"""Selección por clic y máscaras exactas."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import efectos, exportar, segmentar
from revisor.caras import ModeloNoDisponible
from revisor.segmentar import Mascara, Segmentador, mascara_desde
from revisor.servidor import Sesion, atender

from .conftest import DATOS, MODELOS, guardar, imagen_prueba, oculto


def _pedir(sesion: Sesion, comando: dict[str, Any]) -> tuple[dict[str, Any], bytes | None]:
    return atender(sesion, json.dumps({"id": 1, "comando": comando}).encode())  # type: ignore[return-value]


def _abrir(sesion: Sesion, ruta: Path) -> str:
    return _pedir(sesion, {"tipo": "abrir_imagen", "ruta": str(ruta)})[0]["datos"]["imagen_id"]


def test_modelo_real_un_clic_da_la_silueta_de_la_cara() -> None:
    pixeles = np.array(Image.open(DATOS / "astronauta.jpg").convert("RGB"))
    s = segmentar.segmentador_de(MODELOS)
    mascara = s.segmentar(s.preparar(pixeles), 230, 100)
    assert mascara is not None
    assert mascara.recorte[100 - mascara.y, 230 - mascara.x]
    area = mascara.recorte.sum() / (512 * 512)
    assert 0.01 < area < 0.2
    assert mascara.recorte.shape == (mascara.alto, mascara.ancho)


def test_imagen_alargada_y_diminuta() -> None:
    s = segmentar.segmentador_de(MODELOS)
    for alto, ancho in ((40, 900), (900, 40), (1, 1)):
        preparado = s.preparar(np.full((alto, ancho, 3), 200, dtype=np.uint8))
        assert preparado["nuevo_alto"] >= 1 and preparado["nuevo_ancho"] >= 1
        mascara = s.segmentar(preparado, 0, 0)
        assert mascara is None or (mascara.x + mascara.ancho <= ancho and mascara.y + mascara.alto <= alto)


def test_silueta_vacia_es_none() -> None:
    assert mascara_desde(np.full((256, 256), -5.0, dtype=np.float32), 100, 100, 50, 50) is None


def test_silueta_se_escala_al_tamano_original() -> None:
    logits = np.full((256, 256), -5.0, dtype=np.float32)
    logits[0:64, 0:64] = 5.0
    m = mascara_desde(logits, 1024, 1024, 2000, 2000)
    assert m is not None
    assert m.x == 0 and m.y == 0
    assert 400 < m.ancho < 600


def test_modelo_alterado_no_se_usa(tmp_path: Path) -> None:
    with pytest.raises(ModeloNoDisponible):
        Segmentador(tmp_path)


def _circulo(lado: int = 60) -> np.ndarray:
    yy, xx = np.ogrid[:lado, :lado]
    return (xx - lado / 2) ** 2 + (yy - lado / 2) ** 2 < (lado / 2) ** 2


@pytest.mark.parametrize("efecto", ["solido", "difuminado", "pixelado"])
def test_mascara_solo_cambia_la_silueta_y_su_margen(efecto: str) -> None:
    a = np.random.default_rng(1).integers(0, 256, size=(200, 200, 3), dtype=np.uint8)
    o = oculto(70, 70, 60, 60, efecto, mascara_id="m", dilatacion_px=8, dilatacion_pct=0.0)
    salida, regiones = efectos.aplicar(a, [o], {"m": _circulo()})
    x0, y0, x1, y1 = regiones[0]
    # La esquina de la caja, lejos del círculo, se conserva.
    assert np.array_equal(salida[y0, x0], a[y0, x0])
    assert not np.array_equal(salida[100, 100], a[100, 100])
    # Margen: justo fuera del círculo original también se oculta.
    assert not np.array_equal(salida[100, 70 - 4], a[100, 70 - 4])
    fuera = np.ones(a.shape[:2], dtype=bool)
    fuera[y0:y1, x0:x1] = False
    assert np.array_equal(salida[fuera], a[fuera])


def test_mascara_solida_es_irreversible() -> None:
    a = np.random.default_rng(1).integers(0, 256, size=(200, 200, 3), dtype=np.uint8)
    b = a.copy()
    b[85:115, 85:115] = 255 - b[85:115, 85:115]
    o = oculto(70, 70, 60, 60, "solido", mascara_id="m")
    assert np.array_equal(efectos.aplicar(a, [o], {"m": _circulo()})[0], efectos.aplicar(b, [o], {"m": _circulo()})[0])


def test_si_la_mascara_se_perdio_se_oculta_toda_la_caja() -> None:
    """Ante la duda, ocultar de más."""
    a = np.full((200, 200, 3), 200, dtype=np.uint8)
    salida, regiones = efectos.aplicar(a, [oculto(70, 70, 60, 60, "solido", mascara_id="perdida")])
    x0, y0, x1, y1 = regiones[0]
    assert salida[y0:y1, x0:x1].max() == 0


def test_mascara_con_tamano_que_no_coincide_oculta_toda_la_caja() -> None:
    a = np.full((200, 200, 3), 200, dtype=np.uint8)
    salida, regiones = efectos.aplicar(a, [oculto(70, 70, 60, 60, "solido", mascara_id="m")], {"m": np.ones((5, 5), dtype=bool)})
    x0, y0, x1, y1 = regiones[0]
    assert salida[y0:y1, x0:x1].max() == 0


def test_difuminado_no_toma_color_de_una_silueta_solida_vecina() -> None:
    a = np.full((200, 400, 3), 100, dtype=np.uint8)
    b = a.copy()
    b[85:115, 165:195] = 255
    lista = [oculto(60, 70, 60, 60, "difuminado"), oculto(150, 70, 60, 60, "solido", mascara_id="m")]
    assert np.array_equal(efectos.aplicar(a, lista, {"m": _circulo()})[0], efectos.aplicar(b, lista, {"m": _circulo()})[0])


def test_alfa_solo_cambia_dentro_de_la_silueta() -> None:
    a = np.full((200, 200, 4), 200, dtype=np.uint8)
    a[:, :, 3] = 100
    o = oculto(70, 70, 60, 60, "solido", mascara_id="m", dilatacion_pct=0.0)
    salida, regiones = efectos.aplicar(a, [o], {"m": _circulo()})
    assert salida[100, 100, 3] == 255
    assert salida[regiones[0][1], regiones[0][0], 3] == 100


class FalsoSegmentador:
    def __init__(self, resultado: Mascara | None) -> None:
        self.resultado = resultado
        self.preparaciones = 0

    def preparar(self, _p: Any) -> dict[str, Any]:
        self.preparaciones += 1
        return {}

    def segmentar(self, _pre: Any, _x: int, _y: int) -> Mascara | None:
        return self.resultado


def test_comando_segmentar_y_exportar_con_la_silueta(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    falso = FalsoSegmentador(Mascara(10, 10, 60, 60, _circulo()))
    monkeypatch.setattr(segmentar, "segmentador_de", lambda _c: falso)
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (200, 200), (200, 200, 200))))
    respuesta, _ = _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": 40, "y": 40})
    assert respuesta["ok"]
    datos = respuesta["datos"]
    assert datos["caja"] == {"x": 10, "y": 10, "ancho": 60, "alto": 60}
    _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": 41, "y": 41})
    assert falso.preparaciones == 1, "el encoder debe correr una sola vez por imagen"

    oculta = {"x": 10, "y": 10, "ancho": 60, "alto": 60, "efecto": "solido", "mascara_id": datos["mascara_id"]}
    destino = tmp_path / "s.png"
    assert _pedir(sesion, {"tipo": "exportar", "imagen_id": imagen_id, "ocultamientos": [oculta], "ruta_destino": str(destino)})[0]["ok"]
    with Image.open(destino) as salida:
        assert salida.getpixel((40, 40)) == (0, 0, 0)
    vista = _pedir(sesion, {"tipo": "previsualizar", "imagen_id": imagen_id, "ocultamientos": [oculta]})
    assert vista[0]["ok"]

    assert _pedir(sesion, {"tipo": "cerrar", "imagen_id": imagen_id})[0]["ok"]
    assert imagen_id not in sesion.mascaras and imagen_id not in sesion.preparados


@pytest.mark.parametrize(("x", "y"), [(200, 0), (0, 200), (500, 500)])
def test_clic_fuera_de_la_imagen(tmp_path: Path, x: int, y: int) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", imagen_prueba(200, 200)))
    assert _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": x, "y": y})[0]["error"]["codigo"] == "REGION_FUERA_DE_IMAGEN"


@pytest.mark.parametrize("malo", [-1, 1.5, "1", None, True, 2**64])
def test_coordenadas_invalidas(tmp_path: Path, malo: Any) -> None:
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", imagen_prueba(200, 200)))
    assert _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": malo, "y": 0})[0]["error"]["codigo"] == "VALIDACION"


def test_sin_objeto_en_el_punto(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(segmentar, "segmentador_de", lambda _c: FalsoSegmentador(None))
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", imagen_prueba(200, 200)))
    assert _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": 1, "y": 1})[0]["error"]["codigo"] == "SIN_OBJETO"


def test_sin_modelo_da_error_tipado(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def falla(_c: Path) -> None:
        raise ModeloNoDisponible("falta")

    monkeypatch.setattr(segmentar, "segmentador_de", falla)
    sesion = Sesion(MODELOS)
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", imagen_prueba(200, 200)))
    assert _pedir(sesion, {"tipo": "segmentar", "imagen_id": imagen_id, "x": 1, "y": 1})[0]["error"]["codigo"] == "MODELO_NO_DISPONIBLE"


def test_imagen_cerrada(tmp_path: Path) -> None:
    assert _pedir(Sesion(MODELOS), {"tipo": "segmentar", "imagen_id": "x", "x": 1, "y": 1})[0]["error"]["codigo"] == "IMAGEN_NO_ABIERTA"


def test_exportar_usa_las_mascaras(tmp_path: Path) -> None:
    from revisor import cargador

    imagen = cargador.abrir(str(guardar(tmp_path / "o.png", Image.new("RGB", (200, 200), (200, 200, 200)))))
    destino = tmp_path / "s.png"
    o = oculto(70, 70, 60, 60, "solido", mascara_id="m", dilatacion_pct=0.0)
    exportar.exportar(imagen, [o], str(destino), mascaras={"m": _circulo()})
    with Image.open(destino) as salida:
        assert salida.getpixel((100, 100)) == (0, 0, 0)
        assert salida.getpixel((62, 62)) == (200, 200, 200)
