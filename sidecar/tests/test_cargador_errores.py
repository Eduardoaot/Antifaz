"""Cada error al cargar termina en un código tipado, nunca en una imagen a medias ni en una excepción suelta."""

from __future__ import annotations

import errno
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from PIL import Image

from revisor import cargador
from revisor.errores import Codigo, ErrorRevisor

from .conftest import guardar, imagen_prueba


def _codigo(ruta: Path | str) -> Codigo:
    with pytest.raises(ErrorRevisor) as e:
        cargador.abrir(str(ruta))
    return e.value.codigo


@pytest.mark.parametrize(("ancho", "alto"), [(0, 10), (10, 0), (-1, 5)])
def test_dimensiones_no_positivas(ancho: int, alto: int) -> None:
    with pytest.raises(ErrorRevisor) as e:
        cargador._revisar_dimensiones(ancho, alto)  # pyright: ignore[reportPrivateUsage]
    assert e.value.codigo is Codigo.IMAGEN_CORRUPTA


@pytest.mark.parametrize(
    ("error", "codigo"),
    [
        (PermissionError(errno.EACCES, "negado"), Codigo.SIN_PERMISOS),
        (OSError(errno.EINVAL, "inválida"), Codigo.RUTA_INVALIDA),
        (ValueError("byte nulo"), Codigo.RUTA_INVALIDA),
    ],
)
def test_no_se_puede_consultar_el_archivo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error: Exception, codigo: Codigo
) -> None:
    def falla(_ruta: str) -> None:
        raise error

    monkeypatch.setattr(cargador.os, "stat", falla)
    assert _codigo(tmp_path / "x.png") is codigo


def test_archivo_demasiado_pesado_sin_leerlo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ruta = guardar(tmp_path / "o.png")
    monkeypatch.setattr(cargador, "MAX_BYTES_IMAGEN", ruta.stat().st_size - 1)
    assert _codigo(ruta) is Codigo.ARCHIVO_DEMASIADO_PESADO


def test_modo_entero_con_valores_de_8_bits_no_se_oscurece(tmp_path: Path) -> None:
    datos = np.array([[0, 100], [200, 255]], dtype=np.int32)
    ruta = tmp_path / "i.tif"
    Image.fromarray(datos, mode="I").save(ruta)
    imagen = cargador.abrir(str(ruta))
    assert imagen.pixeles[1, 0, 0] == 200


@pytest.mark.parametrize(
    ("error", "codigo"),
    [
        (FileNotFoundError(errno.ENOENT, "se fue"), Codigo.ARCHIVO_NO_ENCONTRADO),
        (PermissionError(errno.EACCES, "negado"), Codigo.SIN_PERMISOS),
        (OSError(errno.EIO, "disco"), Codigo.RUTA_INVALIDA),
    ],
)
def test_huella_sin_poder_leer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error: Exception, codigo: Codigo) -> None:
    ruta = guardar(tmp_path / "o.png")
    original = open

    def abrir_falla(archivo: Any, modo: str = "r", *args: Any, **kwargs: Any) -> Any:
        if os.fspath(archivo) == os.fspath(cargador.ruta_larga(str(ruta))) and "b" in modo:
            raise error
        return original(archivo, modo, *args, **kwargs)

    monkeypatch.setattr("builtins.open", abrir_falla)
    assert _codigo(ruta) is codigo


@pytest.mark.parametrize(
    ("error", "codigo"),
    [
        (FileNotFoundError(errno.ENOENT, "se fue"), Codigo.ARCHIVO_NO_ENCONTRADO),
        (PermissionError(errno.EACCES, "negado"), Codigo.SIN_PERMISOS),
        (MemoryError(), Codigo.MEMORIA_INSUFICIENTE),
    ],
)
def test_el_archivo_falla_al_decodificar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error: BaseException, codigo: Codigo
) -> None:
    """Entre la huella y la decodificación el archivo puede desaparecer o quedarse sin memoria."""
    ruta = guardar(tmp_path / "o.png")

    def falla(*_a: Any, **_k: Any) -> None:
        raise error

    monkeypatch.setattr(cargador.Image, "open", falla)
    assert _codigo(ruta) is codigo


def test_formato_que_pillow_abre_pero_no_admitimos(tmp_path: Path) -> None:
    ruta = tmp_path / "o.ico"
    imagen_prueba(32, 32).save(ruta, format="ICO")
    assert _codigo(ruta) is Codigo.NO_ES_IMAGEN


# --- RAW con LibRaw simulado -----------------------------------------------------------------


class _Raw:
    def __init__(self, ancho: int, alto: int, error: BaseException | None = None) -> None:
        self.sizes = SimpleNamespace(width=ancho, height=alto)
        self._error = error

    def __enter__(self) -> _Raw:
        return self

    def __exit__(self, *_a: object) -> None:
        return None

    def postprocess(self, **_k: Any) -> np.ndarray:
        if self._error is not None:
            raise self._error
        return np.full((self.sizes.height, self.sizes.width, 3), 90, dtype=np.uint8)


def _raw(tmp_path: Path) -> Path:
    ruta = tmp_path / "foto.dng"
    ruta.write_bytes(b"no es un raw de verdad, pero LibRaw va simulado")
    return ruta


def test_raw_simulado_se_revela(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cargador.rawpy, "imread", lambda _r: _Raw(40, 30))
    imagen = cargador.abrir(str(_raw(tmp_path)))
    assert (imagen.ancho, imagen.alto, imagen.formato) == (40, 30, "RAW")
    # Pillow no entiende la cabecera: los metadatos se tratan como ilegibles, no como limpios.
    assert imagen.metadatos_legibles is False


def test_raw_demasiado_grande_se_rechaza_antes_de_revelar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cargador.rawpy, "imread", lambda _r: _Raw(cargador.MAX_LADO_PX + 1, 10))
    assert _codigo(_raw(tmp_path)) is Codigo.IMAGEN_DEMASIADO_GRANDE


def test_raw_sin_memoria(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cargador.rawpy, "imread", lambda _r: _Raw(40, 30, MemoryError()))
    assert _codigo(_raw(tmp_path)) is Codigo.MEMORIA_INSUFICIENTE
