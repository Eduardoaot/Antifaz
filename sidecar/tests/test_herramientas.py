"""FFmpeg, ffprobe y exiftool: verificación por hash, ejecución sin shell y errores tipados."""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

import pytest

from revisor import herramientas
from revisor.errores import Codigo, ErrorRevisor
from revisor.herramientas import Esperado, Herramienta, Herramientas, entrada, hash_arbol

CONTENIDO = b"binario de prueba"


def _instalar(carpeta: Path, contenido: bytes = CONTENIDO) -> dict[Herramienta, Esperado]:
    ffprobe = carpeta / "ffmpeg" / "ffprobe.exe"
    ffprobe.parent.mkdir(parents=True)
    ffprobe.write_bytes(contenido)
    arbol = carpeta / "exiftool" / "exiftool_files"
    (arbol / "lib").mkdir(parents=True)
    (arbol / "exiftool.pl").write_bytes(b"perl")
    (arbol / "lib" / "Image.pm").write_bytes(b"modulo")
    (carpeta / "exiftool" / "exiftool.exe").write_bytes(contenido)
    sha = hashlib.sha256(contenido).hexdigest()
    return {
        Herramienta.FFPROBE: Esperado("ffmpeg/ffprobe.exe", sha),
        Herramienta.EXIFTOOL: Esperado("exiftool/exiftool.exe", sha, "exiftool/exiftool_files", hash_arbol(arbol)),
    }


class Ejecucion:
    def __init__(self, devuelve: Any = None, lanza: BaseException | None = None) -> None:
        self.devuelve = devuelve if devuelve is not None else subprocess.CompletedProcess([], 0, b"{}", b"")
        self.lanza = lanza
        self.llamadas: list[tuple[list[str], dict[str, Any]]] = []

    def __call__(self, comando: list[str], **opciones: Any) -> Any:
        self.llamadas.append((comando, opciones))
        if self.lanza is not None:
            raise self.lanza
        return self.devuelve


@pytest.fixture
def ejecucion(monkeypatch: pytest.MonkeyPatch) -> Ejecucion:
    falsa = Ejecucion()
    monkeypatch.setattr(herramientas.subprocess, "run", falsa)
    return falsa


def test_hashes_fijados_tienen_formato_sha256() -> None:
    for esperado in herramientas.ESPERADOS.values():
        assert len(esperado.sha256) == 64 and int(esperado.sha256, 16) >= 0
        assert (esperado.arbol is None) == (esperado.arbol_sha256 is None)


def test_verifica_y_recuerda(tmp_path: Path) -> None:
    caja = Herramientas(tmp_path, _instalar(tmp_path))
    ruta = caja.ruta(Herramienta.FFPROBE)
    assert ruta == tmp_path / "ffmpeg" / "ffprobe.exe"
    ruta.write_bytes(b"cambiado despues")  # ya verificada en este proceso
    assert caja.ruta(Herramienta.FFPROBE) == ruta


def test_falta_la_herramienta(tmp_path: Path) -> None:
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path).ruta(Herramienta.FFMPEG)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE


def test_sin_hash_esperado(tmp_path: Path) -> None:
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, {}).ruta(Herramienta.FFMPEG)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE


def test_binario_alterado_no_se_usa(tmp_path: Path) -> None:
    esperados = _instalar(tmp_path)
    (tmp_path / "ffmpeg" / "ffprobe.exe").write_bytes(CONTENIDO + b"!")
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, esperados).ruta(Herramienta.FFPROBE)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE
    assert "hash" in e.value.detalle


@pytest.mark.parametrize("cambio", ["modificar", "agregar", "quitar", "renombrar"])
def test_arbol_de_exiftool_alterado_no_se_usa(tmp_path: Path, cambio: str) -> None:
    esperados = _instalar(tmp_path)
    arbol = tmp_path / "exiftool" / "exiftool_files"
    if cambio == "modificar":
        (arbol / "exiftool.pl").write_bytes(b"perl malicioso")
    elif cambio == "agregar":
        (arbol / "lib" / "Extra.pm").write_bytes(b"x")
    elif cambio == "quitar":
        (arbol / "lib" / "Image.pm").unlink()
    else:
        (arbol / "lib" / "Image.pm").rename(arbol / "Image.pm")
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, esperados).ruta(Herramienta.EXIFTOOL)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE


def test_arbol_ausente(tmp_path: Path) -> None:
    esperados = _instalar(tmp_path)
    import shutil

    shutil.rmtree(tmp_path / "exiftool" / "exiftool_files")
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, esperados).ruta(Herramienta.EXIFTOOL)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE


def test_arbol_completo_pasa(tmp_path: Path) -> None:
    caja = Herramientas(tmp_path, _instalar(tmp_path))
    assert caja.ruta(Herramienta.EXIFTOOL).name == "exiftool.exe"


def test_error_de_lectura_es_tipado(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    esperados = _instalar(tmp_path)

    def falla(_ruta: Path) -> str:
        raise PermissionError(13, "sin permiso")

    monkeypatch.setattr(herramientas, "hash_archivo", falla)
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, esperados).ruta(Herramienta.FFPROBE)
    assert e.value.codigo is Codigo.HERRAMIENTA_NO_DISPONIBLE
    assert str(tmp_path) not in e.value.detalle


