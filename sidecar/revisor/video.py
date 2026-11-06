"""Lectura de un video con ffprobe y validación contra qa/RANGOS.md ("Video de entrada").

`interpretar_ffprobe` es lógica pura: recibe el JSON de ffprobe y devuelve `InfoVideo` o un error
tipado. Lo que no se entiende se rechaza, porque revisar solo una parte sin decirlo no es aceptable:
- más de una pista de video, porque solo se revisaría una;
- una rotación que no sea múltiplo de 90°, porque la máscara quedaría desalineada;
- un contenedor fuera de la lista.

Las pistas de datos (como el GPS de algunas cámaras) y los subtítulos no se revisan: se cuentan para
avisar, y la exportación nunca los copia.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, cast

from .errores import Codigo, ErrorRevisor
from .herramientas import Herramienta, Herramientas, entrada

# qa/RANGOS.md, "Video de entrada". Si cambias uno, cambia también ese documento.
# Beta: máximo 3 s y seguimiento a 24 fps, por decisión del responsable (2026-11-06).
DURACION_MAX_S = 3.0
# Un clip "de 3 s" del teléfono suele durar 3.003 s o más: se acepta un frame de más, hasta 0.05 s.
TOLERANCIA_MAX_S = 0.05
DURACION_AVISO_S = 3
TRACKING_FPS = 24.0
LADO_MIN_PX = 16
LADO_MAX_PX = 8192
FPS_MAX = 240.0
TIEMPO_FFPROBE_S = 60.0

# Nombres de formato tal como los da ffprobe.
CONTENEDORES = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"}


@dataclass(frozen=True)
class InfoVideo:
    duracion_s: float
    ancho: int  # tal como está codificado, antes de rotar
    alto: int
    fps: float
    rotacion: int  # 0, 90, 180 o 270, en sentido horario para verlo derecho
    tiene_audio: bool
    frames_estimados: int
    pistas_sin_revisar: int  # datos y subtítulos: no se exportan
    requiere_confirmar: bool  # dura más que DURACION_AVISO_S

    @property
    def fps_tracking(self) -> float:
        """Nunca más frames de los que tiene el video."""
        return min(TRACKING_FPS, self.fps)

    @property
    def ancho_visible(self) -> int:
        return self.alto if self.rotacion in (90, 270) else self.ancho

    @property
    def alto_visible(self) -> int:
        return self.ancho if self.rotacion in (90, 270) else self.alto


def _fraccion(texto: object) -> float | None:
    """"30000/1001" → 29.97. "0/0" o algo ilegible → None."""
    if not isinstance(texto, str) or "/" not in texto:
        return None
    numerador, _, denominador = texto.partition("/")
    try:
        valor = Fraction(int(numerador), int(denominador))
    except (ValueError, ZeroDivisionError):
        return None
    return float(valor) if valor > 0 else None


def _decimal(texto: object) -> float | None:
    if not isinstance(texto, (str, int, float)) or isinstance(texto, bool):
        return None
    try:
        valor = float(texto)
    except ValueError:
        return None
    return valor if math.isfinite(valor) else None


def _entero(valor: object) -> int | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, str) and valor.lstrip("-").isdigit():
        return int(valor)
    return None


def _diccionario(valor: object) -> dict[str, Any]:
    return cast(dict[str, Any], valor) if isinstance(valor, dict) else {}


def _lista(valor: object) -> list[Any]:
    return cast(list[Any], valor) if isinstance(valor, list) else []


def _rotacion(pista: dict[str, Any]) -> int:
    """Grados en sentido horario para verlo derecho. ffprobe da la matriz en sentido antihorario."""
    grados: float | None = None
    for dato in _lista(pista.get("side_data_list")):
        dato = _diccionario(dato)
        if dato.get("side_data_type") == "Display Matrix" and "rotation" in dato:
            grados = _decimal(dato.get("rotation"))
            if grados is None:
                raise ErrorRevisor(Codigo.VIDEO_NO_SOPORTADO, "rotación ilegible")
            grados = -grados
    if grados is None:
        etiqueta = _diccionario(pista.get("tags")).get("rotate")
        if etiqueta is not None:
            grados = _decimal(etiqueta)
            if grados is None:
                raise ErrorRevisor(Codigo.VIDEO_NO_SOPORTADO, "rotación ilegible")
    if grados is None:
        return 0
    if not math.isclose(grados / 90, round(grados / 90), abs_tol=1e-6):
        raise ErrorRevisor(Codigo.VIDEO_NO_SOPORTADO, f"rotación de {grados}°")
    return int(round(grados)) % 360


def limite_duracion(fps: float) -> float:
    """Duración máxima aceptada para un video con estos fps: el máximo más un frame, con tope."""
    return DURACION_MAX_S + min(1 / fps, TOLERANCIA_MAX_S)


def interpretar_ffprobe(salida: bytes) -> InfoVideo:
    try:
        datos = json.loads(salida)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, "ffprobe dio un JSON ilegible") from e
    raiz = _diccionario(datos)
    formato = _diccionario(raiz.get("format"))
    pistas = [_diccionario(p) for p in _lista(raiz.get("streams"))]
    if not formato or not pistas:
        raise ErrorRevisor(Codigo.NO_ES_VIDEO, "sin formato o sin pistas")
    nombre = formato.get("format_name")
    if nombre not in CONTENEDORES:
        raise ErrorRevisor(Codigo.NO_ES_VIDEO, f"contenedor {nombre!r}")

    # Una portada (attached_pic) es una imagen fija dentro del contenedor, no una pista de video.
    videos = [
        p for p in pistas
        if p.get("codec_type") == "video"
        and _entero(_diccionario(p.get("disposition")).get("attached_pic")) != 1
    ]
    if not videos:
        raise ErrorRevisor(Codigo.NO_ES_VIDEO, "sin pista de video")
    if len(videos) > 1:
        raise ErrorRevisor(Codigo.VIDEO_NO_SOPORTADO, f"{len(videos)} pistas de video")
    video = videos[0]
    audio = sum(1 for p in pistas if p.get("codec_type") == "audio")
    # Datos, subtítulos y portadas: no se revisan y la exportación no los copia.
    otras = len(pistas) - 1 - audio

    ancho, alto = _entero(video.get("width")), _entero(video.get("height"))
    if ancho is None or alto is None:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, "sin dimensiones")
    if not (LADO_MIN_PX <= ancho <= LADO_MAX_PX and LADO_MIN_PX <= alto <= LADO_MAX_PX):
        raise ErrorRevisor(Codigo.VIDEO_TAMANO_NO_SOPORTADO, f"{ancho}x{alto}")

    fps = _fraccion(video.get("avg_frame_rate")) or _fraccion(video.get("r_frame_rate"))
    if fps is None:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, "sin frame rate")
    if fps > FPS_MAX:
        raise ErrorRevisor(Codigo.VIDEO_NO_SOPORTADO, f"{fps:.1f} fps")

    duracion = _decimal(formato.get("duration"))
    if duracion is None:
        duracion = _decimal(video.get("duration"))
    if duracion is None or duracion < 0:
        raise ErrorRevisor(Codigo.VIDEO_CORRUPTO, "sin duración")
    if duracion > limite_duracion(fps):
        raise ErrorRevisor(Codigo.VIDEO_DEMASIADO_LARGO, f"{duracion:.0f} s")

    frames = _entero(video.get("nb_frames"))
    if frames is None or frames < 1:
        frames = max(1, round(duracion * fps))
    if duracion == 0:
        # Un video de un frame es válido (ARC-010): su duración es la de ese frame.
        duracion = 1 / fps

    return InfoVideo(
        duracion_s=duracion,
        ancho=ancho,
        alto=alto,
        fps=fps,
        rotacion=_rotacion(video),
        tiene_audio=audio > 0,
        frames_estimados=frames,
        pistas_sin_revisar=otras,
        requiere_confirmar=duracion > DURACION_AVISO_S,
    )


def leer(herramientas: Herramientas, ruta: str) -> InfoVideo:
    salida = herramientas.ejecutar(
        Herramienta.FFPROBE,
        ["-print_format", "json", "-show_format", "-show_streams", entrada(ruta)],
        TIEMPO_FFPROBE_S,
    )
    return interpretar_ffprobe(salida)
