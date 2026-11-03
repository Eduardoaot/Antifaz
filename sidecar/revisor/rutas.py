"""Rutas de Windows, incluidas las de más de 260 caracteres."""

from __future__ import annotations

import os

UMBRAL_RUTA_LARGA = 240


def ruta_larga(ruta: str) -> str:
    """Agrega el prefijo que Windows exige para rutas largas. Se aplica solo a rutas absolutas."""
    if os.name != "nt" or ruta.startswith("\\\\?\\") or len(ruta) < UMBRAL_RUTA_LARGA:
        return ruta
    absoluta = os.path.abspath(ruta)
    if absoluta.startswith("\\\\"):
        return "\\\\?\\UNC\\" + absoluta[2:]
    return "\\\\?\\" + absoluta


def misma_ruta(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))
