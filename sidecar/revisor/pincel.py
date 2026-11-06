"""Pincel: la persona pinta lo que quiere ocultar y el trazo se vuelve una silueta.

Sirve para corregir a mano lo que la detección o el clic dejaron fuera. Solo agrega zonas:
quitar parte de una silueta podría destapar algo, así que para eso se quita la zona y se rehace.
La silueta vive en memoria, igual que las de SlimSAM: si se pierde, se oculta toda su caja.
"""

from __future__ import annotations

from collections.abc import Sequence

import cv2
import numpy as np

from .errores import Codigo, ErrorRevisor
from .esquemas import PINCEL_MAX, PINCEL_MIN
from .segmentar import Mascara


def rasterizar(puntos: Sequence[tuple[int, int]], tamano: int, ancho: int, alto: int) -> Mascara:
    """Dibuja el trazo con el grosor pedido. Todo punto debe caber en la imagen: no se recorta en silencio."""
    if not puntos:
        raise ErrorRevisor(Codigo.VALIDACION, "trazo vacío")
    if not PINCEL_MIN <= tamano <= PINCEL_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, "tamaño de pincel fuera de rango")
    for x, y in puntos:
        if not (0 <= x < ancho and 0 <= y < alto):
            raise ErrorRevisor(Codigo.REGION_FUERA_DE_IMAGEN, "punto del trazo fuera de la imagen")
    # Con tamaño par el diámetro sale un píxel mayor: sobra un poco antes que faltar.
    radio = tamano // 2
    xs = [x for x, _ in puntos]
    ys = [y for _, y in puntos]
    x0, y0 = max(0, min(xs) - radio), max(0, min(ys) - radio)
    x1, y1 = min(ancho, max(xs) + radio + 1), min(alto, max(ys) + radio + 1)
    lienzo = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    locales = [(x - x0, y - y0) for x, y in puntos]
    for p in locales:
        cv2.circle(lienzo, p, radio, 1, thickness=-1)
    for a, b in zip(locales, locales[1:], strict=False):
        cv2.line(lienzo, a, b, 1, thickness=2 * radio + 1)
    recorte = lienzo.astype(bool)
    filas, columnas = np.nonzero(recorte)
    # Un punto dentro de la imagen siempre pinta al menos su píxel.
    fx0, fx1 = int(columnas.min()), int(columnas.max()) + 1
    fy0, fy1 = int(filas.min()), int(filas.max()) + 1
    return Mascara(x0 + fx0, y0 + fy0, fx1 - fx0, fy1 - fy0, recorte[fy0:fy1, fx0:fx1].copy())
