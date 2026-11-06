"""Flujo de video de la app con FFmpeg, exiftool y EdgeTAM falsos: abrir, seguir, ver y exportar."""
from __future__ import annotations

import json
import os
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from revisor import video_app
from revisor.errores import Codigo, ErrorRevisor
from revisor.herramientas import Herramienta
from revisor.seguimiento import Avance, Indicacion

from .test_metadatos_video import caja, mp4

ANCHO, ALTO, N, FPS = 640, 480, 10, 24


def ffprobe(ancho: int = ANCHO, alto: int = ALTO, frames: int = N, fps: str = "24/1", audio: bool = True) -> bytes:
    pistas: list[dict[str, Any]] = [{
        "codec_type": "video", "width": ancho, "height": alto, "avg_frame_rate": fps,
        "nb_frames": str(frames), "disposition": {"attached_pic": 0},
    }]
    if audio:
        pistas.append({"codec_type": "audio"})
    duracion = frames / (int(fps.split("/")[0]) / int(fps.split("/")[1]))
    return json.dumps({"streams": pistas, "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": str(duracion)}}).encode()


EXIF_LIMPIO = json.dumps([{
    "SourceFile": "x.parcial", "ExifTool:ExifToolVersion": 13.61, "System:FileName": "x.parcial",
    "System:FileModifyDate": "2026:11:06 10:00:00-06:00", "File:FileType": "MP4",
    "QuickTime:CreateDate": "0000:00:00 00:00:00", "QuickTime:ImageWidth": 640,
    "Track1:HandlerDescription": "VideoHandler", "Track1:MediaCreateDate": "0000:00:00 00:00:00",
    "Composite:ImageSize": "640 480",
}]).encode()


class Falsas:
    """Herramientas falsas. Cada frame es de un color distinto y la salida es un MP4 limpio."""

    def __init__(self, frames: int = N, exif: bytes = EXIF_LIMPIO, audio: bool = True, salida_frames: int | None = None) -> None:
        self.frames = frames
        self.salida_frames = frames if salida_frames is None else salida_frames
        self.exif = exif
        self.audio = audio
        self.escritos: list[np.ndarray] = []
        self.argumentos_codificar: list[str] = []
        self.temporales: list[str] = []

    def ejecutar(self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float, cwd: str | None = None) -> bytes:
        if herramienta is Herramienta.EXIFTOOL:
            assert cwd is not None and argumentos[-2] == "--" and "/" not in argumentos[-1] and "\\" not in argumentos[-1]
            return self.exif
        es_salida = argumentos[-1].endswith(".parcial")
        ancho, alto = (ANCHO, ALTO)
        return ffprobe(ancho, alto, self.frames, audio=self.audio and not es_salida)

    def leer_frames(self, argumentos: list[str], ancho: int, alto: int, max_frames: int, tiempo_max_s: float) -> Iterator[np.ndarray]:
        cantidad = self.salida_frames if "crop" in " ".join(argumentos) else self.frames
        for i in range(cantidad):
            yield np.full((alto, ancho, 3), 40 + i, dtype=np.uint8)

    def escribir_frames(self, argumentos: list[str], frames: Iterable[np.ndarray], ancho: int, alto: int, tiempo_max_s: float) -> int:
        self.argumentos_codificar = argumentos
        temporal = argumentos[-1].removeprefix("file:")
        self.temporales.append(temporal)
        for f in frames:
            self.escritos.append(f.copy())
        Path(temporal).write_bytes(mp4())
        return len(self.escritos)


class SeguidorFalso:
    """Un cuadrado de 80 px que se mueve; opcionalmente se pierde en algunas posiciones."""

    def __init__(self, perdidas: Sequence[int] = (), vacio: bool = False) -> None:
        self.perdidas = set(perdidas)
        self.vacio = vacio
        self.llamadas: list[tuple[int, Indicacion]] = []

    def seguir(self, frames: Sequence[np.ndarray], frame_inicio: int, indicacion: Indicacion, avance: Avance | None = None) -> dict[int, np.ndarray]:
        self.llamadas.append((frame_inicio, indicacion))
        alto, ancho = frames[0].shape[:2]
        salida: dict[int, np.ndarray] = {}
        for p in range(len(frames)):
            m = np.zeros((alto, ancho), dtype=bool)
            if not self.vacio and p not in self.perdidas:
                m[100:180, 100 + p * 10 : 180 + p * 10] = True
            salida[p] = m
        return salida


@pytest.fixture
def original(tmp_path: Path) -> Path:
    ruta = tmp_path / "original.mp4"
    ruta.write_bytes(b"bytes del video original")
    return ruta


