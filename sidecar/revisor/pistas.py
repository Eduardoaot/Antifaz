"""Zona oculta en cada frame de un video, a partir de las máscaras del seguimiento.

No depende del método de seguimiento: recibe una máscara por frame rastreado (vacía si el método
perdió el objeto) y decide qué ocultar en cada frame del video. Las reglas son fail-closed:

- Entre dos frames rastreados se mueven ambas máscaras hacia el frame intermedio, se unen y se
  amplían. Es la interpolación que se midió en tools/benchmark_video.py.
- Si el objeto se pierde a mitad de la pista, se oculta la caja que cubre la última y la siguiente
  posición conocidas, y esos frames se marcan para revisión. Nunca se deja de ocultar.
- Se oculta también `margen_frames` antes del primer frame y después del último en que aparece.
- Al pasar del proxy a la resolución real, un píxel parcialmente cubierto cuenta como cubierto.

Los límites vienen de qa/RANGOS.md ("Procesamiento de video").
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass

import cv2
import numpy as np
import numpy.typing as npt

from .errores import Codigo, ErrorRevisor

Mascara = npt.NDArray[np.bool_]

MARGEN_FRAMES_MAX = 120
MARGEN_FRAMES_DEFAULT = 5
FPS_TRACKING_MIN = 1.0
FPS_TRACKING_MAX = 30.0
MARGEN_PX_MIN = 8
MARGEN_PCT = 10.0


@dataclass(frozen=True)
class ZonaFrame:
    frame: int
    mascara: Mascara
    revisar: bool  # el objeto se perdió aquí: se oculta de más y la persona debe revisarlo


def frames_a_rastrear(total: int, fps_video: float, fps_tracking: float) -> list[int]:
    """Índices de los frames que se rastrean. Siempre incluye el primero y el último."""
    if total < 1:
        raise ErrorRevisor(Codigo.VALIDACION, f"total de frames inválido: {total}")
    if not (math.isfinite(fps_video) and fps_video > 0):
        raise ErrorRevisor(Codigo.VALIDACION, "fps del video inválido")
    if not FPS_TRACKING_MIN <= fps_tracking <= FPS_TRACKING_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, f"fps de tracking fuera de rango: {fps_tracking}")
    paso = max(1.0, fps_video / fps_tracking)
    indices = {min(total - 1, round(k * paso)) for k in range(math.ceil(total / paso) + 1)}
    indices.add(total - 1)
    return sorted(indices)


def margen_px(m: Mascara) -> int:
    """El mismo margen que en fotos: max(8 px, 10% del lado corto de la caja)."""
    caja = _caja(m)
    if caja is None:
        return MARGEN_PX_MIN
    x0, y0, x1, y1 = caja
    return max(MARGEN_PX_MIN, math.ceil(min(x1 - x0, y1 - y0) * MARGEN_PCT / 100))


def _caja(m: Mascara) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _dilatar(m: Mascara, margen: int) -> Mascara:
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margen + 1, 2 * margen + 1))
    return cv2.dilate(m.astype(np.uint8), nucleo).astype(bool)


def _desplazar(m: Mascara, dx: float, dy: float) -> Mascara:
    matriz = np.array([[1, 0, dx], [0, 1, dy]], dtype=np.float32)
    # Lineal y luego "> 0": un píxel tocado en parte cuenta como cubierto.
    forma = (m.shape[1], m.shape[0])
    movida = cv2.warpAffine(m.astype(np.uint8) * 255, matriz, forma, flags=cv2.INTER_LINEAR)
    return movida > 0


def _centro(m: Mascara) -> tuple[float, float]:
    ys, xs = np.nonzero(m)
    return float(xs.mean()), float(ys.mean())


def _caja_de_ambas(a: Mascara, b: Mascara) -> Mascara:
    ca, cb = _caja(a), _caja(b)
    assert ca is not None and cb is not None
    salida = np.zeros_like(a)
    salida[min(ca[1], cb[1]) : max(ca[3], cb[3]), min(ca[0], cb[0]) : max(ca[2], cb[2])] = True
    return salida


def _validar(rastreadas: dict[int, Mascara], total: int) -> tuple[int, int]:
    if not rastreadas:
        raise ErrorRevisor(Codigo.VALIDACION, "pista sin frames rastreados")
    formas = {m.shape for m in rastreadas.values()}
    if len(formas) != 1:
        raise ErrorRevisor(Codigo.VALIDACION, "máscaras de tamaños distintos")
    forma = next(iter(formas))
    if len(forma) != 2 or min(forma) < 1:
        raise ErrorRevisor(Codigo.VALIDACION, "máscara sin dos dimensiones")
    if any(m.dtype != np.bool_ for m in rastreadas.values()):
        raise ErrorRevisor(Codigo.VALIDACION, "máscara que no es booleana")
    if min(rastreadas) < 0 or max(rastreadas) >= total:
        raise ErrorRevisor(Codigo.VALIDACION, "frame rastreado fuera del video")
    return forma[0], forma[1]


def zonas(
    rastreadas: dict[int, Mascara], total: int, margen_frames: int = MARGEN_FRAMES_DEFAULT
) -> Iterator[ZonaFrame]:
    """Una zona por frame del video, en la resolución de las máscaras (el proxy)."""
    if not 0 <= margen_frames <= MARGEN_FRAMES_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, f"margen de frames fuera de rango: {margen_frames}")
    alto, ancho = _validar(rastreadas, total)
    vacia = np.zeros((alto, ancho), dtype=bool)
    con_objeto = sorted(i for i, m in rastreadas.items() if m.any())
    if not con_objeto:
        # El método no encontró nada en ningún frame: no hay de dónde ocultar. Quien llama decide;
        # aquí no se inventa una zona. Se marca todo para revisión.
        for t in range(total):
            yield ZonaFrame(t, vacia, True)
        return
    rastreados = sorted(rastreadas)
    primero, ultimo = con_objeto[0], con_objeto[-1]
    for t in range(total):
        if t < primero:
            dentro = primero - t <= margen_frames
            yield ZonaFrame(t, _ampliada(rastreadas[primero]) if dentro else vacia, False)
            continue
        if t > ultimo:
            dentro = t - ultimo <= margen_frames
            yield ZonaFrame(t, _ampliada(rastreadas[ultimo]) if dentro else vacia, False)
            continue
        yield _zona_dentro(t, rastreadas, rastreados, con_objeto)


def _ampliada(m: Mascara) -> Mascara:
    return _dilatar(m, margen_px(m))


def _zona_dentro(
    t: int, rastreadas: dict[int, Mascara], rastreados: list[int], con_objeto: list[int]
) -> ZonaFrame:
    """t está entre el primer y el último frame con objeto."""
    # Vecinos con objeto: el último antes (o en) t y el primero después (o en) t.
    a = max(i for i in con_objeto if i <= t)
    b = min(i for i in con_objeto if i >= t)
    ma, mb = rastreadas[a], rastreadas[b]
    # ¿Hubo un frame rastreado entre a y b en que se perdió el objeto?
    perdido = any(a < i < b and not rastreadas[i].any() for i in rastreados) or (
        t in rastreadas and not rastreadas[t].any()
    )
    if perdido:
        caja = _caja_de_ambas(ma, mb)
        return ZonaFrame(t, _dilatar(caja, max(margen_px(ma), margen_px(mb))), True)
    if a == b:
        return ZonaFrame(t, _ampliada(ma), False)
    (xa, ya), (xb, yb) = _centro(ma), _centro(mb)
    u = (t - a) / (b - a)
    hacia_b = _desplazar(ma, (xb - xa) * u, (yb - ya) * u)
    hacia_a = _desplazar(mb, (xa - xb) * (1 - u), (ya - yb) * (1 - u))
    union = hacia_b | hacia_a
    return ZonaFrame(t, _dilatar(union, max(margen_px(ma), margen_px(mb))), False)


def a_resolucion(m: Mascara, alto: int, ancho: int) -> Mascara:
    """Del proxy a la resolución real. Lineal y "> 0": nada que estaba cubierto queda fuera."""
    if alto < 1 or ancho < 1:
        raise ErrorRevisor(Codigo.VALIDACION, f"resolución inválida: {ancho}x{alto}")
    if m.shape == (alto, ancho):
        return m.copy()
    # Eje por eje. Al reducir, INTER_AREA promedia el bloque: basta un píxel cubierto para que cuente.
    # Al ampliar, la interpolación mide en el centro del píxel, así que se amplía 1 px más.
    actual = m.astype(np.uint8) * 255
    amplio = False
    for eje, nuevo in ((1, ancho), (0, alto)):
        viejo = actual.shape[eje]
        if nuevo == viejo:
            continue
        destino = (nuevo, actual.shape[0]) if eje == 1 else (actual.shape[1], nuevo)
        modo = cv2.INTER_AREA if nuevo < viejo else cv2.INTER_LINEAR
        amplio |= nuevo > viejo
        actual = (cv2.resize(actual, destino, interpolation=modo) > 0).astype(np.uint8) * 255
    if amplio:
        actual = cv2.dilate(actual, np.ones((3, 3), np.uint8))
    return actual > 0
