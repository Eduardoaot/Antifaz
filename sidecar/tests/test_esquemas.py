"""Límites de qa/RANGOS.md: mínimo-1, mínimo, máximo, máximo+1, null, tipo incorrecto, NaN e Infinity."""
from __future__ import annotations

import math
from typing import Any

import pytest
from pydantic import ValidationError

from revisor.esquemas import Analizar, Exportar, Ocultamiento, Previsualizar, Solicitud

BASE_OCULTA: dict[str, Any] = {"x": 0, "y": 0, "ancho": 10, "alto": 10, "efecto": "solido"}
INVALIDOS_COMUNES = [None, "5", "abc", "", " ", "1e10", "0,5", "😀", [], {}, True, math.nan, math.inf, -math.inf]


def validar_oculta(**cambios: Any) -> Ocultamiento:
    return Ocultamiento.model_validate({**BASE_OCULTA, **cambios})


@pytest.mark.parametrize(
    ("campo", "minimo", "maximo"),
    [
        ("x", 0, 29999),
        ("y", 0, 29999),
        ("ancho", 1, 30000),
        ("alto", 1, 30000),
        ("intensidad", 1, 100),
        ("dilatacion_px", 8, 512),
    ],
)
def test_limites_enteros(campo: str, minimo: int, maximo: int) -> None:
    assert getattr(validar_oculta(**{campo: minimo}), campo) == minimo
    assert getattr(validar_oculta(**{campo: maximo}), campo) == maximo
    for malo in (minimo - 1, maximo + 1, 2**64, -(2**64), minimo + 0.5, float(minimo), *INVALIDOS_COMUNES):
        with pytest.raises(ValidationError):
            validar_oculta(**{campo: malo})


@pytest.mark.parametrize("malo", [-0.1, 50.1, None, "10", "0,5", math.nan, math.inf, -math.inf, True, [], {}])
def test_dilatacion_pct_invalida(malo: Any) -> None:
    with pytest.raises(ValidationError):
        validar_oculta(dilatacion_pct=malo)


@pytest.mark.parametrize("bueno", [0, 0.0, 50, 50.0, 10.5])
def test_dilatacion_pct_valida(bueno: float) -> None:
    assert validar_oculta(dilatacion_pct=bueno).dilatacion_pct == bueno


@pytest.mark.parametrize("malo", ["", "SOLIDO", "emoji", "emoji_", "EMOJI_GATO", "emoji_perro", "😀", "ninguno", None, 1, [], {}])
def test_efecto_desconocido_nunca_cae_en_sin_efecto(malo: Any) -> None:
    with pytest.raises(ValidationError):
        validar_oculta(efecto=malo)


@pytest.mark.parametrize(
    "efecto",
    ["solido", "difuminado", "pixelado", "emoji_sonrisa", "emoji_lentes", "emoji_gato", "emoji_estrella"],
)
def test_efectos_validos(efecto: str) -> None:
    assert validar_oculta(efecto=efecto).efecto == efecto


def test_campo_desconocido_o_faltante() -> None:
    with pytest.raises(ValidationError):
        validar_oculta(extra=1)
    with pytest.raises(ValidationError):
        Ocultamiento.model_validate({"x": 0, "y": 0, "ancho": 1, "efecto": "solido"})


ANALIZAR: dict[str, Any] = {"tipo": "analizar", "imagen_id": "a"}


@pytest.mark.parametrize("campo", ["umbral_confianza", "umbral_revision"])
@pytest.mark.parametrize("malo", [-0.01, 1.01, None, "0.5", "0,5", math.nan, math.inf, True])
def test_umbrales_invalidos(campo: str, malo: Any) -> None:
    with pytest.raises(ValidationError):
        Analizar.model_validate({**ANALIZAR, campo: malo})


def test_umbrales_en_extremos_y_relacion() -> None:
    assert Analizar.model_validate({**ANALIZAR, "umbral_confianza": 0, "umbral_revision": 0}).umbral_confianza == 0
    assert Analizar.model_validate({**ANALIZAR, "umbral_confianza": 1, "umbral_revision": 1}).umbral_revision == 1
    with pytest.raises(ValidationError):
        Analizar.model_validate({**ANALIZAR, "umbral_confianza": 0.6, "umbral_revision": 0.5})


@pytest.mark.parametrize(("valor", "ok"), [(0.99, False), (1.0, True), (3.0, True), (3.01, False)])
def test_multiplicador_cara(valor: float, ok: bool) -> None:
    datos = {**ANALIZAR, "multiplicador_cara": valor}
    if ok:
        assert Analizar.model_validate(datos).multiplicador_cara == valor
    else:
        with pytest.raises(ValidationError):
            Analizar.model_validate(datos)


EXPORTAR: dict[str, Any] = {"tipo": "exportar", "imagen_id": "a", "ocultamientos": [], "ruta_destino": "C:/x.jpg"}


@pytest.mark.parametrize(("valor", "ok"), [(59, False), (60, True), (100, True), (101, False), ("90", False), (90.0, False), (None, False)])
def test_jpeg_calidad(valor: Any, ok: bool) -> None:
    datos = {**EXPORTAR, "jpeg_calidad": valor}
    if ok:
        assert Exportar.model_validate(datos).jpeg_calidad == valor
    else:
        with pytest.raises(ValidationError):
            Exportar.model_validate(datos)


@pytest.mark.parametrize("ruta", ["", None, 5, []])
def test_ruta_destino_invalida(ruta: Any) -> None:
    with pytest.raises(ValidationError):
        Exportar.model_validate({**EXPORTAR, "ruta_destino": ruta})


@pytest.mark.parametrize(("valor", "ok"), [(63, False), (64, True), (4096, True), (4097, False)])
def test_lado_previsualizacion(valor: int, ok: bool) -> None:
    datos = {"tipo": "previsualizar", "imagen_id": "a", "ocultamientos": [], "lado_max": valor}
    if ok:
        assert Previsualizar.model_validate(datos).lado_max == valor
    else:
        with pytest.raises(ValidationError):
            Previsualizar.model_validate(datos)


def test_demasiados_ocultamientos() -> None:
    uno = dict(BASE_OCULTA)
    assert len(Exportar.model_validate({**EXPORTAR, "ocultamientos": [uno] * 5000}).ocultamientos) == 5000
    with pytest.raises(ValidationError):
        Exportar.model_validate({**EXPORTAR, "ocultamientos": [uno] * 5001})


@pytest.mark.parametrize(
    "mala",
    [
        {},
        {"id": 1},
        {"comando": {"tipo": "ping"}},
        {"id": -1, "comando": {"tipo": "ping"}},
        {"id": 2**53, "comando": {"tipo": "ping"}},
        {"id": "1", "comando": {"tipo": "ping"}},
        {"id": 1.0, "comando": {"tipo": "ping"}},
        {"id": True, "comando": {"tipo": "ping"}},
        {"id": 1, "comando": {"tipo": "borrar_todo"}},
        {"id": 1, "comando": {}},
        {"id": 1, "comando": None},
        {"id": 1, "comando": {"tipo": "ping"}, "extra": 1},
    ],
)
def test_solicitud_invalida(mala: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Solicitud.model_validate(mala)