def abrir(original: Path, falsas: Falsas | None = None) -> tuple[video_app.VideoAbierto, Falsas]:
    falsas = falsas or Falsas()
    return video_app.abrir(falsas, str(original)), falsas  # type: ignore[arg-type]


# --- dimensiones del proxy ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ancho", "alto", "esperado"),
    [
        (1920, 1080, (852, 480)),
        (1080, 1920, (480, 852)),
        (640, 480, (640, 480)),
        (480, 480, (480, 480)),
        (320, 240, (320, 240)),
        (100, 100, (240, 240)),
        (16, 16, (240, 240)),
        (3841, 2161, (852, 480)),
    ],
)
def test_dimensiones_proxy(ancho: int, alto: int, esperado: tuple[int, int]) -> None:
    assert video_app.dimensiones_proxy(ancho, alto) == esperado


def test_proxy_demasiado_alargado() -> None:
    with pytest.raises(ErrorRevisor) as e:
        video_app.dimensiones_proxy(8192, 16)
    assert e.value.codigo is Codigo.VIDEO_TAMANO_NO_SOPORTADO


# --- abrir --------------------------------------------------------------------------------------


def test_abrir_guarda_proxy_y_huella(original: Path) -> None:
    abierto, _ = abrir(original)
    assert abierto.total == N
    assert abierto.indices == list(range(N))
    assert (abierto.proxy_ancho, abierto.proxy_alto) == (ANCHO, ALTO)
    assert len(abierto.huella) == 64


def test_abrir_a_60_fps_rastrea_a_24(original: Path) -> None:
    class A60(Falsas):
        def ejecutar(self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float, cwd: str | None = None) -> bytes:
            return ffprobe(frames=150, fps="60/1")

    abierto, _ = abrir(original, A60(frames=150))
    assert abierto.total == 150
    assert abierto.indices[0] == 0 and abierto.indices[-1] == 149
    assert 55 <= len(abierto.indices) <= 65  # unos 24 por segundo en 2.5 s


def test_abrir_mas_frames_de_los_anunciados_sigue_rastreando(original: Path) -> None:
    class Miente(Falsas):
        def ejecutar(self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float, cwd: str | None = None) -> bytes:
            return ffprobe(frames=10)

    abierto, _ = abrir(original, Miente(frames=40))
    assert abierto.total == 40
    assert abierto.indices == list(range(40))


def test_abrir_rechaza_si_los_frames_reales_pasan_el_limite(original: Path) -> None:
    class Miente(Falsas):
        def ejecutar(self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float, cwd: str | None = None) -> bytes:
            return ffprobe(frames=24)

    with pytest.raises(ErrorRevisor) as e:
        abrir(original, Miente(frames=24 * 4))
    assert e.value.codigo is Codigo.VIDEO_DEMASIADO_LARGO


def test_abrir_archivo_inexistente_o_vacio(tmp_path: Path) -> None:
    with pytest.raises(ErrorRevisor) as e:
        video_app.abrir(Falsas(), str(tmp_path / "no.mp4"))  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.ARCHIVO_NO_ENCONTRADO
    vacio = tmp_path / "vacio.mp4"
    vacio.write_bytes(b"")
    with pytest.raises(ErrorRevisor) as e:
        video_app.abrir(Falsas(), str(vacio))  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.ARCHIVO_VACIO


def test_abrir_sin_frames(original: Path) -> None:
    with pytest.raises(ErrorRevisor) as e:
        abrir(original, Falsas(frames=0))
    assert e.value.codigo in (Codigo.VIDEO_CORRUPTO, Codigo.NO_ES_VIDEO)


# --- seguir, vista y quitar ---------------------------------------------------------------------


def test_seguir_guarda_la_pista(original: Path) -> None:
    abierto, _ = abrir(original)
    seguidor = SeguidorFalso()
    resultado = video_app.seguir(abierto, seguidor, 4, 130, 140)
    assert resultado["frames_revisar"] == 0
    assert resultado["frames_con_objeto"] == N
    assert seguidor.llamadas[0][0] == 4
    assert str(resultado["pista_id"]) in abierto.pistas


def test_seguir_marca_frames_perdidos(original: Path) -> None:
    abierto, _ = abrir(original)
    resultado = video_app.seguir(abierto, SeguidorFalso(perdidas=[5]), 0, 130, 140)
    assert resultado["posiciones_revisar"] == [5]


