"""Protocolo, fuzzing y proceso real: un mensaje o archivo malo nunca cierra el sidecar."""
from __future__ import annotations

import io
import json
import logging
import os
import random
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from revisor import cargador
from revisor.errores import Codigo, ErrorRevisor
from revisor.servidor import Sesion, atender, servir

from .conftest import MODELOS, bytes_imagen, guardar, imagen_prueba

SIDECAR = Path(__file__).parent.parent


def _sesion() -> Sesion:
    return Sesion(MODELOS)


def _pedir(sesion: Sesion, comando: dict[str, Any], id_: int = 1) -> tuple[dict[str, Any], bytes | None]:
    return atender(sesion, json.dumps({"id": id_, "comando": comando}).encode())  # type: ignore[return-value]


def _abrir(sesion: Sesion, ruta: Path) -> str:
    respuesta, _ = _pedir(sesion, {"tipo": "abrir_imagen", "ruta": str(ruta)})
    assert respuesta["ok"], respuesta
    return respuesta["datos"]["imagen_id"]


def test_ping() -> None:
    assert _pedir(_sesion(), {"tipo": "ping"})[0] == {"id": 1, "ok": True, "datos": {"protocolo": 1}}


@pytest.mark.parametrize(
    ("contenido", "codigo"),
    [
        (b"", "MENSAJE_INVALIDO"),
        (b"no es json", "MENSAJE_INVALIDO"),
        (b"\xff\xfe\x00", "MENSAJE_INVALIDO"),
        (b'{"id":1,"comando":{"tipo":"analizar","imagen_id":"a","umbral_confianza":NaN}}', "MENSAJE_INVALIDO"),
        (b'{"id":1,"comando":{"tipo":"analizar","imagen_id":"a","umbral_confianza":Infinity}}', "MENSAJE_INVALIDO"),
        (b"null", "VALIDACION"),
        (b"[]", "VALIDACION"),
        (b"5", "VALIDACION"),
        (b"{}", "VALIDACION"),
        (b'{"id":1,"comando":{"tipo":"desconocido"}}', "VALIDACION"),
        (b'{"id":1,"comando":{"tipo":"abrir_imagen","ruta":""}}', "VALIDACION"),
        (b"[" * 100000, "MENSAJE_INVALIDO"),
    ],
)
def test_mensajes_invalidos_dan_error_tipado(contenido: bytes, codigo: str) -> None:
    respuesta, binario = atender(_sesion(), contenido)
    assert respuesta["ok"] is False
    assert respuesta["error"]["codigo"] == codigo  # type: ignore[index]
    assert binario is None


def test_id_se_devuelve_si_es_valido_aunque_el_comando_no_lo_sea() -> None:
    assert atender(_sesion(), b'{"id":9,"comando":{}}')[0]["id"] == 9
    assert atender(_sesion(), b'{"id":"9","comando":{}}')[0]["id"] is None
    assert atender(_sesion(), b'{"id":true,"comando":{}}')[0]["id"] is None


@given(st.binary(max_size=2000))
def test_propiedad_bytes_al_azar_siempre_dan_respuesta(contenido: bytes) -> None:
    respuesta, _ = atender(_sesion(), contenido)
    assert respuesta["ok"] in (True, False)


_JSON = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False) | st.text(max_size=20),
    lambda hijos: st.lists(hijos, max_size=4) | st.dictionaries(st.text(max_size=10), hijos, max_size=4),
    max_leaves=12,
)


@given(_JSON, _JSON)
def test_propiedad_json_al_azar_nunca_cierra(id_: Any, comando: Any) -> None:
    respuesta, _ = atender(_sesion(), json.dumps({"id": id_, "comando": comando}).encode())
    assert respuesta["ok"] is False


