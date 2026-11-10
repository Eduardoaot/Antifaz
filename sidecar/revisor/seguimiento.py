"""Seguimiento de un objeto en video.

EdgeTAM (Apache-2.0) es preciso pero lento en CPU (~1 s/frame). El seguidor por defecto es un
híbrido: EdgeTAM solo en keyframes y CSRT (OpenCV contrib) entre medias. Medido en docs/benchmarks/.

La persona elige el objeto en cualquier frame, con un punto o una caja. Se propaga hacia adelante y
hacia atrás desde ahí. Devuelve una máscara por frame recibido, vacía si se perdió el objeto:
`pistas.zonas` decide qué ocultar y qué marcar para revisión.

Los pesos de EdgeTAM se verifican por hash antes de cargarlos y se cargan sin red.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from .errores import Codigo, ErrorRevisor
from .herramientas import FRAMES_MAX, Frame
from .pistas import Mascara

CARPETA_EDGETAM = "edgetam"
ARCHIVOS_EDGETAM = {
    "config.json": "0827d003132f67efc496928f4fe5dd4125fcac518950c4eabe1d1f85e245c82a",
    "model.safetensors": "8858f8e4757b0b96dab8763f296ecffd845efbbbf698f64163cfa20a63d5fff4",
    "preprocessor_config.json": "247f7be8f3979e98bc8e89b94c3e6542f6f1506070c97fbcc983f53a64a9bf86",
    "processor_config.json": "f8a68e865cfad115c1c2763f3d93eca7b1c622da06da2a9273eb437fb2389b6d",
    "video_preprocessor_config.json": "0b05a4bdcd7bb31e7bc12d5882e6a4f4ea7fcc8063d2240ab225e57561658233",
}
# qa/RANGOS.md, "Procesamiento de video": lado corto del proxy.
PROXY_LADO_MIN = 240
PROXY_LADO_MAX = 720
# Cada cuántos frames del proxy se llama a EdgeTAM. 4 ≈ 6 llamadas/s a 24 fps de tracking.
PASO_CLAVE_MIN = 1
PASO_CLAVE_MAX = 24
PASO_CLAVE_DEFAULT = 4
# Margen extra sobre la caja de CSRT al unirla con la silueta trasladada (fail-closed).
MARGEN_CAJA_CSRT_PCT = 15.0
MARGEN_CAJA_CSRT_PX = 8


@dataclass(frozen=True)
class Punto:
    x: int
    y: int


@dataclass(frozen=True)
class Caja:
    x0: int
    y0: int
    x1: int  # exclusivo
    y1: int


Indicacion = Punto | Caja
# Se llama tras cada frame con (frames hechos, total). Cancelar es reiniciar el sidecar (app/main).
Avance = Callable[[int, int], None]


class Seguidor(Protocol):
    def seguir(
        self, frames: Sequence[Frame], frame_inicio: int, indicacion: Indicacion, avance: Avance | None = None
    ) -> dict[int, Mascara]: ...


def validar(frames: Sequence[Frame], frame_inicio: int, indicacion: Indicacion) -> tuple[int, int]:
    """Valida todo antes de tocar el modelo. Devuelve (alto, ancho)."""
    if not 1 <= len(frames) <= FRAMES_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, f"cantidad de frames fuera de rango: {len(frames)}")
    forma = frames[0].shape
    if len(forma) != 3 or forma[2] != 3:
        raise ErrorRevisor(Codigo.VALIDACION, "frame que no es RGB")
    alto, ancho = int(forma[0]), int(forma[1])
    if not PROXY_LADO_MIN <= min(alto, ancho) <= PROXY_LADO_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, f"proxy fuera de rango: {ancho}x{alto}")
    if any(f.shape != forma or f.dtype != np.uint8 for f in frames):
        raise ErrorRevisor(Codigo.VALIDACION, "frames de tamaños o tipos distintos")
    if not 0 <= frame_inicio < len(frames):
        raise ErrorRevisor(Codigo.VALIDACION, f"frame inicial fuera del video: {frame_inicio}")
    match indicacion:
        case Punto(x=x, y=y):
            if not (0 <= x < ancho and 0 <= y < alto):
                raise ErrorRevisor(Codigo.REGION_FUERA_DE_IMAGEN, "punto fuera del frame")
        case Caja(x0=x0, y0=y0, x1=x1, y1=y1):
            if not (0 <= x0 < x1 <= ancho and 0 <= y0 < y1 <= alto):
                raise ErrorRevisor(Codigo.REGION_FUERA_DE_IMAGEN, "caja fuera del frame o vacía")
    return alto, ancho


def verificar_pesos(carpeta: Path) -> Path:
    destino = carpeta / CARPETA_EDGETAM
    for nombre, esperado in ARCHIVOS_EDGETAM.items():
        ruta = destino / nombre
        try:
            h = hashlib.sha256()
            with ruta.open("rb") as archivo:
                while bloque := archivo.read(1024 * 1024):
                    h.update(bloque)
        except OSError as e:
            raise ErrorRevisor(Codigo.SEGUIMIENTO_NO_DISPONIBLE, f"edgetam: falta {nombre}") from e
        if h.hexdigest() != esperado:
            raise ErrorRevisor(Codigo.SEGUIMIENTO_NO_DISPONIBLE, f"edgetam: hash distinto en {nombre}")
    return destino


class SeguidorEdgeTam:
    def __init__(self, carpeta_modelos: Path) -> None:
        destino = verificar_pesos(carpeta_modelos)
        # Sin red: los pesos ya están verificados en disco. Debe fijarse antes de importar.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import torch
        from transformers import EdgeTamVideoModel, Sam2VideoProcessor

        self._torch: Any = torch
        try:
            self._modelo: Any = EdgeTamVideoModel.from_pretrained(str(destino), local_files_only=True).eval()
            self._procesador: Any = Sam2VideoProcessor.from_pretrained(str(destino), local_files_only=True)
        except (OSError, ValueError) as e:
            detalle = f"edgetam: no cargó ({type(e).__name__})"
            raise ErrorRevisor(Codigo.SEGUIMIENTO_NO_DISPONIBLE, detalle) from e

    def seguir(
        self, frames: Sequence[Frame], frame_inicio: int, indicacion: Indicacion, avance: Avance | None = None
    ) -> dict[int, Mascara]:
        alto, ancho = validar(frames, frame_inicio, indicacion)
        try:
            return self._seguir(list(frames), frame_inicio, indicacion, alto, ancho, avance)
        except MemoryError as e:
            raise ErrorRevisor(Codigo.MEMORIA_INSUFICIENTE, "edgetam: sin memoria") from e
        except RuntimeError as e:
            # Errores de PyTorch: el mensaje puede traer tamaños pero no contenido; solo se registra el tipo.
            raise ErrorRevisor(Codigo.INTERNO, f"edgetam: {type(e).__name__}") from e

    def _seguir(
        self,
        frames: list[Frame],
        inicio: int,
        indicacion: Indicacion,
        alto: int,
        ancho: int,
        avance: Avance | None,
    ) -> dict[int, Mascara]:
        torch = self._torch
        total = len(frames)
        mascaras: dict[int, Mascara] = {}
        with torch.inference_mode():
            sesion = self._procesador.init_video_session(
                video=frames, inference_device="cpu", dtype=torch.float32
            )
            match indicacion:
                case Punto(x=x, y=y):
                    self._procesador.add_inputs_to_inference_session(
                        inference_session=sesion, frame_idx=inicio, obj_ids=1,
                        input_points=[[[[x, y]]]], input_labels=[[[1]]],
                    )
                case Caja(x0=x0, y0=y0, x1=x1, y1=y1):
                    self._procesador.add_inputs_to_inference_session(
                        inference_session=sesion, frame_idx=inicio, obj_ids=1,
                        input_boxes=[[[x0, y0, x1, y1]]],
                    )
            self._modelo(inference_session=sesion, frame_idx=inicio)
            for reverso in (False, True):
                if reverso and inicio == 0:
                    break
                iterador = self._modelo.propagate_in_video_iterator(
                    sesion, start_frame_idx=inicio, reverse=reverso
                )
                for salida in iterador:
                    m = self._procesador.post_process_masks(
                        [salida.pred_masks], original_sizes=[[alto, ancho]]
                    )[0]
                    indice = int(salida.frame_idx)
                    mascaras[indice] = np.asarray(m[0, 0].numpy(), dtype=bool)
                    if avance is not None:
                        avance(len(mascaras), total)
        faltan = [i for i in range(total) if i not in mascaras]
        if faltan:
            # Fail-closed: un frame sin respuesta del modelo nunca queda como "sin objeto" en silencio.
            raise ErrorRevisor(Codigo.INTERNO, f"edgetam: {len(faltan)} frames sin máscara")
        return mascaras


def _caja_de_mascara(m: Mascara) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _mascara_de_caja(caja: tuple[int, int, int, int], alto: int, ancho: int) -> Mascara:
    x0, y0, x1, y1 = caja
    m = np.zeros((alto, ancho), dtype=bool)
    m[max(0, y0) : max(0, min(alto, y1)), max(0, x0) : max(0, min(ancho, x1))] = True
    return m


def _centro_caja(caja: tuple[int, int, int, int]) -> tuple[float, float]:
    x0, y0, x1, y1 = caja
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def _desplazar_mascara(m: Mascara, dx: float, dy: float) -> Mascara:
    matriz = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]], dtype=np.float32)
    movida = cv2.warpAffine(
        m.astype(np.uint8) * 255, matriz, (m.shape[1], m.shape[0]), flags=cv2.INTER_NEAREST
    )
    return movida > 0


def _ampliar_caja(caja: tuple[int, int, int, int], alto: int, ancho: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = caja
    margen = max(MARGEN_CAJA_CSRT_PX, int(round(min(x1 - x0, y1 - y0) * MARGEN_CAJA_CSRT_PCT / 100.0)))
    return max(0, x0 - margen), max(0, y0 - margen), min(ancho, x1 + margen), min(alto, y1 + margen)


def _zona_entre_claves(
    mascara_clave: Mascara, caja_clave: tuple[int, int, int, int], caja_nueva: tuple[int, int, int, int]
) -> Mascara:
    """Silueta del keyframe movida al centro de CSRT, unida a la caja ampliada (cubre de más)."""
    alto, ancho = int(mascara_clave.shape[0]), int(mascara_clave.shape[1])
    cx0, cy0 = _centro_caja(caja_clave)
    cx1, cy1 = _centro_caja(caja_nueva)
    movida = _desplazar_mascara(mascara_clave, cx1 - cx0, cy1 - cy0)
    caja = _mascara_de_caja(_ampliar_caja(caja_nueva, alto, ancho), alto, ancho)
    return movida | caja


def _csrt_disponible() -> bool:
    legacy = getattr(cv2, "legacy", None)
    return legacy is not None and hasattr(legacy, "TrackerCSRT_create")


def _nuevo_csrt() -> Any:
    if not _csrt_disponible():
        raise ErrorRevisor(Codigo.SEGUIMIENTO_NO_DISPONIBLE, "csrt: opencv sin contrib")
    return cv2.legacy.TrackerCSRT_create()


def _bgr(frame: Frame) -> np.ndarray:
    return cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)


def _indices_clave(total: int, frame_inicio: int, paso: int) -> list[int]:
    """Keyframe cada `paso` frames, siempre con el inicio, el primero y el último."""
    indices = {0, total - 1, frame_inicio}
    k = frame_inicio % paso
    while k < total:
        indices.add(k)
        k += paso
    return sorted(indices)


class SeguidorHibrido:
    """EdgeTAM una vez sobre los keyframes (video corto); CSRT rellena los huecos.

    Así EdgeTAM conserva contexto temporal entre claves. Si CSRT se pierde, máscara vacía
    y `pistas` marca revisión.
    """

    def __init__(self, edgetam: SeguidorEdgeTam, paso: int = PASO_CLAVE_DEFAULT) -> None:
        if not PASO_CLAVE_MIN <= paso <= PASO_CLAVE_MAX:
            raise ErrorRevisor(Codigo.VALIDACION, f"paso de keyframes fuera de rango: {paso}")
        if not _csrt_disponible():
            raise ErrorRevisor(Codigo.SEGUIMIENTO_NO_DISPONIBLE, "csrt: opencv sin contrib")
        self._edgetam = edgetam
        self._paso = paso

    def seguir(
        self, frames: Sequence[Frame], frame_inicio: int, indicacion: Indicacion, avance: Avance | None = None
    ) -> dict[int, Mascara]:
        alto, ancho = validar(frames, frame_inicio, indicacion)
        lista = list(frames)
        total = len(lista)
        vacia = np.zeros((alto, ancho), dtype=bool)
        claves = _indices_clave(total, frame_inicio, self._paso)
        frames_clave = [lista[i] for i in claves]
        inicio_clave = claves.index(frame_inicio)

        def avance_clave(hechos: int, _total_clave: int) -> None:
            if avance is None:
                return
            # Estima el progreso sobre el video completo según keyframes hechos.
            approx = min(total, max(1, hechos * self._paso))
            avance(approx, total)

        por_clave = self._edgetam.seguir(frames_clave, inicio_clave, indicacion, avance_clave)
        mascaras: dict[int, Mascara] = {claves[i]: por_clave[i] for i in range(len(claves))}

        def rellenar(a: int, b: int) -> None:
            """Rellena (a, b) exclusive con CSRT desde la silueta en a hacia b."""
            if b - a <= 1:
                return
            mascara_a = mascaras[a]
            caja_a = _caja_de_mascara(mascara_a)
            if caja_a is None:
                for t in range(a + 1, b):
                    mascaras[t] = vacia.copy()
                return
            rastreador = _nuevo_csrt()
            x0, y0, x1, y1 = caja_a
            rastreador.init(_bgr(lista[a]), (x0, y0, x1 - x0, y1 - y0))
            perdio = False
            for t in range(a + 1, b):
                if perdio:
                    mascaras[t] = vacia.copy()
                    continue
                ok, (x, y, w, h) = rastreador.update(_bgr(lista[t]))
                if not ok or w < 1 or h < 1:
                    mascaras[t] = vacia.copy()
                    perdio = True
                    continue
                caja_t = (int(x), int(y), int(x + w), int(y + h))
                mascaras[t] = _zona_entre_claves(mascara_a, caja_a, caja_t)
            if avance is not None:
                avance(len(mascaras), total)

        for i in range(len(claves) - 1):
            rellenar(claves[i], claves[i + 1])

        faltan = [i for i in range(total) if i not in mascaras]
        if faltan:
            raise ErrorRevisor(Codigo.INTERNO, f"hibrido: {len(faltan)} frames sin máscara")
        if avance is not None:
            avance(total, total)
        return mascaras


@lru_cache(maxsize=1)
def seguidor_de(carpeta_modelos: Path) -> SeguidorHibrido:
    return SeguidorHibrido(SeguidorEdgeTam(carpeta_modelos))
