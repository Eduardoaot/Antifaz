"""Datos personales en el texto de una imagen: OCR local y patrones.

El texto leído nunca sale de aquí ni va a los logs: la UI solo recibe de qué tipo es y dónde está.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from .cargador import Pixeles

registro = logging.getLogger(__name__)

UMBRAL_OCR = 0.3

_CORREO = re.compile(r"[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_CURP = re.compile(r"\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b")
_RFC = re.compile(r"\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b")
_NUMEROS = re.compile(r"(?<![\dA-Za-z])\+?\d(?:[\s().-]*\d){6,22}(?![\dA-Za-z])")
_DIRECCION = re.compile(
    r"\b(?:calle|av\.?|avenida|blvd\.?|boulevard|col\.?|colonia|privada|fracc\.?|c\.?\s?p\.?\s?\d{5})\b",
    re.IGNORECASE,
)
_DOCUMENTO = re.compile(
    r"\b(?:instituto nacional electoral|credencial para votar|pasaporte|passport|estados unidos mexicanos|"
    r"licencia de conducir|acta de nacimiento|clave de elector|curp)\b",
    re.IGNORECASE,
)
_MEDICO = re.compile(
    r"\b(?:receta|diagn[oó]stico|paciente|resultados? de laboratorio|expediente cl[ií]nico|"
    r"c[eé]dula profesional|dosis|mg/dl|hospital|imss|issste)\b",
    re.IGNORECASE,
)
_FINANCIERO = re.compile(
    r"\b(?:estado de cuenta|clabe|n[uú]mero de cuenta|saldo|cvv|visa|mastercard|american express)\b",
    re.IGNORECASE,
)
_VIAJE = re.compile(
    r"\b(?:boarding pass|pase de abordar|n[uú]mero de vuelo|flight number|boleto de avi[oó]n)\b",
    re.IGNORECASE,
)
# Marcas y formatos que usan esos números y que no son datos de una persona.
LARGO_TELEFONO = (7, 13)
LARGO_TARJETA = (13, 19)
LARGO_CLABE = 18


def es_luhn(digitos: str) -> bool:
    """Suma de verificación de las tarjetas: reduce falsas alarmas con números cualquiera."""
    if not digitos.isdigit():
        return False
    suma = 0
    for i, c in enumerate(reversed(digitos)):
        n = int(c)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        suma += n
    return suma % 10 == 0


def es_clabe(digitos: str) -> bool:
    """Dígito de control de una CLABE interbancaria mexicana."""
    if len(digitos) != LARGO_CLABE or not digitos.isdigit():
        return False
    pesos = (3, 7, 1) * 6
    suma = sum(int(d) * p % 10 for d, p in zip(digitos[:17], pesos, strict=False))
    return (10 - suma % 10) % 10 == int(digitos[17])


def clasificar(texto: str) -> list[str]:
    """Reglas del catálogo que aplican a una línea de texto."""
    reglas: list[str] = []
    if _CORREO.search(texto) or _DIRECCION.search(texto):
        reglas.append("CON-01")
    if _CURP.search(texto) or _RFC.search(texto) or _DOCUMENTO.search(texto):
        reglas.append("DOC-01")
    if _MEDICO.search(texto):
        reglas.append("MED-01")
    if _FINANCIERO.search(texto):
        reglas.append("FIN-01")
    if _VIAJE.search(texto):
        reglas.append("VIA-01")
    for coincidencia in _NUMEROS.finditer(texto):
        digitos = re.sub(r"\D", "", coincidencia.group())
        if LARGO_TARJETA[0] <= len(digitos) <= LARGO_TARJETA[1] and es_luhn(digitos):
            reglas.append("FIN-01")
        elif es_clabe(digitos):
            reglas.append("FIN-01")
        elif LARGO_TELEFONO[0] <= len(digitos) <= LARGO_TELEFONO[1]:
            reglas.append("CON-01")
    return sorted(set(reglas))


@dataclass(frozen=True)
class TextoSensible:
    regla_id: str
    x: int
    y: int
    ancho: int
    alto: int
    confianza: float


@lru_cache(maxsize=1)
def _lector() -> Any:
    # Se importa aquí porque tarda en cargar y solo se usa al analizar.
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _a_caja(puntos: Any, ancho: int, alto: int) -> tuple[int, int, int, int] | None:
    xs = [float(p[0]) for p in puntos]
    ys = [float(p[1]) for p in puntos]
    x0, y0 = max(0, int(min(xs))), max(0, int(min(ys)))
    x1, y1 = min(ancho, int(max(xs)) + 1), min(alto, int(max(ys)) + 1)
    return (x0, y0, x1 - x0, y1 - y0) if x1 > x0 and y1 > y0 else None


def buscar(pixeles: Pixeles) -> list[TextoSensible]:
    """Una línea puede activar varias reglas: se devuelve una zona por regla."""
    rgb = pixeles[:, :, :3]
    alto, ancho = rgb.shape[:2]
    resultado, _ = _lector()(rgb[:, :, ::-1])
    zonas: list[TextoSensible] = []
    for puntos, texto, confianza in resultado or []:
        confianza_num = float(confianza)
        if confianza_num < UMBRAL_OCR:
            continue
        caja = _a_caja(puntos, ancho, alto)
        if caja is None:
            continue
        for regla in clasificar(str(texto)):
            zonas.append(TextoSensible(regla, *caja, confianza_num))
    return zonas
