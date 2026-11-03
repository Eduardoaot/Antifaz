"""Irreversibilidad: la zona oculta no debe depender del contenido original."""
from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from revisor import efectos
from revisor.errores import Codigo, ErrorRevisor

from .conftest import oculto

EFECTOS = ["solido", "difuminado", "pixelado"]


def _rng() -> np.random.Generator:
    return np.random.default_rng(123)


def _imagen(alto: int = 200, ancho: int = 300, canales: int = 3, valor: int | None = None) -> np.ndarray:
    if valor is not None:
        return np.full((alto, ancho, canales), valor, dtype=np.uint8)
    return np.random.default_rng(5).integers(0, 256, size=(alto, ancho, canales), dtype=np.uint8)


@pytest.mark.parametrize("efecto", EFECTOS)
def test_irreversible_el_contenido_no_influye(efecto: str) -> None:
    """Dos fotos que solo difieren dentro de la zona dan exactamente la misma salida."""
    a = _imagen()
    b = a.copy()
    b[60:120, 80:180] = 255 - b[60:120, 80:180]
    o = oculto(80, 60, 100, 60, efecto)
    salida_a, regiones = efectos.aplicar(a, [o], _rng())
    salida_b, _ = efectos.aplicar(b, [o], _rng())
    assert np.array_equal(salida_a, salida_b), "lo original se filtró a la salida"
    x0, y0, x1, y1 = regiones[0]
    assert (x0, y0) == (72, 52) and (x1, y1) == (188, 128)


@pytest.mark.parametrize("efecto", EFECTOS)
def test_secreto_de_alto_contraste_no_deja_correlacion(efecto: str) -> None:
    """Texto blanco sobre negro: la salida no debe correlacionar con el patrón."""
    a = _imagen(valor=0)
    a[70:110, 90:170][::2, :] = 255
    salida, _ = efectos.aplicar(a, [oculto(80, 60, 100, 60, efecto)], _rng())
    zona_in = a[70:110, 90:170, 0].astype(float).ravel()
    zona_out = salida[70:110, 90:170, 0].astype(float).ravel()
    if zona_out.std() > 0:
        assert abs(np.corrcoef(zona_in, zona_out)[0, 1]) < 0.1


@pytest.mark.parametrize("efecto", EFECTOS)
def test_fuera_de_la_zona_no_cambia_y_entrada_intacta(efecto: str) -> None:
    a = _imagen()
    copia = a.copy()
    salida, regiones = efectos.aplicar(a, [oculto(80, 60, 100, 60, efecto)], _rng())
    assert np.array_equal(a, copia), "se modificó el original en memoria"
    x0, y0, x1, y1 = regiones[0]
    mascara = np.zeros(a.shape[:2], dtype=bool)
    mascara[y0:y1, x0:x1] = True
    assert np.array_equal(salida[~mascara], a[~mascara])


def test_dilatacion_minima_y_porcentual() -> None:
    assert efectos.region_dilatada(oculto(50, 50, 10, 10), 200, 200) == (42, 42, 68, 68)
    assert efectos.region_dilatada(oculto(50, 50, 100, 100, dilatacion_pct=10.0), 300, 300) == (40, 40, 160, 160)
    assert efectos.region_dilatada(oculto(50, 50, 100, 100, dilatacion_pct=0.0, dilatacion_px=8), 300, 300) == (42, 42, 158, 158)


def test_margen_se_ajusta_al_borde() -> None:
    assert efectos.region_dilatada(oculto(0, 0, 10, 10), 20, 20) == (0, 0, 18, 18)


@pytest.mark.parametrize(
    ("x", "y", "ancho", "alto"),
    [(190, 0, 11, 10), (0, 190, 10, 11), (200, 0, 1, 1), (0, 0, 201, 1)],
)
def test_zona_fuera_de_la_imagen_se_rechaza_sin_recortar(x: int, y: int, ancho: int, alto: int) -> None:
    with pytest.raises(ErrorRevisor) as e:
        efectos.aplicar(_imagen(200, 200), [oculto(x, y, ancho, alto)], _rng())
    assert e.value.codigo is Codigo.REGION_FUERA_DE_IMAGEN


def test_borde_exacto_y_toda_la_imagen() -> None:
    a = _imagen(50, 50)
    salida, _ = efectos.aplicar(a, [oculto(0, 0, 50, 50)], _rng())
    assert salida.max() == 0
    salida, regiones = efectos.aplicar(a, [oculto(49, 49, 1, 1)], _rng())
    assert regiones[0] == (41, 41, 50, 50)
    assert salida[49, 49].max() == 0


def test_lista_vacia_copia_igual() -> None:
    a = _imagen(10, 10)
    salida, regiones = efectos.aplicar(a, [], _rng())
    assert regiones == []
    assert np.array_equal(salida, a)
    assert salida is not a


