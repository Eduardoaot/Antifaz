"""Comprueba, leyendo los bytes, que un MP4 exportado solo tiene lo indispensable (SEG-008, SEG-009).

Es el equivalente de metadatos.py para video. Recorre las cajas ISO-BMFF con una lista blanca y
rechaza todo lo demás. En particular:
- `udta`, `meta`, `uuid` y `©xyz`: ahí van GPS (`©xyz`), modelo del teléfono y fechas;
- pistas que no sean de video o de audio, como las de GPS o de timecode;
- fechas de creación o modificación distintas de cero en `mvhd`, `tkhd` y `mdhd`;
- nombre de compresor en la descripción de la pista, y perfiles de color ICC (pueden traer nombres);
- bytes sobrantes al final o cajas con longitud inválida.

Lee solo las cabeceras de las cajas y salta `mdat`, así que no carga el video en memoria.

Pendiente: confirmar con FFmpeg real que su salida, con `-map_metadata -1 -fflags +bitexact`, cabe en
esta lista. Si no cabe, la exportación falla cerrada; se ajusta la lista, no se relaja la regla.
"""

from __future__ import annotations

from typing import BinaryIO, NoReturn

from .errores import Codigo, ErrorRevisor

# Cajas que solo contienen otras cajas.
_CONTENEDORAS = {b"moov", b"trak", b"edts", b"mdia", b"minf", b"dinf", b"stbl"}
# Cajas permitidas por padre. b"" es el nivel superior del archivo.
_PERMITIDAS: dict[bytes, set[bytes]] = {
    b"": {b"ftyp", b"moov", b"mdat", b"free"},
    b"moov": {b"mvhd", b"trak"},
    b"trak": {b"tkhd", b"edts", b"mdia"},
    b"edts": {b"elst"},
    b"mdia": {b"mdhd", b"hdlr", b"minf"},
    b"minf": {b"vmhd", b"smhd", b"dinf", b"stbl"},
    b"dinf": {b"dref"},
    b"stbl": {
        b"stsd", b"stts", b"stss", b"ctts", b"stsc", b"stsz", b"stco", b"co64", b"sgpd", b"sbgp", b"sdtp",
    },
}
_UNICAS_ARRIBA = {b"ftyp", b"moov"}
_HANDLERS = {b"vide": b"VideoHandler", b"soun": b"SoundHandler"}
_ENTRADAS_VIDEO = {b"avc1", b"hvc1"}
_ENTRADAS_AUDIO = {b"mp4a"}
_HIJAS_ENTRADA = {b"avcC", b"hvcC", b"btrt", b"pasp", b"colr", b"esds"}
# Tamaño fijo antes de las cajas hijas en una entrada de stsd (ISO/IEC 14496-12, 12.1.3 y 12.2.3).
_CABECERA_VISUAL = 8 + 78
_CABECERA_AUDIO = 8 + 28
_COMPRESOR = slice(8 + 42, 8 + 74)
_MAX_CAJA_LEIDA = 4 * 1024 * 1024
_MAX_PROFUNDIDAD = 12


def _rechazar(detalle: str) -> NoReturn:
    raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, detalle)


def _nombre(tipo: bytes) -> str:
    """Nombre seguro para el log: solo ASCII imprimible."""
    return "".join(chr(b) if 0x20 <= b < 0x7F else "?" for b in tipo)


def _cabecera(archivo: BinaryIO, fin: int) -> tuple[bytes, int, int]:
    """Lee una cabecera de caja. Devuelve tipo, inicio del contenido y fin de la caja."""
    inicio = archivo.tell()
    base = archivo.read(8)
    if len(base) != 8:
        _rechazar("mp4 truncado en una cabecera")
    tamano, tipo = int.from_bytes(base[:4], "big"), base[4:]
    contenido = inicio + 8
    if tamano == 1:
        extendido = archivo.read(8)
        if len(extendido) != 8:
            _rechazar("mp4 truncado en un tamaño extendido")
        tamano = int.from_bytes(extendido, "big")
        contenido += 8
    elif tamano == 0:
        # "Hasta el final": solo se acepta en mdat, que es lo último que escribe FFmpeg sin faststart.
        tamano = fin - inicio
        if tipo != b"mdat":
            _rechazar(f"mp4 con caja {_nombre(tipo)} de tamaño abierto")
    if tamano < contenido - inicio or inicio + tamano > fin:
        _rechazar(f"mp4 con caja {_nombre(tipo)} de longitud inválida")
    return tipo, contenido, inicio + tamano


