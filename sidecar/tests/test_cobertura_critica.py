"""Caminos que no deberían ocurrir: si ocurren, deben fallar en voz alta y nunca guardar un archivo."""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import cargador, efectos, exportar, metadatos
from revisor.errores import Codigo, ErrorRevisor

from .conftest import bytes_imagen, guardar, imagen_prueba, oculto


def test_efecto_desconocido_no_cae_en_sin_efecto() -> None:
    salida = np.zeros((10, 10, 3), dtype=np.uint8)
    malo: Any = "ninguno"
    with pytest.raises(AssertionError):
        efectos._aplicar_efecto(salida, malo, 0, 0, 5, 5, 80, np.random.default_rng(0))


def test_sin_generador_usa_uno_propio() -> None:
    a = np.zeros((50, 50, 3), dtype=np.uint8)
    salida, _ = efectos.aplicar(a, [oculto(5, 5, 10, 10, "pixelado")])
    assert salida.shape == a.shape


def test_codificar_formato_desconocido() -> None:
    with pytest.raises(ErrorRevisor) as e:
        exportar._codificar(np.zeros((4, 4, 3), dtype=np.uint8), "GIF", 90)
    assert e.value.codigo is Codigo.INTERNO


def test_verificar_formato_desconocido() -> None:
    with pytest.raises(ErrorRevisor) as e:
        exportar._verificar_contenido(b"", "GIF", np.zeros((4, 4, 3), dtype=np.uint8), [])
    assert e.value.codigo is Codigo.INTERNO


def test_extension_con_formato_sin_soporte_no_guarda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(exportar.EXTENSIONES, ".gif", "GIF")
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))
    destino = tmp_path / "s.gif"
    with pytest.raises(ErrorRevisor) as e:
        exportar.exportar(imagen, [], str(destino))
    assert e.value.codigo is Codigo.INTERNO
    assert not destino.exists()


def test_dimensiones_distintas_no_se_guardan() -> None:
    esperado = np.zeros((8, 8, 3), dtype=np.uint8)
    salida = io.BytesIO()
    Image.new("RGB", (4, 4)).save(salida, format="PNG")
    with pytest.raises(ErrorRevisor) as e:
        exportar._verificar_contenido(salida.getvalue(), "PNG", esperado, [])
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA


def test_si_no_se_puede_borrar_el_temporal_se_registra(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    salida = tmp_path / "salida"
    salida.mkdir()
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png")))

    def falla_renombrar(_a: str, _b: str) -> None:
        raise PermissionError(13, "bloqueado")

    def falla_borrar(_r: str) -> None:
        raise PermissionError(13, "bloqueado")

    monkeypatch.setattr(os, "replace", falla_renombrar)
    monkeypatch.setattr(os, "remove", falla_borrar)
    with pytest.raises(ErrorRevisor):
        exportar.exportar(imagen, [], str(salida / "s.png"))
    monkeypatch.undo()
    assert "temporal" in caplog.text
    # Lo que queda no parece un archivo terminado.
    assert all(p.suffix == ".parcial" for p in salida.iterdir())


def test_marcador_sin_longitud_se_salta() -> None:
    d = bytes_imagen("JPEG")
    metadatos.verificar_jpeg(d[:2] + b"\xff\x01" + d[2:])


def test_exploracion_sin_fin_se_rechaza() -> None:
    d = bytes_imagen("JPEG")
    with pytest.raises(ErrorRevisor):
        metadatos.verificar_jpeg(d[:2] + b"\xff\xda\x00\x02" + b"\x11" * 40)


def test_verificar_png_sin_bloques() -> None:
    with pytest.raises(ErrorRevisor):
        metadatos.verificar_png(b"\x89PNG\r\n\x1a\n")


@pytest.mark.parametrize("efecto", ["solido", "difuminado", "pixelado"])
def test_jpeg_y_png_verifican_cada_efecto(tmp_path: Path, efecto: str) -> None:
    imagen = cargador.abrir(str(guardar(tmp_path / "o.png", imagen_prueba(200, 200))))
    for nombre in ("s.png", "s.jpg"):
        exportar.exportar(imagen, [oculto(50, 50, 60, 60, efecto)], str(tmp_path / nombre), sobrescribir=True)
        assert (tmp_path / nombre).exists()


def test_alfa_casi_invisible_no_conserva_el_contenido() -> None:
    a = np.random.default_rng(1).integers(1, 256, size=(20, 20, 4), dtype=np.uint8)
    a[:, :, 3] = efectos.ALFA_INVISIBLE - 1
    salida, _ = efectos.aplicar(a, [])
    assert (salida == 0).all()


def test_alfa_visible_se_conserva() -> None:
    a = np.random.default_rng(1).integers(1, 256, size=(20, 20, 4), dtype=np.uint8)
    a[:, :, 3] = efectos.ALFA_INVISIBLE
    salida, _ = efectos.aplicar(a, [])
    assert np.array_equal(salida, a)


def test_huella_identifica_el_contenido(tmp_path: Path) -> None:
    ruta = guardar(tmp_path / "o.png", imagen_prueba())
    primera = cargador.abrir(str(ruta)).huella
    assert len(primera) == 64
    assert cargador.abrir(str(ruta)).huella == primera
    imagen_prueba(30, 30).save(ruta)
    assert cargador.abrir(str(ruta)).huella != primera


def test_duplicados_conservan_la_union_de_las_cajas() -> None:
    from revisor.caras import Cara, _sin_duplicados

    completa = Cara(0, 0, 100, 100, 0.80)
    parcial = Cara(0, 0, 60, 60, 0.90)
    assert _sin_duplicados([completa, parcial]) == [Cara(0, 0, 100, 100, 0.90)]
    lejos = Cara(500, 500, 50, 50, 0.5)
    assert len(_sin_duplicados([completa, lejos])) == 2


def test_una_libreria_nativa_que_escribe_en_stdout_no_rompe_el_protocolo(tmp_path: Path) -> None:
    import json
    import subprocess
    import sys

    guion = (
        "import os, sys\n"
        "sys.argv = ['x', '--modelos', '.']\n"
        "import revisor.__main__ as m\n"
        "real = m.servir\n"
        "def con_ruido(e, s, ses):\n"
        "    os.write(1, b'RUIDO NATIVO')\n"
        "    real(e, s, ses)\n"
        "m.servir = con_ruido\n"
        "m.main()\n"
    )
    contenido = b'{"id":1,"comando":{"tipo":"ping"}}'
    marco = len(contenido).to_bytes(4, "big") + contenido
    r = subprocess.run([sys.executable, "-c", guion], input=marco, capture_output=True, timeout=60, cwd=Path(__file__).parent.parent)
    assert r.returncode == 0
    largo = int.from_bytes(r.stdout[:4], "big")
    assert json.loads(r.stdout[4:4 + largo])["ok"] is True
    assert b"RUIDO NATIVO" in r.stderr
