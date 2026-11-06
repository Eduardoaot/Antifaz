"""Seguimiento con EdgeTAM: validación, pesos verificados y una corrida real sin red."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from revisor import seguimiento
from revisor.errores import Codigo, ErrorRevisor
from revisor.herramientas import FRAMES_MAX
from revisor.seguimiento import ARCHIVOS_EDGETAM, Caja, Punto, validar, verificar_pesos

from .conftest import MODELOS

ALTO, ANCHO = 240, 426


def video(n: int = 3, alto: int = ALTO, ancho: int = ANCHO) -> list[np.ndarray]:
    return [np.zeros((alto, ancho, 3), dtype=np.uint8) for _ in range(n)]


def codigo(*args: object) -> Codigo:
    with pytest.raises(ErrorRevisor) as e:
        validar(*args)  # type: ignore[arg-type]
    return e.value.codigo


# --- validar ------------------------------------------------------------------------------------


def test_entrada_valida() -> None:
    assert validar(video(), 1, Punto(0, 0)) == (ALTO, ANCHO)
    assert validar(video(), 2, Caja(0, 0, ANCHO, ALTO)) == (ALTO, ANCHO)


@pytest.mark.parametrize("n", [0, FRAMES_MAX + 1])
def test_cantidad_de_frames_fuera_de_rango(n: int) -> None:
    frames = video(1) * n
    assert codigo(frames, 0, Punto(1, 1)) is Codigo.VALIDACION


def test_un_frame_es_valido() -> None:
    assert validar(video(1), 0, Punto(1, 1)) == (ALTO, ANCHO)


@pytest.mark.parametrize(
    ("alto", "ancho"),
    [(seguimiento.PROXY_LADO_MIN - 1, 426), (seguimiento.PROXY_LADO_MAX + 1, 1300), (1300, 239)],
)
def test_proxy_fuera_de_rango(alto: int, ancho: int) -> None:
    assert codigo(video(1, alto, ancho), 0, Punto(1, 1)) is Codigo.VALIDACION


@pytest.mark.parametrize(
    ("alto", "ancho"), [(seguimiento.PROXY_LADO_MIN, 426), (seguimiento.PROXY_LADO_MAX, 1280), (1280, 720)]
)
def test_proxy_en_los_limites(alto: int, ancho: int) -> None:
    assert validar(video(1, alto, ancho), 0, Punto(1, 1)) == (alto, ancho)


def test_frames_distintos() -> None:
    frames = video(2)
    frames.append(np.zeros((ALTO, ANCHO + 2, 3), dtype=np.uint8))
    assert codigo(frames, 0, Punto(1, 1)) is Codigo.VALIDACION
    frames = video(2) + [np.zeros((ALTO, ANCHO, 3), dtype=np.float32)]
    assert codigo(frames, 0, Punto(1, 1)) is Codigo.VALIDACION


def test_frame_que_no_es_rgb() -> None:
    assert codigo([np.zeros((ALTO, ANCHO), dtype=np.uint8)], 0, Punto(1, 1)) is Codigo.VALIDACION
    assert codigo([np.zeros((ALTO, ANCHO, 4), dtype=np.uint8)], 0, Punto(1, 1)) is Codigo.VALIDACION


@pytest.mark.parametrize("inicio", [-1, 3])
def test_frame_inicial_fuera_del_video(inicio: int) -> None:
    assert codigo(video(3), inicio, Punto(1, 1)) is Codigo.VALIDACION


@pytest.mark.parametrize("punto", [Punto(-1, 0), Punto(0, -1), Punto(ANCHO, 0), Punto(0, ALTO)])
def test_punto_fuera(punto: Punto) -> None:
    assert codigo(video(), 0, punto) is Codigo.REGION_FUERA_DE_IMAGEN


@pytest.mark.parametrize(
    "caja",
    [Caja(-1, 0, 10, 10), Caja(0, 0, ANCHO + 1, 10), Caja(5, 5, 5, 10), Caja(5, 5, 10, 5), Caja(10, 0, 5, 10)],
)
def test_caja_fuera_o_vacia(caja: Caja) -> None:
    assert codigo(video(), 0, caja) is Codigo.REGION_FUERA_DE_IMAGEN


# --- pesos --------------------------------------------------------------------------------------


def _copiar_pesos_falsos(carpeta: Path) -> None:
    destino = carpeta / seguimiento.CARPETA_EDGETAM
    destino.mkdir()
    for nombre in ARCHIVOS_EDGETAM:
        (destino / nombre).write_bytes(b"falso")


def test_pesos_ausentes(tmp_path: Path) -> None:
    with pytest.raises(ErrorRevisor) as e:
        verificar_pesos(tmp_path)
    assert e.value.codigo is Codigo.SEGUIMIENTO_NO_DISPONIBLE
    assert str(tmp_path) not in e.value.detalle


def test_pesos_alterados(tmp_path: Path) -> None:
    _copiar_pesos_falsos(tmp_path)
    with pytest.raises(ErrorRevisor) as e:
        seguimiento.SeguidorEdgeTam(tmp_path)
    assert e.value.codigo is Codigo.SEGUIMIENTO_NO_DISPONIBLE
    assert "hash" in e.value.detalle


# --- corrida real -------------------------------------------------------------------------------

HAY_PESOS = (MODELOS / seguimiento.CARPETA_EDGETAM / "model.safetensors").exists()

# Un cuadrado con textura que cruza el frame. Se elige con un clic en el frame 6 de 12, así se
# prueba la propagación hacia atrás y hacia adelante. Corre con la red bloqueada.
GUION = r"""
import json, sys
from pathlib import Path
import numpy as np
from revisor.red import bloquear_red
bloquear_red()
from revisor.seguimiento import Punto, SeguidorEdgeTam

alto, ancho, lado, n = 240, 426, 60, 12
rng = np.random.default_rng(3)
fondo = rng.integers(90, 110, (alto, ancho, 3), dtype=np.uint8)
textura = rng.integers(0, 255, (lado, lado, 3), dtype=np.uint8)
textura[:, :, 0] = 230
frames, verdades = [], []
for i in range(n):
    x, y = 30 + i * 25, 90
    f = fondo.copy(); f[y:y + lado, x:x + lado] = textura
    v = np.zeros((alto, ancho), bool); v[y:y + lado, x:x + lado] = True
    frames.append(f); verdades.append(v)
avances = []
mascaras = SeguidorEdgeTam(Path(sys.argv[1])).seguir(
    frames, 6, Punto(30 + 6 * 25 + 30, 120), lambda hechos, total: avances.append((hechos, total))
)
cobertura = [float((mascaras[i] & verdades[i]).sum() / verdades[i].sum()) for i in range(n)]
print(json.dumps({"frames": sorted(mascaras), "cobertura": cobertura, "avances": avances[-1]}))
"""


@pytest.mark.modelo
@pytest.mark.skipif(not HAY_PESOS, reason="sin pesos de EdgeTAM descargados")
def test_sigue_en_ambos_sentidos_sin_red() -> None:
    hecho = subprocess.run(
        [sys.executable, "-c", GUION, str(MODELOS)],
        capture_output=True, text=True, encoding="utf-8", timeout=600,
        cwd=Path(__file__).parent.parent,
    )
    assert hecho.returncode == 0, hecho.stderr[-3000:]
    resultado = json.loads(hecho.stdout.strip().splitlines()[-1])
    assert resultado["frames"] == list(range(12))
    assert resultado["avances"] == [12, 12]
    # El objeto se sigue en todos los frames, antes y después del clic.
    assert min(resultado["cobertura"]) > 0.8, resultado["cobertura"]
