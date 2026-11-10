"""Efectos para ocultar zonas.

Decisión del responsable (2026-11-06): el difuminado y el pixelado usan los colores de la imagen,
porque se ven naturales, aunque técnicas de reconstrucción podrían recuperar parte del contenido
(ver docs/INVESTIGACION.md). Solo el bloque sólido y el emoji no dependen de lo que había debajo:
el emoji crece hasta tapar lo que oculta (la silueta, el óvalo de una cara o la caja completa), y lo
que no alcance queda con su color principal, nunca con la foto.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import assert_never, cast

import cv2
import numpy as np
from numpy.typing import NDArray

from . import emojis
from .cargador import Pixeles
from .errores import Codigo, ErrorRevisor
from .esquemas import Ocultamiento, TipoEfecto, TipoEmoji, es_emoji

COLOR_SOLIDO = (0, 0, 0)
SIGMA_MIN = 25.0
SIGMA_MAX = 1000.0
SIGMA_REDUCIDO = 16.0
PIXEL_MIN = 8
PIXEL_MAX = 256
INTENSIDAD_REFERENCIA = 80
# Por debajo no se ve, pero el color se recupera con solo subir el alfa.
ALFA_INVISIBLE = 8
# Hasta cuántas veces el lado mayor de su caja puede crecer un emoji para taparla sin relleno visible.
EMOJI_ESCALA_MAX = 2.0
# Por encima, el emoji se escala solo en la parte visible, para no reservar un cuadro gigante en memoria.
EMOJI_LADO_COMPLETO = 2048
# Puntos de la orilla que se revisan al buscar el tamaño del emoji. El relleno cubre lo que se escape.
EMOJI_PUNTOS_MAX = 4096


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


def _caja_con_margen(o: Ocultamiento) -> tuple[int, int, int, int]:
    """La zona con margen sin recortar al borde de la foto. El óvalo y el centro del emoji salen de aquí."""
    margen = max(o.dilatacion_px, math.ceil(min(o.ancho, o.alto) * o.dilatacion_pct / 100))
    return o.x - margen, o.y - margen, o.x + o.ancho + margen, o.y + o.alto + margen


def _elipse(o: Ocultamiento, region: tuple[int, int, int, int]) -> NDArray[np.bool_]:
    """Óvalo inscrito en la zona con margen, en coordenadas de la región.

    Con el margen que la app da a las caras (x1.3 y 10 %), este óvalo contiene la caja completa que dio
    el detector, aun cerca del borde de la foto: se calcula sin recortar y luego se recorta.
    """
    ux0, uy0, ux1, uy1 = _caja_con_margen(o)
    x0, y0, x1, y1 = region
    cx, cy = (ux0 + ux1 - 1) / 2, (uy0 + uy1 - 1) / 2
    a, b = (ux1 - ux0) / 2, (uy1 - uy0) / 2
    yy, xx = np.ogrid[y0:y1, x0:x1]
    return ((xx - cx) / a) ** 2 + ((yy - cy) / b) ** 2 <= 1.0


def _ovalo_nucleo(
    o: Ocultamiento,
    region: tuple[int, int, int, int],
    mascaras: Mapping[str, NDArray[np.bool_]],
    alto: int,
    ancho: int,
) -> NDArray[np.bool_] | None:
    """La cara del detector con el margen mínimo, en coordenadas de la región, si el emoji se ajusta.

    Solo aplica a un emoji sobre una cara (óvalo, sin silueta y lejos de la orilla) que se encogió o se
    movió. En cualquier otro caso es None y el emoji tapa su zona completa, centrado, como siempre.
    """
    n = o.nucleo
    movido = o.desplazamiento_x != 0 or o.desplazamiento_y != 0
    if n is None or (o.escala >= 1 and not movido) or not es_emoji(o.efecto) or o.forma != "elipse":
        return None
    if _silueta(o, region, mascaras) is not None:
        return None
    if o.x == 0 or o.y == 0 or o.x + o.ancho >= ancho or o.y + o.alto >= alto:
        return None
    m = o.dilatacion_px
    x0, y0, x1, y1 = region
    cx, cy = (2 * n.x + n.ancho - 1) / 2, (2 * n.y + n.alto - 1) / 2
    a, b = n.ancho / 2 + m, n.alto / 2 + m
    yy, xx = np.ogrid[y0:y1, x0:x1]
    return ((xx - cx) / a) ** 2 + ((yy - cy) / b) ** 2 <= 1.0


def lado_emoji(opaco: NDArray[np.bool_], dx: NDArray[np.float64], dy: NDArray[np.float64]) -> int:
    """Lado, en píxeles de la foto, con el que la parte opaca del emoji tapa todos los puntos dados.

    Los puntos se miden desde el centro del emoji. Crece hasta EMOJI_ESCALA_MAX veces el tamaño de lo
    que tapa; si ni así alcanza (las puntas de una estrella), lo que falte ya tiene su color principal.
    """
    n = opaco.shape[0]
    base = max(1, math.ceil(2 * max(float(np.abs(dx).max()), float(np.abs(dy).max())) + 1))

    def cubre(lado: int) -> bool:
        u = np.floor(dx * n / lado + n / 2).astype(np.int64)
        v = np.floor(dy * n / lado + n / 2).astype(np.int64)
        dentro = (u >= 0) & (u < n) & (v >= 0) & (v < n)
        return bool(dentro.all() and opaco[v, u].all())

    tope = math.ceil(base * EMOJI_ESCALA_MAX)
    if not cubre(tope):
        return tope
    bajo, alto = 1, tope
    while bajo < alto:
        medio = (bajo + alto) // 2
        if cubre(medio):
            alto = medio
        else:
            bajo = medio + 1
    return bajo


def _orilla(objetivo: NDArray[np.bool_]) -> tuple[NDArray[np.intp], NDArray[np.intp]]:
    """Los píxeles del borde de lo que se tapa: si la orilla queda cubierta, el interior también."""
    lleno = np.pad(objetivo, 1).astype(np.uint8)
    adentro = cv2.erode(lleno, np.ones((3, 3), np.uint8))[1:-1, 1:-1].astype(bool)
    ys, xs = np.nonzero(objetivo & ~adentro)
    paso = max(1, len(xs) // EMOJI_PUNTOS_MAX)
    return ys[::paso], xs[::paso]


def _pegar_emoji(
    salida: Pixeles,
    emoji: TipoEmoji,
    region: tuple[int, int, int, int],
    centro: tuple[float, float],
    objetivo: NDArray[np.bool_],
    escala: float = 1.0,
    minimo: NDArray[np.bool_] | None = None,
    pegar_en: tuple[float, float] | None = None,
) -> tuple[int, int, int, int]:
    """Del tamaño justo para tapar `objetivo` desde `centro`, por `escala`. Devuelve la región que tocó.

    Con `minimo` puede quedar más chico que `objetivo` y pegarse en `pegar_en`, pero nunca tanto que,
    desde ahí, deje de tapar `minimo`: si hace falta, crece. Sin él, va en `centro` y nunca es más chico
    que `objetivo`. Lo transparente deja ver el color principal ya pintado en lo que se oculta; fuera de
    eso, la foto, que ahí no hay nada que ocultar.
    """
    alto_img, ancho_img = salida.shape[:2]
    original = emojis.cargar(emoji)
    n = original.shape[0]
    x0, y0, _, _ = region
    ys, xs = _orilla(objetivo)
    if xs.size == 0:
        return region
    cx, cy = centro
    dx = xs.astype(np.float64) + (x0 - cx)
    dy = ys.astype(np.float64) + (y0 - cy)
    opaco = emojis.opaco(emoji)
    justo = lado_emoji(opaco, dx, dy)
    lado = max(1, round(justo * escala))
    if minimo is None:
        lado = max(lado, justo)
    else:
        if pegar_en is not None:
            cx, cy = pegar_en
        mys, mxs = _orilla(minimo)
        if mxs.size > 0:
            mdx = mxs.astype(np.float64) + (x0 - cx)
            mdy = mys.astype(np.float64) + (y0 - cy)
            lado = max(lado, lado_emoji(opaco, mdx, mdy))
    ex0, ey0 = math.floor(cx - lado / 2 + 0.5), math.floor(cy - lado / 2 + 0.5)
    rx0, ry0 = max(0, ex0), max(0, ey0)
    rx1, ry1 = min(ancho_img, ex0 + lado), min(alto_img, ey0 + lado)
    if rx0 >= rx1 or ry0 >= ry1:
        return region
    if lado <= EMOJI_LADO_COMPLETO:
        recorte = cv2.resize(original, (lado, lado), interpolation=cv2.INTER_AREA)[
            ry0 - ey0 : ry1 - ey0, rx0 - ex0 : rx1 - ex0
        ]
    else:
        # Enorme: solo se calcula la parte que cae dentro de la foto, para no agotar la memoria.
        escala = lado / n
        matriz = np.array([[escala, 0, ex0 - rx0], [0, escala, ey0 - ry0]], dtype=np.float64)
        recorte = cv2.warpAffine(
            original, matriz, (rx1 - rx0, ry1 - ry0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT
        )
    alfa = recorte[:, :, 3:4].astype(np.float32) / 255.0
    fondo = salida[ry0:ry1, rx0:rx1, :3].astype(np.float32)
    mezcla = recorte[:, :, :3].astype(np.float32) * alfa + fondo * (1.0 - alfa)
    salida[ry0:ry1, rx0:rx1, :3] = np.clip(np.rint(mezcla), 0, 255).astype(np.uint8)
    if salida.shape[2] == 4:
        salida[ry0:ry1, rx0:rx1, 3] = np.maximum(salida[ry0:ry1, rx0:rx1, 3], recorte[:, :, 3])
    # La región final abarca la caja y lo que tocó el emoji.
    return min(rx0, region[0]), min(ry0, region[1]), max(rx1, region[2]), max(ry1, region[3])


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
        case "emoji_sonrisa" | "emoji_lentes" | "emoji_gato" | "emoji_estrella":
            # Primero un relleno fijo: es lo que lo hace irreversible. El emoji se pega encima después.
            salida[y0:y1, x0:x1, :3] = emojis.color_principal(efecto)
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


def _forma(
    o: Ocultamiento,
    region: tuple[int, int, int, int],
    mascaras: Mapping[str, NDArray[np.bool_]],
    alto: int,
    ancho: int,
) -> NDArray[np.bool_] | None:
    """Lo que de verdad se tapa dentro de la región. None es la caja completa.

    La silueta manda si existe. Sin ella, un emoji sobre una cara tapa el óvalo de la cara para poder
    ajustarse a ella; cualquier otra cosa tapa la caja completa.
    """
    silueta = _silueta(o, region, mascaras)
    if silueta is not None:
        return silueta
    if es_emoji(o.efecto) and o.forma == "elipse":
        # Si la caja toca la orilla, la app la recortó al ampliarla y ya no está centrada en la cara:
        # el óvalo podría dejar fuera una esquina. Ahí se tapa la caja completa.
        if o.x == 0 or o.y == 0 or o.x + o.ancho >= ancho or o.y + o.alto >= alto:
            return None
        return _elipse(o, region)
    return None


def aplicar(
    pixeles: Pixeles,
    ocultamientos: Sequence[Ocultamiento],
    mascaras: Mapping[str, NDArray[np.bool_]] | None = None,
) -> tuple[Pixeles, list[tuple[int, int, int, int]]]:
    """Devuelve una copia con las zonas ocultas y sus regiones finales. No modifica la entrada."""
    siluetas = mascaras if mascaras is not None else {}
    alto, ancho = pixeles.shape[:2]
    regiones = [region_dilatada(o, alto, ancho) for o in ocultamientos]
    pares = list(zip(ocultamientos, regiones, strict=True))
    formas = [_forma(o, r, siluetas, alto, ancho) for o, r in pares]
    nucleos = [_ovalo_nucleo(o, r, siluetas, alto, ancho) for o, r in pares]
    # Un sticker más chico que su zona solo oculta la cara del detector: lo demás queda como en la foto.
    recortes = [n if n is not None else f for f, n in zip(formas, nucleos, strict=True)]
    # Los bloques sólidos y los emojis primero: un difuminado vecino no debe tomar color de lo que tapan.
    fuente = pixeles.copy()
    for o, (x0, y0, x1, y1), silueta in zip(ocultamientos, regiones, recortes, strict=True):
        if o.efecto == "solido" or es_emoji(o.efecto):
            if silueta is None:
                fuente[y0:y1, x0:x1, :3] = COLOR_SOLIDO
            else:
                fuente[y0:y1, x0:x1, :3][silueta] = COLOR_SOLIDO
    salida = fuente.copy()
    finales: list[tuple[int, int, int, int]] = []
    for o, (x0, y0, x1, y1), silueta, forma, nucleo in zip(
        ocultamientos, regiones, recortes, formas, nucleos, strict=True
    ):
        previo = salida[y0:y1, x0:x1].copy()
        _aplicar_efecto(salida, fuente, o.efecto, x0, y0, x1, y1, o.intensidad)
        if silueta is not None:
            salida[y0:y1, x0:x1][~silueta] = previo[~silueta]
        if es_emoji(o.efecto):
            # El emoji puede salir de su caja: la región que se verifica al exportar es la que tocó.
            ux0, uy0, ux1, uy1 = _caja_con_margen(o)
            # El tamaño se mide siempre contra la zona completa: la escala es relativa a ese tamaño.
            objetivo = forma if forma is not None else np.ones((y1 - y0, x1 - x0), dtype=bool)
            centro = ((ux0 + ux1) / 2, (uy0 + uy1) / 2)
            # Movido, en fracciones de los semiejes. Solo cuenta si la cara del detector manda.
            pegar_en = (
                centro[0] + o.desplazamiento_x * (ux1 - ux0) / 2,
                centro[1] + o.desplazamiento_y * (uy1 - uy0) / 2,
            )
            emoji = cast(TipoEmoji, o.efecto)
            finales.append(
                _pegar_emoji(salida, emoji, (x0, y0, x1, y1), centro, objetivo, o.escala, nucleo, pegar_en)
            )
        else:
            finales.append((x0, y0, x1, y1))
    limpiar_transparentes(salida)
    return salida, finales
