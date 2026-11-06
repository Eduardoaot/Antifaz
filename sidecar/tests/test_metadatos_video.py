"""Verificador de MP4 exportado (SEG-008, SEG-009): lista blanca de cajas, sin fechas ni GPS."""
from __future__ import annotations

import io

import pytest
from hypothesis import given
from hypothesis import strategies as st

from revisor.errores import Codigo, ErrorRevisor
from revisor.metadatos_video import verificar_mp4


def caja(tipo: bytes, *hijos: bytes) -> bytes:
    cuerpo = b"".join(hijos)
    return (8 + len(cuerpo)).to_bytes(4, "big") + tipo + cuerpo


def completa(version: int = 0, banderas: int = 0) -> bytes:
    return bytes([version]) + banderas.to_bytes(3, "big")


def con_fechas(tipo: bytes, creacion: int = 0, modificacion: int = 0, version: int = 0, resto: int = 20) -> bytes:
    ancho = 4 if version == 0 else 8
    return caja(tipo, completa(version), creacion.to_bytes(ancho, "big"), modificacion.to_bytes(ancho, "big"), bytes(resto))


def hdlr(tipo: bytes = b"vide", nombre: bytes = b"VideoHandler") -> bytes:
    return caja(b"hdlr", completa(), bytes(4), tipo, bytes(12), nombre + b"\x00")


def entrada_video(compresor: bytes = b"", hijas: tuple[bytes, ...] = (b"avcC",), colr: bytes = b"nclx") -> bytes:
    cabecera = bytearray(78)
    if compresor:
        cabecera[42] = len(compresor)
        cabecera[43 : 43 + len(compresor)] = compresor
    cajas = [caja(h, colr + bytes(7)) if h == b"colr" else caja(h, bytes(8)) for h in hijas]
    return caja(b"avc1", bytes(cabecera), *cajas)


def entrada_audio() -> bytes:
    return caja(b"mp4a", bytes(28), caja(b"esds", bytes(20)))


def stsd(entrada: bytes, cuantas: int = 1) -> bytes:
    return caja(b"stsd", completa(), cuantas.to_bytes(4, "big"), entrada)


def dref(bandera: int = 1) -> bytes:
    return caja(b"dinf", caja(b"dref", completa(), (1).to_bytes(4, "big"), caja(b"url ", completa(0, bandera))))


def trak(
    tipo: bytes = b"vide",
    *,
    tkhd: bytes | None = None,
    mdhd: bytes | None = None,
    manejador: bytes | None = None,
    entrada: bytes | None = None,
    extra_stbl: bytes = b"",
    extra_trak: bytes = b"",
    dinf: bytes | None = None,
) -> bytes:
    es_video = tipo == b"vide"
    medio = caja(b"vmhd", completa(0, 1), bytes(8)) if es_video else caja(b"smhd", completa(), bytes(4))
    if entrada is None:
        entrada = entrada_video() if es_video else entrada_audio()
    if manejador is None:
        manejador = hdlr(tipo, b"VideoHandler" if es_video else b"SoundHandler")
    tablas = caja(
        b"stbl",
        stsd(entrada),
        *(caja(t, completa(), bytes(4)) for t in (b"stts", b"stsc", b"stsz", b"stco")),
        extra_stbl,
    )
    return caja(
        b"trak",
        tkhd if tkhd is not None else con_fechas(b"tkhd", resto=72),
        caja(b"edts", caja(b"elst", completa(), bytes(4))),
        caja(
            b"mdia",
            mdhd if mdhd is not None else con_fechas(b"mdhd", resto=8),
            manejador,
            caja(b"minf", medio, dinf if dinf is not None else dref(), tablas),
        ),
        extra_trak,
    )


def mp4(
    *,
    pistas: tuple[bytes, ...] | None = None,
    mvhd: bytes | None = None,
    extra_moov: bytes = b"",
    extra_raiz: bytes = b"",
    mdat: bytes | None = None,
) -> bytes:
    if pistas is None:
        pistas = (trak(b"vide"), trak(b"soun"))
    return (
        caja(b"ftyp", b"isom", bytes(4), b"isomiso2avc1mp41")
        + caja(b"moov", mvhd if mvhd is not None else con_fechas(b"mvhd", resto=88), *pistas, extra_moov)
        + extra_raiz
        + (mdat if mdat is not None else caja(b"mdat", b"\x00\x01\x02" * 50))
    )


def verificar(datos: bytes) -> None:
    verificar_mp4(io.BytesIO(datos))


def rechaza(datos: bytes, fragmento: str) -> None:
    with pytest.raises(ErrorRevisor) as e:
        verificar(datos)
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
    assert fragmento in e.value.detalle


