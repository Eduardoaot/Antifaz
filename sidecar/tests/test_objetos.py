"""Detector de objetos y reglas para reducir falsas alarmas. Las muestras reales no se versionan."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import analisis, cargador, contenido, objetos
from revisor.caras import ModeloNoDisponible
from revisor.contenido import Zona
from revisor.objetos import CLASES, DetectorObjetos, Objeto, decodificar

from .conftest import DATOS, MODELOS, guardar, imagen_prueba


def _logit(p: float) -> float:
    return float(np.log(p / (1 - p)))


def _salida(*filas: tuple[str, float, tuple[float, float, float, float]]) -> tuple[np.ndarray, np.ndarray]:
    logits = np.full((len(filas), len(CLASES)), -20.0, dtype=np.float32)
    cajas = np.zeros((len(filas), 4), dtype=np.float32)
    for i, (frase, puntaje, caja) in enumerate(filas):
        logits[i, [c.frase for c in CLASES].index(frase)] = _logit(puntaje)
        cajas[i] = caja
    return logits, cajas


def test_decodifica_a_coordenadas_reales() -> None:
    zonas = decodificar(*_salida(("a car license plate", 0.5, (0.5, 0.5, 0.2, 0.1))), 1000, 500)
    assert [(z.regla_id, z.x, z.y, z.ancho, z.alto) for z in zonas] == [("MAT-01", 400, 225, 200, 50)]


@pytest.mark.parametrize(("frase", "regla"), [("a smartphone screen", "PAN-01"), ("a television", "PAN-01"), ("a credit card", "FIN-01"), ("a street sign", "UBI-04"), ("a window with a view of the street or buildings", "UBI-06"), ("jewelry or a necklace", "VAL-02"), ("a gun", "ARM-01"), ("a rifle", "ARM-01"), ("a flag", "EXT-01")])
def test_cada_clase_lleva_a_su_regla(frase: str, regla: str) -> None:
    assert decodificar(*_salida((frase, 0.9, (0.5, 0.5, 0.2, 0.2))), 100, 100)[0].regla_id == regla


@pytest.mark.parametrize("clase", CLASES, ids=lambda c: c.frase)
def test_umbral_por_clase(clase: objetos.Clase) -> None:
    assert decodificar(*_salida((clase.frase, clase.umbral, (0.5, 0.5, 0.2, 0.2))), 100, 100)
    assert not decodificar(*_salida((clase.frase, clase.umbral - 0.01, (0.5, 0.5, 0.2, 0.2))), 100, 100)


def test_caja_que_se_sale_se_ajusta_y_una_vacia_se_descarta() -> None:
    z = decodificar(*_salida(("a gun", 0.9, (0.0, 0.0, 0.4, 0.4))), 100, 100)[0]
    assert (z.x, z.y, z.ancho, z.alto) == (0, 0, 20, 20)
    assert decodificar(*_salida(("a gun", 0.9, (-2.0, -2.0, 0.1, 0.1))), 100, 100) == []


def test_duplicados_se_unen_y_lo_separado_no() -> None:
    assert len(decodificar(*_salida(("a gun", 0.9, (0.5, 0.5, 0.2, 0.2)), ("a rifle", 0.8, (0.51, 0.5, 0.2, 0.2))), 100, 100)) == 1
    assert len(decodificar(*_salida(("a gun", 0.9, (0.2, 0.2, 0.1, 0.1)), ("a gun", 0.8, (0.8, 0.8, 0.1, 0.1))), 100, 100)) == 2


def test_modelo_alterado_no_se_usa(tmp_path: Path) -> None:
    with pytest.raises(ModeloNoDisponible):
        DetectorObjetos(tmp_path)


def test_modelo_real_no_marca_una_imagen_vacia() -> None:
    detector = objetos.detector_de(MODELOS)
    assert detector.buscar(np.full((400, 400, 3), 128, dtype=np.uint8)) == []
    assert isinstance(detector.buscar(np.array(Image.open(DATOS / "astronauta.jpg").convert("RGB"))), list)


NEUTRO = {"ARM-01": 0.0, "EXT-01": 0.0, "DES-01": 0.0, "SUG-01": 0.0}


def _simular(monkeypatch: pytest.MonkeyPatch, escena: dict[str, float], zonas: list[Zona], encontrados: list[Objeto]) -> None:
    class FalsoContenido:
        def escena(self, _p: Any) -> dict[str, float]:
            return {**NEUTRO, **escena}

        def probabilidad_bano(self, _p: object) -> float:
            return 0.0

        def zonas(self, _p: Any, _u: float) -> list[Zona]:
            return zonas

        def probabilidad_cara(self, *_a: Any) -> float:
            return 0.9

    class FalsoObjetos:
        def buscar(self, _p: Any) -> list[Objeto]:
            return encontrados

    monkeypatch.setattr(contenido, "revisor_de", lambda _c: FalsoContenido())
    monkeypatch.setattr(objetos, "detector_de", lambda _c: FalsoObjetos())


def _analizar(tmp_path: Path) -> dict[str, Any]:
    imagen = cargador.abrir(str(guardar(tmp_path / "a.png", imagen_prueba(640, 480))))
    return analisis.analizar(imagen, MODELOS, 0.25, 0.6, 1.3)


def _de(resultado: dict[str, Any], regla: str) -> list[dict[str, Any]]:
    return [h for h in resultado["hallazgos"] if h["regla_id"] == regla]


def test_objetos_llegan_como_zonas(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {}, [], [Objeto("MAT-01", 10, 10, 50, 20, 0.2), Objeto("PAN-01", 100, 100, 50, 50, 0.7)])
    resultado = _analizar(tmp_path)
    assert _de(resultado, "MAT-01")[0]["caja"] == {"x": 10, "y": 10, "ancho": 50, "alto": 20}
    assert _de(resultado, "MAT-01")[0]["requiere_revision"] is True
    assert _de(resultado, "PAN-01")[0]["requiere_revision"] is False
    assert {"MAT-01", "PAN-01", "VAL-02", "UBI-04", "UBI-06"} <= set(resultado["cobertura"]["reglas_revisadas"])
    assert "UBI-05" not in resultado["cobertura"]["reglas_revisadas"]


def test_arma_con_zona_no_repite_el_aviso_general(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {"ARM-01": 0.9}, [], [Objeto("ARM-01", 10, 10, 50, 20, 0.5)])
    armas = _de(_analizar(tmp_path), "ARM-01")
    assert len(armas) == 1 and armas[0]["caja"] is not None


def test_arma_sin_zona_avisa_sobre_la_imagen(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {"ARM-01": 0.9}, [], [])
    assert _de(_analizar(tmp_path), "ARM-01")[0]["caja"] is None


def test_una_bandera_comun_no_es_extremismo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {"EXT-01": 0.5}, [], [Objeto("EXT-01", 10, 10, 50, 20, 0.9)])
    assert _de(_analizar(tmp_path), "EXT-01") == []


def test_bandera_en_una_escena_extremista_se_puede_tapar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {"EXT-01": 0.6}, [], [Objeto("EXT-01", 10, 10, 50, 20, 0.5)])
    extremismo = _de(_analizar(tmp_path), "EXT-01")
    assert len(extremismo) == 1 and extremismo[0]["caja"] is not None


@pytest.mark.parametrize(("puntaje", "aparece"), [(0.59, False), (0.6, True)])
def test_umbral_de_extremismo_sin_bandera(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, puntaje: float, aparece: bool) -> None:
    _simular(monkeypatch, {"EXT-01": puntaje}, [], [])
    assert bool(_de(_analizar(tmp_path), "EXT-01")) is aparece


@pytest.mark.parametrize(
    ("confianza", "escena_sug", "aparece"),
    [(0.66, 0.05, False), (0.25, 0.05, False), (0.7, 0.0, True), (0.25, 0.1, True), (0.4, 0.85, True)],
)
def test_desnudez_de_confianza_media_necesita_respaldo_de_la_escena(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, confianza: float, escena_sug: float, aparece: bool
) -> None:
    _simular(monkeypatch, {"SUG-01": escena_sug}, [Zona("DES-01", 10, 10, 50, 50, confianza)], [])
    assert bool(_de(_analizar(tmp_path), "DES-01")) is aparece


def test_fail_closed_si_falta_el_detector(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {}, [], [])

    def falla(_c: Path) -> None:
        raise ModeloNoDisponible("falta")

    monkeypatch.setattr(objetos, "detector_de", falla)
    resultado = _analizar(tmp_path)
    assert "objetos_no_disponible" in resultado["cobertura"]["motivos"]
    assert "MAT-01" not in resultado["cobertura"]["reglas_revisadas"]
    assert "DES-01" in resultado["cobertura"]["reglas_revisadas"]


def test_fail_closed_si_el_detector_explota(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _simular(monkeypatch, {}, [], [])

    class Roto:
        def buscar(self, _p: Any) -> None:
            raise RuntimeError("onnx")

    monkeypatch.setattr(objetos, "detector_de", lambda _c: Roto())
    resultado = _analizar(tmp_path)
    assert "objetos_fallo" in resultado["cobertura"]["motivos"]
    assert "PAN-01" not in resultado["cobertura"]["reglas_revisadas"]


def test_descarta_la_caja_metida_en_otra_del_mismo_tipo() -> None:
    zonas = decodificar(
        *_salida(("a street sign", 0.9, (0.5, 0.5, 0.4, 0.4)), ("a street sign", 0.5, (0.5, 0.5, 0.1, 0.1))), 100, 100
    )
    assert len(zonas) == 1


def test_tope_de_cajas_en_clases_ruidosas_y_sin_tope_en_placas() -> None:
    letreros = [("a street sign", 0.9 - i * 0.01, (0.05 + i * 0.12, 0.5, 0.08, 0.08)) for i in range(8)]
    assert len(decodificar(*_salida(*letreros), 1000, 1000)) == 4
    placas = [("a car license plate", 0.9 - i * 0.01, (0.05 + i * 0.12, 0.5, 0.08, 0.08)) for i in range(8)]
    assert len(decodificar(*_salida(*placas), 1000, 1000)) == 8


# --- Forma de cara (caras.py) ------------------------------------------------------------------------


def _puntos(ojo_d: tuple[float, float], ojo_i: tuple[float, float], nariz: tuple[float, float], boca_d: tuple[float, float], boca_i: tuple[float, float]) -> list[float]:
    return [0, 0, 100, 100, *ojo_d, *ojo_i, *nariz, *boca_d, *boca_i]


def test_forma_de_cara_de_frente_de_lado_y_acostada() -> None:
    from revisor.caras import forma_de_cara

    assert forma_de_cara(_puntos((35, 40), (65, 40), (50, 55), (38, 72), (62, 72)))
    # De perfil: los ojos juntos, la boca abajo.
    assert forma_de_cara(_puntos((55, 40), (68, 41), (75, 56), (60, 72), (70, 72)))
    # Acostada (girada 90°): la misma cara, de lado.
    assert forma_de_cara(_puntos((40, 65), (40, 35), (55, 50), (72, 62), (72, 38)))


def test_puntos_sin_forma_de_cara_se_descartan() -> None:
    from revisor.caras import forma_de_cara

    # Todos amontonados en un punto (textura).
    assert not forma_de_cara(_puntos((50, 50), (51, 50), (50, 51), (51, 51), (50, 52)))
    # La boca a la misma altura que los ojos y lejos de la nariz.
    assert not forma_de_cara(_puntos((10, 50), (90, 50), (50, 95), (12, 52), (88, 52)))
    # Puntos fuera de la caja.
    assert not forma_de_cara(_puntos((35, 40), (65, 40), (50, 55), (38, 72), (200, 72)))
    # Caja vacía.
    assert not forma_de_cara([0, 0, 0, 0, *([1.0] * 10)])