def test_hash_arbol_depende_de_rutas_y_contenido(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    for carpeta in (a, b):
        carpeta.mkdir()
    (a / "x").write_bytes(b"1")
    (b / "y").write_bytes(b"1")
    assert hash_arbol(a) != hash_arbol(b)
    (b / "y").rename(b / "x")
    assert hash_arbol(a) == hash_arbol(b)


def test_entrada_usa_file_y_rechaza_vacia() -> None:
    assert entrada("C:\\v\\concat:a.mp4") == "file:C:\\v\\concat:a.mp4"
    with pytest.raises(ErrorRevisor) as e:
        entrada("")
    assert e.value.codigo is Codigo.RUTA_INVALIDA


def test_ejecuta_sin_shell_sin_entrada_y_con_protocolos_limitados(tmp_path: Path, ejecucion: Ejecucion) -> None:
    caja = Herramientas(tmp_path, _instalar(tmp_path))
    assert caja.ejecutar(Herramienta.FFPROBE, ["-show_format", "file:x.mp4"], 30) == b"{}"
    comando, opciones = ejecucion.llamadas[0]
    assert comando[0].endswith("ffprobe.exe")
    assert comando[1:6] == ["-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file"]
    assert comando[-1] == "file:x.mp4"
    assert opciones["shell"] is False
    assert opciones["stdin"] is subprocess.DEVNULL
    assert opciones["timeout"] == 30
    assert set(opciones["env"]) <= {"SystemRoot", "SYSTEMROOT", "WINDIR", "PATH"}


def test_entorno_minimo_no_hereda_proxies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy:8080")
    monkeypatch.setenv("USERPROFILE", "C:\\Users\\alguien")
    entorno = herramientas._entorno_minimo()  # pyright: ignore[reportPrivateUsage]
    assert "HTTPS_PROXY" not in entorno and "USERPROFILE" not in entorno
    assert "PATH" in entorno


@pytest.mark.parametrize("tiempo", [0.5, 0, -1, herramientas.TIEMPO_MAX_S_MAX + 1, float("nan"), float("inf")])
def test_tiempo_fuera_de_rango(tmp_path: Path, ejecucion: Ejecucion, tiempo: float) -> None:
    caja = Herramientas(tmp_path, _instalar(tmp_path))
    with pytest.raises(ErrorRevisor) as e:
        caja.ejecutar(Herramienta.FFPROBE, [], tiempo)
    assert e.value.codigo is Codigo.VALIDACION
    assert not ejecucion.llamadas


@pytest.mark.parametrize("tiempo", [herramientas.TIEMPO_MAX_S_MIN, herramientas.TIEMPO_MAX_S_MAX])
def test_tiempo_en_los_limites(tmp_path: Path, ejecucion: Ejecucion, tiempo: float) -> None:
    Herramientas(tmp_path, _instalar(tmp_path)).ejecutar(Herramienta.FFPROBE, [], tiempo)
    assert ejecucion.llamadas[0][1]["timeout"] == tiempo


def test_tiempo_agotado(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(herramientas.subprocess, "run", Ejecucion(lanza=subprocess.TimeoutExpired("x", 5)))
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, _instalar(tmp_path)).ejecutar(Herramienta.FFPROBE, [], 5)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_no_arranca(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(herramientas.subprocess, "run", Ejecucion(lanza=OSError(8, "formato")))
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, _instalar(tmp_path)).ejecutar(Herramienta.FFPROBE, [], 5)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_codigo_de_salida_no_cero_no_filtra_stderr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stderr = b"C:\\Users\\alguien\\Videos\\boda.mp4: Invalid data"
    monkeypatch.setattr(herramientas.subprocess, "run", Ejecucion(subprocess.CompletedProcess([], 1, b"", stderr)))
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, _instalar(tmp_path)).ejecutar(Herramienta.FFPROBE, [], 5)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO
    assert "alguien" not in e.value.detalle and "boda" not in e.value.detalle


def test_salida_demasiado_grande(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    enorme = subprocess.CompletedProcess([], 0, b"x" * (herramientas.SALIDA_MAX_BYTES + 1), b"")
    monkeypatch.setattr(herramientas.subprocess, "run", Ejecucion(enorme))
    with pytest.raises(ErrorRevisor) as e:
        Herramientas(tmp_path, _instalar(tmp_path)).ejecutar(Herramienta.FFPROBE, [], 5)
    assert e.value.codigo is Codigo.HERRAMIENTA_FALLO


def test_no_ejecuta_si_el_hash_no_coincide(tmp_path: Path, ejecucion: Ejecucion) -> None:
    esperados = _instalar(tmp_path, b"otro")
    esperados[Herramienta.FFPROBE] = Esperado("ffmpeg/ffprobe.exe", "0" * 64)
    with pytest.raises(ErrorRevisor):
        Herramientas(tmp_path, esperados).ejecutar(Herramienta.FFPROBE, [], 5)
    assert not ejecucion.llamadas


HERRAMIENTAS_REALES = Path(__file__).parent.parent / "herramientas"


@pytest.mark.skipif(not (HERRAMIENTAS_REALES / "ffmpeg" / "ffprobe.exe").exists(), reason="sin herramientas descargadas")
def test_herramientas_descargadas_coinciden_con_el_hash() -> None:
    caja = Herramientas(HERRAMIENTAS_REALES)
    for herramienta in Herramienta:
        assert caja.ruta(herramienta).is_file()
