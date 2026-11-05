"""Carga de imágenes por contenido, nunca por extensión. Rechaza antes de decodificar lo que no cabe."""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from pathlib import PurePath
from typing import Any

import numpy as np
import rawpy
from numpy.typing import NDArray
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from PIL.ExifTags import IFD
from pillow_heif import register_heif_opener

from .errores import Codigo, ErrorRevisor
from .rutas import ruta_larga

register_heif_opener()
# El límite propio se revisa antes de decodificar; así la bomba se rechaza con un mensaje claro.
Image.MAX_IMAGE_PIXELS = None

registro = logging.getLogger(__name__)

MAX_BYTES_IMAGEN = 1024**3
MAX_MEGAPIXELES = 200
MAX_LADO_PX = 30000
MAX_RELACION_ASPECTO = 100
LADO_MIN_DETECCION = 16
FIRMA_PNG = bytes((0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))
FORMATOS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF", "AVIF", "GIF", "TIFF", "BMP"}
FORMATOS_ANIMABLES = {"GIF", "WEBP", "PNG", "AVIF"}
# Pillow abriría estos como TIFF y solo vería la miniatura, así que van directo a LibRaw.
EXTENSIONES_RAW = {".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".pef", ".srw"}

Pixeles = NDArray[np.uint8]


@dataclass
class ImagenCargada:
    pixeles: Pixeles
    formato: str
    ruta: str
    tiene_gps: bool
    metadatos_legibles: bool
    tiene_alfa: bool
    demasiado_pequena: bool
    huella: str = ""

    @property
    def ancho(self) -> int:
        return int(self.pixeles.shape[1])

    @property
    def alto(self) -> int:
        return int(self.pixeles.shape[0])


def _revisar_dimensiones(ancho: int, alto: int) -> None:
    if ancho < 1 or alto < 1:
        raise ErrorRevisor(Codigo.IMAGEN_CORRUPTA, "dimensiones no positivas")
    if ancho > MAX_LADO_PX or alto > MAX_LADO_PX or ancho * alto > MAX_MEGAPIXELES * 1_000_000:
        raise ErrorRevisor(Codigo.IMAGEN_DEMASIADO_GRANDE, f"{ancho}x{alto}")
    if max(ancho, alto) / min(ancho, alto) > MAX_RELACION_ASPECTO:
        raise ErrorRevisor(Codigo.IMAGEN_MUY_ALARGADA, f"{ancho}x{alto}")


def _revisar_archivo(ruta: str) -> None:
    try:
        info = os.stat(ruta)
    except FileNotFoundError as e:
        raise ErrorRevisor(Codigo.ARCHIVO_NO_ENCONTRADO) from e
    except PermissionError as e:
        raise ErrorRevisor(Codigo.SIN_PERMISOS) from e
    except (OSError, ValueError) as e:
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, type(e).__name__) from e
    if not os.path.isfile(ruta):
        raise ErrorRevisor(Codigo.NO_ES_IMAGEN, "no es un archivo regular")
    if info.st_size == 0:
        raise ErrorRevisor(Codigo.ARCHIVO_VACIO)
    if info.st_size > MAX_BYTES_IMAGEN:
        raise ErrorRevisor(Codigo.ARCHIVO_DEMASIADO_PESADO, f"{info.st_size} bytes")


def _leer_gps(imagen: Image.Image) -> tuple[bool, bool]:
    """Devuelve (tiene_gps, metadatos_legibles). Un fallo aquí vuelve parcial el análisis."""
    try:
        gps = bool(imagen.getexif().get_ifd(IFD.GPSInfo))
        xmp: Any = imagen.info.get("xmp") or imagen.info.get("XML:com.adobe.xmp") or b""
        crudo = xmp.encode("utf-8", "ignore") if isinstance(xmp, str) else bytes(xmp)
        return gps or b"GPSLatitude" in crudo, True
    except Exception as e:  # noqa: BLE001 - un EXIF dañado puede lanzar casi cualquier cosa
        registro.warning("EXIF ilegible: %s", type(e).__name__)
        return False, False


def _verificar_integridad_png(ruta: str) -> None:
    """Pillow no revisa el CRC de IDAT al decodificar: un PNG dañado saldría como imagen válida."""
    with open(ruta, "rb") as archivo:
        if archivo.read(8) != FIRMA_PNG:
            return
    with Image.open(ruta) as imagen:
        imagen.verify()


def _orientar(imagen: Image.Image) -> tuple[Image.Image, bool]:
    """Un EXIF dañado no debe impedir abrir la foto, pero sí vuelve parcial el análisis."""
    try:
        return ImageOps.exif_transpose(imagen), True
    except Exception as e:  # noqa: BLE001 - un EXIF dañado puede lanzar casi cualquier cosa
        registro.warning("Orientación ilegible: %s", type(e).__name__)
        return imagen, False


def _a_srgb(imagen: Image.Image) -> Image.Image:
    perfil: Any = imagen.info.get("icc_profile")
    if not perfil or imagen.mode not in ("RGB", "RGBA", "CMYK", "L"):
        return imagen
    try:
        import io

        origen = ImageCms.ImageCmsProfile(io.BytesIO(perfil))
        destino = ImageCms.createProfile("sRGB")
        salida = "RGBA" if imagen.mode == "RGBA" else "RGB"
        convertida = ImageCms.profileToProfile(imagen, origen, destino, outputMode=salida)
        return convertida if convertida is not None else imagen
    except (OSError, ValueError, ImageCms.PyCMSError) as e:
        # El color queda aproximado, pero el perfil no se conserva: la salida se escribe desde píxeles.
        registro.warning("Perfil de color no convertido: %s", type(e).__name__)
        return imagen


