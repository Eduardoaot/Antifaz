"""Lectura de video con ffprobe: rangos de qa/RANGOS.md ("Video de entrada") y casos ARC de la Fase 3."""
from __future__ import annotations

import json
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from revisor import video
from revisor.errores import Codigo, ErrorRevisor
from revisor.herramientas import Herramienta

DE_LECTURA = {
    Codigo.NO_ES_VIDEO,
    Codigo.VIDEO_CORRUPTO,
    Codigo.VIDEO_NO_SOPORTADO,
    Codigo.VIDEO_TAMANO_NO_SOPORTADO,
    Codigo.VIDEO_DEMASIADO_LARGO,
}


def pista_video(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "codec_type": "video",
        "width": 1920,
        "height": 1080,
        "avg_frame_rate": "30000/1001",
        "r_frame_rate": "30000/1001",
        "nb_frames": "300",
        "disposition": {"attached_pic": 0},
    }
    base.update(cambios)
    return base


def salida(*pistas: dict[str, Any], **formato: Any) -> bytes:
    datos_formato: dict[str, Any] = {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "2.500000"}
    datos_formato.update(formato)
    return json.dumps({"streams": list(pistas) or [pista_video()], "format": datos_formato}).encode()


def codigo(datos: bytes) -> Codigo:
    with pytest.raises(ErrorRevisor) as e:
        video.interpretar_ffprobe(datos)
    return e.value.codigo


def test_video_normal() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(nb_frames="90"), {"codec_type": "audio"}, duration="2.970"))
    assert (info.ancho, info.alto, info.rotacion) == (1920, 1080, 0)
    assert info.fps == pytest.approx(29.97, abs=0.01)
    assert info.duracion_s == pytest.approx(2.97)
    assert info.frames_estimados == 90
    assert info.fps_tracking == 24
    assert info.tiene_audio
    assert info.pistas_sin_revisar == 0
    assert not info.requiere_confirmar


def test_arc033_video_sin_audio() -> None:
    assert not video.interpretar_ffprobe(salida()).tiene_audio


def test_webm_y_matroska() -> None:
    assert video.interpretar_ffprobe(salida(format_name="matroska,webm")).ancho == 1920


@pytest.mark.parametrize("nombre", ["image2", "gif", "png_pipe", "avi", "mp3", None])
def test_contenedor_no_soportado(nombre: str | None) -> None:
    assert codigo(salida(format_name=nombre)) is Codigo.NO_ES_VIDEO


@pytest.mark.parametrize("datos", [b"", b"no es json", b"\xff\xfe", b"[]", b"{}", b'{"format": {}, "streams": []}'])
def test_salida_ilegible(datos: bytes) -> None:
    assert codigo(datos) in (Codigo.VIDEO_CORRUPTO, Codigo.NO_ES_VIDEO)


def test_solo_audio_no_es_video() -> None:
    assert codigo(salida({"codec_type": "audio"})) is Codigo.NO_ES_VIDEO


def test_portada_no_cuenta_como_video() -> None:
    portada = pista_video(disposition={"attached_pic": 1})
    assert codigo(salida(portada, {"codec_type": "audio"})) is Codigo.NO_ES_VIDEO
    info = video.interpretar_ffprobe(salida(pista_video(), portada))
    assert info.pistas_sin_revisar == 1


def test_varias_pistas_de_video_se_rechazan() -> None:
    assert codigo(salida(pista_video(), pista_video())) is Codigo.VIDEO_NO_SOPORTADO


def test_pistas_de_datos_y_subtitulos_se_cuentan() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(), {"codec_type": "data"}, {"codec_type": "subtitle"}))
    assert info.pistas_sin_revisar == 2


@pytest.mark.parametrize(("ancho", "alto"), [(16, 16), (8192, 4320), (1080, 1920), (16, 8192)])
def test_lados_en_rango(ancho: int, alto: int) -> None:
    info = video.interpretar_ffprobe(salida(pista_video(width=ancho, height=alto)))
    assert (info.ancho, info.alto) == (ancho, alto)


