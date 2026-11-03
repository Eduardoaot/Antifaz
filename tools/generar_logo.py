"""Genera el logo final y el ícono de la app desde una sola geometría.

Salida: brand/logo/*.svg, brand/icon/*.png y brand/icon/icono.ico.
Lee el nombre de brand/brand.json, así que renombrar solo requiere volver a ejecutarlo.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
LOGO = RAIZ / "brand/logo"
ICONO = RAIZ / "brand/icon"
TAMANOS_PNG = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
TAMANOS_ICO = (16, 24, 32, 48, 64, 128, 256)
SUPERMUESTREO = 8
INICIO_TEXTO = 76

# Geometría en una cuadrícula de 64.
ESQUINAS_SVG = "M2 2H18V6H6V18H2ZM46 2H62V18H58V6H46ZM62 62H46V58H58V46H62ZM2 62V46H6V58H18V62Z"
ESQUINAS = [
    [(2, 2), (18, 2), (18, 6), (6, 6), (6, 18), (2, 18)],
    [(46, 2), (62, 2), (62, 18), (58, 18), (58, 6), (46, 6)],
    [(62, 62), (46, 62), (46, 58), (58, 58), (58, 46), (62, 46)],
    [(2, 62), (2, 46), (6, 46), (6, 58), (18, 58), (18, 62)],
]
MASCARA_SVG = (
    "M10 27C10 23 14 21 18 21C23 21 27 23 32 25C37 23 41 21 46 21C50 21 54 23 54 27V33"
    "C54 39 50 43 44 43C39 43 36 41 32 36C28 41 25 43 20 43C14 43 10 39 10 33Z"
    "M15 30.5a6 4 0 1 0 12 0a6 4 0 1 0-12 0ZM37 30.5a6 4 0 1 0 12 0a6 4 0 1 0-12 0Z"
)
CURVAS_MASCARA = [
    ((10, 27), (10, 23), (14, 21), (18, 21)),
    ((18, 21), (23, 21), (27, 23), (32, 25)),
    ((32, 25), (37, 23), (41, 21), (46, 21)),
    ((46, 21), (50, 21), (54, 23), (54, 27)),
    ((54, 27), (54, 29), (54, 31), (54, 33)),
    ((54, 33), (54, 39), (50, 43), (44, 43)),
    ((44, 43), (39, 43), (36, 41), (32, 36)),
    ((32, 36), (28, 41), (25, 43), (20, 43)),
    ((20, 43), (14, 43), (10, 39), (10, 33)),
    ((10, 33), (10, 31), (10, 29), (10, 27)),
]
OJOS = ((21, 30.5), (43, 30.5))
OJO_RX, OJO_RY = 6, 4

# A 16 px el dibujo grande se empasta, así que el tamaño chico tiene su propio dibujo.
PIXELES_16 = [
    "................",
    ".###........###.",
    ".#............#.",
    ".#............#.",
    "................",
    "...####..####...",
    "...##########...",
    "...#..####..#...",
    "...#..####..#...",
    "...####..####...",
    "....##....##....",
    "................",
    ".#............#.",
    ".#............#.",
    ".###........###.",
    "................",
]

VARIANTES = {
    "claro": ("#3A3590", "#1B1A2E"),
    "oscuro": ("#B5B0FF", "#F2F2F8"),
    "mono-negro": ("#000000", "#000000"),
    "mono-blanco": ("#FFFFFF", "#FFFFFF"),
}
COLOR_MOSAICO = "#3A3590"
COLOR_SIMBOLO = "#FFFFFF"


def simbolo_svg(color: str) -> str:
    return f'<path fill="{color}" d="{ESQUINAS_SVG}"/><path fill="{color}" fill-rule="evenodd" d="{MASCARA_SVG}"/>'


def palabra(nombre: str) -> tuple[str, float]:
    """Convierte el nombre en trazos para no depender de la fuente instalada."""
    fuente = instantiateVariableFont(
        TTFont(RAIZ / "brand/fonts/AtkinsonHyperlegibleNext-Variable.ttf"), {"wght": 700}
    )
    glifos = fuente.getGlyphSet()
    mapa = fuente.getBestCmap()
    tam = 36
    escala = tam / fuente["head"].unitsPerEm
    pluma = SVGPathPen(glifos)
    limites = BoundsPen(glifos)
    x = float(INICIO_TEXTO)
    for letra in nombre:
        if ord(letra) not in mapa:
            raise ValueError(f"La fuente no tiene el carácter {letra!r}")
        glifo = mapa[ord(letra)]
        for destino in (pluma, limites):
            glifos[glifo].draw(TransformPen(destino, (escala, 0, 0, -escala, x, 45)))
        x += glifos[glifo].width * escala
    # El símbolo termina en 62: el texto nunca debe pisarlo ni salirse del lienzo.
    izquierda, arriba, _, abajo = limites.bounds
    if izquierda <= 62 or arriba < 0 or abajo > 64:
        raise ValueError(f"El texto no cabe junto al símbolo: {limites.bounds}")
    return pluma.getCommands(), x


def escribir_svgs(nombre: str) -> None:
    LOGO.mkdir(parents=True, exist_ok=True)
    trazos, fin_texto = palabra(nombre)
    total = fin_texto + 2
    for variante, (color, texto) in VARIANTES.items():
        (LOGO / f"isotipo-{variante}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{nombre}">'
            f"{simbolo_svg(color)}</svg>\n",
            encoding="utf-8",
        )
        (LOGO / f"horizontal-{variante}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total:.1f} 64" role="img" aria-label="{nombre}">'
            f'{simbolo_svg(color)}<path fill="{texto}" d="{trazos}"/></svg>\n',
            encoding="utf-8",
        )
    filas = "".join(
        f'<path d="M{x} {y}h1v1h-1z"/>'
        for y, fila in enumerate(PIXELES_16)
        for x, celda in enumerate(fila)
        if celda == "#"
    )
    (LOGO / "isotipo-16.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" '
        f'fill="#3A3590" role="img" aria-label="{nombre}">{filas}</svg>\n',
        encoding="utf-8",
    )


def bezier(p0, p1, p2, p3, pasos=24):
    for i in range(pasos):
        t = i / pasos
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
        )


def icono_grande(tam: int) -> Image.Image:
    lienzo = tam * SUPERMUESTREO
    # Se deja más margen relativo al crecer; por debajo de 48 px el símbolo llena más el mosaico.
    proporcion = 0.82 if tam < 48 else 0.72
    escala = lienzo * proporcion / 64
    margen = (lienzo - 64 * escala) / 2

    def pt(p):
        return (margen + p[0] * escala, margen + p[1] * escala)

    imagen = Image.new("RGBA", (lienzo, lienzo), (0, 0, 0, 0))
    dibujo = ImageDraw.Draw(imagen)
    dibujo.rounded_rectangle((0, 0, lienzo - 1, lienzo - 1), radius=lienzo * 0.18, fill=COLOR_MOSAICO)
    for esquina in ESQUINAS:
        dibujo.polygon([pt(p) for p in esquina], fill=COLOR_SIMBOLO)
    contorno = [pt(p) for curva in CURVAS_MASCARA for p in bezier(*curva)]
    dibujo.polygon(contorno, fill=COLOR_SIMBOLO)
    for cx, cy in OJOS:
        x0, y0 = pt((cx - OJO_RX, cy - OJO_RY))
        x1, y1 = pt((cx + OJO_RX, cy + OJO_RY))
        dibujo.ellipse((x0, y0, x1, y1), fill=COLOR_MOSAICO)
    return imagen.resize((tam, tam), Image.Resampling.LANCZOS)


def icono_16() -> Image.Image:
    imagen = Image.new("RGBA", (16, 16), COLOR_MOSAICO)
    pixeles = imagen.load()
    for x, y in ((0, 0), (15, 0), (0, 15), (15, 15)):
        pixeles[x, y] = (0, 0, 0, 0)
    blanco = (255, 255, 255, 255)
    for y, fila in enumerate(PIXELES_16):
        for x, celda in enumerate(fila):
            if celda == "#":
                pixeles[x, y] = blanco
    return imagen


def escribir_iconos() -> None:
    ICONO.mkdir(parents=True, exist_ok=True)
    imagenes = {}
    for tam in TAMANOS_PNG:
        imagenes[tam] = icono_16() if tam == 16 else icono_grande(tam)
        imagenes[tam].save(ICONO / f"icono-{tam}.png", optimize=True)
    imagenes[256].save(
        ICONO / "icono.ico",
        format="ICO",
        sizes=[(t, t) for t in TAMANOS_ICO],
        append_images=[imagenes[t] for t in TAMANOS_ICO if t != 256],
    )


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    nombre = json.loads((RAIZ / "brand/brand.json").read_text(encoding="utf-8"))["nombre"]
    escribir_svgs(nombre)
    escribir_iconos()
    with Image.open(ICONO / "icono.ico") as ico:
        tamanos = sorted(ico.info["sizes"])
    esperados = sorted((t, t) for t in TAMANOS_ICO)
    if tamanos != esperados:
        print(f"ERROR: el .ico tiene {tamanos}, se esperaba {esperados}")
        return 1
    print(f"OK: {len(list(LOGO.glob('*.svg')))} SVG, {len(TAMANOS_PNG)} PNG y .ico con {len(tamanos)} tamaños")
    return 0


if __name__ == "__main__":
    sys.exit(main())