def test_mp4_limpio_pasa() -> None:
    verificar(mp4())


def test_mp4_solo_video_pasa() -> None:
    verificar(mp4(pistas=(trak(b"vide"),)))


def test_mp4_con_free_vacio_y_fechas_v1_en_cero_pasa() -> None:
    verificar(mp4(mvhd=con_fechas(b"mvhd", version=1, resto=88), extra_raiz=caja(b"free", bytes(16))))


def test_mdat_abierto_al_final_pasa() -> None:
    datos = mp4(mdat=b"\x00\x00\x00\x00mdat" + bytes(100))
    verificar(datos)


def test_mdat_con_tamano_extendido_pasa() -> None:
    cuerpo = bytes(40)
    verificar(mp4(mdat=(1).to_bytes(4, "big") + b"mdat" + (16 + len(cuerpo)).to_bytes(8, "big") + cuerpo))


@pytest.mark.parametrize(
    ("datos", "fragmento"),
    [
        # GPS de iPhone y Android vive en udta/©xyz o en meta.
        (mp4(extra_moov=caja(b"udta", caja(b"\xa9xyz", b"+19.4326-099.1332/"))), "udta"),
        (mp4(extra_moov=caja(b"meta", completa())), "meta"),
        (mp4(extra_raiz=caja(b"uuid", bytes(16))), "uuid"),
        (mp4(extra_raiz=caja(b"meta", completa())), "meta"),
        (mp4(pistas=(trak(b"vide", extra_trak=caja(b"udta")),)), "udta"),
        (mp4(pistas=(trak(b"vide", extra_stbl=caja(b"saiz", bytes(4))),)), "saiz"),
    ],
)
def test_seg008_rechaza_cajas_de_metadatos(datos: bytes, fragmento: str) -> None:
    rechaza(datos, fragmento)


@pytest.mark.parametrize("version", [0, 1])
@pytest.mark.parametrize("tipo", [b"mvhd", b"tkhd", b"mdhd"])
@pytest.mark.parametrize(("creacion", "modificacion"), [(3_800_000_000, 0), (0, 1)])
def test_rechaza_fechas(tipo: bytes, version: int, creacion: int, modificacion: int) -> None:
    resto = {b"mvhd": 88, b"tkhd": 72, b"mdhd": 8}[tipo]
    fechada = con_fechas(tipo, creacion, modificacion, version, resto)
    if tipo == b"mvhd":
        datos = mp4(mvhd=fechada)
    elif tipo == b"tkhd":
        datos = mp4(pistas=(trak(b"vide", tkhd=fechada),))
    else:
        datos = mp4(pistas=(trak(b"vide", mdhd=fechada),))
    rechaza(datos, "fecha")


def test_rechaza_version_desconocida() -> None:
    rechaza(mp4(mvhd=con_fechas(b"mvhd", version=2, resto=88)), "versión")


@pytest.mark.parametrize("tipo", [b"meta", b"tmcd", b"text", b"sbtl", b"gpmd"])
def test_rechaza_pistas_que_no_son_video_ni_audio(tipo: bytes) -> None:
    rechaza(mp4(pistas=(trak(b"vide"), trak(b"vide", manejador=hdlr(tipo, b"Datos")))), "pista de tipo")


def test_rechaza_nombre_de_pista_ajeno() -> None:
    rechaza(mp4(pistas=(trak(b"vide", manejador=hdlr(b"vide", b"Core Media Video")),)), "nombre de pista")


def test_acepta_nombre_de_pista_vacio() -> None:
    verificar(mp4(pistas=(trak(b"vide", manejador=hdlr(b"vide", b"")),)))


def test_rechaza_nombre_de_compresor() -> None:
    rechaza(mp4(pistas=(trak(b"vide", entrada=entrada_video(b"Lavc libx264")),)), "compresor")


def test_rechaza_perfil_icc_y_acepta_nclx() -> None:
    verificar(mp4(pistas=(trak(b"vide", entrada=entrada_video(hijas=(b"avcC", b"colr"))),)))
    con_icc = entrada_video(hijas=(b"avcC", b"colr"), colr=b"prof")
    rechaza(mp4(pistas=(trak(b"vide", entrada=con_icc),)), "ICC")


def test_rechaza_caja_ajena_en_la_descripcion() -> None:
    rechaza(mp4(pistas=(trak(b"vide", entrada=entrada_video(hijas=(b"avcC", b"uuid"))),)), "descripción")


