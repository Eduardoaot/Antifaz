"""Frames por tubería con ffmpeg. Un Python verificado por hash hace de ffmpeg falso."""
from __future__ import annotations

import sys
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest

from revisor import herramientas
from revisor.errores import Codigo, ErrorRevisor
from revisor.herramientas import Esperado, Herramienta, Herramientas, hash_archivo

PYTHON = Path(sys.executable)

# Cada guion recibe sus argumentos como sys.argv[1:], igual que ffmpeg recibiría los suyos.
EMITIR = (
    "import sys\n"
    "w, h, n, resto, codigo = map(int, sys.argv[1:6])\n"
    "out = sys.stdout.buffer\n"
    "for i in range(n):\n"
    "    out.write(bytes([i % 256]) * (w * h * 3))\n"
    "out.write(b'x' * resto)\n"
    "out.flush()\n"
    "sys.exit(codigo)\n"
)
SIN_FIN = "import sys, time\nout = sys.stdout.buffer\nwhile True:\n    out.write(bytes(48)); out.flush(); time.sleep(0.01)\n"
DORMIR = "import time\ntime.sleep(60)\n"
CONTAR = (
    "import sys\n"
    "esperado, codigo = int(sys.argv[1]), int(sys.argv[2])\n"
    "total = 0\n"
    "while bloque := sys.stdin.buffer.read(65536):\n"
    "    total += len(bloque)\n"
    "sys.exit(codigo if total == esperado else 9)\n"
)
SALIR = "import sys\nsys.exit(0)\n"


def falso(guion: str) -> Herramientas:
    esperados = {Herramienta.FFMPEG: Esperado(PYTHON.name, hash_archivo(PYTHON))}
    return Herramientas(PYTHON.parent, esperados, {Herramienta.FFMPEG: ("-I", "-c", guion)})


def frames(n: int, alto: int = 3, ancho: int = 4) -> Iterator[np.ndarray]:
    for i in range(n):
        yield np.full((alto, ancho, 3), i, dtype=np.uint8)


# --- leer_frames --------------------------------------------------------------------------------


def test_lee_cada_frame_completo() -> None:
    leidos = list(falso(EMITIR).leer_frames(["4", "3", "5", "0", "0"], 4, 3, 10, 30))
    assert len(leidos) == 5
    assert all(f.shape == (3, 4, 3) and f.dtype == np.uint8 for f in leidos)
    assert [int(f[0, 0, 0]) for f in leidos] == [0, 1, 2, 3, 4]


def test_frame_incompleto_es_error() -> None:
    with pytest.raises(ErrorRevisor) as e:
        list(falso(EMITIR).leer_frames(["4", "3", "2", "7", "0"], 4, 3, 10, 30))
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO
    assert "incompleto" in e.value.detalle


def test_mas_frames_de_los_esperados_es_error() -> None:
    with pytest.raises(ErrorRevisor) as e:
        list(falso(EMITIR).leer_frames(["4", "3", "6", "0", "0"], 4, 3, 5, 30))
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_codigo_de_salida_no_cero_tras_frames_es_error() -> None:
    """FCL-008: aunque ya llegaron frames, si ffmpeg falla al final no se da por bueno."""
    with pytest.raises(ErrorRevisor) as e:
        list(falso(EMITIR).leer_frames(["4", "3", "2", "0", "1"], 4, 3, 10, 30))
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_ningun_frame_es_error() -> None:
    with pytest.raises(ErrorRevisor) as e:
        list(falso(EMITIR).leer_frames(["4", "3", "0", "0", "0"], 4, 3, 10, 30))
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_tiempo_agotado_mata_el_proceso() -> None:
    inicio = time.monotonic()
    with pytest.raises(ErrorRevisor) as e:
        list(falso(DORMIR).leer_frames([], 4, 3, 10, 1))
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO
    assert time.monotonic() - inicio < 15


def test_dejar_de_leer_termina_el_proceso() -> None:
    lector = falso(SIN_FIN).leer_frames([], 4, 4, 1000, 60)
    assert next(lector).shape == (4, 4, 3)
    inicio = time.monotonic()
    lector.close()
    assert time.monotonic() - inicio < 10


