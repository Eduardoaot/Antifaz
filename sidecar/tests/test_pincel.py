"""Pincel: el trazo pintado a mano se vuelve una silueta y se oculta en la copia."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from PIL import Image

from revisor import efectos, pincel
from revisor.errores import ErrorRevisor
from revisor.esquemas import PINCEL_MAX, PINCEL_MIN, PUNTOS_TRAZO_MAX
from revisor.servidor import Sesion, atender

from .conftest import MODELOS, guardar, oculto


def _pedir(sesion: Sesion, comando: dict[str, Any]) -> dict[str, Any]:
    return atender(sesion, json.dumps({"id": 1, "comando": comando}).encode())[0]  # type: ignore[return-value]


def _abrir(sesion: Sesion, ruta: Path) -> str:
    return _pedir(sesion, {"tipo": "abrir_imagen", "ruta": str(ruta)})["datos"]["imagen_id"]


def _pintar(sesion: Sesion, imagen_id: str, puntos: list[tuple[int, int]], tamano: Any = 10) -> dict[str, Any]:
    return _pedir(
        sesion,
        {"tipo": "pintar", "imagen_id": imagen_id, "puntos": [{"x": x, "y": y} for x, y in puntos], "tamano": tamano},
    )


# --- Rasterizado -----------------------------------------------------------------------------


def test_un_punto_da_un_circulo_del_tamano_pedido() -> None:
    m = pincel.rasterizar([(50, 50)], 21, 100, 100)
    assert (m.x, m.y, m.ancho, m.alto) == (40, 40, 21, 21)
    assert m.recorte[10, 10]
    # Las esquinas de la caja quedan fuera del círculo.
    assert not m.recorte[0, 0]


def test_tamano_uno_pinta_un_solo_pixel() -> None:
    m = pincel.rasterizar([(5, 7)], 1, 10, 10)
    assert (m.x, m.y, m.ancho, m.alto) == (5, 7, 1, 1)
    assert m.recorte.all()


def test_tamano_par_no_queda_corto() -> None:
    m = pincel.rasterizar([(50, 50)], 32, 100, 100)
    assert m.ancho >= 32 and m.alto >= 32


def test_la_linea_entre_puntos_no_deja_huecos() -> None:
    m = pincel.rasterizar([(10, 50), (90, 50)], 5, 100, 100)
    fila = m.recorte[50 - m.y]
    assert fila.all(), "todo el tramo entre los dos puntos debe quedar pintado"
    assert m.ancho >= 81


def test_en_el_borde_se_ajusta_solo_el_grosor() -> None:
    m = pincel.rasterizar([(0, 0), (99, 99)], 30, 100, 100)
    assert m.x == 0 and m.y == 0
    assert m.x + m.ancho <= 100 and m.y + m.alto <= 100
    assert m.recorte[0, 0] and m.recorte[-1, -1]


@pytest.mark.parametrize("punto", [(100, 0), (0, 100), (-1, 0), (0, -1)])
def test_punto_fuera_de_la_imagen_se_rechaza(punto: tuple[int, int]) -> None:
    with pytest.raises(ErrorRevisor) as e:
        pincel.rasterizar([(5, 5), punto], 10, 100, 100)
    assert e.value.codigo.value == "REGION_FUERA_DE_IMAGEN"


@pytest.mark.parametrize("tamano", [0, -1, 513])
def test_tamano_fuera_de_rango_se_rechaza(tamano: int) -> None:
    with pytest.raises(ErrorRevisor) as e:
        pincel.rasterizar([(5, 5)], tamano, 100, 100)
    assert e.value.codigo.value == "VALIDACION"


def test_trazo_vacio_se_rechaza() -> None:
    with pytest.raises(ErrorRevisor):
        pincel.rasterizar([], 10, 100, 100)


@given(
    datos=st.data(),
    ancho=st.integers(1, 300),
    alto=st.integers(1, 300),
    tamano=st.integers(PINCEL_MIN, PINCEL_MAX),
)
def test_propiedad_cubre_cada_punto_y_cabe_en_la_imagen(datos: st.DataObject, ancho: int, alto: int, tamano: int) -> None:
    puntos = datos.draw(st.lists(st.tuples(st.integers(0, ancho - 1), st.integers(0, alto - 1)), min_size=1, max_size=20))
    m = pincel.rasterizar(puntos, tamano, ancho, alto)
    assert m.recorte.shape == (m.alto, m.ancho)
    assert 0 <= m.x and 0 <= m.y and m.x + m.ancho <= ancho and m.y + m.alto <= alto
    for x, y in puntos:
        assert m.recorte[y - m.y, x - m.x], "cada punto del trazo debe quedar oculto"


def test_el_efecto_solo_cambia_el_trazo_y_su_margen() -> None:
    a = np.random.default_rng(3).integers(0, 256, size=(200, 200, 3), dtype=np.uint8)
    m = pincel.rasterizar([(20, 100), (180, 100)], 10, 200, 200)
    o = oculto(m.x, m.y, m.ancho, m.alto, "solido", mascara_id="t", dilatacion_pct=0.0)
    salida, _ = efectos.aplicar(a, [o], {"t": m.recorte})
    assert salida[100, 100].max() == 0
    # Margen mínimo de 8 px alrededor del trazo; más lejos, la foto queda igual.
    assert np.array_equal(salida[60, 100], a[60, 100])
    assert np.array_equal(salida[140, 100], a[140, 100])


# --- Comando del sidecar ---------------------------------------------------------------------


def test_comando_pintar_y_exportar(tmp_path: Path) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (200, 200), (200, 200, 200))))
    respuesta = _pintar(sesion, imagen_id, [(20, 100), (180, 100)], 10)
    assert respuesta["ok"]
    datos = respuesta["datos"]
    caja = datos["caja"]
    assert caja["x"] <= 15 and caja["x"] + caja["ancho"] >= 185
    oculta = {**caja, "efecto": "solido", "mascara_id": datos["mascara_id"], "dilatacion_pct": 0.0}
    destino = tmp_path / "p.png"
    assert _pedir(sesion, {"tipo": "exportar", "imagen_id": imagen_id, "ocultamientos": [oculta], "ruta_destino": str(destino)})["ok"]
    with Image.open(destino) as salida:
        assert salida.getpixel((100, 100)) == (0, 0, 0)
        assert salida.getpixel((100, 30)) == (200, 200, 200)
    assert _pedir(sesion, {"tipo": "cerrar", "imagen_id": imagen_id})["ok"]
    assert imagen_id not in sesion.mascaras


def test_cada_trazo_tiene_su_propia_silueta(tmp_path: Path) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100))))
    uno = _pintar(sesion, imagen_id, [(10, 10)])["datos"]["mascara_id"]
    dos = _pintar(sesion, imagen_id, [(80, 80)])["datos"]["mascara_id"]
    assert uno != dos
    assert set(sesion.mascaras[imagen_id]) == {uno, dos}


def test_pintar_fuera_de_la_imagen(tmp_path: Path) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100))))
    assert _pintar(sesion, imagen_id, [(10, 10), (100, 10)])["error"]["codigo"] == "REGION_FUERA_DE_IMAGEN"
    assert imagen_id not in sesion.mascaras


def test_pintar_sin_imagen_abierta() -> None:
    assert _pintar(Sesion(MODELOS), "x", [(1, 1)])["error"]["codigo"] == "IMAGEN_NO_ABIERTA"


@pytest.mark.parametrize("tamano", [0, 513, 1.5, "10", None, True, float("nan"), float("inf")])
def test_tamano_invalido_en_el_mensaje(tmp_path: Path, tamano: Any) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100))))
    if isinstance(tamano, float) and not math.isfinite(tamano):
        # json.dumps escribe NaN e Infinity, que el sidecar rechaza al leer.
        crudo = json.dumps({"id": 1, "comando": {"tipo": "pintar", "imagen_id": imagen_id, "puntos": [{"x": 1, "y": 1}], "tamano": tamano}})
        assert atender(sesion, crudo.encode())[0]["ok"] is False
        return
    assert _pintar(sesion, imagen_id, [(1, 1)], tamano)["error"]["codigo"] == "VALIDACION"


@pytest.mark.parametrize(
    "puntos",
    [
        [],
        [{"x": -1, "y": 0}],
        [{"x": 1.5, "y": 0}],
        [{"x": "1", "y": 0}],
        [{"x": True, "y": 0}],
        [{"x": 1}],
        [{"x": 1, "y": 1, "z": 1}],
        [[1, 1]],
        [{"x": 30000, "y": 0}],
        [{"x": 0, "y": 0}] * (PUNTOS_TRAZO_MAX + 1),
    ],
)
def test_puntos_invalidos(tmp_path: Path, puntos: list[Any]) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100))))
    respuesta = _pedir(sesion, {"tipo": "pintar", "imagen_id": imagen_id, "puntos": puntos, "tamano": 10})
    assert respuesta["error"]["codigo"] == "VALIDACION"


def test_limites_exactos_se_aceptan(tmp_path: Path) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100))))
    assert _pintar(sesion, imagen_id, [(0, 0)], PINCEL_MIN)["ok"]
    assert _pintar(sesion, imagen_id, [(99, 99)], PINCEL_MAX)["ok"]
    assert _pintar(sesion, imagen_id, [(50, 50)] * PUNTOS_TRAZO_MAX, 10)["ok"]