def test_flujo_completo_y_cierre(tmp_path: Path) -> None:
    sesion = _sesion()
    origen = guardar(tmp_path / "o.jpg", imagen_prueba(200, 150))
    imagen_id = _abrir(sesion, origen)

    respuesta, binario = _pedir(sesion, {"tipo": "previsualizar", "imagen_id": imagen_id, "ocultamientos": [], "lado_max": 64})
    assert respuesta["datos"]["binario_bytes"] == len(binario or b"")
    assert (binario or b"").startswith(b"\xff\xd8")

    destino = tmp_path / "s.jpg"
    respuesta, _ = _pedir(sesion, {"tipo": "exportar", "imagen_id": imagen_id, "ocultamientos": [], "ruta_destino": str(destino)})
    assert respuesta["ok"]
    assert destino.exists()

    assert _pedir(sesion, {"tipo": "cerrar", "imagen_id": imagen_id})[0]["ok"]
    assert _pedir(sesion, {"tipo": "cerrar", "imagen_id": imagen_id})[0]["ok"]
    respuesta, _ = _pedir(sesion, {"tipo": "analizar", "imagen_id": imagen_id})
    assert respuesta["error"]["codigo"] == "IMAGEN_NO_ABIERTA"


def test_previsualizar_con_alfa_es_png(tmp_path: Path) -> None:
    sesion = _sesion()
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", imagen_prueba(modo="RGBA")))
    respuesta, binario = _pedir(sesion, {"tipo": "previsualizar", "imagen_id": imagen_id, "ocultamientos": []})
    assert respuesta["datos"]["mime"] == "image/png"
    assert (binario or b"").startswith(b"\x89PNG")


def test_previsualizacion_oculta_de_verdad(tmp_path: Path) -> None:
    from PIL import Image

    sesion = _sesion()
    imagen_id = _abrir(sesion, guardar(tmp_path / "o.png", Image.new("RGB", (100, 100), (255, 255, 255))))
    oculta = {"x": 40, "y": 40, "ancho": 20, "alto": 20, "efecto": "solido"}
    _, binario = _pedir(sesion, {"tipo": "previsualizar", "imagen_id": imagen_id, "ocultamientos": [oculta]})
    with Image.open(io.BytesIO(binario or b"")) as vista:
        assert max(vista.convert("L").getpixel((50, 50)), 0) < 40  # type: ignore[arg-type]


