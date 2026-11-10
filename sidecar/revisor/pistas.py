"""Zona oculta en cada frame de un video, a partir de las máscaras del seguimiento.

No depende del método de seguimiento: recibe una máscara por frame rastreado (vacía si el método
perdió el objeto) y decide qué ocultar en cada frame del video. Las reglas son fail-closed:

- Entre dos frames rastreados se mueven ambas máscaras hacia el frame intermedio, se unen y se
  amplían. Es la interpolación que se midió en tools/benchmark_video.py.
- Si el objeto se pierde a mitad de la pista: cerca de la última o siguiente aparición (mismo
  `pista.margen_frames`) se oculta con margen extra y se marca revisión; en el medio de un hueco
  largo no se inventa cuadro (el objeto suele haber salido del encuadre) pero sí se marca revisión.
  Un hueco corto (ambas orillas a la vez) sí interpola el corredor, o ancla si el salto es grande.
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
# Multiplicador del margen de dilatación cuando el seguimiento perdió el objeto (fail-closed acotado).
MARGEN_PERDIDO_MULT = 3
# Si la distancia entre centros supera esto × la diagonal mayor, el objeto probablemente salió del
# encuadre: no se pinta el corredor, solo la ancla temporal más cercana.
SALTO_PERDIDO_MULT = 4.0


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
    contexto = _Contexto(rastreadas, total, margen_frames)
    for t in range(total):
        yield contexto.zona(t)


def zona_en(
    rastreadas: dict[int, Mascara], total: int, t: int, margen_frames: int = MARGEN_FRAMES_DEFAULT
) -> ZonaFrame:
    """La zona de un solo frame, igual a la que daría `zonas`. Para la vista previa."""
    if not 0 <= t < total:
        raise ErrorRevisor(Codigo.VALIDACION, f"frame fuera del video: {t}")
    return _Contexto(rastreadas, total, margen_frames).zona(t)


class _Contexto:
    def __init__(self, rastreadas: dict[int, Mascara], total: int, margen_frames: int) -> None:
        if not 0 <= margen_frames <= MARGEN_FRAMES_MAX:
            raise ErrorRevisor(Codigo.VALIDACION, f"margen de frames fuera de rango: {margen_frames}")
        alto, ancho = _validar(rastreadas, total)
        self.rastreadas = rastreadas
        self.margen = margen_frames
        self.vacia = np.zeros((alto, ancho), dtype=bool)
        self.con_objeto = sorted(i for i, m in rastreadas.items() if m.any())
        self.rastreados = sorted(rastreadas)

    def zona(self, t: int) -> ZonaFrame:
        if not self.con_objeto:
            # El método no encontró nada en ningún frame: no hay de dónde ocultar. Quien llama decide;
            # aquí no se inventa una zona. Se marca todo para revisión.
            return ZonaFrame(t, self.vacia, True)
        primero, ultimo = self.con_objeto[0], self.con_objeto[-1]
        if t < primero:
            dentro = primero - t <= self.margen
            return ZonaFrame(t, _ampliada(self.rastreadas[primero]) if dentro else self.vacia, False)
        if t > ultimo:
            dentro = t - ultimo <= self.margen
            return ZonaFrame(t, _ampliada(self.rastreadas[ultimo]) if dentro else self.vacia, False)
        return _zona_dentro(t, self.rastreadas, self.rastreados, self.con_objeto, self.margen, self.vacia)


def _ampliada(m: Mascara) -> Mascara:
    return _dilatar(m, margen_px(m))


def _corredor(ma: Mascara, mb: Mascara, t: int, a: int, b: int) -> Mascara:
    """Une las siluetas de a y b desplazadas hacia el frame t (cubre el trayecto)."""
    if a == b:
        return ma.copy()
    (xa, ya), (xb, yb) = _centro(ma), _centro(mb)
    u = (t - a) / (b - a)
    hacia_b = _desplazar(ma, (xb - xa) * u, (yb - ya) * u)
    hacia_a = _desplazar(mb, (xa - xb) * (1 - u), (ya - yb) * (1 - u))
    return hacia_b | hacia_a


def _diagonal(m: Mascara) -> float:
    caja = _caja(m)
    if caja is None:
        return 0.0
    x0, y0, x1, y1 = caja
    return math.hypot(x1 - x0, y1 - y0)


def _salto_grande(ma: Mascara, mb: Mascara) -> bool:
    (xa, ya), (xb, yb) = _centro(ma), _centro(mb)
    distancia = math.hypot(xb - xa, yb - ya)
    ref = max(_diagonal(ma), _diagonal(mb), float(MARGEN_PX_MIN))
    return distancia > SALTO_PERDIDO_MULT * ref


def _zona_perdido(
    t: int, a: int, b: int, ma: Mascara, mb: Mascara, margen_frames: int, vacia: Mascara
) -> ZonaFrame:
    """Fail-closed cerca de las orillas; sin cuadro fantasma en el medio de un hueco largo."""
    cerca_a = (t - a) <= margen_frames
    cerca_b = (b - t) <= margen_frames
    if not cerca_a and not cerca_b:
        # Hueco largo: el objeto probablemente salió del encuadre. No inventar zona.
        return ZonaFrame(t, vacia.copy(), True)
    if cerca_a and cerca_b and _salto_grande(ma, mb):
        ancla = ma if (t - a) <= (b - t) else mb
        return ZonaFrame(t, _dilatar(ancla, margen_px(ancla) * MARGEN_PERDIDO_MULT), True)
    # Orilla(s): mover la silueta a lo largo del trayecto (no dejarla clavada donde se vio).
    union = _corredor(ma, mb, t, a, b)
    base = max(margen_px(ma), margen_px(mb)) * MARGEN_PERDIDO_MULT
    return ZonaFrame(t, _dilatar(union, base), True)


def _zona_dentro(
    t: int,
    rastreadas: dict[int, Mascara],
    rastreados: list[int],
    con_objeto: list[int],
    margen_frames: int,
    vacia: Mascara,
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
    if a == b:
        return ZonaFrame(t, _ampliada(ma), perdido)
    if perdido:
        return _zona_perdido(t, a, b, ma, mb, margen_frames, vacia)
    union = _corredor(ma, mb, t, a, b)
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
