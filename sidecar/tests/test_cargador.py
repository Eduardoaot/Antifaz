"""Casos ARC de qa/MATRIZ_PRUEBAS.md para fotos."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageCms
from pillow_heif import register_heif_opener

from revisor import cargador
from revisor.errores import Codigo, ErrorRevisor

from .conftest import exif_con_gps, guardar, imagen_prueba, png_con_dimensiones

register_heif_opener()


def codigo_de(ruta: Path | str) -> Codigo:
    with pytest.raises(ErrorRevisor) as e:
        cargador.abrir(str(ruta))
    return e.value.codigo


def test_arc012_cero_bytes(tmp_path: Path) -> None:
    ruta = tmp_path / "vacio.jpg"
    ruta.write_bytes(b"")
    assert codigo_de(ruta) is Codigo.ARCHIVO_VACIO


def test_archivo_inexistente_y_carpeta(tmp_path: Path) -> None:
    assert codigo_de(tmp_path / "no.jpg") is Codigo.ARCHIVO_NO_ENCONTRADO
    assert codigo_de(tmp_path) is Codigo.NO_ES_IMAGEN


@pytest.mark.parametrize("contenido", [b"esto es texto", b"MZ\x90\x00" + b"\x00" * 200, os.urandom(4096)])
def test_arc015_016_extension_falsa(tmp_path: Path, contenido: bytes) -> None:
    ruta = tmp_path / "foto.jpg"
    ruta.write_bytes(contenido)
    assert codigo_de(ruta) is Codigo.NO_ES_IMAGEN


def test_arc014_truncada_no_se_analiza_a_medias(tmp_path: Path) -> None:
    ruta = guardar(tmp_path / "a.jpg", imagen_prueba(400, 400), quality=90)
    ruta.write_bytes(ruta.read_bytes()[: ruta.stat().st_size // 2])
    assert codigo_de(ruta) is Codigo.IMAGEN_CORRUPTA


def test_arc013_corrupta_png(tmp_path: Path) -> None:
    ruta = guardar(tmp_path / "a.png", imagen_prueba(200, 200))
    datos = bytearray(ruta.read_bytes())
    datos[len(datos) // 2 : len(datos) // 2 + 64] = b"\xff" * 64
    ruta.write_bytes(bytes(datos))
    assert codigo_de(ruta) is Codigo.IMAGEN_CORRUPTA


@pytest.mark.parametrize(
    ("ancho", "alto", "codigo"),
    [
        (30001, 10, Codigo.IMAGEN_DEMASIADO_GRANDE),
        (20000, 20000, Codigo.IMAGEN_DEMASIADO_GRANDE),
        (2**31 - 1, 2**31 - 1, Codigo.IMAGEN_DEMASIADO_GRANDE),
        (10000, 50, Codigo.IMAGEN_MUY_ALARGADA),
    ],
)
def test_arc017_bomba_se_rechaza_antes_de_decodificar(tmp_path: Path, ancho: int, alto: int, codigo: Codigo) -> None:
    ruta = tmp_path / "bomba.png"
    ruta.write_bytes(png_con_dimensiones(ancho, alto))
    assert codigo_de(ruta) is codigo


def test_arc006_un_pixel(tmp_path: Path) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "a.png", Image.new("RGB", (1, 1), (9, 9, 9)))))
    assert (imagen.ancho, imagen.alto) == (1, 1)
    assert imagen.demasiado_pequena


def test_lado_minimo_de_deteccion(tmp_path: Path) -> None:
    assert cargador.abrir(str(guardar(tmp_path / "a.png", Image.new("RGB", (15, 15))))).demasiado_pequena
    assert not cargador.abrir(str(guardar(tmp_path / "b.png", Image.new("RGB", (16, 16))))).demasiado_pequena


def test_relacion_de_aspecto_en_el_limite(tmp_path: Path) -> None:
    assert cargador.abrir(str(guardar(tmp_path / "a.png", Image.new("RGB", (1000, 10))))).ancho == 1000
    assert codigo_de(guardar(tmp_path / "b.png", Image.new("RGB", (1010, 10)))) is Codigo.IMAGEN_MUY_ALARGADA


@pytest.mark.parametrize(
    ("nombre", "opciones"),
    [
        ("a.jpg", {"quality": 90}),
        ("a.png", {}),
        ("a.webp", {"quality": 90}),
        ("a.avif", {"quality": 90}),
        ("a.heic", {"quality": 90}),
        ("a.heif", {"quality": 90}),
        ("a.tif", {}),
        ("a.bmp", {}),
    ],
)
def test_arc018_023_formatos(tmp_path: Path, nombre: str, opciones: dict[str, int]) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / nombre, imagen_prueba(), **opciones)))
    assert (imagen.ancho, imagen.alto) == (64, 48)
    assert imagen.pixeles.dtype == np.uint8
    assert imagen.pixeles.shape == (48, 64, 3)


def test_extension_engañosa_se_lee_por_contenido(tmp_path: Path) -> None:
    ruta = tmp_path / "en-realidad-png.jpg"
    imagen_prueba().save(ruta, format="PNG")
    assert cargador.abrir(str(ruta)).formato == "PNG"


def test_arc019_png_transparente(tmp_path: Path) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "a.png", imagen_prueba(modo="RGBA"))))
    assert imagen.tiene_alfa
    assert imagen.pixeles.shape[2] == 4


def test_arc024_gif_animado_no_se_revisa_a_medias(tmp_path: Path) -> None:
    ruta = tmp_path / "a.gif"
    cuadros = [Image.new("RGB", (20, 20), c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    cuadros[0].save(ruta, save_all=True, append_images=cuadros[1:], duration=50)
    assert codigo_de(ruta) is Codigo.ANIMACION_NO_SOPORTADA


def test_gif_estatico_si_abre(tmp_path: Path) -> None:
    assert cargador.abrir(str(guardar(tmp_path / "a.gif", Image.new("P", (20, 20), 1)))).ancho == 20


def test_webp_animado_no_se_revisa_a_medias(tmp_path: Path) -> None:
    ruta = tmp_path / "a.webp"
    cuadros = [imagen_prueba(32, 32), Image.new("RGB", (32, 32), (1, 2, 3))]
    cuadros[0].save(ruta, save_all=True, append_images=cuadros[1:], duration=50)
    assert codigo_de(ruta) is Codigo.ANIMACION_NO_SOPORTADA


def test_arc026_cmyk_sin_colores_invertidos(tmp_path: Path) -> None:
    # CMYK (0,0,0,0) es blanco en Pillow.
    ruta = guardar(tmp_path / "a.jpg", Image.new("CMYK", (32, 32), (0, 0, 0, 0)), quality=95)
    imagen = cargador.abrir(str(ruta))
    assert imagen.pixeles.shape[2] == 3
    assert imagen.pixeles.mean() > 200


def test_arc027_16_bits_no_se_satura(tmp_path: Path) -> None:
    datos = np.full((32, 32), 32768, dtype=np.uint16)
    ruta = guardar(tmp_path / "a.png", Image.fromarray(datos))
    imagen = cargador.abrir(str(ruta))
    assert imagen.pixeles.dtype == np.uint8
    assert 120 <= imagen.pixeles.mean() <= 135


def test_tiff_de_punto_flotante(tmp_path: Path) -> None:
    datos = np.linspace(0, 1, 32 * 32, dtype=np.float32).reshape(32, 32)
    imagen = cargador.abrir(str(guardar(tmp_path / "a.tif", Image.fromarray(datos))))
    assert imagen.pixeles.max() == 255
    assert imagen.pixeles.min() == 0


def test_tiff_constante_de_punto_flotante(tmp_path: Path) -> None:
    datos = np.full((32, 32), 0.5, dtype=np.float32)
    assert cargador.abrir(str(guardar(tmp_path / "a.tif", Image.fromarray(datos)))).pixeles.max() == 0


def test_arc028_grises_y_paleta(tmp_path: Path) -> None:
    assert cargador.abrir(str(guardar(tmp_path / "a.png", imagen_prueba(modo="L")))).pixeles.shape[2] == 3
    assert cargador.abrir(str(guardar(tmp_path / "b.png", imagen_prueba(modo="LA")))).pixeles.shape[2] == 4
    paleta = imagen_prueba().convert("P")
    assert cargador.abrir(str(guardar(tmp_path / "c.png", paleta))).pixeles.shape[2] == 3


def test_arc029_perfil_de_color_se_convierte(tmp_path: Path) -> None:
    perfil = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    ruta = guardar(tmp_path / "a.png", imagen_prueba(), icc_profile=srgb)
    assert cargador.abrir(str(ruta)).pixeles.shape == (48, 64, 3)
    # Un perfil inservible no debe impedir abrir la imagen.
    otra = guardar(tmp_path / "b.png", imagen_prueba(), icc_profile=perfil[:40])
    assert cargador.abrir(str(otra)).pixeles.shape == (48, 64, 3)


@pytest.mark.parametrize(
    ("orientacion", "dims"),
    [(1, (64, 48)), (2, (64, 48)), (3, (64, 48)), (4, (64, 48)), (5, (48, 64)), (6, (48, 64)), (7, (48, 64)), (8, (48, 64))],
)
def test_arc030_las_8_orientaciones(tmp_path: Path, orientacion: int, dims: tuple[int, int]) -> None:
    exif = Image.Exif()
    exif[0x0112] = orientacion
    imagen = cargador.abrir(str(guardar(tmp_path / "a.jpg", imagen_prueba(), exif=exif, quality=90)))
    assert (imagen.ancho, imagen.alto) == dims


def test_orientacion_invalida_no_rompe(tmp_path: Path) -> None:
    exif = Image.Exif()
    exif[0x0112] = 99
    assert cargador.abrir(str(guardar(tmp_path / "a.jpg", imagen_prueba(), exif=exif))).ancho == 64


def test_gps_en_exif_y_xmp(tmp_path: Path) -> None:
    assert cargador.abrir(str(guardar(tmp_path / "a.jpg", imagen_prueba(), exif=exif_con_gps()))).tiene_gps
    assert not cargador.abrir(str(guardar(tmp_path / "b.jpg", imagen_prueba()))).tiene_gps
    xmp = b'<x:xmpmeta><rdf:Description exif:GPSLatitude="19,25N"/></x:xmpmeta>'
    assert cargador.abrir(str(guardar(tmp_path / "c.jpg", imagen_prueba(), xmp=xmp))).tiene_gps


@pytest.mark.parametrize("nombre", ["fotó ñandú.jpg", "😀 foto.jpg", "con  espacios .jpg", "日本語.jpg"])
def test_arc_nombres_raros(tmp_path: Path, nombre: str) -> None:
    assert cargador.abrir(str(guardar(tmp_path / nombre, imagen_prueba(), format="JPEG"))).ancho == 64


def test_arc_ruta_de_mas_de_260_caracteres(tmp_path: Path) -> None:
    carpeta = "\\\\?\\" + str(tmp_path) + "\\" + "\\".join(["c" * 50] * 6)
    os.makedirs(carpeta)
    ruta = carpeta + "\\foto.jpg"
    imagen_prueba().save(ruta, format="JPEG")
    assert len(ruta) > 260
    assert cargador.abrir(ruta[4:]).ancho == 64


def test_raw_falso_no_cae_en_la_miniatura(tmp_path: Path) -> None:
    # Un .dng que en realidad es JPEG: rawpy lo rechaza y no se abre como otra cosa.
    ruta = tmp_path / "a.dng"
    imagen_prueba().save(ruta, format="JPEG")
    assert codigo_de(ruta) is Codigo.NO_ES_IMAGEN


def test_raw_real_usa_el_sensor_y_no_la_miniatura(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    llamado: list[str] = []
    sensor = np.full((40, 30, 3), 77, dtype=np.uint8)

    def falso(ruta: str) -> np.ndarray:
        llamado.append(ruta)
        return sensor

    monkeypatch.setattr(cargador, "_cargar_raw", falso)
    ruta = tmp_path / "a.nef"
    imagen_prueba().save(ruta, format="JPEG", exif=exif_con_gps())
    imagen = cargador.abrir(str(ruta))
    assert llamado
    assert imagen.formato == "RAW"
    assert imagen.pixeles[0, 0, 0] == 77
    assert imagen.tiene_gps
