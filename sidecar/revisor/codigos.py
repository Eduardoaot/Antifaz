"""Códigos QR y de barras legibles. Su contenido no se guarda: solo se usa para saber de qué tipo son."""

from __future__ import annotations

from dataclasses import dataclass

import zxingcpp

from .cargador import Pixeles

# Los pases de abordar usan el formato BCBP de IATA, que empieza con M y el número de tramos.
LARGO_MINIMO_BCBP = 58


@dataclass(frozen=True)
class Codigo:
    regla_id: str
    x: int
    y: int
    ancho: int
    alto: int


def regla_de(texto: str) -> str:
    return (
        "VIA-01" if len(texto) >= LARGO_MINIMO_BCBP and texto[0] == "M" and texto[1:2].isdigit() else "COD-01"
    )


def buscar(pixeles: Pixeles) -> list[Codigo]:
    rgb = pixeles[:, :, :3]
    alto, ancho = rgb.shape[:2]
    salida: list[Codigo] = []
    for leido in zxingcpp.read_barcodes(rgb):
        pos = leido.position
        xs = [pos.top_left.x, pos.top_right.x, pos.bottom_left.x, pos.bottom_right.x]
        ys = [pos.top_left.y, pos.top_right.y, pos.bottom_left.y, pos.bottom_right.y]
        x0, y0 = max(0, min(xs)), max(0, min(ys))
        x1, y1 = min(ancho, max(xs) + 1), min(alto, max(ys) + 1)
        if x1 > x0 and y1 > y0:
            salida.append(Codigo(regla_de(leido.text), x0, y0, x1 - x0, y1 - y0))
    return salida
