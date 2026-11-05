"""Detección y honestidad del análisis: una falla nunca se presenta como 'revisado y limpio'."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import analisis, caras, cargador
from revisor.caras import DetectorCaras, ModeloNoDisponible

from .conftest import DATOS, MODELOS, exif_con_gps, guardar, imagen_prueba

ASTRONAUTA = DATOS / "astronauta.jpg"


def _analizar(ruta: Path, modelos: Path = MODELOS) -> dict[str, Any]:
    return analisis.analizar(cargador.abrir(str(ruta)), modelos, 0.25, 0.6, 1.3)


def _reglas(resultado: dict[str, Any]) -> list[str]:
    return [h["regla_id"] for h in resultado["hallazgos"]]


@pytest.mark.parametrize(
    "imagen",
    [
        Image.new("RGB", (640, 480), (0, 0, 0)),
        Image.new("RGB", (640, 480), (255, 255, 255)),
        Image.new("RGB", (640, 480), (120, 40, 200)),
        imagen_prueba(640, 480),
    ],
    ids=["negra", "blanca", "color", "ruido"],
)
def test_arc001_004_sin_nada(tmp_path: Path, imagen: Image.Image) -> None:
    resultado = _analizar(guardar(tmp_path / "a.png", imagen))
    assert resultado["hallazgos"] == []
    assert resultado["cobertura"]["completa"] is True
    assert resultado["cobertura"]["reglas_revisadas"] == ["CAR-01", "MEN-01", "UBI-01"]


def test_arc005_cielo_sin_nada(tmp_path: Path) -> None:
    """Degradado suave y un poco de grano, como un cielo vacío."""
    alto, ancho = 480, 640
    base = np.linspace(120, 230, alto, dtype=np.float32)[:, None] + np.random.default_rng(3).normal(0, 2, (alto, ancho))
    cielo = np.stack([base * 0.7, base * 0.85, base], axis=2).clip(0, 255).astype(np.uint8)
    resultado = _analizar(guardar(tmp_path / "cielo.png", Image.fromarray(cielo)))
    assert resultado["hallazgos"] == []
    assert resultado["cobertura"]["completa"] is True


def test_arc007_mas_de_100_megapixeles(tmp_path: Path) -> None:
    ruta = guardar(tmp_path / "enorme.png", Image.new("RGB", (11000, 10000), (200, 210, 220)), compress_level=1)
    resultado = _analizar(ruta)
    assert resultado["hallazgos"] == []
    assert resultado["cobertura"]["completa"] is True


def test_cara_real_detectada_y_pregunta_por_menores() -> None:
    resultado = _analizar(ASTRONAUTA)
    reglas = _reglas(resultado)
    assert reglas.count("CAR-01") == 1
    assert reglas.count("MEN-01") == 1
    cara = next(h for h in resultado["hallazgos"] if h["regla_id"] == "CAR-01")
    caja = cara["caja"]
    assert caja["ancho"] > 50
    assert caja["x"] + caja["ancho"] <= 512
    assert caja["y"] + caja["alto"] <= 512
    assert cara["posicion"]


def test_nunca_afirma_una_edad() -> None:
    assert "edad" not in str(_analizar(ASTRONAUTA)).lower()
    assert "años" not in str(_analizar(ASTRONAUTA)).lower()


def test_caja_cabe_en_la_imagen_con_cualquier_multiplicador() -> None:
    imagen = cargador.abrir(str(ASTRONAUTA))
    for factor in (1.0, 1.3, 3.0):
        for h in analisis.analizar(imagen, MODELOS, 0.25, 0.5, factor)["hallazgos"]:
            if h["caja"]:
                assert h["caja"]["x"] >= 0 and h["caja"]["y"] >= 0
                assert h["caja"]["x"] + h["caja"]["ancho"] <= imagen.ancho
                assert h["caja"]["y"] + h["caja"]["alto"] <= imagen.alto


def test_gps_genera_advertencia(tmp_path: Path) -> None:
    assert "UBI-01" in _reglas(_analizar(guardar(tmp_path / "a.jpg", imagen_prueba(), exif=exif_con_gps())))


def test_fail_closed_sin_modelo(tmp_path: Path) -> None:
    resultado = _analizar(guardar(tmp_path / "a.png", imagen_prueba(100, 100)), tmp_path)
    assert resultado["cobertura"]["completa"] is False
    assert "modelo_no_disponible" in resultado["cobertura"]["motivos"]
    # Lo que no se pudo revisar debe seguir contando como no revisado.
    assert resultado["cobertura"]["reglas_revisadas"] == ["UBI-01"]


def test_fail_closed_modelo_alterado(tmp_path: Path) -> None:
    (tmp_path / caras.ARCHIVO_MODELO).write_bytes(b"modelo falso")
    with pytest.raises(ModeloNoDisponible):
        DetectorCaras(tmp_path)
    assert _analizar(guardar(tmp_path / "a.png", imagen_prueba(100, 100)), tmp_path)["cobertura"]["completa"] is False


def test_fail_closed_si_la_deteccion_explota(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def fallar(*_a: object) -> None:
        raise RuntimeError("cv2 explotó")

    monkeypatch.setattr(DetectorCaras, "detectar", fallar)
    resultado = _analizar(guardar(tmp_path / "a.png", imagen_prueba(100, 100)))
    assert resultado["cobertura"]["completa"] is False
    assert "deteccion_fallo" in resultado["cobertura"]["motivos"]


def test_fail_closed_imagen_demasiado_pequena(tmp_path: Path) -> None:
    resultado = _analizar(guardar(tmp_path / "a.png", Image.new("RGB", (5, 5))))
    assert resultado["cobertura"]["completa"] is False
    assert "demasiado_pequena" in resultado["cobertura"]["motivos"]


def test_fail_closed_exif_ilegible(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def fallar(_self: Image.Image) -> None:
        raise ValueError("exif malo")

    monkeypatch.setattr(Image.Image, "getexif", fallar)
    ruta = guardar(tmp_path / "a.png", imagen_prueba())
    imagen = cargador.abrir(str(ruta))
    assert imagen.metadatos_legibles is False
    resultado = analisis.analizar(imagen, MODELOS, 0.25, 0.5, 1.3)
    assert "metadatos" in resultado["cobertura"]["motivos"]


def _caras_falsas(monkeypatch: pytest.MonkeyPatch, *confianzas: float) -> None:
    def falso(_self: object, _pixeles: object, _umbral: float) -> list[caras.Cara]:
        return [caras.Cara(10 * i, 10, 8, 8, c) for i, c in enumerate(confianzas)]

    monkeypatch.setattr(DetectorCaras, "detectar", falso)


def test_posible_cara_se_avisa_pero_no_pregunta_por_menores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Un reloj o una textura pueden parecer cara: se avisa con duda y sin preguntar por menores."""
    _caras_falsas(monkeypatch, 0.3, 0.58)
    resultado = _analizar(guardar(tmp_path / "a.png", imagen_prueba(100, 100)))
    assert _reglas(resultado) == ["CAR-01", "CAR-01"]
    assert all(h["requiere_revision"] for h in resultado["hallazgos"])


