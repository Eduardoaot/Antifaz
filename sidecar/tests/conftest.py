from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest
from hypothesis import HealthCheck, settings
from PIL import Image

from revisor.esquemas import Ocultamiento

settings.register_profile("corto", max_examples=60, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
settings.register_profile("largo", max_examples=2000, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
settings.load_profile("corto")

DATOS = Path(__file__).parent / "datos"
MODELOS = Path(__file__).parent.parent / "modelos"


@pytest.fixture
def carpeta_modelos() -> Path:
    return MODELOS


def imagen_prueba(ancho: int = 64, alto: int = 48, modo: str = "RGB") -> Image.Image:
    rng = np.random.default_rng(7)
    canales = {"RGB": 3, "RGBA": 4, "L": 1, "CMYK": 4, "LA": 2}[modo]
    datos = rng.integers(0, 256, size=(alto, ancho, canales), dtype=np.uint8)
    if modo in ("RGBA", "LA"):
        datos[:, :, -1] = 255
    return Image.fromarray(datos.squeeze() if canales == 1 else datos, mode=modo)


def guardar(ruta: Path, imagen: Image.Image | None = None, **opciones: object) -> Path:
    (imagen if imagen is not None else imagen_prueba()).save(ruta, **opciones)
    return ruta


def bytes_imagen(formato: str = "JPEG", **opciones: object) -> bytes:
    salida = io.BytesIO()
    imagen_prueba().save(salida, format=formato, **opciones)
    return salida.getvalue()


def exif_con_gps() -> Image.Exif:
    exif = Image.Exif()
    exif[0x0110] = "Modelo de telefono secreto"
    exif[0x8825] = {1: "N", 2: (19.0, 25.0, 42.0), 3: "W", 4: (99.0, 7.0, 39.0)}
    return exif


def png_con_dimensiones(ancho: int, alto: int) -> bytes:
    """PNG cuyo encabezado declara dimensiones arbitrarias: la forma clásica de una bomba."""

    def bloque(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))

    cabecera = struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", cabecera) + bloque(b"IDAT", zlib.compress(b"\0" * 16)) + bloque(b"IEND", b"")


def oculto(x: int = 10, y: int = 10, ancho: int = 20, alto: int = 20, efecto: str = "solido", **extra: object) -> Ocultamiento:
    return Ocultamiento(x=x, y=y, ancho=ancho, alto=alto, efecto=efecto, **extra)  # type: ignore[arg-type]