def test_seguir_sin_objeto_no_agrega_pista(original: Path) -> None:
    abierto, _ = abrir(original)
    with pytest.raises(ErrorRevisor) as e:
        video_app.seguir(abierto, SeguidorFalso(vacio=True), 0, 1, 1)
    assert e.value.codigo is Codigo.SIN_OBJETO
    assert abierto.pistas == {}


def test_seguir_posicion_fuera(original: Path) -> None:
    abierto, _ = abrir(original)
    with pytest.raises(ErrorRevisor) as e:
        video_app.seguir(abierto, SeguidorFalso(), N, 1, 1)
    assert e.value.codigo is Codigo.VALIDACION


def test_vista_oculta_la_zona(original: Path) -> None:
    import cv2

    abierto, _ = abrir(original)
    pista = str(video_app.seguir(abierto, SeguidorFalso(), 0, 130, 140)["pista_id"])
    datos, revisar = video_app.vista(abierto, 0, [(pista, "solido")])
    assert not revisar
    imagen = cv2.imdecode(np.frombuffer(datos, np.uint8), cv2.IMREAD_COLOR)
    assert imagen.shape == (ALTO, ANCHO, 3)
    assert imagen[110:170, 110:170].max() < 20  # tapado con negro
    assert imagen[400:470, 500:600].mean() > 30  # lo demás se ve


def test_vista_sin_pistas_y_con_pista_desconocida(original: Path) -> None:
    abierto, _ = abrir(original)
    datos, revisar = video_app.vista(abierto, 2, [])
    assert datos[:2] == b"\xff\xd8" and not revisar
    with pytest.raises(ErrorRevisor) as e:
        video_app.vista(abierto, 0, [("no-existe", "solido")])
    assert e.value.codigo is Codigo.VALIDACION


def test_quitar(original: Path) -> None:
    abierto, _ = abrir(original)
    pista = str(video_app.seguir(abierto, SeguidorFalso(), 0, 130, 140)["pista_id"])
    video_app.quitar(abierto, pista)
    assert abierto.pistas == {}
    with pytest.raises(ErrorRevisor):
        video_app.quitar(abierto, pista)


# --- exportar -----------------------------------------------------------------------------------


def preparar(original: Path, falsas: Falsas | None = None) -> tuple[video_app.VideoAbierto, Falsas, str]:
    abierto, falsas = abrir(original, falsas)
    pista = str(video_app.seguir(abierto, SeguidorFalso(), 0, 130, 140)["pista_id"])
    return abierto, falsas, pista


def sin_temporales(carpeta: Path) -> bool:
    return not [n for n in os.listdir(carpeta) if n.endswith(".parcial")]


def test_exportar_oculta_cada_frame_y_verifica(original: Path, tmp_path: Path) -> None:
    abierto, falsas, pista = preparar(original)
    destino = tmp_path / "salida.mp4"
    resultado = video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), False)  # type: ignore[arg-type]
    assert destino.exists() and sin_temporales(tmp_path)
    assert resultado["frames"] == N and resultado["pistas_ocultas"] == 1
    assert len(falsas.escritos) == N
    for p, frame in enumerate(falsas.escritos):
        assert frame[110:170, 110 + p * 10 : 170 + p * 10].max() == 0, p
        assert frame[400:470, 500:600].min() == 40 + p


def test_exportar_argumentos_sin_metadatos(original: Path, tmp_path: Path) -> None:
    abierto, falsas, pista = preparar(original)
    video_app.exportar(falsas, abierto, [(pista, "difuminado")], str(tmp_path / "s.mp4"), False)  # type: ignore[arg-type]
    a = falsas.argumentos_codificar
    for opcion in (["-map_metadata", "-1"], ["-fflags", "+bitexact"], ["-map_chapters", "-1"], ["-f", "mp4"]):
        i = len(a) - 1 - a[::-1].index(opcion[0])  # la última aparición: la de la salida
        assert a[i + 1] == opcion[1]
    assert a[-1].startswith("file:") and a[-1].endswith(".parcial")
    assert f"file:{original}" in a  # audio del original, por ruta explícita


def test_exportar_sin_audio_no_lo_pide(original: Path, tmp_path: Path) -> None:
    abierto, falsas, pista = preparar(original, Falsas(audio=False))
    video_app.exportar(falsas, abierto, [(pista, "solido")], str(tmp_path / "s.mp4"), False)  # type: ignore[arg-type]
    assert "-c:a" not in falsas.argumentos_codificar and f"file:{original}" not in falsas.argumentos_codificar


def test_exportar_sin_pistas_quita_metadatos_igual(original: Path, tmp_path: Path) -> None:
    abierto, falsas = abrir(original)
    video_app.exportar(falsas, abierto, [], str(tmp_path / "s.mp4"), False)  # type: ignore[arg-type]
    assert (tmp_path / "s.mp4").exists()