def test_una_cara_segura_si_pregunta_por_menores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _caras_falsas(monkeypatch, 0.3, 0.6)
    resultado = _analizar(guardar(tmp_path / "a.png", imagen_prueba(100, 100)))
    assert _reglas(resultado).count("MEN-01") == 1
    assert [h["requiere_revision"] for h in resultado["hallazgos"] if h["regla_id"] == "CAR-01"] == [True, False]


def test_baja_confianza_se_marca_para_revision() -> None:
    imagen = cargador.abrir(str(ASTRONAUTA))
    resultado = analisis.analizar(imagen, MODELOS, 0.25, 1.0, 1.3)
    assert all(h["requiere_revision"] for h in resultado["hallazgos"] if h["regla_id"] == "CAR-01")


def _mosaico(caras_por_lado: int, lado: int) -> np.ndarray:
    base = Image.open(ASTRONAUTA).crop((120, 0, 320, 200)).resize((lado, lado))
    arreglo = np.array(base)
    return np.vstack([np.hstack([arreglo] * caras_por_lado)] * caras_por_lado)


def test_vis_multitud_mas_de_100_caras(tmp_path: Path) -> None:
    """Línea base de recall en multitudes sintéticas: 121 caras."""
    ruta = tmp_path / "multitud.png"
    Image.fromarray(_mosaico(11, 110)).save(ruta)
    resultado = _analizar(ruta)
    encontradas = _reglas(resultado).count("CAR-01")
    assert encontradas >= 100, f"recall bajo: {encontradas}/121"


def test_foto_grande_cara_chica_usa_mosaicos(tmp_path: Path) -> None:
    lienzo = np.full((3000, 4000, 3), 200, dtype=np.uint8)
    cara = np.array(Image.open(ASTRONAUTA).crop((120, 0, 320, 200)).resize((70, 70)))
    lienzo[2500:2570, 3500:3570] = cara
    ruta = tmp_path / "grande.png"
    Image.fromarray(lienzo).save(ruta)
    assert _reglas(_analizar(ruta)).count("CAR-01") >= 1


def test_mismas_caras_no_se_duplican_entre_mosaicos(tmp_path: Path) -> None:
    lienzo = np.full((2400, 3200, 3), 200, dtype=np.uint8)
    cara = np.array(Image.open(ASTRONAUTA).crop((120, 0, 320, 200)).resize((150, 150)))
    lienzo[1000:1150, 1500:1650] = cara
    ruta = tmp_path / "grande.png"
    Image.fromarray(lienzo).save(ruta)
    assert _reglas(_analizar(ruta)).count("CAR-01") == 1


@pytest.mark.parametrize(
    ("caja", "esperado"),
    [
        ((0, 0), "en la parte superior izquierda"),
        ((45, 0), "en la parte superior, al centro"),
        ((90, 0), "en la parte superior derecha"),
        ((0, 45), "en el lado izquierdo"),
        ((45, 45), "al centro"),
        ((90, 45), "en el lado derecho"),
        ((0, 90), "en la parte inferior izquierda"),
        ((45, 90), "en la parte inferior, al centro"),
        ((90, 90), "en la parte inferior derecha"),
    ],
)
def test_posicion_en_palabras(caja: tuple[int, int], esperado: str) -> None:
    assert analisis.describir_posicion(caja[0], caja[1], 10, 10, 100, 100) == esperado


def test_modelo_con_ruta_con_acentos(tmp_path: Path) -> None:
    carpeta = tmp_path / "módelos ñ"
    os.makedirs(carpeta)
    (carpeta / caras.ARCHIVO_MODELO).write_bytes((MODELOS / caras.ARCHIVO_MODELO).read_bytes())
    assert "CAR-01" in _reglas(_analizar(ASTRONAUTA, carpeta))