def _leer(archivo: BinaryIO, desde: int, hasta: int) -> bytes:
    if hasta - desde > _MAX_CAJA_LEIDA:
        _rechazar("mp4 con una caja de cabecera demasiado grande")
    archivo.seek(desde)
    datos = archivo.read(hasta - desde)
    if len(datos) != hasta - desde:
        _rechazar("mp4 truncado")
    return datos


def _fechas_en_cero(cuerpo: bytes, tipo: bytes) -> None:
    """mvhd, tkhd y mdhd: versión, banderas, creación y modificación (32 o 64 bits)."""
    if len(cuerpo) < 4:
        _rechazar(f"mp4 con {_nombre(tipo)} truncado")
    ancho = {0: 4, 1: 8}.get(cuerpo[0])
    if ancho is None:
        _rechazar(f"mp4 con {_nombre(tipo)} de versión desconocida")
    fechas = cuerpo[4 : 4 + 2 * ancho]
    if len(fechas) != 2 * ancho:
        _rechazar(f"mp4 con {_nombre(tipo)} truncado")
    if any(fechas):
        _rechazar(f"mp4 con fecha en {_nombre(tipo)}")


def _handler(cuerpo: bytes) -> bytes:
    # versión y banderas (4), pre_defined (4), handler_type (4), reservado (12), nombre terminado en 0.
    if len(cuerpo) < 25:
        _rechazar("mp4 con hdlr truncado")
    tipo = cuerpo[8:12]
    esperado = _HANDLERS.get(tipo)
    if esperado is None:
        _rechazar(f"mp4 con pista de tipo {_nombre(tipo)}")
    nombre = cuerpo[24:].rstrip(b"\x00")
    if nombre not in (b"", esperado):
        _rechazar("mp4 con nombre de pista inesperado")
    return tipo


def _entrada_stsd(entrada: bytes) -> None:
    tipo = entrada[4:8]
    if tipo in _ENTRADAS_VIDEO:
        cabecera = _CABECERA_VISUAL
        if len(entrada) < cabecera:
            _rechazar("mp4 con entrada de video truncada")
        # El primer byte es la longitud del nombre del compresor; debe estar vacío.
        if any(entrada[_COMPRESOR]):
            _rechazar("mp4 con nombre de compresor")
    elif tipo in _ENTRADAS_AUDIO:
        cabecera = _CABECERA_AUDIO
        if len(entrada) < cabecera:
            _rechazar("mp4 con entrada de audio truncada")
    else:
        _rechazar(f"mp4 con códec {_nombre(tipo)}")
    i = cabecera
    while i < len(entrada):
        if i + 8 > len(entrada):
            _rechazar("mp4 con caja hija truncada")
        tamano, hija = int.from_bytes(entrada[i : i + 4], "big"), entrada[i + 4 : i + 8]
        if tamano < 8 or i + tamano > len(entrada):
            _rechazar("mp4 con caja hija de longitud inválida")
        if hija not in _HIJAS_ENTRADA:
            _rechazar(f"mp4 con caja {_nombre(hija)} en la descripción de la pista")
        if hija == b"colr" and entrada[i + 8 : i + 12] != b"nclx":
            _rechazar("mp4 con perfil de color ICC")
        i += tamano


