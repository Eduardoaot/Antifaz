"""Zona oculta por frame a partir del seguimiento: interpolación, objeto perdido y margen de frames."""
from __future__ import annotations

import math

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from revisor import pistas
from revisor.errores import Codigo, ErrorRevisor
from revisor.pistas import Mascara, a_resolucion, frames_a_rastrear, zonas

ALTO, ANCHO = 120, 200


def cuadro(x: int, y: int, lado: int = 20) -> Mascara:
    m = np.zeros((ALTO, ANCHO), dtype=bool)
    m[y : y + lado, x : x + lado] = True
    return m


def vacia() -> Mascara:
    return np.zeros((ALTO, ANCHO), dtype=bool)


def codigo_de(funcion: object, *args: object, **kwargs: object) -> Codigo:
    with pytest.raises(ErrorRevisor) as e:
        if callable(funcion):
            resultado = funcion(*args, **kwargs)
            if hasattr(resultado, "__next__"):
                list(resultado)  # type: ignore[call-overload]
    return e.value.codigo


# --- frames_a_rastrear --------------------------------------------------------------------------


def test_24_fps_en_video_de_24_rastrea_todos() -> None:
    assert frames_a_rastrear(72, 24, 24) == list(range(72))


def test_video_con_menos_fps_rastrea_todos() -> None:
    assert frames_a_rastrear(45, 15, 24) == list(range(45))


def test_video_de_60_a_24_rastrea_uno_de_cada_dos_y_medio() -> None:
    indices = frames_a_rastrear(180, 60, 24)
    assert indices[0] == 0 and indices[-1] == 179
    assert all(1 <= b - a <= 3 for a, b in zip(indices, indices[1:], strict=False))
    assert len(indices) == pytest.approx(180 / 2.5, abs=2)


def test_un_solo_frame() -> None:
    assert frames_a_rastrear(1, 30, 24) == [0]


@given(st.integers(1, 800), st.floats(0.5, 240), st.floats(1, 30))
def test_siempre_incluye_extremos_y_sin_huecos_grandes(total: int, fps_video: float, fps_tracking: float) -> None:
    indices = frames_a_rastrear(total, fps_video, fps_tracking)
    assert indices[0] == 0 and indices[-1] == total - 1
    assert indices == sorted(set(indices))
    paso = max(1.0, fps_video / fps_tracking)
    assert all(b - a <= math.ceil(paso) for a, b in zip(indices, indices[1:], strict=False))


@pytest.mark.parametrize("total", [0, -1])
def test_total_invalido(total: int) -> None:
    assert codigo_de(frames_a_rastrear, total, 30, 24) is Codigo.VALIDACION


@pytest.mark.parametrize("fps", [0, -1, float("nan"), float("inf")])
def test_fps_video_invalido(fps: float) -> None:
    assert codigo_de(frames_a_rastrear, 10, fps, 24) is Codigo.VALIDACION


@pytest.mark.parametrize("fps", [0.99, 30.01, float("nan"), float("inf"), 0])
def test_fps_tracking_fuera_de_rango(fps: float) -> None:
    assert codigo_de(frames_a_rastrear, 10, 30, fps) is Codigo.VALIDACION


@pytest.mark.parametrize("fps", [pistas.FPS_TRACKING_MIN, pistas.FPS_TRACKING_MAX])
def test_fps_tracking_en_los_limites(fps: float) -> None:
    assert frames_a_rastrear(10, 30, fps)[0] == 0


# --- zonas --------------------------------------------------------------------------------------


def test_frame_rastreado_se_oculta_con_margen() -> None:
    (zona,) = zonas({0: cuadro(50, 50)}, 1)
    assert zona.mascara[50:70, 50:70].all()
    assert zona.mascara[50, 50 - pistas.MARGEN_PX_MIN]  # margen de 8 px
    assert not zona.mascara[50, 50 - pistas.MARGEN_PX_MIN - 2]
    assert not zona.revisar


def test_interpolacion_cubre_la_posicion_intermedia() -> None:
    """El objeto va de x=20 a x=100 en 4 frames; en el frame 2 está en x=60."""
    lista = list(zonas({0: cuadro(20, 50), 4: cuadro(100, 50)}, 5, margen_frames=0))
    assert lista[2].mascara[50:70, 60:80].all()
    assert not any(z.revisar for z in lista)


@given(st.integers(0, 140), st.integers(0, 80), st.integers(0, 140), st.integers(0, 80), st.integers(2, 8))
def test_movimiento_lineal_siempre_cubierto(x0: int, y0: int, x1: int, y1: int, pasos: int) -> None:
    """Si el objeto se mueve en línea recta, toda posición intermedia queda dentro de la zona."""
    lista = list(zonas({0: cuadro(x0, y0), pasos: cuadro(x1, y1)}, pasos + 1, margen_frames=0))
    for t in range(pasos + 1):
        x = round(x0 + (x1 - x0) * t / pasos)
        y = round(y0 + (y1 - y0) * t / pasos)
        assert lista[t].mascara[cuadro(x, y)].all()


