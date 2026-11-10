"""Revisión de contenido. Las muestras sensibles no se versionan: aquí se usan salidas simuladas."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import analisis, cargador, contenido, objetos
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
    # 64 px de zona más 15% por lado: 10 px.
    zonas = decodificar_zonas(_salida(_fila("FEMALE_BREAST_EXPOSED", 0.9, 160, 160, 32, 32)), 640, 480, 0.25)
    assert zonas == [Zona("DES-01", 278, 278, 84, 84, pytest.approx(0.9))]  # type: ignore[arg-type]


# --- Pecho en una sola zona y margen (qa/RANGOS.md, contenido.pareja_pecho y contenido.margen_zona) ---


def _z(x: int, y: int, ancho: int = 40, alto: int = 40, regla: str = "SUG-01", confianza: float = 0.8) -> Zona:
    return Zona(regla, x, y, ancho, alto, confianza)


def test_los_dos_lados_del_pecho_quedan_en_una_zona() -> None:
    filas = _salida(_fila("FEMALE_BREAST_COVERED", 0.8, 100, 100, 20, 20), _fila("FEMALE_BREAST_COVERED", 0.7, 122, 100, 20, 20))
    (zona,) = decodificar_zonas(filas, 320, 320, 0.25)
    # Unión de x 90-132 e y 90-110, más 15% por lado (6 y 3 px).
    assert (zona.regla_id, zona.x, zona.y, zona.ancho, zona.alto) == ("SUG-01", 84, 87, 54, 26)
    assert zona.confianza == pytest.approx(0.8)


def test_si_un_lado_esta_descubierto_la_zona_es_desnudez() -> None:
    filas = _salida(_fila("FEMALE_BREAST_COVERED", 0.8, 100, 100, 20, 20), _fila("FEMALE_BREAST_EXPOSED", 0.6, 122, 100, 20, 20))
    (zona,) = decodificar_zonas(filas, 320, 320, 0.25)
    assert zona.regla_id == "DES-01"


def test_otras_partes_no_se_unen_al_pecho() -> None:
    filas = _salida(_fila("FEMALE_BREAST_COVERED", 0.8, 100, 100, 20, 20), _fila("BUTTOCKS_COVERED", 0.8, 122, 100, 20, 20))
    assert len(decodificar_zonas(filas, 320, 320, 0.25)) == 2


@pytest.mark.parametrize(
    ("b", "pareja"),
    [
        (_z(64, 0), True),  # separación 24 = 0.6 × 40: el límite se une
        (_z(65, 0), False),  # 25 px: ya son dos personas
        (_z(30, 0), True),  # se enciman
        (_z(50, 20), True),  # solape vertical 20 = 0.5 × 40: el límite se une
        (_z(50, 21), False),  # 19 px de solape: a distinta altura
        (_z(50, 0, 80, 80), True),  # el doble de grande: todavía pareja
        (_z(50, 0, 81, 40), False),  # más del doble de ancho
        (_z(50, 0, 40, 81), False),  # más del doble de alto
    ],
)
def test_limites_de_pareja(b: Zona, pareja: bool) -> None:
    assert (len(contenido.unir_pechos([_z(0, 0), b])) == 1) is pareja


def test_cada_lado_se_une_con_el_mas_cercano() -> None:
    # Dos personas juntas: a-b y c-d. b y c también cumplen, pero están más lejos que sus parejas.
    a, b, c, d = _z(0, 0), _z(45, 0), _z(105, 0), _z(150, 0)
    assert sorted((z.x, z.ancho) for z in contenido.unir_pechos([c, a, d, b])) == [(0, 85), (105, 85)]


def test_un_lado_sin_pareja_se_conserva() -> None:
    assert contenido.unir_pechos([_z(0, 0)]) == [_z(0, 0)]
    assert contenido.unir_pechos([]) == []


def test_el_margen_no_se_sale_de_la_imagen() -> None:
    assert contenido.con_margen(_z(2, 3, 100, 100), 104, 300) == _z(0, 0, 104, 118)


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
    # Una foto en el espacio no parece un baño.
    assert 0 <= revisor.probabilidad_bano(astronauta) < analisis.UMBRAL_BANO
    assert revisor.zonas(np.zeros((1, 1, 3), dtype=np.uint8), 0.25) == []


def _simular(monkeypatch: pytest.MonkeyPatch, escena: dict[str, float], zonas: list[Zona], bano: float = 0.0) -> None:
    class SinObjetos:
        def buscar(self, _p: Any) -> list[Any]:
            return []

    monkeypatch.setattr(objetos, "detector_de", lambda _c: SinObjetos())

    class Falso:
        def escena(self, _p: Any) -> dict[str, float]:
            return escena

        def probabilidad_bano(self, _p: Any) -> float:
            return bano

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


@pytest.mark.parametrize(("regla", "puntaje", "aparece"), [("ARM-01", 0.34, False), ("ARM-01", 0.35, True), ("EXT-01", 0.59, False), ("EXT-01", 0.9, True), ("DES-01", 0.5, True), ("SUG-01", 0.5, True)])
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


@pytest.mark.parametrize(("bano", "aparece"), [(0.59, False), (0.6, True), (0.95, True)])
def test_bano_es_aviso_de_riesgo_bajo_sobre_la_foto_completa(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bano: float, aparece: bool
) -> None:
    _simular(monkeypatch, NEUTRO, [], bano)
    resultado = _analizar(tmp_path)
    hallazgos = [h for h in resultado["hallazgos"] if h["regla_id"] == "INT-01"]
    assert bool(hallazgos) is aparece
    assert "INT-01" in resultado["cobertura"]["reglas_revisadas"]
    if aparece:
        assert hallazgos[0]["caja"] is None
        assert hallazgos[0]["requiere_revision"] is True


def test_el_bano_no_le_quita_puntaje_a_la_desnudez(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """El baño va en su propia comparación: un desnudo en un baño se sigue avisando."""
    _simular(monkeypatch, {**NEUTRO, "DES-01": 0.5}, [], 0.99)
    reglas = {h["regla_id"] for h in _analizar(tmp_path)["hallazgos"]}
    assert {"DES-01", "INT-01"} <= reglas
    assert "INT-01" not in contenido.FRASES_RIESGO


def test_si_falla_el_bano_la_revision_queda_parcial(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, NEUTRO, [])
    original = contenido.revisor_de

    def con_bano_roto(carpeta: Any) -> Any:
        revisor = original(carpeta)

        def romper(_p: Any) -> float:
            raise RuntimeError("falla simulada")

        revisor.probabilidad_bano = romper
        return revisor

    monkeypatch.setattr(contenido, "revisor_de", con_bano_roto)
    resultado = _analizar(tmp_path)
    assert resultado["cobertura"]["completa"] is False
    assert "INT-01" not in resultado["cobertura"]["reglas_revisadas"]