@pytest.mark.parametrize(("ancho", "alto"), [(15, 1080), (1920, 15), (8193, 1080), (1920, 8193), (0, 0), (-1, 10)])
def test_lados_fuera_de_rango(ancho: int, alto: int) -> None:
    assert codigo(salida(pista_video(width=ancho, height=alto))) is Codigo.VIDEO_TAMANO_NO_SOPORTADO


@pytest.mark.parametrize("cambio", [{"width": None}, {"height": "mil"}, {"width": True}, {"width": 12.5}])
def test_dimensiones_ilegibles(cambio: dict[str, Any]) -> None:
    assert codigo(salida(pista_video(**cambio))) is Codigo.VIDEO_CORRUPTO


def test_fps_variable_usa_el_promedio() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(avg_frame_rate="2997/100", r_frame_rate="60/1")))
    assert info.fps == pytest.approx(29.97)


def test_fps_sin_promedio_usa_el_nominal() -> None:
    assert video.interpretar_ffprobe(salida(pista_video(avg_frame_rate="0/0", r_frame_rate="25/1"))).fps == 25


@pytest.mark.parametrize("fps", ["240/1", "1/1", "1/2"])
def test_fps_en_rango(fps: str) -> None:
    video.interpretar_ffprobe(salida(pista_video(avg_frame_rate=fps)))


def test_fps_por_encima_del_maximo() -> None:
    assert codigo(salida(pista_video(avg_frame_rate="241/1"))) is Codigo.VIDEO_NO_SOPORTADO


@pytest.mark.parametrize("fps", ["0/0", "x/y", "-30/1", "30", None])
def test_fps_ilegible(fps: str | None) -> None:
    assert codigo(salida(pista_video(avg_frame_rate=fps, r_frame_rate=fps))) is Codigo.VIDEO_CORRUPTO


@pytest.mark.parametrize("duracion", ["15", "15.0", "0.5", "0.001", "15.003", "15.0333"])
def test_duracion_en_rango(duracion: str) -> None:
    video.interpretar_ffprobe(salida(duration=duracion))


@pytest.mark.parametrize("duracion", ["15.0334", "15.05", "60", "7200"])
def test_arc011_duracion_por_encima_del_maximo(duracion: str) -> None:
    assert codigo(salida(duration=duracion)) is Codigo.VIDEO_DEMASIADO_LARGO


@pytest.mark.parametrize(
    ("fps", "pasa", "no_pasa"),
    [
        ("24/1", "15.0416", "15.0417"),  # un frame de 24 fps: 0.04166 s
        ("60/1", "15.0166", "15.0167"),
        ("10/1", "15.05", "15.0501"),  # un frame duraría 0.1 s: manda el tope de 0.05 s
        ("1/1", "15.05", "15.0501"),
    ],
)
def test_tolerancia_de_un_frame_con_tope(fps: str, pasa: str, no_pasa: str) -> None:
    video.interpretar_ffprobe(salida(pista_video(avg_frame_rate=fps), duration=pasa))
    assert codigo(salida(pista_video(avg_frame_rate=fps), duration=no_pasa)) is Codigo.VIDEO_DEMASIADO_LARGO


@pytest.mark.parametrize("duracion", ["0.5", "15"])
def test_en_beta_nunca_pide_confirmar(duracion: str) -> None:
    assert video.interpretar_ffprobe(salida(duration=duracion)).requiere_confirmar is False


def test_aviso_no_supera_el_maximo() -> None:
    assert video.DURACION_AVISO_S <= video.DURACION_MAX_S


@pytest.mark.parametrize(("fps", "esperado"), [("24/1", 24), ("30000/1001", 24), ("60/1", 24), ("15/1", 15), ("1/1", 1)])
def test_fps_de_tracking_no_supera_el_del_video(fps: str, esperado: float) -> None:
    assert video.interpretar_ffprobe(salida(pista_video(avg_frame_rate=fps))).fps_tracking == esperado


@pytest.mark.parametrize("duracion", [None, "N/A", "-1", "nan", "inf"])
def test_duracion_ilegible(duracion: str | None) -> None:
    assert codigo(salida(duration=duracion)) is Codigo.VIDEO_CORRUPTO


