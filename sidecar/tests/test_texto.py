"""Datos personales en texto y códigos. Todos los datos son ficticios y las imágenes se generan aquí."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import zxingcpp
from hypothesis import given
from hypothesis import strategies as st
from PIL import Image, ImageDraw, ImageFont

from revisor import analisis, cargador, codigos, texto

from .conftest import MODELOS, guardar, imagen_prueba

FUENTE = Path(__file__).parents[2] / "brand/fonts/AtkinsonHyperlegibleNext-Variable.ttf"


def _imagen_con_texto(lineas: list[str], tam: int = 42) -> np.ndarray:
    imagen = Image.new("RGB", (1100, 90 + 80 * len(lineas)), (255, 255, 255))
    dibujo = ImageDraw.Draw(imagen)
    fuente = ImageFont.truetype(str(FUENTE), tam)
    for i, linea in enumerate(lineas):
        dibujo.text((40, 40 + 80 * i), linea, fill=(10, 10, 10), font=fuente)
    return np.array(imagen)


@pytest.mark.parametrize(
    ("linea", "regla"),
    [
        ("Llámame al 55 1234 5678", "CON-01"),
        ("Tel: (81) 8123-4567", "CON-01"),
        ("+52 55 1234 5678", "CON-01"),
        ("persona.ficticia@ejemplo.com", "CON-01"),
        ("Calle Reforma 123", "CON-01"),
        ("Col. Centro, C.P. 06000", "CON-01"),
        ("GOMC800101HDFRRN09", "DOC-01"),
        ("INSTITUTO NACIONAL ELECTORAL", "DOC-01"),
        ("Clave de elector", "DOC-01"),
        ("Pasaporte", "DOC-01"),
        ("4242 4242 4242 4242", "FIN-01"),
        ("5555-5555-5555-4444", "FIN-01"),
        ("Estado de cuenta", "FIN-01"),
        ("CLABE", "FIN-01"),
        ("Receta médica", "MED-01"),
        ("Diagnóstico", "MED-01"),
        ("Paciente: Fulano", "MED-01"),
        ("Boarding pass", "VIA-01"),
        ("Pase de abordar", "VIA-01"),
    ],
)
def test_clasifica(linea: str, regla: str) -> None:
    assert regla in texto.clasificar(linea)


@pytest.mark.parametrize("linea", ["", "   ", "Playa del Carmen", "Feliz cumpleaños", "2026", "Hola 123", "😀😀", "Precio 99", "12:30", "AB12"])
def test_texto_comun_no_avisa(linea: str) -> None:
    assert texto.clasificar(linea) == []


def test_tarjeta_que_no_pasa_luhn_no_es_tarjeta() -> None:
    assert "FIN-01" not in texto.clasificar("4242 4242 4242 4241")


@pytest.mark.parametrize(("numero", "valido"), [("4242424242424242", True), ("4242424242424241", False), ("", True), ("abc", False)])
def test_luhn(numero: str, valido: bool) -> None:
    assert texto.es_luhn(numero) is (valido and numero != "") or numero == ""


def test_clabe() -> None:
    # Dígito de control calculado para una CLABE ficticia.
    base = "00218012345678900"
    control = (10 - sum(int(d) * p % 10 for d, p in zip(base, (3, 7, 1) * 6, strict=False)) % 10) % 10
    valida = base + str(control)
    assert texto.es_clabe(valida)
    assert "FIN-01" in texto.clasificar(valida)
    assert not texto.es_clabe(base + str((control + 1) % 10))
    assert not texto.es_clabe("123")
    assert not texto.es_clabe("a" * 18)


@given(st.text(max_size=200))
def test_propiedad_cualquier_texto_no_rompe(linea: str) -> None:
    assert isinstance(texto.clasificar(linea), list)


def test_ocr_real_encuentra_datos_y_da_su_lugar() -> None:
    pixeles = _imagen_con_texto(["Hola, soy de Monterrey", "Tel: 81 8123 4567", "persona@ejemplo.com"])
    zonas = texto.buscar(pixeles)
    assert [z.regla_id for z in zonas] == ["CON-01", "CON-01"]
    for z in zonas:
        assert z.x >= 0 and z.y >= 80 and z.x + z.ancho <= pixeles.shape[1] and z.y + z.alto <= pixeles.shape[0]


@pytest.mark.parametrize("linea", ["GOMC800101HDFRRN09", "4242 4242 4242 4242"])
def test_ocr_real_lee_documentos_y_tarjetas(linea: str) -> None:
    assert texto.buscar(_imagen_con_texto([linea]))


def test_ocr_real_en_imagen_sin_texto() -> None:
    assert texto.buscar(np.full((300, 300, 3), 200, dtype=np.uint8)) == []


def test_caja_vacia_se_descarta() -> None:
    assert texto._a_caja([[500, 500], [600, 500], [600, 600], [500, 600]], 100, 100) is None


def test_baja_confianza_de_ocr_y_caja_invalida_se_ignoran(monkeypatch: pytest.MonkeyPatch) -> None:
    def falso() -> Any:
        puntos = [[0, 0], [10, 0], [10, 10], [0, 10]]
        fuera = [[500, 500], [600, 500], [600, 600], [500, 600]]
        return lambda _a: ([[puntos, "55 1234 5678", 0.1], [fuera, "55 1234 5678", 0.9]], None)

    monkeypatch.setattr(texto, "_lector", falso)
    assert texto.buscar(np.zeros((50, 50, 3), dtype=np.uint8)) == []


def _codigo(texto_codigo: str, formato: Any) -> np.ndarray:
    matriz = np.array(zxingcpp.create_barcode(texto_codigo, formato).to_image(scale=6, add_quiet_zones=True))
    gris = matriz if matriz.ndim == 2 else matriz[:, :, 0]
    return np.stack([gris] * 3, axis=2).astype(np.uint8)


def test_qr_real() -> None:
    zonas = codigos.buscar(_codigo("https://ejemplo.com/ficticio", zxingcpp.BarcodeFormat.QRCode))
    assert [z.regla_id for z in zonas] == ["COD-01"]
    assert zonas[0].ancho > 50


def test_pase_de_abordar_se_reconoce_por_su_formato() -> None:
    bcbp = "M1FICTICIO/PERSONA    EABC123 MEXGDLAM 0123 305Y012A0001 100"
    assert codigos.regla_de(bcbp) == "VIA-01"
    zonas = codigos.buscar(_codigo(bcbp, zxingcpp.BarcodeFormat.PDF417))
    assert [z.regla_id for z in zonas] == ["VIA-01"]


@pytest.mark.parametrize("contenido", ["", "M", "https://ejemplo.com", "M1corto", "Mx" + "a" * 70])
def test_otros_codigos_son_genericos(contenido: str) -> None:
    assert codigos.regla_de(contenido) == "COD-01"


def test_imagen_sin_codigos() -> None:
    assert codigos.buscar(np.full((100, 100, 3), 255, dtype=np.uint8)) == []


def _analizar(tmp_path: Path, imagen: Image.Image) -> dict[str, Any]:
    cargada = cargador.abrir(str(guardar(tmp_path / "a.png", imagen)))
    return analisis.analizar(cargada, MODELOS, 0.25, 0.6, 1.3)


def test_analisis_completo_con_texto_y_codigo(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    lienzo = Image.fromarray(_imagen_con_texto(["Tel: 81 8123 4567", "", "", "", ""]))
    lienzo.paste(Image.fromarray(_codigo("https://ejemplo.com", zxingcpp.BarcodeFormat.QRCode)), (700, 150))
    with caplog.at_level(logging.INFO):
        resultado = _analizar(tmp_path, lienzo)
    reglas = [h["regla_id"] for h in resultado["hallazgos"]]
    assert "CON-01" in reglas and "COD-01" in reglas
    assert {"CON-01", "DOC-01", "FIN-01", "MED-01", "VIA-01", "COD-01"} <= set(resultado["cobertura"]["reglas_revisadas"])
    assert all(h["caja"] and h["posicion"] for h in resultado["hallazgos"] if h["regla_id"] in {"CON-01", "COD-01"})
    # Lo que dice la imagen no viaja a la UI ni a los logs.
    assert "8123" not in json.dumps(resultado)
    assert "8123" not in caplog.text
    assert "ejemplo" not in caplog.text


@pytest.mark.parametrize(("modulo", "motivo", "regla"), [(texto, "texto_fallo", "CON-01"), (codigos, "codigos_fallo", "COD-01")])
def test_fail_closed_si_falla(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, modulo: Any, motivo: str, regla: str) -> None:
    def falla(_p: Any) -> None:
        raise RuntimeError("secreto 55 1234 5678")

    monkeypatch.setattr(modulo, "buscar", falla)
    with caplog.at_level(logging.INFO):
        resultado = _analizar(tmp_path, imagen_prueba(100, 100))
    assert resultado["cobertura"]["completa"] is False
    assert motivo in resultado["cobertura"]["motivos"]
    assert regla not in resultado["cobertura"]["reglas_revisadas"]
    assert "secreto" not in caplog.text


def test_imagen_diminuta_no_se_revisa_en_texto(tmp_path: Path) -> None:
    resultado = _analizar(tmp_path, Image.new("RGB", (5, 5)))
    assert "CON-01" not in resultado["cobertura"]["reglas_revisadas"]
    assert "COD-01" not in resultado["cobertura"]["reglas_revisadas"]
