"""Exportación fail-closed, metadatos (SEG) y limpieza."""
from __future__ import annotations

import errno
import os
import stat
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from revisor import cargador, exportar, metadatos
from revisor.errores import Codigo, ErrorRevisor

from .conftest import exif_con_gps, guardar, imagen_prueba, oculto

CENTINELA = b"Modelo de telefono secreto"


def _abrir_con_todo(tmp_path: Path, nombre: str = "origen.jpg") -> cargador.ImagenCargada:
    exif = exif_con_gps()
    ruta = tmp_path / nombre
    imagen_prueba(300, 200).save(
        ruta,
        format="JPEG",
        exif=exif,
        comment=b"comentario " + CENTINELA,
        icc_profile=b"perfil-con-nombre " + CENTINELA,
        xmp=b"<x:xmpmeta>" + CENTINELA + b"</x:xmpmeta>",
    )
    assert CENTINELA in ruta.read_bytes()
    return cargador.abrir(str(ruta))


@pytest.mark.parametrize("nombre", ["salida.jpg", "salida.JPEG", "salida.png"])
def test_seg_salida_sin_metadatos(tmp_path: Path, nombre: str) -> None:
    imagen = _abrir_con_todo(tmp_path)
    destino = tmp_path / nombre
    exportar.exportar(imagen, [oculto()], str(destino))
    crudo = destino.read_bytes()
    assert CENTINELA not in crudo
    for marca in (b"Exif", b"http://ns.adobe.com", b"ICC_PROFILE", b"GPS", b"xmpmeta", b"Photoshop"):
        assert marca not in crudo
    with Image.open(destino) as releida:
        assert not releida.getexif()
        assert not releida.info.get("icc_profile")
        assert not releida.info.get("comment")
        assert not releida.info.get("xmp")


@pytest.mark.parametrize("nombre", ["salida.jpg", "salida.png"])
@pytest.mark.parametrize("efecto", ["emoji_sonrisa", "emoji_lentes", "emoji_gato", "emoji_estrella", "emoji_mono"])
def test_exporta_con_emoji_y_la_verificacion_lo_acepta(tmp_path: Path, nombre: str, efecto: str) -> None:
    """Los bordes del emoji tienen más detalle que un bloque: JPEG debe seguir dentro de su tolerancia."""
    imagen = _abrir_con_todo(tmp_path)
    destino = tmp_path / nombre
    resultado = exportar.exportar(imagen, [oculto(10, 10, 120, 120, efecto), oculto(150, 40, 30, 30, efecto)], str(destino))
    assert resultado["zonas_ocultas"] == 2
    assert CENTINELA not in destino.read_bytes()


def test_seg_miniatura_exif_con_el_original_no_sobrevive(tmp_path: Path) -> None:
    """La miniatura embebida puede guardar la foto sin ocultar."""
    miniatura = tmp_path / "mini.jpg"
    Image.new("RGB", (40, 40), (250, 10, 10)).save(miniatura, quality=95)
    mini = miniatura.read_bytes()
    exif = b"Exif\x00\x00II*\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00" + mini
    ruta = tmp_path / "con-miniatura.jpg"
    imagen_prueba(200, 200).save(ruta, format="JPEG", exif=exif)
    assert mini in ruta.read_bytes()
    destino = tmp_path / "salida.jpg"
    exportar.exportar(cargador.abrir(str(ruta)), [], str(destino))
    salida = destino.read_bytes()
    assert mini not in salida
    assert salida.count(b"\xff\xd8") == 1


def test_seg_datos_tras_eoi_no_sobreviven(tmp_path: Path) -> None:
    ruta = guardar(tmp_path / "a.jpg", imagen_prueba())
    ruta.write_bytes(ruta.read_bytes() + b"DATOS-OCULTOS-" + CENTINELA)
    destino = tmp_path / "salida.jpg"
    exportar.exportar(cargador.abrir(str(ruta)), [], str(destino))
    assert CENTINELA not in destino.read_bytes()


def test_seg_png_con_texto_no_sobrevive(tmp_path: Path) -> None:
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Autor", CENTINELA.decode())
    ruta = guardar(tmp_path / "a.png", imagen_prueba(), pnginfo=info)
    destino = tmp_path / "salida.png"
    exportar.exportar(cargador.abrir(str(ruta)), [], str(destino))
    assert CENTINELA not in destino.read_bytes()


