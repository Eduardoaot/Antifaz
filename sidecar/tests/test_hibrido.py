"""Seguidor híbrido: EdgeTAM sobre keyframes y CSRT en los huecos, sin pesos reales."""
from __future__ import annotations

import numpy as np
import pytest

from revisor import seguimiento
from revisor.errores import Codigo, ErrorRevisor
from revisor.seguimiento import Caja, Punto, SeguidorHibrido, _csrt_disponible, _indices_clave


class EdgeTamFalso:
    """Simula EdgeTAM sobre un video (posiblemente solo keyframes)."""

    def __init__(self) -> None:
        self.llamadas: list[int] = []

    def seguir(self, frames, frame_inicio, indicacion, avance=None):  # noqa: ANN001
        self.llamadas.append(len(frames))
        alto, ancho = int(frames[0].shape[0]), int(frames[0].shape[1])
        mascaras: dict[int, np.ndarray] = {}
        # Propaga un disco desde la indicación inicial a lo largo del "video" de keyframes.
        match indicacion:
            case Punto(x=x, y=y):
                cx, cy = float(x), float(y)
            case Caja(x0=x0, y0=y0, x1=x1, y1=y1):
                cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        for i in range(len(frames)):
            # En el video sintético el cuadrado avanza ~8 px por frame real; aquí cada
            # keyframe equivale a varios frames: el test solo exige máscaras no vacías.
            m = np.zeros((alto, ancho), dtype=bool)
            yy, xx = np.ogrid[:alto, :ancho]
            m[(xx - cx) ** 2 + (yy - cy) ** 2 <= 12**2] = True
            mascaras[i] = m
            if avance is not None:
                avance(i + 1, len(frames))
            cx += 4.0
        return mascaras


def video_cuadrado(n: int = 12, alto: int = 240, ancho: int = 320, lado: int = 40) -> list[np.ndarray]:
    rng = np.random.default_rng(0)
    fondo = rng.integers(40, 60, (alto, ancho, 3), dtype=np.uint8)
    textura = rng.integers(0, 255, (lado, lado, 3), dtype=np.uint8)
    textura[:, :, 0] = 230
    frames = []
    for i in range(n):
        f = fondo.copy()
        x, y = 20 + i * 8, 100
        f[y : y + lado, x : x + lado] = textura
        frames.append(f)
    return frames


def test_indices_clave_incluye_extremos_e_inicio() -> None:
    assert _indices_clave(12, 5, 4)[0] == 0
    assert _indices_clave(12, 5, 4)[-1] == 11
    assert 5 in _indices_clave(12, 5, 4)


@pytest.mark.skipif(not _csrt_disponible(), reason="opencv sin contrib/CSRT")
def test_paso_fuera_de_rango() -> None:
    with pytest.raises(ErrorRevisor) as e:
        SeguidorHibrido(EdgeTamFalso(), paso=0)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.VALIDACION


@pytest.mark.skipif(not _csrt_disponible(), reason="opencv sin contrib/CSRT")
def test_una_sola_llamada_edgetam_sobre_keyframes() -> None:
    frames = video_cuadrado()
    avances: list[tuple[int, int]] = []
    falso = EdgeTamFalso()
    mascaras = SeguidorHibrido(falso, paso=4).seguir(  # type: ignore[arg-type]
        frames, 0, Punto(40, 120), lambda h, t: avances.append((h, t))
    )
    assert sorted(mascaras) == list(range(len(frames)))
    assert all(m.any() for m in mascaras.values())
    assert avances[-1] == (len(frames), len(frames))
    # Una sola sesión de EdgeTAM con los keyframes, no una por frame.
    assert falso.llamadas == [len(_indices_clave(len(frames), 0, 4))]


@pytest.mark.skipif(not _csrt_disponible(), reason="opencv sin contrib/CSRT")
def test_propaga_hacia_atras_desde_el_medio() -> None:
    frames = video_cuadrado()
    mascaras = SeguidorHibrido(EdgeTamFalso(), paso=3).seguir(  # type: ignore[arg-type]
        frames, 6, Punto(20 + 6 * 8 + 20, 120)
    )
    assert sorted(mascaras) == list(range(len(frames)))
    assert mascaras[0].any() and mascaras[len(frames) - 1].any()


@pytest.mark.skipif(not _csrt_disponible(), reason="opencv sin contrib/CSRT")
def test_keyframe_vacio_rellena_hueco_vacio() -> None:
    class PrimeroVacio(EdgeTamFalso):
        def seguir(self, frames, frame_inicio, indicacion, avance=None):  # noqa: ANN001
            self.llamadas.append(len(frames))
            alto, ancho = int(frames[0].shape[0]), int(frames[0].shape[1])
            mascaras = super().seguir(frames, frame_inicio, indicacion, avance)
            mascaras[0] = np.zeros((alto, ancho), dtype=bool)
            return mascaras

    frames = video_cuadrado(8)
    mascaras = SeguidorHibrido(PrimeroVacio(), paso=4).seguir(frames, 0, Punto(40, 120))  # type: ignore[arg-type]
    assert sorted(mascaras) == list(range(8))
    assert not mascaras[0].any()
    # Sin silueta en el keyframe inicial, CSRT ida no aporta; la vuelta desde el siguiente sí.
    assert mascaras[3].any()


def test_constantes_de_paso_en_rangos() -> None:
    assert seguimiento.PASO_CLAVE_MIN <= seguimiento.PASO_CLAVE_DEFAULT <= seguimiento.PASO_CLAVE_MAX


@pytest.mark.skipif(not _csrt_disponible(), reason="opencv sin contrib/CSRT")
def test_relleno_bidireccional_une_ida_y_vuelta() -> None:
    """Con movimiento lateral, el relleno no deja el hueco vacío entre claves."""
    frames = video_cuadrado(16)
    mascaras = SeguidorHibrido(EdgeTamFalso(), paso=5).seguir(  # type: ignore[arg-type]
        frames, 0, Punto(40, 120)
    )
    # Frames intermedios (no keyframe) deben tener cobertura.
    claves = set(_indices_clave(16, 0, 5))
    intermedios = [i for i in range(16) if i not in claves]
    assert intermedios and all(mascaras[i].any() for i in intermedios)


def test_cerrar_parpadeos_tapa_hueco_de_un_frame() -> None:
    alto, ancho = 40, 40
    vacia = np.zeros((alto, ancho), dtype=bool)
    llena = vacia.copy()
    llena[10:20, 10:20] = True
    mascaras = {0: llena.copy(), 1: vacia.copy(), 2: llena.copy()}
    seguimiento._cerrar_parpadeos(mascaras, 3)
    assert mascaras[1].any()
    assert mascaras[1][10:20, 10:20].all()
