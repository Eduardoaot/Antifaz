"""Calcula contraste WCAG de brand/tokens.json y simula daltonismo (Machado et al., 2009).

Falla si un par no llega a su mínimo. La separación por daltonismo es informativa,
porque el riesgo nunca se comunica solo con color.
"""
from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MATRICES = {
    "protanopia": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
# (texto, fondo, mínimo): 4.5 para texto normal, 3 para bordes, íconos y foco.
PARES = [
    ("texto", "fondo", 4.5), ("texto", "superficie", 4.5),
    ("texto-suave", "fondo", 4.5), ("texto-suave", "superficie", 4.5),
    ("marca", "fondo", 4.5), ("marca", "superficie", 4.5), ("sobre-marca", "marca", 4.5),
    ("borde-control", "fondo", 3), ("borde-control", "superficie", 3),
    ("foco", "fondo", 3), ("foco", "superficie", 3),
    ("riesgo-alto", "riesgo-alto-fondo", 4.5), ("riesgo-medio", "riesgo-medio-fondo", 4.5),
    ("riesgo-bajo", "riesgo-bajo-fondo", 4.5),
    ("riesgo-alto", "superficie", 4.5), ("riesgo-medio", "superficie", 4.5), ("riesgo-bajo", "superficie", 4.5),
    # superficie-2: filas y campos dentro de un panel.
    ("texto", "superficie-2", 4.5), ("texto-suave", "superficie-2", 4.5), ("marca", "superficie-2", 4.5),
    ("borde-control", "superficie-2", 3), ("foco", "superficie-2", 3),
    # lienzo: gris medio-oscuro sin tinte detrás de la foto, igual en los dos temas. No tiene mínimo: es una
    # región decorativa y la foto ya la identifica (WCAG 1.4.11 pide 3:1 solo a lo necesario para reconocer
    # un control o su estado). Sobre él solo hay foto y marcas con doble contorno blanco y negro, que se ven
    # sobre cualquier color. El anillo de foco del área se dibuja por fuera (outline-offset), sobre el
    # fondo, y ese par ya se revisa arriba.
    # borde-sutil es decorativo: separa cajas que ya se distinguen por su contenido, así que no tiene mínimo.
]


def lineal(hex_color: str) -> list[float]:
    valores = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in valores]


def luminancia(rgb: list[float]) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def contraste(a: str, b: str) -> float:
    claro, oscuro = sorted((luminancia(lineal(a)), luminancia(lineal(b))), reverse=True)
    return (claro + 0.05) / (oscuro + 0.05)


def lab(rgb: list[float]) -> tuple[float, float, float]:
    rgb = [min(1.0, max(0.0, v)) for v in rgb]
    x = (0.4124 * rgb[0] + 0.3576 * rgb[1] + 0.1805 * rgb[2]) / 0.95047
    y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    z = (0.0193 * rgb[0] + 0.1192 * rgb[1] + 0.9505 * rgb[2]) / 1.08883
    f = [t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116 for t in (x, y, z)]
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def separacion(a: list[float], b: list[float]) -> float:
    return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** 0.5


def simular(matriz: list[list[float]], rgb: list[float]) -> list[float]:
    return [sum(m * c for m, c in zip(fila, rgb)) for fila in matriz]


def main() -> int:
    # La consola de Windows usa cp1252 por defecto y no puede imprimir ΔE.
    sys.stdout.reconfigure(encoding="utf-8")
    tokens = json.loads((RAIZ / "brand/tokens.json").read_text(encoding="utf-8"))["color"]
    fallas = 0
    for tema, valores in tokens.items():
        print(f"\n== Tema {tema}")
        for texto, fondo, minimo in PARES:
            razon = contraste(valores[texto], valores[fondo])
            ok = razon >= minimo
            fallas += not ok
            print(f"{'ok ' if ok else 'MAL'} {razon:5.2f} (mín {minimo}) {texto} sobre {fondo}")
        nombres = ["riesgo-alto", "riesgo-medio", "riesgo-bajo", "marca"]
        for vision, matriz in MATRICES.items():
            separaciones = {
                f"{a}/{b}": separacion(simular(matriz, lineal(valores[a])), simular(matriz, lineal(valores[b])))
                for a, b in itertools.combinations(nombres, 2)
            }
            par = min(separaciones, key=separaciones.get)
            print(f"    {vision}: menor separación {separaciones[par]:.1f} ΔE ({par})")
    print(f"\n{'OK: contraste AA' if not fallas else f'{fallas} par(es) sin contraste'}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