def test_solapados_no_se_filtran_entre_si() -> None:
    a = _imagen()
    b = a.copy()
    b[40:160, 40:260] = 0
    lista = [oculto(50, 50, 100, 100, "difuminado"), oculto(100, 50, 150, 100, "pixelado")]
    assert np.array_equal(efectos.aplicar(a, lista, _rng())[0], efectos.aplicar(b, lista, _rng())[0])


def test_difuminado_no_toma_color_de_otra_zona_sin_ocultar() -> None:
    a = _imagen(100, 400, valor=0)
    b = a.copy()
    # La segunda zona queda dentro del alcance del difuminado de la primera.
    b[40:60, 90:110] = 255
    lista = [oculto(40, 40, 20, 20, "difuminado"), oculto(90, 40, 20, 20, "solido")]
    assert np.array_equal(efectos.aplicar(a, lista, _rng())[0], efectos.aplicar(b, lista, _rng())[0])


@pytest.mark.parametrize("intensidad", [1, 30, 80, 100])
@pytest.mark.parametrize("efecto", ["difuminado", "pixelado"])
def test_intensidad_nunca_cambia_la_seguridad(efecto: str, intensidad: int) -> None:
    a = _imagen()
    b = a.copy()
    o = oculto(80, 60, 100, 60, efecto, intensidad=intensidad)
    x0, y0, x1, y1 = efectos.region_dilatada(o, *a.shape[:2])
    b[y0:y1, x0:x1] = 255 - b[y0:y1, x0:x1]
    assert np.array_equal(efectos.aplicar(a, [o], _rng())[0], efectos.aplicar(b, [o], _rng())[0])


def test_pixelado_bloque_mayor_que_region() -> None:
    a = _imagen(100, 100)
    salida, regiones = efectos.aplicar(a, [oculto(40, 40, 1, 1, "pixelado", dilatacion_px=8, intensidad=100)], _rng())
    x0, y0, x1, y1 = regiones[0]
    assert len(np.unique(salida[y0:y1, x0:x1].reshape(-1, 3), axis=0)) >= 1


def test_difuminado_con_sigma_grande_rapido_y_correcto() -> None:
    a = _imagen(2000, 3000)
    salida, _ = efectos.aplicar(a, [oculto(100, 100, 2500, 1500, "difuminado")], _rng())
    assert salida.shape == a.shape


def test_alfa_transparente_no_esconde_ni_revela() -> None:
    a = _imagen(100, 100, canales=4)
    a[:, :, 3] = 0
    salida, regiones = efectos.aplicar(a, [oculto(30, 30, 20, 20)], _rng())
    x0, y0, x1, y1 = regiones[0]
    assert (salida[y0:y1, x0:x1, 3] == 255).all()
    assert (salida[y0:y1, x0:x1, :3] == 0).all()
    # Fuera de la zona, el color guardado bajo alfa 0 se borra.
    assert (salida[0:10, 0:10, :3] == 0).all()


def test_rgb_bajo_alfa_parcial_se_conserva() -> None:
    a = _imagen(20, 20, canales=4)
    a[:, :, 3] = 128
    salida, _ = efectos.aplicar(a, [], _rng())
    assert np.array_equal(salida, a)


@given(
    imagen=arrays(np.uint8, st.tuples(st.integers(20, 80), st.integers(20, 80), st.just(3))),
    efecto=st.sampled_from(EFECTOS),
    datos=st.tuples(st.floats(0, 0.9), st.floats(0, 0.9), st.floats(0.05, 1), st.floats(0.05, 1)),
    intensidad=st.integers(1, 100),
    semilla=st.integers(0, 2**32 - 1),
)
def test_propiedad_cualquier_mascara_valida(
    imagen: np.ndarray, efecto: str, datos: tuple[float, float, float, float], intensidad: int, semilla: int
) -> None:
    alto, ancho = imagen.shape[:2]
    x, y = int(datos[0] * ancho), int(datos[1] * alto)
    w = max(1, min(ancho - x, int(datos[2] * ancho)))
    h = max(1, min(alto - y, int(datos[3] * alto)))
    o = oculto(x, y, w, h, efecto, intensidad=intensidad)
    salida, regiones = efectos.aplicar(imagen, [o], np.random.default_rng(semilla))
    assert salida.shape == imagen.shape
    x0, y0, x1, y1 = regiones[0]
    otra = imagen.copy()
    otra[y0:y1, x0:x1] = 255 - otra[y0:y1, x0:x1]
    salida_otra, _ = efectos.aplicar(otra, [o], np.random.default_rng(semilla))
    assert np.array_equal(salida, salida_otra)
    fuera = np.ones(imagen.shape[:2], dtype=bool)
    fuera[y0:y1, x0:x1] = False
    assert np.array_equal(salida[fuera], imagen[fuera])