def _a_ocho_bits(imagen: Image.Image) -> Image.Image:
    if imagen.mode.startswith("I;16") or imagen.mode == "I":
        datos = np.asarray(imagen, dtype=np.float64)
        if imagen.mode == "I" and float(datos.max(initial=0)) <= 255:
            return Image.fromarray(np.clip(datos, 0, 255).astype(np.uint8), mode="L")
        return Image.fromarray(np.clip(datos / 257.0, 0, 255).astype(np.uint8), mode="L")
    if imagen.mode == "F":
        datos = np.nan_to_num(np.asarray(imagen, dtype=np.float64))
        minimo, maximo = float(datos.min()), float(datos.max())
        escala = 255.0 / (maximo - minimo) if maximo > minimo else 0.0
        return Image.fromarray(((datos - minimo) * escala).astype(np.uint8), mode="L")
    return imagen


def _normalizar(imagen: Image.Image) -> Pixeles:
    imagen = _a_ocho_bits(imagen)
    tiene_alfa = imagen.mode in ("RGBA", "LA", "PA", "La", "RGBa") or "transparency" in imagen.info
    imagen = _a_srgb(imagen)
    convertida = imagen.convert("RGBA" if tiene_alfa else "RGB")
    return np.array(convertida, dtype=np.uint8)


def _cargar_raw(ruta: str) -> Pixeles:
    try:
        with rawpy.imread(ruta) as raw:
            _revisar_dimensiones(raw.sizes.width, raw.sizes.height)
            return np.array(raw.postprocess(use_camera_wb=True, output_bps=8), dtype=np.uint8)
    except ErrorRevisor:
        raise
    except MemoryError as e:
        raise ErrorRevisor(Codigo.MEMORIA_INSUFICIENTE) from e
    except Exception as e:  # noqa: BLE001 - LibRaw expone muchas clases propias de error
        raise ErrorRevisor(Codigo.NO_ES_IMAGEN, f"raw: {type(e).__name__}") from e


def _abrir_raw(ruta_original: str, ruta: str, huella: str) -> ImagenCargada:
    pixeles = _cargar_raw(ruta)
    try:
        with Image.open(ruta) as cabecera:
            tiene_gps, legibles = _leer_gps(cabecera)
    except (OSError, ValueError, SyntaxError):
        tiene_gps, legibles = False, False
    return _construir(pixeles, "RAW", ruta_original, tiene_gps, legibles, huella)


def _huella(ruta: str) -> str:
    """Identifica el contenido del archivo: las decisiones solo valen para estos mismos bytes."""
    resumen = hashlib.sha256()
    try:
        with open(ruta, "rb") as archivo:
            while parte := archivo.read(1024 * 1024):
                resumen.update(parte)
    except FileNotFoundError as e:
        raise ErrorRevisor(Codigo.ARCHIVO_NO_ENCONTRADO) from e
    except PermissionError as e:
        raise ErrorRevisor(Codigo.SIN_PERMISOS) from e
    except OSError as e:
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, f"errno {e.errno}") from e
    return resumen.hexdigest()


def _construir(
    pixeles: Pixeles, formato: str, ruta: str, tiene_gps: bool, legibles: bool, huella: str
) -> ImagenCargada:
    return ImagenCargada(
        pixeles=pixeles,
        formato=formato,
        ruta=ruta,
        tiene_gps=tiene_gps,
        metadatos_legibles=legibles,
        tiene_alfa=bool(pixeles.shape[2] == 4),
        demasiado_pequena=min(pixeles.shape[0], pixeles.shape[1]) < LADO_MIN_DETECCION,
        huella=huella,
    )


def abrir(ruta_original: str) -> ImagenCargada:
    ruta = ruta_larga(ruta_original)
    _revisar_archivo(ruta)
    # Se calcula antes de decodificar: si el archivo cambia después, la huella ya no coincidirá.
    huella = _huella(ruta)
    if PurePath(ruta_original).suffix.lower() in EXTENSIONES_RAW:
        return _abrir_raw(ruta_original, ruta, huella)
    try:
        _verificar_integridad_png(ruta)
        with Image.open(ruta) as imagen:
            formato = imagen.format or ""
            if formato not in FORMATOS:
                raise ErrorRevisor(Codigo.NO_ES_IMAGEN, f"formato {formato}")
            _revisar_dimensiones(*imagen.size)
            if formato in FORMATOS_ANIMABLES and int(getattr(imagen, "n_frames", 1)) > 1:
                raise ErrorRevisor(Codigo.ANIMACION_NO_SOPORTADA)
            tiene_gps, legibles = _leer_gps(imagen)
            imagen.load()
            orientada, orientacion_legible = _orientar(imagen)
            _revisar_dimensiones(*orientada.size)
            pixeles = _normalizar(orientada)
            legibles = legibles and orientacion_legible
    except ErrorRevisor:
        raise
    except FileNotFoundError as e:
        raise ErrorRevisor(Codigo.ARCHIVO_NO_ENCONTRADO) from e
    except PermissionError as e:
        raise ErrorRevisor(Codigo.SIN_PERMISOS) from e
    except UnidentifiedImageError as e:
        raise ErrorRevisor(Codigo.NO_ES_IMAGEN, "no identificada") from e
    except MemoryError as e:
        raise ErrorRevisor(Codigo.MEMORIA_INSUFICIENTE) from e
    except Exception as e:  # noqa: BLE001 - un archivo malformado puede lanzar casi cualquier cosa
        raise ErrorRevisor(Codigo.IMAGEN_CORRUPTA, type(e).__name__) from e
    return _construir(pixeles, formato, ruta_original, tiene_gps, legibles, huella)