def test_seg_irreversible_en_el_archivo_final(tmp_path: Path) -> None:
    """Dos originales distintos en la zona dan la misma zona en el PNG final."""
    base = imagen_prueba(120, 120)
    a = guardar(tmp_path / "a.png", base)
    arreglo = np.array(base)
    arreglo[40:80, 40:80] = 255 - arreglo[40:80, 40:80]
    b = guardar(tmp_path / "b.png", Image.fromarray(arreglo))
    resultados = []
    for origen, salida in ((a, "sa.png"), (b, "sb.png")):
        exportar.exportar(cargador.abrir(str(origen)), [oculto(40, 40, 40, 40, "solido")], str(tmp_path / salida))
        resultados.append(np.array(Image.open(tmp_path / salida)))
    assert np.array_equal(resultados[0], resultados[1])


def test_png_con_transparencia_conserva_alfa(tmp_path: Path) -> None:
    origen = guardar(tmp_path / "a.png", imagen_prueba(modo="RGBA"))
    destino = tmp_path / "s.png"
    exportar.exportar(cargador.abrir(str(origen)), [], str(destino))
    with Image.open(destino) as r:
        assert r.mode == "RGBA"


def test_jpeg_desde_transparente_se_aplana(tmp_path: Path) -> None:
    origen = guardar(tmp_path / "a.png", imagen_prueba(modo="RGBA"))
    destino = tmp_path / "s.jpg"
    exportar.exportar(cargador.abrir(str(origen)), [], str(destino))
    with Image.open(destino) as r:
        assert r.mode == "RGB"


@pytest.mark.parametrize("nombre", ["a.webp", "a", "a.exe", "a.jpg.exe"])
def test_extension_no_admitida(tmp_path: Path, nombre: str) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [], str(tmp_path / nombre))
    assert e.value.codigo is Codigo.RUTA_INVALIDA


def test_ruta_relativa_y_carpeta_inexistente(tmp_path: Path) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    for destino in ("relativa.jpg", str(tmp_path / "no-existe" / "a.jpg")):
        with pytest.raises(ErrorRevisor) as e:
            exportar.exportar(imagen, [], destino)
        assert e.value.codigo is Codigo.RUTA_INVALIDA


def test_no_pisa_el_original(tmp_path: Path) -> None:
    origen = guardar(tmp_path / "o.png")
    previo = origen.read_bytes()
    imagen = cargador.abrir(str(origen))
    for destino in (origen, tmp_path / "O.PNG"):
        with pytest.raises(ErrorRevisor) as e:
            exportar.exportar(imagen, [], str(destino), sobrescribir=True)
        assert e.value.codigo is Codigo.DESTINO_ES_ORIGEN
    assert origen.read_bytes() == previo


def test_no_sobrescribe_sin_confirmar(tmp_path: Path) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    destino = tmp_path / "s.png"
    destino.write_bytes(b"previo")
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [], str(destino))
    assert e.value.codigo is Codigo.DESTINO_EXISTE
    assert destino.read_bytes() == b"previo"
    exportar.exportar(imagen, [], str(destino), sobrescribir=True)
    assert destino.read_bytes() != b"previo"


def _sin_residuos(carpeta: Path, permitidos: set[str]) -> None:
    assert {p.name for p in carpeta.iterdir()} == permitidos


@pytest.mark.parametrize(
    ("numero", "codigo"),
    [
        (errno.ENOSPC, Codigo.DISCO_LLENO),
        (errno.EACCES, Codigo.SIN_PERMISOS),
        (errno.EROFS, Codigo.SIN_PERMISOS),
        (errno.EIO, Codigo.RUTA_INVALIDA),
    ],
)
def test_disco_lleno_o_sin_permisos_no_deja_nada(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, numero: int, codigo: Codigo
) -> None:
    salida = tmp_path / "salida"
    salida.mkdir()
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))

    def fallar(_fd: int) -> None:
        raise OSError(numero, "falla simulada")

    monkeypatch.setattr(os, "fsync", fallar)
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [oculto()], str(salida / "s.jpg"))
    assert e.value.codigo is codigo
    _sin_residuos(salida, set())