def _stsd(cuerpo: bytes) -> None:
    if len(cuerpo) < 8:
        _rechazar("mp4 con stsd truncado")
    cuantas = int.from_bytes(cuerpo[4:8], "big")
    if cuantas != 1:
        _rechazar(f"mp4 con {cuantas} descripciones en una pista")
    entrada = cuerpo[8:]
    if len(entrada) < 8 or int.from_bytes(entrada[:4], "big") != len(entrada):
        _rechazar("mp4 con stsd de longitud inválida")
    _entrada_stsd(entrada)


def _dref(cuerpo: bytes) -> None:
    # Una sola referencia "url " con la bandera 1: los datos están en este mismo archivo.
    if cuerpo[4:8] != (1).to_bytes(4, "big") or cuerpo[8:] != b"\x00\x00\x00\x0curl \x00\x00\x00\x01":
        _rechazar("mp4 con referencia a datos externos")


def _recorrer(
    archivo: BinaryIO, padre: bytes, inicio: int, fin: int, profundidad: int, conteo: dict[bytes, int]
) -> None:
    if profundidad > _MAX_PROFUNDIDAD:
        _rechazar("mp4 demasiado anidado")
    permitidas = _PERMITIDAS[padre]
    handler: bytes | None = None
    tiene_vmhd = tiene_smhd = False
    archivo.seek(inicio)
    while archivo.tell() < fin:
        tipo, contenido, final = _cabecera(archivo, fin)
        if tipo not in permitidas:
            _rechazar(f"mp4 con caja {_nombre(tipo)} dentro de {_nombre(padre) or 'la raíz'}")
        conteo[tipo] = conteo.get(tipo, 0) + 1
        if tipo in _CONTENEDORAS:
            _recorrer(archivo, tipo, contenido, final, profundidad + 1, conteo)
        elif tipo in (b"mvhd", b"tkhd", b"mdhd"):
            _fechas_en_cero(_leer(archivo, contenido, final), tipo)
        elif tipo == b"hdlr":
            handler = _handler(_leer(archivo, contenido, final))
        elif tipo == b"stsd":
            _stsd(_leer(archivo, contenido, final))
        elif tipo == b"dref":
            _dref(_leer(archivo, contenido, final))
        elif tipo == b"free":
            if any(_leer(archivo, contenido, final)):
                _rechazar("mp4 con datos en una caja free")
        tiene_vmhd |= tipo == b"vmhd"
        tiene_smhd |= tipo == b"smhd"
        archivo.seek(final)
    if archivo.tell() != fin:
        _rechazar("mp4 con bytes sobrantes")
    if padre == b"mdia" and handler is None:
        _rechazar("mp4 con pista sin hdlr")
    if padre == b"minf" and tiene_vmhd == tiene_smhd:
        _rechazar("mp4 con pista sin tipo de medio claro")


def verificar_mp4(archivo: BinaryIO) -> None:
    """Levanta EXPORTACION_NO_VERIFICADA si el MP4 trae algo fuera de la lista blanca."""
    archivo.seek(0, 2)
    fin = archivo.tell()
    archivo.seek(0)
    primeros = archivo.read(8)
    if len(primeros) != 8 or primeros[4:8] != b"ftyp":
        _rechazar("mp4 sin ftyp al inicio")
    conteo: dict[bytes, int] = {}
    _recorrer(archivo, b"", 0, fin, 0, conteo)
    for tipo in _UNICAS_ARRIBA:
        if conteo.get(tipo, 0) != 1:
            _rechazar(f"mp4 con {conteo.get(tipo, 0)} cajas {_nombre(tipo)}")
    if conteo.get(b"mdat", 0) < 1:
        _rechazar("mp4 sin datos")
    if conteo.get(b"trak", 0) < 1 or conteo.get(b"trak", 0) != conteo.get(b"hdlr", 0):
        _rechazar("mp4 con pistas incompletas")
    # La exportación escribe una pista de video y, si el original tenía, una de audio.
    if conteo.get(b"vmhd", 0) != 1:
        _rechazar(f"mp4 con {conteo.get(b'vmhd', 0)} pistas de video")
    if conteo.get(b"smhd", 0) > 1:
        _rechazar(f"mp4 con {conteo[b'smhd']} pistas de audio")
