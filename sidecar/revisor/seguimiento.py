"""Seguimiento de un objeto en video con EdgeTAM (Apache-2.0), elegido por el responsable el 2026-11-06.

En el i5-10210U de referencia tarda unos 1.9 s por frame a 480 px: unos 2 minutos por un video de
3 s a 24 fps (qa/REPORTE_FASE_3.md). Queda detrás de la interfaz `Seguidor` por si cambia el método.

La persona elige el objeto en cualquier frame, con un punto o una caja. Se propaga hacia adelante y
hacia atrás desde ahí. Devuelve una máscara por frame recibido, vacía si el modelo no vio el objeto:
`pistas.zonas` decide qué ocultar y qué marcar para revisión.

Los pesos se verifican por hash antes de cargarlos y se cargan sin red.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

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


@lru_cache(maxsize=1)
def seguidor_de(carpeta_modelos: Path) -> SeguidorEdgeTam:
    return SeguidorEdgeTam(carpeta_modelos)