@pytest.mark.parametrize(
    "exif",
    [
        json.dumps([{"SourceFile": "x", "UserData:GPSCoordinates": "19.4 -99.1"}]).encode(),
        json.dumps([{"SourceFile": "x", "Keys:Make": "Apple"}]).encode(),
        json.dumps([{"SourceFile": "x", "QuickTime:Model": "Pixel"}]).encode(),
        json.dumps([{"SourceFile": "x", "QuickTime:CreateDate": "2026:11:06 10:00:00"}]).encode(),
        json.dumps([{"SourceFile": "x", "XMP-xmp:CreatorTool": "x"}]).encode(),
        b"no es json",
        b"[]",
    ],
)
def test_exportar_rechaza_si_exiftool_ve_algo(original: Path, tmp_path: Path, exif: bytes) -> None:
    abierto, falsas, pista = preparar(original, Falsas(exif=exif))
    destino = tmp_path / "s.mp4"
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
    assert not destino.exists() and sin_temporales(tmp_path)


def test_exportar_rechaza_si_el_mp4_trae_metadatos(original: Path, tmp_path: Path) -> None:
    class ConGps(Falsas):
        def escribir_frames(self, argumentos: list[str], frames: Iterable[np.ndarray], ancho: int, alto: int, tiempo_max_s: float) -> int:
            super().escribir_frames(argumentos, frames, ancho, alto, tiempo_max_s)
            Path(argumentos[-1].removeprefix("file:")).write_bytes(mp4(extra_moov=caja(b"udta", caja(b"\xa9xyz", b"+19.4"))))
            return 1

    abierto, falsas, pista = preparar(original, ConGps())
    destino = tmp_path / "s.mp4"
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
    assert not destino.exists() and sin_temporales(tmp_path)


@pytest.mark.parametrize("salida_frames", [N - 1, N + 1])
def test_fcl004_frames_distintos_al_exportar(original: Path, tmp_path: Path, salida_frames: int) -> None:
    abierto, falsas, pista = preparar(original, Falsas(salida_frames=salida_frames))
    destino = tmp_path / "s.mp4"
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.EXPORTACION_NO_VERIFICADA
    assert not destino.exists() and sin_temporales(tmp_path)


def test_exportar_si_el_original_cambio(original: Path, tmp_path: Path) -> None:
    abierto, falsas, pista = preparar(original)
    original.write_bytes(b"otros bytes")
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(tmp_path / "s.mp4"), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.ARCHIVO_CAMBIO
    assert falsas.escritos == []


@pytest.mark.parametrize(
    ("nombre", "codigo"),
    [("s.mov", Codigo.RUTA_INVALIDA), ("original.mp4", Codigo.DESTINO_ES_ORIGEN), ("falta/s.mp4", Codigo.RUTA_INVALIDA)],
)
def test_exportar_destinos_invalidos(original: Path, tmp_path: Path, nombre: str, codigo: Codigo) -> None:
    abierto, falsas, pista = preparar(original)
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(tmp_path / nombre), False)  # type: ignore[arg-type]
    assert e.value.codigo is codigo
    assert falsas.escritos == []


def test_exportar_no_sobrescribe_sin_permiso(original: Path, tmp_path: Path) -> None:
    abierto, falsas, pista = preparar(original)
    destino = tmp_path / "s.mp4"
    destino.write_bytes(b"mio")
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.DESTINO_EXISTE and destino.read_bytes() == b"mio"
    video_app.exportar(falsas, abierto, [(pista, "solido")], str(destino), True)  # type: ignore[arg-type]
    assert destino.read_bytes() != b"mio"


def test_exportar_pista_desconocida(original: Path, tmp_path: Path) -> None:
    abierto, falsas = abrir(original)
    with pytest.raises(ErrorRevisor) as e:
        video_app.exportar(falsas, abierto, [("nada", "solido")], str(tmp_path / "s.mp4"), False)  # type: ignore[arg-type]
    assert e.value.codigo is Codigo.VALIDACION


# --- revisar_exiftool ---------------------------------------------------------------------------


def test_exiftool_limpio_pasa() -> None:
    video_app.revisar_exiftool(EXIF_LIMPIO)


def test_exiftool_detalle_sin_valores() -> None:
    with pytest.raises(ErrorRevisor) as e:
        video_app.revisar_exiftool(json.dumps([{"SourceFile": "x", "QuickTime:Author": "Ana Pérez"}]).encode())
    assert "Ana" not in e.value.detalle and "Author" in e.value.detalle