def test_duracion_de_la_pista_si_falta_la_del_contenedor() -> None:
    datos = json.loads(salida(duration=None))
    datos["format"].pop("duration")
    datos["streams"][0]["duration"] = "2.5"
    assert video.interpretar_ffprobe(json.dumps(datos).encode()).duracion_s == 2.5


def test_arc010_video_de_un_frame() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(nb_frames="1", avg_frame_rate="30/1"), duration="0"))
    assert info.frames_estimados == 1
    assert info.duracion_s == pytest.approx(1 / 30)


def test_frames_estimados_sin_nb_frames() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(nb_frames=None, avg_frame_rate="24/1"), duration="2.5"))
    assert info.frames_estimados == 60


@pytest.mark.parametrize(
    ("matriz", "esperada"), [(-90, 90), (90, 270), (180, 180), (-180, 180), (0, 0), (270, 90), (-270, 270)]
)
def test_arc038_rotacion_por_matriz(matriz: float, esperada: int) -> None:
    pista = pista_video(side_data_list=[{"side_data_type": "Display Matrix", "rotation": matriz}])
    info = video.interpretar_ffprobe(salida(pista))
    assert info.rotacion == esperada


def test_arc038_rotacion_por_etiqueta_antigua() -> None:
    info = video.interpretar_ffprobe(salida(pista_video(width=1920, height=1080, tags={"rotate": "90"})))
    assert info.rotacion == 90
    assert (info.ancho_visible, info.alto_visible) == (1080, 1920)


def test_arc043_y_arc044_orientacion_visible() -> None:
    vertical = video.interpretar_ffprobe(salida(pista_video(width=1080, height=1920)))
    horizontal = video.interpretar_ffprobe(salida(pista_video(width=1920, height=1080)))
    assert (vertical.ancho_visible, vertical.alto_visible) == (1080, 1920)
    assert (horizontal.ancho_visible, horizontal.alto_visible) == (1920, 1080)


@pytest.mark.parametrize("rotacion", [45, -30.5, 1])
def test_rotacion_no_multiplo_de_90(rotacion: float) -> None:
    pista = pista_video(side_data_list=[{"side_data_type": "Display Matrix", "rotation": rotacion}])
    assert codigo(salida(pista)) is Codigo.VIDEO_NO_SOPORTADO


@pytest.mark.parametrize(
    "pista",
    [
        pista_video(side_data_list=[{"side_data_type": "Display Matrix", "rotation": "x"}]),
        pista_video(tags={"rotate": "noventa"}),
    ],
)
def test_rotacion_ilegible(pista: dict[str, Any]) -> None:
    assert codigo(salida(pista)) is Codigo.VIDEO_NO_SOPORTADO


@given(st.binary(max_size=300))
def test_bytes_arbitrarios_dan_error_tipado(datos: bytes) -> None:
    try:
        video.interpretar_ffprobe(datos)
    except ErrorRevisor as e:
        assert e.codigo in DE_LECTURA


@given(st.recursive(st.none() | st.booleans() | st.integers() | st.floats() | st.text(max_size=8),
                    lambda hijos: st.lists(hijos, max_size=4) | st.dictionaries(st.text(max_size=8), hijos, max_size=4),
                    max_leaves=20))
def test_json_arbitrario_da_error_tipado(arbol: object) -> None:
    try:
        video.interpretar_ffprobe(json.dumps(arbol).encode())
    except ErrorRevisor as e:
        assert e.codigo in DE_LECTURA


def test_leer_llama_a_ffprobe_con_file_y_json() -> None:
    llamadas: list[tuple[Herramienta, list[str], float]] = []

    class Falsas:
        def ejecutar(self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float) -> bytes:
            llamadas.append((herramienta, argumentos, tiempo_max_s))
            return salida()

    info = video.leer(Falsas(), "C:\\videos\\http:raro.mp4")  # type: ignore[arg-type]
    assert info.ancho == 1920
    herramienta, argumentos, _ = llamadas[0]
    assert herramienta is Herramienta.FFPROBE
    assert argumentos[-1] == "file:C:\\videos\\http:raro.mp4"
    assert "json" in argumentos
