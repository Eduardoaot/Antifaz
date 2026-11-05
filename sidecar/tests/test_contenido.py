"""Revisión de contenido. Las muestras sensibles no se versionan: aquí se usan salidas simuladas."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import analisis, cargador, contenido
from revisor.caras import ModeloNoDisponible
from revisor.contenido import ETIQUETAS_NUDENET, RevisorContenido, Zona, decodificar_zonas

from .conftest import DATOS, MODELOS, guardar, imagen_prueba


def _fila(etiqueta: str, puntaje: float, cx: float, cy: float, w: float, h: float) -> list[float]:
    clases = [0.0] * len(ETIQUETAS_NUDENET)
    clases[ETIQUETAS_NUDENET.index(etiqueta)] = puntaje
    return [cx, cy, w, h, *clases]


def _salida(*filas: list[float]) -> np.ndarray:
    return np.array([filas], dtype=np.float32).transpose(0, 2, 1)


def test_decodifica_y_escala_al_tamano_real() -> None:
    zonas = decodificar_zonas(_salida(_fila("FEMALE_BREAST_EXPOSED", 0.9, 160, 160, 32, 32)), 640, 480, 0.25)
    assert zonas == [Zona("DES-01", 288, 288, 64, 64, pytest.approx(0.9))]  # type: ignore[arg-type]


def test_cubierto_es_sugerente_y_descubierto_es_desnudez() -> None:
    assert decodificar_zonas(_salida(_fila("BUTTOCKS_COVERED", 0.5, 50, 50, 10, 10)), 320, 320, 0.25)[0].regla_id == "SUG-01"
    assert decodificar_zonas(_salida(_fila("MALE_GENITALIA_EXPOSED", 0.5, 50, 50, 10, 10)), 320, 320, 0.25)[0].regla_id == "DES-01"


@pytest.mark.parametrize("etiqueta", ["FACE_FEMALE", "FACE_MALE", "BELLY_EXPOSED", "FEET_COVERED", "ARMPITS_EXPOSED", "MALE_BREAST_EXPOSED"])
def test_partes_comunes_no_generan_aviso(etiqueta: str) -> None:
    assert decodificar_zonas(_salida(_fila(etiqueta, 0.99, 50, 50, 10, 10)), 320, 320, 0.25) == []


def test_bajo_el_umbral_se_descarta() -> None:
    assert decodificar_zonas(_salida(_fila("ANUS_EXPOSED", 0.2, 50, 50, 10, 10)), 320, 320, 0.25) == []


def test_caja_que_se_sale_se_ajusta_y_una_vacia_se_descarta() -> None:
    zona = decodificar_zonas(_salida(_fila("ANUS_EXPOSED", 0.9, 0, 0, 20, 20)), 320, 320, 0.25)[0]
    assert (zona.x, zona.y) == (0, 0)
    assert decodificar_zonas(_salida(_fila("ANUS_EXPOSED", 0.9, -50, -50, 10, 10)), 320, 320, 0.25) == []


def test_duplicados_se_unen() -> None:
    filas = _salida(_fila("ANUS_EXPOSED", 0.9, 50, 50, 20, 20), _fila("ANUS_EXPOSED", 0.8, 51, 51, 20, 20))
    assert len(decodificar_zonas(filas, 320, 320, 0.25)) == 1


def test_salida_sin_filas_no_rompe() -> None:
    assert decodificar_zonas(np.zeros((1, 22, 0), dtype=np.float32), 320, 320, 0.25) == []


def test_modelo_alterado_no_se_usa(tmp_path: Path) -> None:
    (tmp_path / contenido.ARCHIVO_TOKENIZADOR).write_bytes(b"falso")
    with pytest.raises(ModeloNoDisponible):
        RevisorContenido(tmp_path)
    with pytest.raises(ModeloNoDisponible):
        RevisorContenido(tmp_path / "no-existe")


def test_modelo_real_en_imagenes_comunes() -> None:
    revisor = contenido.revisor_de(MODELOS)
    astronauta = np.array(Image.open(DATOS / "astronauta.jpg").convert("RGB"))
    for pixeles in (astronauta, np.zeros((64, 900, 3), dtype=np.uint8), np.zeros((900, 64, 4), dtype=np.uint8)):
        puntajes = revisor.escena(pixeles)
        assert set(puntajes) == {"ARM-01", "EXT-01", "DES-01", "SUG-01"}
        assert all(0 <= v <= 1 for v in puntajes.values())
    assert max(revisor.escena(astronauta).values()) < analisis.UMBRAL_ESCENA
    assert revisor.zonas(astronauta, 0.25) == []
    assert revisor.zonas(np.zeros((1, 1, 3), dtype=np.uint8), 0.25) == []


def _simular(monkeypatch: pytest.MonkeyPatch, escena: dict[str, float], zonas: list[Zona]) -> None:
    class Falso:
        def escena(self, _p: Any) -> dict[str, float]:
            return escena

        def zonas(self, _p: Any, _u: float) -> list[Zona]:
            return zonas

    monkeypatch.setattr(contenido, "revisor_de", lambda _c: Falso())


def _analizar(tmp_path: Path) -> dict[str, Any]:
    imagen = cargador.abrir(str(guardar(tmp_path / "a.png", imagen_prueba(640, 480))))
    return analisis.analizar(imagen, MODELOS, 0.25, 0.6, 1.3)


NEUTRO = {"ARM-01": 0.1, "EXT-01": 0.0, "DES-01": 0.0, "SUG-01": 0.0}


def test_foto_comun_no_genera_avisos_de_contenido(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, NEUTRO, [])
    resultado = _analizar(tmp_path)
    assert resultado["hallazgos"] == []
    assert {"ARM-01", "EXT-01", "DES-01", "SUG-01"} <= set(resultado["cobertura"]["reglas_revisadas"])


@pytest.mark.parametrize(("regla", "puntaje", "aparece"), [("ARM-01", 0.34, False), ("ARM-01", 0.35, True), ("EXT-01", 0.9, True), ("DES-01", 0.5, True), ("SUG-01", 0.5, True)])
def test_escena_avisa_sobre_la_imagen_completa(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, regla: str, puntaje: float, aparece: bool) -> None:
    _simular(monkeypatch, {**NEUTRO, regla: puntaje}, [])
    hallazgos = [h for h in _analizar(tmp_path)["hallazgos"] if h["regla_id"] == regla]
    assert bool(hallazgos) is aparece
    if aparece:
        assert hallazgos[0]["caja"] is None
        assert hallazgos[0]["requiere_revision"] is True


def test_zona_lleva_caja_y_posicion_y_no_se_repite_el_aviso_de_escena(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {**NEUTRO, "DES-01": 0.9}, [Zona("DES-01", 10, 10, 50, 50, 0.9), Zona("SUG-01", 300, 300, 40, 40, 0.4)])
    hallazgos = _analizar(tmp_path)["hallazgos"]
    desnudez = [h for h in hallazgos if h["regla_id"] == "DES-01"]
    assert len(desnudez) == 1
    assert desnudez[0]["caja"] == {"x": 10, "y": 10, "ancho": 50, "alto": 50}
    assert desnudez[0]["posicion"] == "en la parte superior izquierda"
    assert desnudez[0]["requiere_revision"] is False
    assert [h["requiere_revision"] for h in hallazgos if h["regla_id"] == "SUG-01"] == [True]


def test_fail_closed_sin_modelos_de_contenido(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def falla(_c: Path) -> None:
        raise ModeloNoDisponible("falta")

    monkeypatch.setattr(contenido, "revisor_de", falla)
    resultado = _analizar(tmp_path)
    assert resultado["cobertura"]["completa"] is False
    assert "contenido_no_disponible" in resultado["cobertura"]["motivos"]
    assert "DES-01" not in resultado["cobertura"]["reglas_revisadas"]


def test_fail_closed_si_el_modelo_explota(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def falla(_c: Path) -> None:
        raise RuntimeError("onnx")

    monkeypatch.setattr(contenido, "revisor_de", falla)
    resultado = _analizar(tmp_path)
    assert "contenido_fallo" in resultado["cobertura"]["motivos"]
    assert "ARM-01" not in resultado["cobertura"]["reglas_revisadas"]


def test_nunca_afirma_que_muestra_la_foto() -> None:
    import json

    cat = json.loads((Path(__file__).parents[2] / "rules/catalogo.json").read_text(encoding="utf-8"))
    for regla in cat["reglas"]:
        if regla["id"] in {"ARM-01", "EXT-01", "DES-01", "SUG-01"}:
            assert regla["texto_aviso"].startswith("Podría")
