"""Ocultamiento irreversible: lo original se sobrescribe ANTES de aplicar cualquier efecto.

El difuminado y el pixelado solo no son irreversibles (ver docs/INVESTIGACION.md), así que aquí
nunca se calculan a partir del contenido original. La zona de salida no depende de lo que había.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import assert_never

import cv2
import numpy as np

from .cargador import Pixeles
from .errores import Codigo, ErrorRevisor
from .esquemas import Ocultamiento, TipoEfecto

COLOR_SOLIDO = (0, 0, 0)
RUIDO_MIN = 96
RUIDO_MAX = 160
SIGMA_MIN = 25.0
SIGMA_MAX = 1000.0
SIGMA_REDUCIDO = 16.0
PIXEL_MIN = 8
PIXEL_MAX = 256
INTENSIDAD_REFERENCIA = 80
# Por debajo no se ve, pero el color se recupera con solo subir el alfa.
ALFA_INVISIBLE = 8


def region_dilatada(o: Ocultamiento, alto: int, ancho: int) -> tuple[int, int, int, int]:
    """Devuelve (x0, y0, x1, y1). La zona pedida debe caber; solo el margen se ajusta al borde."""
    if o.x + o.ancho > ancho or o.y + o.alto > alto:
        raise ErrorRevisor(Codigo.REGION_FUERA_DE_IMAGEN)
    margen = max(o.dilatacion_px, math.ceil(min(o.ancho, o.alto) * o.dilatacion_pct / 100))
    return (
        max(0, o.x - margen),
        max(0, o.y - margen),
        min(ancho, o.x + o.ancho + margen),
        min(alto, o.y + o.alto + margen),
    )


def _ruido(rng: np.random.Generator, alto: int, ancho: int) -> Pixeles:
    return rng.integers(RUIDO_MIN, RUIDO_MAX, size=(alto, ancho, 3), dtype=np.uint8)


def _difuminar(
    salida: Pixeles, x0: int, y0: int, x1: int, y1: int, intensidad: int, rng: np.random.Generator
) -> None:
    lado = min(x1 - x0, y1 - y0)
    base = max(SIGMA_MIN, lado * 0.25)
    sigma = min(SIGMA_MAX, max(SIGMA_MIN, base * intensidad / INTENSIDAD_REFERENCIA))
    # Primero se sobrescribe. Los vecinos de fuera solo aportan la transición del borde.
    salida[y0:y1, x0:x1, :3] = _ruido(rng, y1 - y0, x1 - x0)
    relleno = math.ceil(sigma * 3)
    alto, ancho = salida.shape[:2]
    cx0, cy0, cx1, cy1 = (
        max(0, x0 - relleno),
        max(0, y0 - relleno),
        min(ancho, x1 + relleno),
        min(alto, y1 + relleno),
    )
    recorte = salida[cy0:cy1, cx0:cx1, :3]
    factor = max(1, math.ceil(sigma / SIGMA_REDUCIDO))
    chico = cv2.resize(
        recorte,
        (max(1, recorte.shape[1] // factor), max(1, recorte.shape[0] // factor)),
        interpolation=cv2.INTER_AREA,
    )
    borroso = cv2.GaussianBlur(chico, (0, 0), sigma / factor)
    borroso = cv2.resize(borroso, (recorte.shape[1], recorte.shape[0]), interpolation=cv2.INTER_LINEAR)
    salida[y0:y1, x0:x1, :3] = borroso[y0 - cy0 : y1 - cy0, x0 - cx0 : x1 - cx0]


def _pixelar(
    salida: Pixeles, x0: int, y0: int, x1: int, y1: int, intensidad: int, rng: np.random.Generator
) -> None:
    alto, ancho = y1 - y0, x1 - x0
    base = max(16.0, min(alto, ancho) * 0.10)
    bloque = int(min(PIXEL_MAX, max(PIXEL_MIN, base * intensidad / INTENSIDAD_REFERENCIA)))
    filas, columnas = max(1, math.ceil(alto / bloque)), max(1, math.ceil(ancho / bloque))
    # Los colores de los bloques son aleatorios: no salen del contenido original.
    colores = _ruido(rng, filas, columnas)
    salida[y0:y1, x0:x1, :3] = np.repeat(np.repeat(colores, bloque, axis=0), bloque, axis=1)[:alto, :ancho]


def _aplicar_efecto(
    salida: Pixeles,
    efecto: TipoEfecto,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    intensidad: int,
    rng: np.random.Generator,
) -> None:
    match efecto:
        case "solido":
            salida[y0:y1, x0:x1, :3] = COLOR_SOLIDO
        case "difuminado":
            _difuminar(salida, x0, y0, x1, y1, intensidad, rng)
        case "pixelado":
            _pixelar(salida, x0, y0, x1, y1, intensidad, rng)
        case _ as inalcanzable:
            assert_never(inalcanzable)
    if salida.shape[2] == 4:
        # Una zona transparente no debe poder ocultar ni revelar nada.
        salida[y0:y1, x0:x1, 3] = 255


def limpiar_transparentes(pixeles: Pixeles) -> None:
    """Un píxel transparente sigue guardando color. Se borra para que no viaje oculto en el archivo."""
    if pixeles.shape[2] == 4:
        invisibles = pixeles[:, :, 3] < ALFA_INVISIBLE
        pixeles[invisibles, :3] = 0
        pixeles[invisibles, 3] = 0


def aplicar(
    pixeles: Pixeles, ocultamientos: Sequence[Ocultamiento], rng: np.random.Generator | None = None
) -> tuple[Pixeles, list[tuple[int, int, int, int]]]:
    """Devuelve una copia con las zonas ocultas y sus regiones finales. No modifica la entrada."""
    generador = rng if rng is not None else np.random.default_rng()
    alto, ancho = pixeles.shape[:2]
    regiones = [region_dilatada(o, alto, ancho) for o in ocultamientos]
    salida = pixeles.copy()
    # Primero se sobrescriben todas las zonas: un difuminado no debe tomar color de otra sin ocultar.
    for x0, y0, x1, y1 in regiones:
        salida[y0:y1, x0:x1, :3] = COLOR_SOLIDO
    for o, (x0, y0, x1, y1) in zip(ocultamientos, regiones, strict=True):
        _aplicar_efecto(salida, o.efecto, x0, y0, x1, y1, o.intensidad, generador)
    limpiar_transparentes(salida)
    return salida, regiones