def test_error_interno_se_traduce_sin_filtrar_detalles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    secreto = "C:\\Users\\persona\\secreto.jpg"

    def fallar(_ruta: str) -> None:
        raise RuntimeError(secreto)

    monkeypatch.setattr(cargador, "abrir", fallar)
    with caplog.at_level(logging.INFO):
        respuesta, _ = _pedir(_sesion(), {"tipo": "abrir_imagen", "ruta": secreto})
    assert respuesta["error"]["codigo"] == "INTERNO"
    assert secreto not in json.dumps(respuesta)
    assert "persona" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_err005_log_de_validacion_no_incluye_la_ruta(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        atender(_sesion(), json.dumps({"id": 1, "comando": {"tipo": "abrir_imagen", "ruta": "C:/persona.jpg", "x": 1}}).encode())
    assert "persona" not in caplog.text


def test_err005_abrir_ruta_personal_no_aparece_en_el_log(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    ruta = tmp_path / "persona-secreta.jpg"
    ruta.write_bytes(b"no soy imagen")
    with caplog.at_level(logging.INFO):
        respuesta, _ = _pedir(_sesion(), {"tipo": "abrir_imagen", "ruta": str(ruta)})
    assert respuesta["error"]["codigo"] == "NO_ES_IMAGEN"
    assert "persona-secreta" not in caplog.text


def test_memoria_insuficiente(monkeypatch: pytest.MonkeyPatch) -> None:
    def fallar(_ruta: str) -> None:
        raise MemoryError

    monkeypatch.setattr(cargador, "abrir", fallar)
    assert _pedir(_sesion(), {"tipo": "abrir_imagen", "ruta": "x"})[0]["error"]["codigo"] == "MEMORIA_INSUFICIENTE"


def _marco(contenido: bytes) -> bytes:
    return len(contenido).to_bytes(4, "big") + contenido


def _leer_respuestas(crudo: bytes) -> list[bytes]:
    salida, i = [], 0
    while i < len(crudo):
        n = int.from_bytes(crudo[i : i + 4], "big")
        salida.append(crudo[i + 4 : i + 4 + n])
        i += 4 + n
    return salida


def test_bucle_mensaje_demasiado_grande_no_pierde_alineacion() -> None:
    enorme = b"x" * (16 * 1024 * 1024 + 1)
    entrada = io.BytesIO(_marco(enorme) + _marco(b'{"id":2,"comando":{"tipo":"ping"}}'))
    salida = io.BytesIO()
    servir(entrada, salida, _sesion())
    primera, segunda = [json.loads(m) for m in _leer_respuestas(salida.getvalue())]
    assert primera["error"]["codigo"] == "MENSAJE_INVALIDO"
    assert segunda["ok"]


def test_bucle_termina_si_la_entrada_se_corta() -> None:
    for entrada in (b"", b"\x00\x00", _marco(b"abc")[:5]):
        salida = io.BytesIO()
        servir(io.BytesIO(entrada), salida, _sesion())
        assert salida.getvalue() == b""


def _base(formato: str) -> bytes:
    return bytes_imagen(formato)


@pytest.mark.parametrize("formato", ["JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP"])
def test_fuzz_archivos_mutados_nunca_cierran(tmp_path: Path, formato: str) -> None:
    aleatorio = random.Random(formato)
    base = _base(formato)
    ruta = tmp_path / "fuzz.jpg"
    for _ in range(150):
        datos = bytearray(base)
        match aleatorio.randrange(4):
            case 0:
                for _ in range(aleatorio.randrange(1, 30)):
                    datos[aleatorio.randrange(len(datos))] = aleatorio.randrange(256)
            case 1:
                datos = datos[: aleatorio.randrange(len(datos))]
            case 2:
                i = aleatorio.randrange(len(datos))
                datos[i:i] = os.urandom(aleatorio.randrange(200))
            case _:
                datos[:16] = os.urandom(16)
        ruta.write_bytes(bytes(datos))
        try:
            imagen = cargador.abrir(str(ruta))
        except ErrorRevisor as e:
            assert isinstance(e.codigo, Codigo)
        else:
            assert imagen.pixeles.ndim == 3


@given(st.binary(min_size=1, max_size=4096))
def test_fuzz_bytes_al_azar_en_el_cargador(tmp_path: Path, datos: bytes) -> None:
    ruta = tmp_path / "azar.jpg"
    ruta.write_bytes(datos)
    with pytest.raises(ErrorRevisor):
        cargador.abrir(str(ruta))


def _proceso(tmp_path: Path) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [sys.executable, "-m", "revisor", "--modelos", str(MODELOS), "--logs", str(tmp_path / "logs")],
        cwd=SIDECAR,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_proceso_real_responde_y_sale_al_cerrar_stdin(tmp_path: Path) -> None:
    proceso = _proceso(tmp_path)
    salida, _ = proceso.communicate(_marco(b'{"id":1,"comando":{"tipo":"ping"}}') + _marco(b"basura"), timeout=60)
    assert proceso.returncode == 0
    primera, segunda = [json.loads(m) for m in _leer_respuestas(salida)]
    assert primera["ok"]
    assert segunda["ok"] is False


def test_seg_python_no_puede_abrir_red() -> None:
    codigo = (
        "import socket\n"
        "from revisor.red import bloquear_red, RedProhibida\n"
        "bloquear_red()\n"
        "resultados = []\n"
        "for fn in (lambda: socket.create_connection(('127.0.0.1', 9), 1), lambda: socket.getaddrinfo('example.com', 80),\n"
        "           lambda: socket.socket().bind(('127.0.0.1', 0))):\n"
        "    try:\n"
        "        fn()\n"
        "        resultados.append('paso')\n"
        "    except RedProhibida:\n"
        "        resultados.append('bloqueado')\n"
        "print(resultados)\n"
    )
    salida = subprocess.run([sys.executable, "-c", codigo], cwd=SIDECAR, capture_output=True, text=True, timeout=60, check=True)
    assert salida.stdout.strip() == "['bloqueado', 'bloqueado', 'bloqueado']"