def test_falla_al_renombrar_no_deja_nada_y_conserva_el_previo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    salida = tmp_path / "salida"
    salida.mkdir()
    previo = salida / "s.jpg"
    previo.write_bytes(b"previo")
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))

    def fallar(_a: str, _b: str) -> None:
        raise PermissionError(errno.EACCES, "bloqueado por el antivirus")

    monkeypatch.setattr(os, "replace", fallar)
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [], str(previo), sobrescribir=True)
    assert e.value.codigo is Codigo.SIN_PERMISOS
    assert previo.read_bytes() == b"previo"
    _sin_residuos(salida, {"s.jpg"})


def test_carpeta_de_solo_lectura_real(tmp_path: Path) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    destino = tmp_path / "s.jpg"
    destino.write_bytes(b"x")
    os.chmod(destino, stat.S_IREAD)
    try:
        with pytest.raises(ErrorRevisor) as e:
            exportar.exportar(imagen, [], str(destino), sobrescribir=True)
        assert e.value.codigo is Codigo.SIN_PERMISOS
        _sin_residuos(tmp_path, {"o.png", "s.jpg"})
    finally:
        os.chmod(destino, stat.S_IWRITE)


@pytest.mark.parametrize("campo", ["verificar_jpeg"])
def test_si_la_verificacion_falla_no_se_guarda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, campo: str) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))

    def fallar(_d: bytes) -> None:
        raise ErrorRevisor(Codigo.EXPORTACION_NO_VERIFICADA, "simulada")

    monkeypatch.setattr(metadatos, campo, fallar)
    destino = tmp_path / "s.jpg"
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [oculto()], str(destino))
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
    assert not destino.exists()


