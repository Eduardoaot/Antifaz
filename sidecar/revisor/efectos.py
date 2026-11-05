"""Efectos para ocultar zonas.

Decisión del responsable (2026-11-06): el difuminado y el pixelado usan los colores de la imagen,
porque se ven naturales, aunque técnicas de reconstrucción podrían recuperar parte del contenido
(ver docs/INVESTIGACION.md). Solo el bloque sólido no depende de lo que había debajo.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import assert_never

import cv2
import numpy as np
from numpy.typing import NDArray

from .cargador import Pixeles
from .errores import Codigo, ErrorRevisor
from .esquemas import Ocultamiento, TipoEfecto

COLOR_SOLIDO = (0, 0, 0)
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


def _difuminar(salida: Pixeles, fuente: Pixeles, x0: int, y0: int, x1: int, y1: int, intensidad: int) -> None:
    lado = min(x1 - x0, y1 - y0)
    base = max(SIGMA_MIN, lado * 0.25)
    sigma = min(SIGMA_MAX, max(SIGMA_MIN, base * intensidad / INTENSIDAD_REFERENCIA))
    # Los vecinos de fuera entran al cálculo para que el borde se funda con la foto.
    relleno = math.ceil(sigma * 3)
    alto, ancho = fuente.shape[:2]
    cx0, cy0, cx1, cy1 = (
        max(0, x0 - relleno),
        max(0, y0 - relleno),
        min(ancho, x1 + relleno),
        min(alto, y1 + relleno),
    )
    recorte = fuente[cy0:cy1, cx0:cx1, :3]
    factor = max(1, math.ceil(sigma / SIGMA_REDUCIDO))
    chico = cv2.resize(
        recorte,
        (max(1, recorte.shape[1] // factor), max(1, recorte.shape[0] // factor)),
        interpolation=cv2.INTER_AREA,
    )
    borroso = cv2.GaussianBlur(chico, (0, 0), sigma / factor)
    borroso = cv2.resize(borroso, (recorte.shape[1], recorte.shape[0]), interpolation=cv2.INTER_LINEAR)
    salida[y0:y1, x0:x1, :3] = borroso[y0 - cy0 : y1 - cy0, x0 - cx0 : x1 - cx0]


def _pixelar(salida: Pixeles, fuente: Pixeles, x0: int, y0: int, x1: int, y1: int, intensidad: int) -> None:
    alto, ancho = y1 - y0, x1 - x0
    base = max(16.0, min(alto, ancho) * 0.10)
    bloque = int(min(PIXEL_MAX, max(PIXEL_MIN, base * intensidad / INTENSIDAD_REFERENCIA)))
    filas, columnas = max(1, round(alto / bloque)), max(1, round(ancho / bloque))
    # Cada bloque toma el color promedio de lo que cubre.
    colores = cv2.resize(fuente[y0:y1, x0:x1, :3], (columnas, filas), interpolation=cv2.INTER_AREA)
    salida[y0:y1, x0:x1, :3] = cv2.resize(colores, (ancho, alto), interpolation=cv2.INTER_NEAREST)


def _aplicar_efecto(
    salida: Pixeles,
    fuente: Pixeles,
    efecto: TipoEfecto,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    intensidad: int,
) -> None:
    match efecto:
        case "solido":
            salida[y0:y1, x0:x1, :3] = COLOR_SOLIDO
        case "difuminado":
            _difuminar(salida, fuente, x0, y0, x1, y1, intensidad)
        case "pixelado":
            _pixelar(salida, fuente, x0, y0, x1, y1, intensidad)
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


def _silueta(
    o: Ocultamiento,
    region: tuple[int, int, int, int],
    mascaras: Mapping[str, NDArray[np.bool_]],
) -> NDArray[np.bool_] | None:
    """Silueta con su margen, en coordenadas de la región. None significa ocultar toda la caja."""
    mascara = mascaras.get(o.mascara_id) if o.mascara_id is not None else None
    if mascara is None or mascara.shape != (o.alto, o.ancho):
        return None
    x0, y0, x1, y1 = region
    lienzo = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    lienzo[o.y - y0 : o.y - y0 + o.alto, o.x - x0 : o.x - x0 + o.ancho] = mascara.astype(np.uint8)
    margen = max(o.dilatacion_px, math.ceil(min(o.ancho, o.alto) * o.dilatacion_pct / 100))
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margen + 1, 2 * margen + 1))
    return cv2.dilate(lienzo, nucleo).astype(bool)


def aplicar(
    pixeles: Pixeles,
    ocultamientos: Sequence[Ocultamiento],
    mascaras: Mapping[str, NDArray[np.bool_]] | None = None,
) -> tuple[Pixeles, list[tuple[int, int, int, int]]]:
    """Devuelve una copia con las zonas ocultas y sus regiones finales. No modifica la entrada."""
    siluetas = mascaras if mascaras is not None else {}
    alto, ancho = pixeles.shape[:2]
    regiones = [region_dilatada(o, alto, ancho) for o in ocultamientos]
    # Los bloques sólidos van primero: un difuminado vecino no debe tomar color de lo que tapan.
    fuente = pixeles.copy()
    recortes = [_silueta(o, r, siluetas) for o, r in zip(ocultamientos, regiones, strict=True)]
    for o, (x0, y0, x1, y1), silueta in zip(ocultamientos, regiones, recortes, strict=True):
        if o.efecto == "solido":
            if silueta is None:
                fuente[y0:y1, x0:x1, :3] = COLOR_SOLIDO
            else:
                fuente[y0:y1, x0:x1, :3][silueta] = COLOR_SOLIDO
    salida = fuente.copy()
    for o, (x0, y0, x1, y1), silueta in zip(ocultamientos, regiones, recortes, strict=True):
        previo = salida[y0:y1, x0:x1].copy()
        _aplicar_efecto(salida, fuente, o.efecto, x0, y0, x1, y1, o.intensidad)
        if silueta is not None:
            salida[y0:y1, x0:x1][~silueta] = previo[~silueta]
    limpiar_transparentes(salida)
    return salida, regiones
