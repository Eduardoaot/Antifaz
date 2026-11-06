"""Video en la app: abrir, ver un frame, seguir un objeto, quitarlo y exportar.

Flujo de la beta (decisiones del responsable, 2026-11-06): hasta 3 s, seguimiento a 24 fps con
EdgeTAM sobre un proxy de 480 px. En video todavía no hay detección automática: la persona elige
qué ocultar, y la app lo dice.

Privacidad:
- Los frames sin ocultar solo viven en memoria y en tuberías con FFmpeg (SEG-004).
- Antes de exportar se comprueba que el archivo sigue siendo el mismo (huella).
- La salida se escribe a un temporal, se revisa con `metadatos_video.py` y con exiftool, y solo
  entonces se renombra. Si algo falla, no queda archivo final (FCL-008).
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import math
import os
import re
import uuid
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

import cv2
import numpy as np

from . import efectos, metadatos_video, pistas, video
from .errores import Codigo, ErrorRevisor
from .esquemas import Ocultamiento, TipoEfecto
from .exportar import error_de_sistema, limpiar_parciales
from .herramientas import FRAMES_MAX, Frame, Herramienta, Herramientas, entrada
from .pistas import Mascara
from .rutas import misma_ruta, ruta_larga
from .seguimiento import Punto, Seguidor

registro = logging.getLogger(__name__)

PROXY_LADO = 480
PROXY_LADO_MIN = 240
PROXY_LARGO_MAX = 4096
TIEMPO_DECODIFICAR_S = 300.0
TIEMPO_EXPORTAR_S = 3600.0
TIEMPO_REVISAR_S = 120.0
# qa/RANGOS.md, "Exportación". En video: H.264 con CRF y AAC.
CRF = 20
AUDIO_KBPS = 160
CALIDAD_VISTA = 85
_BLOQUE_HASH = 1024 * 1024


@dataclass
class PistaVideo:
    rastreadas: dict[int, Mascara]  # por índice de frame del video, en el proxy
    revisar: frozenset[int]  # frames del video donde se perdió el objeto


@dataclass
class VideoAbierto:
    ruta: str
    huella: str
    info: video.InfoVideo
    total: int  # frames reales decodificados
    indices: list[int]  # frames rastreados, en orden
    proxy: list[Frame]  # un frame del proxy por cada índice
    pistas: dict[str, PistaVideo] = field(default_factory=lambda: {})

    @property
    def proxy_alto(self) -> int:
        return int(self.proxy[0].shape[0])

    @property
    def proxy_ancho(self) -> int:
        return int(self.proxy[0].shape[1])


def huella_de(ruta: str) -> str:
    h = hashlib.sha256()
    try:
        with open(ruta_larga(ruta), "rb") as archivo:
            while bloque := archivo.read(_BLOQUE_HASH):
                h.update(bloque)
    except FileNotFoundError as e:
        raise ErrorRevisor(Codigo.ARCHIVO_NO_ENCONTRADO) from e
    except PermissionError as e:
        raise ErrorRevisor(Codigo.SIN_PERMISOS) from e
    except OSError as e:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, f"no se pudo leer: errno {e.errno}") from e
    return h.hexdigest()


def _par(valor: int) -> int:
    return max(2, valor - valor % 2)


def dimensiones_proxy(ancho: int, alto: int) -> tuple[int, int]:
    """Lado corto de 480 px. Uno más chico se amplía hasta 240, el mínimo de EdgeTAM. Siempre pares."""
    corto, largo = min(ancho, alto), max(ancho, alto)
    objetivo = PROXY_LADO if corto >= PROXY_LADO else max(corto, PROXY_LADO_MIN)
    largo_proxy = round(largo * objetivo / corto)
    if largo_proxy > PROXY_LARGO_MAX:
        raise ErrorRevisor(Codigo.VIDEO_TAMANO_NO_SOPORTADO, f"demasiado alargado: {ancho}x{alto}")
    corto_proxy, largo_proxy = _par(objetivo), _par(largo_proxy)
    return (corto_proxy, largo_proxy) if ancho <= alto else (largo_proxy, corto_proxy)


def _quedarse(i: int, deseados: set[int], estimado: int, paso: int) -> bool:
    # Si el video trae más frames de los que dijo ffprobe, se sigue con el mismo paso.
    return i in deseados or (i >= estimado and (i - estimado) % paso == 0)


def abrir(herramientas: Herramientas, ruta: str) -> VideoAbierto:
    if not os.path.isfile(ruta_larga(ruta)):
        raise ErrorRevisor(Codigo.ARCHIVO_NO_ENCONTRADO)
    if os.path.getsize(ruta_larga(ruta)) == 0:
        raise ErrorRevisor(Codigo.ARCHIVO_VACIO)
    huella = huella_de(ruta)
    info = video.leer(herramientas, ruta)
    ancho_p, alto_p = dimensiones_proxy(info.ancho_visible, info.alto_visible)
    estimado = min(info.frames_estimados, FRAMES_MAX)
    deseados = set(pistas.frames_a_rastrear(estimado, info.fps, info.fps_tracking))
    paso = max(1, math.ceil(info.fps / info.fps_tracking))
    argumentos = [
        "-i", entrada(ruta), "-map", "0:v:0", "-an", "-sn", "-dn", "-fps_mode", "passthrough",
        "-vf", f"scale={ancho_p}:{alto_p}:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ]
    indices: list[int] = []
    proxy: list[Frame] = []
    ultimo: tuple[int, Frame] | None = None
    total = 0
    lector = herramientas.leer_frames(argumentos, ancho_p, alto_p, FRAMES_MAX, TIEMPO_DECODIFICAR_S)
    with contextlib.closing(lector):
        for i, frame in enumerate(lector):
            total = i + 1
            if _quedarse(i, deseados, estimado, paso):
                indices.append(i)
                proxy.append(frame.copy())
            ultimo = (i, frame)
    if ultimo is None:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, "sin frames")
    if indices[-1] != ultimo[0]:
        # El último frame siempre se rastrea: después de él no hay con qué interpolar.
        indices.append(ultimo[0])
        proxy.append(ultimo[1].copy())
    # La duración real manda: si ffprobe dijo menos, el límite de la beta se aplica de nuevo.
    if total / info.fps > video.limite_duracion(info.fps) + 1 / info.fps:
        raise ErrorRevisor(Codigo.VIDEO_DEMASIADO_LARGO, f"{total} frames reales")
    return VideoAbierto(ruta, huella, info, total, indices, proxy)


def _posicion(abierto: VideoAbierto, posicion: int) -> int:
    if not 0 <= posicion < len(abierto.indices):
        raise ErrorRevisor(Codigo.VALIDACION, f"posición fuera del video: {posicion}")
    return abierto.indices[posicion]


def _pista(abierto: VideoAbierto, pista_id: str) -> PistaVideo:
    pista = abierto.pistas.get(pista_id)
    if pista is None:
        raise ErrorRevisor(Codigo.VALIDACION, "pista desconocida")
    return pista


def seguir(abierto: VideoAbierto, seguidor: Seguidor, posicion: int, x: int, y: int) -> dict[str, object]:
    _posicion(abierto, posicion)
    por_posicion = seguidor.seguir(abierto.proxy, posicion, Punto(x, y))
    rastreadas = {abierto.indices[p]: m for p, m in por_posicion.items()}
    if not any(m.any() for m in rastreadas.values()):
        raise ErrorRevisor(Codigo.SIN_OBJETO, "el seguimiento no encontró el objeto")
    revisar = frozenset(z.frame for z in pistas.zonas(rastreadas, abierto.total) if z.revisar)
    pista_id = uuid.uuid4().hex
    abierto.pistas[pista_id] = PistaVideo(rastreadas, revisar)
    con_objeto = sum(1 for m in rastreadas.values() if m.any())
    return {
        "pista_id": pista_id,
        "frames_revisar": len(revisar),
        "posiciones_revisar": [p for p, i in enumerate(abierto.indices) if i in revisar],
        "frames_con_objeto": con_objeto,
        "frames_rastreados": len(rastreadas),
    }


def quitar(abierto: VideoAbierto, pista_id: str) -> None:
    _pista(abierto, pista_id)
    del abierto.pistas[pista_id]


def _ocultamientos(
    zonas_frame: Sequence[tuple[str, Mascara, TipoEfecto]], alto: int, ancho: int
) -> tuple[list[Ocultamiento], dict[str, Mascara]]:
    """Cada zona, ya a la resolución del frame, como un ocultamiento con su silueta."""
    lista: list[Ocultamiento] = []
    siluetas: dict[str, Mascara] = {}
    for clave, mascara, efecto in zonas_frame:
        completa = pistas.a_resolucion(mascara, alto, ancho)
        ys, xs = np.nonzero(completa)
        if xs.size == 0:
            continue
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        siluetas[clave] = completa[y0:y1, x0:x1]
        lista.append(
            Ocultamiento(
                x=x0, y=y0, ancho=x1 - x0, alto=y1 - y0, efecto=efecto,
                # La zona ya trae su margen; los 8 px mínimos de fotos se suman y no destapan nada.
                dilatacion_px=8, dilatacion_pct=0.0, mascara_id=clave,
            )
        )
    return lista, siluetas


def _aplicar(frame: Frame, zonas_frame: Sequence[tuple[str, Mascara, TipoEfecto]]) -> Frame:
    alto, ancho = int(frame.shape[0]), int(frame.shape[1])
    ocultamientos, siluetas = _ocultamientos(zonas_frame, alto, ancho)
    if not ocultamientos:
        return frame
    salida, _ = efectos.aplicar(frame, ocultamientos, siluetas)
    return salida


def vista(
    abierto: VideoAbierto, posicion: int, elegidas: Sequence[tuple[str, TipoEfecto]]
) -> tuple[bytes, bool]:
    """JPEG del frame en el proxy con las zonas ocultas, y si ese frame se debe revisar."""
    indice = _posicion(abierto, posicion)
    zonas_frame: list[tuple[str, Mascara, TipoEfecto]] = []
    revisar = False
    for pista_id, efecto in elegidas:
        pista = _pista(abierto, pista_id)
        zona = pistas.zona_en(pista.rastreadas, abierto.total, indice)
        zonas_frame.append((pista_id, zona.mascara, efecto))
        revisar |= zona.revisar
    frame = _aplicar(abierto.proxy[posicion], zonas_frame)
    bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    ok, datos = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, CALIDAD_VISTA])
    if not ok:
        raise ErrorRevisor(Codigo.INTERNO, "no se pudo codificar la vista")
    return bytes(datos.tobytes()), revisar


# --- Exportación --------------------------------------------------------------------------------

# Grupos de exiftool que describen el archivo en disco o la propia herramienta, no su contenido.
_GRUPOS_FUERA = {"ExifTool", "System", "File", "Composite"}
_GRUPOS_CONTENIDO = re.compile(r"QuickTime|Track\d+")
_ETIQUETAS_PROHIBIDAS = re.compile(
    r"GPS|Location|Make|Model|Serial|Author|Artist|Copyright|Comment|Title|Software|Encoder|Creator|Owner"
    r"|Description",
    re.IGNORECASE,
)
_ETIQUETAS_PERMITIDAS = {"HandlerDescription"}
_FECHAS_CERO = {"0000:00:00 00:00:00", "0", ""}


def revisar_exiftool(salida: bytes) -> None:
    """Segunda revisión, independiente de la de cajas. Solo registra nombres de etiquetas, no valores."""
    try:
        datos = json.loads(salida)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "exiftool dio un JSON ilegible") from e
    if not isinstance(datos, list) or len(cast(list[Any], datos)) != 1:
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "exiftool no describió un solo archivo")
    descripcion = cast(list[Any], datos)[0]
    if not isinstance(descripcion, dict):
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "exiftool sin descripción")
    for clave, valor in cast(dict[str, Any], descripcion).items():
        if clave == "SourceFile":
            continue
        grupo, _, etiqueta = clave.partition(":")
        if not etiqueta or grupo in _GRUPOS_FUERA:
            continue
        if not _GRUPOS_CONTENIDO.fullmatch(grupo):
            raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, f"exiftool: grupo {grupo}")
        if etiqueta not in _ETIQUETAS_PERMITIDAS and _ETIQUETAS_PROHIBIDAS.search(etiqueta):
            raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, f"exiftool: {grupo}:{etiqueta}")
        if "Date" in etiqueta and str(valor).strip() not in _FECHAS_CERO:
            raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, f"exiftool: fecha en {grupo}:{etiqueta}")


def argumentos_codificar(
    ancho: int, alto: int, fps: float, ruta_original: str, con_audio: bool, temporal: str
) -> list[str]:
    """FFmpeg: frames por tubería, audio del original y ningún metadato."""
    argumentos = [
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ancho}x{alto}", "-framerate", f"{fps:.6f}",
        "-i", "pipe:0",
    ]
    if con_audio:
        argumentos += ["-i", entrada(ruta_original)]
    argumentos += ["-map", "0:v:0"]
    if con_audio:
        argumentos += ["-map", "1:a:0?", "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-shortest"]
    argumentos += [
        "-c:v", "libx264", "-preset", "medium", "-crf", str(CRF), "-pix_fmt", "yuv420p",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
        "-movflags", "+faststart", "-f", "mp4", "-y", "file:" + temporal,
    ]
    return argumentos


def _frames_ocultos(
    herramientas: Herramientas,
    abierto: VideoAbierto,
    elegidas: Sequence[tuple[str, TipoEfecto]],
    ancho: int,
    alto: int,
) -> Iterator[Frame]:
    """Decodifica a resolución completa y oculta cada frame. Un frame de más o de menos es un error."""
    argumentos = [
        "-i", entrada(abierto.ruta), "-map", "0:v:0", "-an", "-sn", "-dn", "-fps_mode", "passthrough",
        "-vf", f"crop={ancho}:{alto}:0:0", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ]
    generadores: list[tuple[str, Iterator[pistas.ZonaFrame], TipoEfecto]] = [
        (pista_id, pistas.zonas(_pista(abierto, pista_id).rastreadas, abierto.total), efecto)
        for pista_id, efecto in elegidas
    ]
    lector = herramientas.leer_frames(argumentos, ancho, alto, FRAMES_MAX, TIEMPO_EXPORTAR_S)
    vistos = 0
    with contextlib.closing(lector):
        for frame in lector:
            if vistos >= abierto.total:
                raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "más frames que al abrir")
            zonas_frame: list[tuple[str, Mascara, TipoEfecto]] = [
                (pista_id, next(zonas).mascara, efecto) for pista_id, zonas, efecto in generadores
            ]
            vistos += 1
            yield _aplicar(frame, zonas_frame)
    if vistos != abierto.total:
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, f"{vistos} de {abierto.total} frames")


def _verificar_salida(herramientas: Herramientas, temporal: str, ancho: int, alto: int) -> None:
    with open(temporal, "rb") as archivo:
        metadatos_video.verificar_mp4(archivo)
    carpeta, nombre = os.path.split(temporal)
    revisar_exiftool(
        herramientas.ejecutar(
            Herramienta.EXIFTOOL, ["-j", "-a", "-G1", "-n", "--", nombre], TIEMPO_REVISAR_S, cwd=carpeta
        )
    )
    salida = video.leer(herramientas, temporal)
    if (salida.ancho, salida.alto, salida.rotacion) != (ancho, alto, 0):
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "dimensiones o rotación distintas")


def exportar(
    herramientas: Herramientas,
    abierto: VideoAbierto,
    elegidas: Sequence[tuple[str, TipoEfecto]],
    ruta_destino: str,
    sobrescribir: bool,
) -> dict[str, object]:
    if os.path.splitext(ruta_destino)[1].lower() != ".mp4":
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, "el video se exporta como MP4")
    if misma_ruta(ruta_destino, abierto.ruta):
        raise ErrorRevisor(Codigo.DESTINO_ES_ORIGEN)
    destino = ruta_larga(ruta_destino)
    if os.path.exists(destino) and not sobrescribir:
        raise ErrorRevisor(Codigo.DESTINO_EXISTE)
    carpeta = os.path.dirname(destino)
    if not os.path.isdir(carpeta):
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, "la carpeta no existe")
    for pista_id, _ in elegidas:
        _pista(abierto, pista_id)
    # Las decisiones solo valen para los mismos bytes.
    if huella_de(abierto.ruta) != abierto.huella:
        raise ErrorRevisor(Codigo.ARCHIVO_CAMBIO)
    limpiar_parciales(carpeta)
    ancho, alto = _par(abierto.info.ancho_visible), _par(abierto.info.alto_visible)
    temporal = os.path.join(carpeta, f".{uuid.uuid4().hex}.parcial")
    try:
        herramientas.escribir_frames(
            argumentos_codificar(
                ancho, alto, abierto.info.fps, abierto.ruta, abierto.info.tiene_audio, temporal
            ),
            _frames_ocultos(herramientas, abierto, elegidas, ancho, alto),
            ancho,
            alto,
            TIEMPO_EXPORTAR_S,
        )
        _verificar_salida(herramientas, temporal, ancho, alto)
        os.replace(temporal, destino)
    except OSError as e:
        raise error_de_sistema(e) from e
    finally:
        try:
            if os.path.exists(temporal):
                os.remove(temporal)
        except OSError as e:
            registro.warning("No se pudo borrar un temporal de video: errno %s", e.errno)
    revisar = set[int]().union(*(_pista(abierto, p).revisar for p, _ in elegidas)) if elegidas else set[int]()
    return {
        "bytes": os.path.getsize(destino),
        "pistas_ocultas": len(elegidas),
        "frames": abierto.total,
        "frames_revisar": len(revisar),
    }