def test_si_el_efecto_no_se_aplico_no_se_guarda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Simula un codificador que devuelve la imagen sin ocultar."""
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png", imagen_prueba(200, 200))))
    original = exportar._codificar

    def traidor(_p: np.ndarray, formato: str, calidad: int) -> bytes:
        return original(imagen.pixeles, formato, calidad)

    monkeypatch.setattr(exportar, "_codificar", traidor)
    for nombre in ("s.png", "s.jpg"):
        destino = tmp_path / nombre
        with pytest.raises(ErrorRevisor) as e:
            exportar.exportar(imagen, [oculto(50, 50, 80, 80)], str(destino))
        assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
        assert not destino.exists()


def test_sin_memoria_no_se_guarda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))

    def fallar(*_a: object) -> bytes:
        raise MemoryError

    monkeypatch.setattr(exportar, "_codificar", fallar)
    destino = tmp_path / "s.png"
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [], str(destino))
    assert e.value.codigo is Codigo.MEMORIA_INSUFICIENTE
    assert not destino.exists()


def test_ruta_de_mas_de_260_caracteres(tmp_path: Path) -> None:
    carpeta = "\\\\?\\" + str(tmp_path) + "\\" + "\\".join(["d" * 50] * 6)
    os.makedirs(carpeta)
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    destino = carpeta[4:] + "\\salida ñandú 😀.jpg"
    assert len(destino) > 260
    exportar.exportar(imagen, [oculto()], destino)
    assert os.path.exists("\\\\?\\" + destino)


# Verificadores de bytes


def _jpeg() -> bytes:
    from .conftest import bytes_imagen

    return bytes_imagen("JPEG")


def _png() -> bytes:
    from .conftest import bytes_imagen

    return bytes_imagen("PNG")


def test_verificadores_aceptan_lo_limpio() -> None:
    metadatos.verificar_jpeg(_jpeg())
    metadatos.verificar_png(_png())


def test_verificar_jpeg_progresivo() -> None:
    from .conftest import bytes_imagen

    metadatos.verificar_jpeg(bytes_imagen("JPEG", progressive=True))


@pytest.mark.parametrize(
    "mutar",
    [
        lambda d: b"NOPE" + d,
        lambda d: d + b"extra",
        lambda d: d[:-2],
        lambda d: d[:2] + b"\xff\xe1\x00\x10Exif\x00\x00" + b"\0" * 8 + d[2:],
        lambda d: d[:2] + b"\xff\xfe\x00\x05abc" + d[2:],
        lambda d: d[:2] + b"\xff\xe2\x00\x10ICC_PROFILE\0\0\0" + d[2:],
        lambda d: d[:2] + b"\xff\xe0\x00\x10NOJF\0" + b"\0" * 9 + d[2:],
        lambda d: d[:2] + b"\xff\xe0\x00\x12JFIF\0" + b"\0" * 11 + d[2:],
        lambda d: d[:2] + b"\xff\xdb\xff\xff" + d[2:],
        lambda d: d[:2] + b"\x00" + d[2:],
        lambda d: d[:2] + b"\xff",
        lambda d: d[:2] + b"\xff\xdb",
        lambda d: d[:2] + b"\xff\xda\x00\x02\x00\x00",
        lambda d: d[:2],
    ],
)
def test_verificar_jpeg_rechaza(mutar) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ErrorRevisor):
        metadatos.verificar_jpeg(mutar(_jpeg()))


def _bloque(tipo: bytes, datos: bytes = b"") -> bytes:
    return len(datos).to_bytes(4, "big") + tipo + datos + b"\0\0\0\0"


@pytest.mark.parametrize(
    "mutar",
    [
        lambda d: b"NOPE" + d,
        lambda d: d + b"extra",
        lambda d: d[:-12],
        lambda d: d[:8] + _bloque(b"tEXt", b"autor\0yo") + d[8:],
        lambda d: d[:8] + _bloque(b"eXIf", b"II") + d[8:],
        lambda d: d[:8] + _bloque(b"iTXt", b"x") + d[8:],
        lambda d: d[:8] + _bloque(b"iCCP", b"x") + d[8:],
        lambda d: d[:8] + (10**6).to_bytes(4, "big") + b"IDAT",
    ],
)
def test_verificar_png_rechaza(mutar) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ErrorRevisor):
        metadatos.verificar_png(mutar(_png()))


# --- Temporales de una exportación interrumpida ------------------------------------------------


def _parcial(carpeta: Path, nombre: str, antiguedad_s: float) -> Path:
    ruta = carpeta / nombre
    ruta.write_bytes(b"salida ya oculta, a medias")
    viejo = ruta.stat().st_mtime - antiguedad_s
    os.utime(ruta, (viejo, viejo))
    return ruta


def test_exportar_borra_solo_los_temporales_viejos_propios(tmp_path: Path) -> None:
    hexa = "0123456789abcdef" * 2
    viejo = _parcial(tmp_path, f".{hexa}.parcial", 3600)
    reciente = _parcial(tmp_path, f".{'f' * 32}.parcial", 0)
    ajenos = [
        _parcial(tmp_path, "vacaciones.parcial", 3600),
        # Windows no distingue mayúsculas: se usa otro nombre para no pisar el de arriba.
        _parcial(tmp_path, f".{'ABCDEF12' * 4}.parcial", 3600),
        _parcial(tmp_path, f".{hexa}.parcial.jpg", 3600),
        _parcial(tmp_path, f".{hexa[:-1]}.parcial", 3600),
    ]
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png", imagen_prueba())))
    exportar.exportar(imagen, [oculto()], str(tmp_path / "s.png"))
    assert not viejo.exists()
    assert reciente.exists(), "uno reciente podría estar escribiéndose"
    assert all(a.exists() for a in ajenos), "nunca se borra algo que no creamos"


def test_una_carpeta_de_temporales_no_se_borra(tmp_path: Path) -> None:
    carpeta = tmp_path / f".{'a' * 32}.parcial"
    carpeta.mkdir()
    os.utime(carpeta, (0, 0))
    assert exportar.limpiar_parciales(str(tmp_path)) == 0
    assert carpeta.is_dir()


def test_limpiar_una_carpeta_ilegible_no_falla(tmp_path: Path) -> None:
    assert exportar.limpiar_parciales(str(tmp_path / "no-existe")) == 0


def test_si_no_se_puede_borrar_sigue(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _parcial(tmp_path, f".{'b' * 32}.parcial", 3600)

    def negado(_ruta: str) -> None:
        raise PermissionError(errno.EACCES, "negado")

    monkeypatch.setattr(exportar.os, "remove", negado)
    assert exportar.limpiar_parciales(str(tmp_path)) == 0


def test_cuenta_lo_borrado(tmp_path: Path) -> None:
    for letra in "cde":
        _parcial(tmp_path, f".{letra * 32}.parcial", 3600)
    assert exportar.limpiar_parciales(str(tmp_path)) == 3
    assert list(tmp_path.iterdir()) == []
