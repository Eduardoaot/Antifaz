"""Comprueba, leyendo los bytes, que un archivo exportado solo tiene lo indispensable."""

from __future__ import annotations

from .errores import Codigo, ErrorRevisor

# Marcadores de JPEG sin datos de longitud.
_SIN_LONGITUD = {0x01, *range(0xD0, 0xD8)}
_JPEG_PERMITIDOS = {0xC0, 0xC2, 0xC4, 0xDB, 0xDD, 0xE0}
_PNG_FIRMA = b"\x89PNG\r\n\x1a\n"
_PNG_PERMITIDOS = {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}


def _rechazar(detalle: str) -> None:
    raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, detalle)


def verificar_jpeg(datos: bytes) -> None:
    if datos[:2] != b"\xff\xd8":
        _rechazar("jpeg sin SOI")
    i = 2
    while i < len(datos):
        if datos[i] != 0xFF:
            _rechazar("jpeg desalineado")
        while i < len(datos) and datos[i] == 0xFF:
            i += 1
        if i >= len(datos):
            _rechazar("jpeg sin marcador")
        marcador = datos[i]
        i += 1
        if marcador == 0xD9:
            if i != len(datos):
                _rechazar("jpeg con datos tras EOI")
            return
        if marcador in _SIN_LONGITUD:
            continue
        if marcador == 0xDA:
            i = _saltar_exploracion(datos, i)
            continue
        if marcador not in _JPEG_PERMITIDOS:
            _rechazar(f"jpeg con segmento {marcador:#x}")
        if i + 2 > len(datos):
            _rechazar("jpeg truncado")
        longitud = int.from_bytes(datos[i : i + 2], "big")
        if longitud < 2 or i + longitud > len(datos):
            _rechazar("jpeg con longitud inválida")
        if marcador == 0xE0 and datos[i + 2 : i + 7] != b"JFIF\x00":
            _rechazar("jpeg con APP0 ajeno")
        if marcador == 0xE0 and longitud != 16:
            _rechazar("jpeg con miniatura JFIF")
        i += longitud
    _rechazar("jpeg sin EOI")


def _saltar_exploracion(datos: bytes, inicio: int) -> int:
    longitud = int.from_bytes(datos[inicio : inicio + 2], "big")
    i = inicio + longitud
    while i < len(datos) - 1:
        if datos[i] == 0xFF and datos[i + 1] != 0x00 and not 0xD0 <= datos[i + 1] <= 0xD7:
            return i
        i += 1
    _rechazar("jpeg sin fin de exploración")
    return i


def verificar_png(datos: bytes) -> None:
    if datos[:8] != _PNG_FIRMA:
        _rechazar("png sin firma")
    i = 8
    while i + 8 <= len(datos):
        longitud = int.from_bytes(datos[i : i + 4], "big")
        tipo = datos[i + 4 : i + 8]
        if tipo not in _PNG_PERMITIDOS:
            _rechazar(f"png con bloque {tipo!r}")
        i += 12 + longitud
        if i > len(datos):
            _rechazar("png truncado")
        if tipo == b"IEND":
            if i != len(datos):
                _rechazar("png con datos tras IEND")
            return
    _rechazar("png sin IEND")