def test_objeto_perdido_se_sigue_ocultando_y_se_marca() -> None:
    rastreadas = {0: cuadro(20, 20), 2: vacia(), 4: cuadro(140, 80)}
    lista = list(zonas(rastreadas, 5, margen_frames=0))
    for z in lista[1:4]:
        assert z.revisar
        # La caja cubre de la última a la siguiente posición conocida.
        assert z.mascara[20:100, 20:160].all()
    assert not lista[0].revisar and not lista[4].revisar


def test_perdido_en_el_frame_rastreado_mismo() -> None:
    lista = list(zonas({0: cuadro(20, 20), 1: vacia(), 2: cuadro(30, 20)}, 3, margen_frames=0))
    assert lista[1].revisar and lista[1].mascara[20:40, 20:50].all()


def test_sin_objeto_en_ningun_frame_marca_todo_para_revisar() -> None:
    lista = list(zonas({0: vacia(), 3: vacia()}, 4))
    assert len(lista) == 4
    assert all(z.revisar and not z.mascara.any() for z in lista)


def test_margen_de_frames_antes_y_despues() -> None:
    rastreadas = {i: (cuadro(50, 50) if 10 <= i <= 12 else vacia()) for i in range(20)}
    lista = list(zonas(rastreadas, 20, margen_frames=5))
    con_zona = [z.frame for z in lista if z.mascara.any()]
    assert con_zona == list(range(5, 18))
    assert not any(z.revisar for z in lista)


@pytest.mark.parametrize("margen", [0, pistas.MARGEN_FRAMES_MAX])
def test_margen_en_los_limites(margen: int) -> None:
    lista = list(zonas({0: vacia(), 1: cuadro(50, 50), 2: vacia()}, 3, margen_frames=margen))
    assert bool(lista[0].mascara.any()) is (margen > 0)


@pytest.mark.parametrize("margen", [-1, pistas.MARGEN_FRAMES_MAX + 1])
def test_margen_fuera_de_rango(margen: int) -> None:
    assert codigo_de(zonas, {0: cuadro(1, 1)}, 1, margen_frames=margen) is Codigo.VALIDACION


def test_un_frame_por_cada_frame_del_video() -> None:
    lista = list(zonas({0: cuadro(10, 10), 9: cuadro(30, 10)}, 10))
    assert [z.frame for z in lista] == list(range(10))


@pytest.mark.parametrize(
    ("rastreadas", "total"),
    [
        ({}, 5),
        ({0: cuadro(1, 1), 1: np.zeros((10, 10), dtype=bool)}, 5),
        ({0: np.zeros((4, 4, 3), dtype=bool)}, 1),
        ({0: np.zeros((0, 4), dtype=bool)}, 1),
        ({0: cuadro(1, 1).astype(np.uint8)}, 1),
        ({5: cuadro(1, 1)}, 5),
        ({-1: cuadro(1, 1)}, 5),
    ],
)
def test_entradas_invalidas(rastreadas: dict[int, Mascara], total: int) -> None:
    assert codigo_de(zonas, rastreadas, total) is Codigo.VALIDACION


# --- a_resolucion -------------------------------------------------------------------------------


def test_misma_resolucion_es_copia() -> None:
    m = cuadro(5, 5)
    copia = a_resolucion(m, ALTO, ANCHO)
    assert np.array_equal(copia, m) and copia is not m


@pytest.mark.parametrize(("alto", "ancho"), [(0, 10), (10, 0), (-1, 5)])
def test_resolucion_invalida(alto: int, ancho: int) -> None:
    assert codigo_de(a_resolucion, cuadro(1, 1), alto, ancho) is Codigo.VALIDACION


@given(
    st.integers(4, 40), st.integers(4, 40), st.integers(2, 120), st.integers(2, 120),
    st.integers(0, 39), st.integers(0, 39),
)
def test_escalar_nunca_destapa(alto0: int, ancho0: int, alto: int, ancho: int, y: int, x: int) -> None:
    """Todo píxel real que toque un píxel cubierto del proxy queda cubierto, al ampliar o reducir."""
    m = np.zeros((alto0, ancho0), dtype=bool)
    y, x = y % alto0, x % ancho0
    m[y, x] = True
    salida = a_resolucion(m, alto, ancho)
    # El píxel (y, x) del proxy ocupa este rectángulo en la imagen real.
    sy, sx = alto / alto0, ancho / ancho0
    y0, y1 = math.floor(y * sy), max(math.floor(y * sy) + 1, math.ceil((y + 1) * sy))
    x0, x1 = math.floor(x * sx), max(math.floor(x * sx) + 1, math.ceil((x + 1) * sx))
    assert salida[y0:y1, x0:x1].all()