def test_rechaza_codec_desconocido() -> None:
    rechaza(mp4(pistas=(trak(b"vide", entrada=caja(b"mjpg", bytes(78))),)), "códec")


def test_rechaza_dos_descripciones() -> None:
    pista = trak(b"vide")
    datos = mp4(pistas=(pista.replace(b"stsd" + completa() + (1).to_bytes(4, "big"), b"stsd" + completa() + (2).to_bytes(4, "big")),))
    rechaza(datos, "descripciones")


def test_rechaza_datos_externos() -> None:
    rechaza(mp4(pistas=(trak(b"vide", dinf=dref(bandera=0)),)), "externos")


def test_rechaza_dos_pistas_de_video() -> None:
    rechaza(mp4(pistas=(trak(b"vide"), trak(b"vide"))), "2 pistas de video")


def test_rechaza_dos_pistas_de_audio() -> None:
    rechaza(mp4(pistas=(trak(b"vide"), trak(b"soun"), trak(b"soun"))), "2 pistas de audio")


def test_rechaza_sin_video() -> None:
    rechaza(mp4(pistas=(trak(b"soun"),)), "0 pistas de video")


def test_rechaza_sin_pistas() -> None:
    rechaza(mp4(pistas=()), "pistas incompletas")


def test_rechaza_free_con_datos() -> None:
    rechaza(mp4(extra_raiz=caja(b"free", b"Pixel 9 Pro")), "free")


def test_rechaza_bytes_sobrantes() -> None:
    rechaza(mp4() + b"\x00\x00\x00", "truncado")


def test_rechaza_sin_ftyp() -> None:
    rechaza(mp4()[len(caja(b"ftyp", b"isom", bytes(4), b"isomiso2avc1mp41")) :], "ftyp")
    rechaza(b"", "ftyp")


def test_rechaza_dos_moov() -> None:
    datos = mp4()
    moov_inicio = datos.index(b"moov") - 4
    moov_fin = moov_inicio + int.from_bytes(datos[moov_inicio : moov_inicio + 4], "big")
    rechaza(datos[:moov_fin] + datos[moov_inicio:moov_fin] + datos[moov_fin:], "moov")


def test_rechaza_sin_mdat() -> None:
    datos = mp4()
    rechaza(datos[: datos.rindex(b"mdat") - 4], "sin datos")


def test_rechaza_tamano_abierto_fuera_de_mdat() -> None:
    rechaza(mp4(extra_raiz=b"\x00\x00\x00\x00free"), "tamaño abierto")


def test_rechaza_caja_mas_grande_que_el_archivo() -> None:
    datos = bytearray(mp4())
    i = datos.rindex(b"mdat") - 4
    datos[i : i + 4] = (10**6).to_bytes(4, "big")
    rechaza(bytes(datos), "longitud inválida")


def test_rechaza_tamano_menor_que_la_cabecera() -> None:
    rechaza(mp4(extra_raiz=(4).to_bytes(4, "big") + b"free"), "longitud inválida")


def test_rechaza_tamano_extendido_truncado() -> None:
    rechaza(mp4(mdat=(1).to_bytes(4, "big") + b"mdat" + b"\x00\x00"), "extendido")


def test_rechaza_anidamiento_excesivo() -> None:
    profundo = caja(b"stbl")
    for _ in range(14):
        profundo = caja(b"stbl", profundo)
    pista = trak(b"vide", extra_stbl=profundo)
    with pytest.raises(ErrorRevisor) as e:
        verificar(mp4(pistas=(pista,)))
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA


def test_detalle_del_log_no_lleva_bytes_crudos() -> None:
    with pytest.raises(ErrorRevisor) as e:
        verificar(mp4(extra_raiz=caja(b"\xa9\n\x00x", bytes(4))))
    assert e.value.detalle.isprintable()


@given(st.data())
def test_fail_closed_ante_recortes_y_cambios(data: st.DataObject) -> None:
    """Cualquier recorte, o un byte cambiado en las cabeceras, o se rechaza con el error tipado o
    sigue siendo un MP4 limpio. Nunca se rompe con otra excepción."""
    original = mp4()
    corte = data.draw(st.integers(0, len(original) - 1))
    cambiado = bytearray(original[:corte] if data.draw(st.booleans()) else original)
    if cambiado:
        limite = min(len(cambiado), original.rindex(b"mdat") + 4)
        i = data.draw(st.integers(0, max(0, limite - 1)))
        cambiado[i] = data.draw(st.integers(0, 255))
    try:
        verificar(bytes(cambiado))
    except ErrorRevisor as e:
        assert e.codigo is Codigo.EXPORTACION_NO_VERIFICADA