@pytest.mark.parametrize(
    ("ancho", "alto", "maximo", "tiempo"),
    [
        (0, 3, 10, 30),
        (4, 0, 10, 30),
        (herramientas.LADO_FRAME_MAX + 1, 3, 10, 30),
        (4, 3, 0, 30),
        (4, 3, herramientas.FRAMES_MAX + 1, 30),
        (4, 3, 10, 0.5),
        (4, 3, 10, float("nan")),
    ],
)
def test_lectura_valida_parametros_antes_de_arrancar(ancho: int, alto: int, maximo: int, tiempo: float) -> None:
    with pytest.raises(ErrorRevisor) as e:
        falso(DORMIR).leer_frames([], ancho, alto, maximo, tiempo)
    assert e.value.codigo is Codigo.VALIDACION


def test_lectura_en_los_limites() -> None:
    caja = falso(EMITIR)
    assert len(list(caja.leer_frames(["1", "1", "1", "0", "0"], 1, 1, 1, 30))) == 1
    grande = herramientas.LADO_FRAME_MAX
    assert len(list(caja.leer_frames([str(grande), "1", "1", "0", "0"], grande, 1, herramientas.FRAMES_MAX, 30))) == 1


# --- escribir_frames ----------------------------------------------------------------------------


def test_escribe_todos_los_frames() -> None:
    assert falso(CONTAR).escribir_frames([str(5 * 3 * 4 * 3), "0"], frames(5), 4, 3, 30) == 5


def test_codigo_de_salida_no_cero_al_escribir_es_error() -> None:
    with pytest.raises(ErrorRevisor) as e:
        falso(CONTAR).escribir_frames([str(2 * 3 * 4 * 3), "1"], frames(2), 4, 3, 30)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_proceso_que_cierra_la_entrada_es_error() -> None:
    grandes = (np.zeros((512, 512, 3), dtype=np.uint8) for _ in range(200))
    with pytest.raises(ErrorRevisor) as e:
        falso(SALIR).escribir_frames([], grandes, 512, 512, 30)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


@pytest.mark.parametrize(
    "malo",
    [np.zeros((3, 5, 3), dtype=np.uint8), np.zeros((3, 4), dtype=np.uint8), np.zeros((3, 4, 3), dtype=np.float32)],
)
def test_frame_con_forma_o_tipo_inesperado(malo: np.ndarray) -> None:
    with pytest.raises(ErrorRevisor) as e:
        falso(CONTAR).escribir_frames(["0", "0"], [next(frames(1)), malo], 4, 3, 30)
    assert e.value.codigo is Codigo.VALIDACION


def test_sin_frames_para_escribir() -> None:
    with pytest.raises(ErrorRevisor) as e:
        falso(CONTAR).escribir_frames(["0", "0"], [], 4, 3, 30)
    assert e.value.codigo is Codigo.VALIDACION


def test_error_del_productor_termina_el_proceso() -> None:
    def con_error() -> Iterator[np.ndarray]:
        yield np.zeros((3, 4, 3), dtype=np.uint8)
        raise ErrorRevisor(Codigo.MEMORIA_INSUFICIENTE, "prueba")

    inicio = time.monotonic()
    with pytest.raises(ErrorRevisor) as e:
        falso(CONTAR).escribir_frames(["0", "0"], con_error(), 4, 3, 30)
    assert e.value.codigo is Codigo.MEMORIA_INSUFICIENTE
    assert time.monotonic() - inicio < 10


def test_tiempo_agotado_al_escribir() -> None:
    def lentos() -> Iterator[np.ndarray]:
        for _ in range(5):
            time.sleep(0.6)
            yield np.zeros((3, 4, 3), dtype=np.uint8)

    with pytest.raises(ErrorRevisor) as e:
        falso(CONTAR).escribir_frames(["0", "0"], lentos(), 4, 3, 1)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_no_arranca_si_el_hash_no_coincide() -> None:
    caja = Herramientas(PYTHON.parent, {Herramienta.FFMPEG: Esperado(PYTHON.name, "0" * 64)})
    with pytest.raises(ErrorRevisor) as e:
        caja.escribir_frames([], frames(1), 4, 3, 30)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE
