"""Exportación fail-closed: temporal, verificación y renombrado atómico. Nunca queda un archivo a medias."""

from __future__ import annotations

import errno
import io
import logging
import os
import uuid
from collections.abc import Sequence
from pathlib import PurePath
from typing import assert_never

import numpy as np
from PIL import Image

from . import efectos, metadatos
from .cargador import ImagenCargada, Pixeles
from .errores import Codigo, ErrorRevisor
from .esquemas import Ocultamiento
from .rutas import misma_ruta, ruta_larga

registro = logging.getLogger(__name__)

EXTENSIONES = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG"}
# Diferencia media admitida entre lo pedido y lo escrito en JPEG, que comprime con pérdida.
TOLERANCIA_JPEG = 24.0


def _codificar(pixeles: Pixeles, formato: str, calidad: int) -> bytes:
    salida = io.BytesIO()
    # Se crea desde el arreglo, así que no hereda ningún metadato de la imagen de origen.
    imagen = Image.fromarray(pixeles)
    match formato:
        case "JPEG":
            imagen.save(salida, format="JPEG", quality=calidad, optimize=True)
        case "PNG":
            imagen.save(salida, format="PNG", optimize=False)
        case _:
            raise ErrorRevisor(Codigo.INTERNO, f"formato sin codificador: {formato}")
    return salida.getvalue()


def _aplanar(pixeles: Pixeles) -> Pixeles:
    """JPEG no admite transparencia: se compone sobre blanco."""
    if pixeles.shape[2] != 4:
        return pixeles
    alfa = pixeles[:, :, 3:4].astype(np.float32) / 255.0
    return (pixeles[:, :, :3] * alfa + 255.0 * (1.0 - alfa)).astype(np.uint8)


def _verificar_contenido(
    datos: bytes, formato: str, esperado: Pixeles, regiones: Sequence[tuple[int, int, int, int]]
) -> None:
    match formato:
        case "JPEG":
            metadatos.verificar_jpeg(datos)
        case "PNG":
            metadatos.verificar_png(datos)
        case _:
            raise ErrorRevisor(Codigo.INTERNO, f"formato sin verificador: {formato}")
    with Image.open(io.BytesIO(datos)) as releida:
        leida = np.array(releida.convert("RGBA" if esperado.shape[2] == 4 else "RGB"), dtype=np.uint8)
    if leida.shape != esperado.shape:
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "dimensiones distintas")
    for x0, y0, x1, y1 in regiones:
        zona_leida = leida[y0:y1, x0:x1].astype(np.int16)
        diferencia = float(np.abs(zona_leida - esperado[y0:y1, x0:x1]).mean())
        if diferencia > (0.0 if formato == "PNG" else TOLERANCIA_JPEG):
            raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, f"zona oculta alterada: {diferencia:.1f}")


def _error_de_sistema(e: OSError) -> ErrorRevisor:
    if e.errno in (errno.ENOSPC, errno.EDQUOT):
        return ErrorRevisor(Codigo.DISCO_LLENO)
    if e.errno in (errno.EACCES, errno.EPERM, errno.EROFS) or isinstance(e, PermissionError):
        return ErrorRevisor(Codigo.SIN_PERMISOS)
    return ErrorRevisor(Codigo.RUTA_INVALIDA, f"errno {e.errno}")


def _escribir_atomico(destino: str, datos: bytes) -> None:
    carpeta = os.path.dirname(destino)
    # Un nombre que no parece terminado, por si la app muere antes del renombrado.
    temporal = os.path.join(carpeta, f".{uuid.uuid4().hex}.parcial")
    try:
        with open(temporal, "wb") as f:
            f.write(datos)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporal, destino)
    except OSError as e:
        raise _error_de_sistema(e) from e
    finally:
        try:
            if os.path.exists(temporal):
                os.remove(temporal)
        except OSError as e:
            registro.warning("No se pudo borrar un temporal: errno %s", e.errno)


def exportar(
    imagen: ImagenCargada,
    ocultamientos: Sequence[Ocultamiento],
    ruta_destino: str,
    jpeg_calidad: int = 92,
    sobrescribir: bool = False,
) -> dict[str, object]:
    formato = EXTENSIONES.get(PurePath(ruta_destino).suffix.lower())
    if formato is None or not os.path.isabs(ruta_destino):
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, "extensión o ruta no admitida")
    if misma_ruta(ruta_destino, imagen.ruta):
        raise ErrorRevisor(Codigo.DESTINO_ES_ORIGEN)
    destino = ruta_larga(ruta_destino)
    if not os.path.isdir(os.path.dirname(destino)):
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, "la carpeta no existe")
    if os.path.exists(destino) and not sobrescribir:
        raise ErrorRevisor(Codigo.DESTINO_EXISTE)

    pixeles, regiones = efectos.aplicar(imagen.pixeles, ocultamientos)
    match formato:
        case "JPEG":
            esperado = _aplanar(pixeles)
        case "PNG":
            esperado = pixeles
        case _ as otro:
            assert_never(otro)  # type: ignore[arg-type]
    try:
        datos = _codificar(esperado, formato, jpeg_calidad)
        _verificar_contenido(datos, formato, esperado, regiones)
    except MemoryError as e:
        raise ErrorRevisor(Codigo.MEMORIA_INSUFICIENTE) from e
    _escribir_atomico(destino, datos)
    return {"formato": formato, "bytes": len(datos), "zonas_ocultas": len(regiones)}
