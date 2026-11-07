"""FFmpeg, ffprobe y exiftool: se verifican por hash antes de usarlos y se ejecutan sin shell.

Las versiones y los hashes vienen de tools/descargar_modelos.py. Si una herramienta falta o cambió,
no se usa: un binario alterado podría dejar pasar metadatos o abrir la red.

Fuera de Python no alcanza la auditoría de sockets de red.py, así que cada llamada:
- pasa las rutas con el prefijo `file:` y limita los protocolos a archivos, para que un nombre como
  `http:...` o `concat:...` nunca se interprete como otra cosa;
- corre sin consola, sin entrada y con un entorno mínimo;
- tiene un tiempo máximo y un tope de salida.

El detalle de un fallo nunca incluye la salida de error de la herramienta: puede traer rutas.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import threading
from collections.abc import Generator, Iterable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import IO

import numpy as np
import numpy.typing as npt

from .errores import Codigo, ErrorRevisor
from .rutas import ruta_larga

TIEMPO_MAX_S_MIN = 1.0
TIEMPO_MAX_S_MAX = 6 * 60 * 60.0
SALIDA_MAX_BYTES = 64 * 1024 * 1024
# Frames por tubería: 3 s a 240 fps como máximo (qa/RANGOS.md, "Video de entrada"), con holgura.
FRAMES_MAX = 1000
LADO_FRAME_MAX = 8192
_BLOQUE_HASH = 1024 * 1024


class Herramienta(StrEnum):
    FFMPEG = "ffmpeg"
    FFPROBE = "ffprobe"
    EXIFTOOL = "exiftool"


@dataclass(frozen=True)
class Esperado:
    relativo: str
    sha256: str
    # Carpeta de apoyo que también se ejecuta (los scripts Perl de exiftool), con el hash de su árbol.
    arbol: str | None = None
    arbol_sha256: str | None = None


ESPERADOS: dict[Herramienta, Esperado] = {
    Herramienta.FFMPEG: Esperado(
        "ffmpeg/ffmpeg.exe", "3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec"
    ),
    Herramienta.FFPROBE: Esperado(
        "ffmpeg/ffprobe.exe", "f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52"
    ),
    Herramienta.EXIFTOOL: Esperado(
        "exiftool/exiftool.exe",
        "29121f6ecdebdb91abb1f06614c4c5a74746455a6a1c6b00c16dd093164e5be7",
        arbol="exiftool/exiftool_files",
        arbol_sha256="6c976f28182e607f4760338874c6e4095fe01c192291a5bb9eececa890076493",
    ),
}

# Opciones que se anteponen siempre. ffmpeg y ffprobe: sin banner, sin leer la consola y solo archivos
# o tuberías con este proceso (los frames sin ocultar nunca tocan el disco: SEG-004).
PREFIJOS: dict[Herramienta, tuple[str, ...]] = {
    Herramienta.FFMPEG: (
        "-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
    ),
    Herramienta.FFPROBE: ("-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file"),
    # exiftool no tiene red. -q quita mensajes informativos.
    Herramienta.EXIFTOOL: ("-q",),
}


def entrada(ruta: str) -> str:
    """Ruta para ffmpeg y ffprobe. Con `file:` nunca se lee como URL, protocolo o lista de archivos."""
    if not ruta:
        raise ErrorRevisor(Codigo.RUTA_INVALIDA, "ruta vacía para herramienta")
    return "file:" + ruta_larga(ruta)


def hash_archivo(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as archivo:
        while bloque := archivo.read(_BLOQUE_HASH):
            h.update(bloque)
    return h.hexdigest()


def hash_arbol(carpeta: Path) -> str:
    """Hash de un árbol: ruta relativa y hash de cada archivo, en orden. Cambia si se agrega o quita uno."""
    h = hashlib.sha256()
    archivos = sorted(
        (p for p in carpeta.rglob("*") if p.is_file()), key=lambda p: p.relative_to(carpeta).as_posix()
    )
    for ruta in archivos:
        linea = f"{ruta.relative_to(carpeta).as_posix()}\t{hash_archivo(ruta)}\n"
        h.update(linea.encode("utf-8"))
    return h.hexdigest()


_BANDERAS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
Frame = npt.NDArray[np.uint8]


def _validar_tiempo(tiempo_max_s: float) -> None:
    if not TIEMPO_MAX_S_MIN <= tiempo_max_s <= TIEMPO_MAX_S_MAX:
        raise ErrorRevisor(Codigo.VALIDACION, f"tiempo máximo fuera de rango: {tiempo_max_s}")


def _validar_frame(ancho: int, alto: int) -> int:
    if not (1 <= ancho <= LADO_FRAME_MAX and 1 <= alto <= LADO_FRAME_MAX):
        raise ErrorRevisor(Codigo.VALIDACION, f"tamaño de frame fuera de rango: {ancho}x{alto}")
    return ancho * alto * 3


def _leer_exacto(flujo: IO[bytes], tamano: int) -> bytes:
    partes: list[bytes] = []
    faltan = tamano
    while faltan:
        parte = flujo.read(faltan)
        if not parte:
            break
        partes.append(parte)
        faltan -= len(parte)
    return b"".join(partes)


def _entorno_minimo() -> dict[str, str]:
    """Solo lo que Windows necesita para cargar un programa. Sin proxies ni variables de la persona."""
    claves = ("SystemRoot", "SYSTEMROOT", "WINDIR")
    entorno = {clave: valor for clave in claves if (valor := os.environ.get(clave))}
    sistema = entorno.get("SystemRoot") or entorno.get("SYSTEMROOT")
    entorno["PATH"] = os.path.join(sistema, "System32") if sistema else ""
    return entorno


class Herramientas:
    """Localiza, verifica una vez por proceso y ejecuta las herramientas de video."""

    def __init__(
        self,
        carpeta: Path,
        esperados: dict[Herramienta, Esperado] | None = None,
        prefijos: dict[Herramienta, tuple[str, ...]] | None = None,
    ) -> None:
        self._carpeta = carpeta
        self._esperados = ESPERADOS if esperados is None else esperados
        self._prefijos = PREFIJOS if prefijos is None else prefijos
        self._verificadas: dict[Herramienta, Path] = {}

    def ruta(self, herramienta: Herramienta) -> Path:
        ya = self._verificadas.get(herramienta)
        if ya is not None:
            return ya
        esperado = self._esperados.get(herramienta)
        if esperado is None:
            raise ErrorRevisor(Codigo.HERRAMIENTA_NO_DISPONIBLE, f"{herramienta}: sin hash esperado")
        ruta = self._carpeta / esperado.relativo
        if not ruta.is_file():
            raise ErrorRevisor(Codigo.HERRAMIENTA_NO_DISPONIBLE, f"{herramienta}: no está instalada")
        try:
            iguales = hash_archivo(ruta) == esperado.sha256
            if iguales and esperado.arbol is not None:
                arbol = self._carpeta / esperado.arbol
                iguales = arbol.is_dir() and hash_arbol(arbol) == esperado.arbol_sha256
        except OSError as e:
            detalle = f"{herramienta}: no se pudo leer ({e.errno})"
            raise ErrorRevisor(Codigo.HERRAMIENTA_NO_DISPONIBLE, detalle) from e
        if not iguales:
            raise ErrorRevisor(Codigo.HERRAMIENTA_NO_DISPONIBLE, f"{herramienta}: el hash no coincide")
        self._verificadas[herramienta] = ruta
        return ruta

    def ejecutar(
        self, herramienta: Herramienta, argumentos: list[str], tiempo_max_s: float, cwd: str | None = None
    ) -> bytes:
        """Corre la herramienta y devuelve su salida estándar. Cualquier fallo es un error tipado.

        `cwd` permite pasar un archivo por su nombre corto: exiftool lee mal rutas con acentos.
        """
        _validar_tiempo(tiempo_max_s)
        ruta = self.ruta(herramienta)
        comando = [str(ruta), *self._prefijos[herramienta], *argumentos]
        try:
            resultado = subprocess.run(
                comando,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=tiempo_max_s,
                shell=False,
                check=False,
                env=_entorno_minimo(),
                cwd=cwd if cwd is not None else str(ruta.parent),
                creationflags=_BANDERAS,
            )
        except subprocess.TimeoutExpired as e:
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"{herramienta}: superó {tiempo_max_s:.0f} s") from e
        except OSError as e:
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"{herramienta}: no arrancó ({e.errno})") from e
        if resultado.returncode != 0:
            raise ErrorRevisor(
                Codigo.HERRAMIENTA_FALLO,
                f"{herramienta}: terminó con código {resultado.returncode}"
                f" ({len(resultado.stderr)} bytes de error)",
            )
        if len(resultado.stdout) > SALIDA_MAX_BYTES:
            detalle = f"{herramienta}: salida de {len(resultado.stdout)} bytes"
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, detalle)
        return resultado.stdout

    def _abrir(
        self, herramienta: Herramienta, argumentos: list[str], escribir: bool
    ) -> subprocess.Popen[bytes]:
        ruta = self.ruta(herramienta)
        try:
            return subprocess.Popen(
                [str(ruta), *self._prefijos[herramienta], *argumentos],
                stdin=subprocess.PIPE if escribir else subprocess.DEVNULL,
                stdout=subprocess.DEVNULL if escribir else subprocess.PIPE,
                # La salida de error puede traer rutas y no se registra: se descarta.
                stderr=subprocess.DEVNULL,
                shell=False,
                env=_entorno_minimo(),
                cwd=str(ruta.parent),
                creationflags=_BANDERAS,
            )
        except OSError as e:
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"{herramienta}: no arrancó ({e.errno})") from e

    def leer_frames(
        self, argumentos: list[str], ancho: int, alto: int, max_frames: int, tiempo_max_s: float
    ) -> Generator[Frame]:
        """Frames RGB de ffmpeg por tubería, uno a la vez. Un frame incompleto o de más es un error.

        Si quien llama deja de leer, al cerrar el generador se termina el proceso.
        """
        tamano = _validar_frame(ancho, alto)
        _validar_tiempo(tiempo_max_s)
        if not 1 <= max_frames <= FRAMES_MAX:
            raise ErrorRevisor(Codigo.VALIDACION, f"máximo de frames fuera de rango: {max_frames}")
        return self._leer(argumentos, tamano, (alto, ancho, 3), max_frames, tiempo_max_s)

    def _leer(
        self,
        argumentos: list[str],
        tamano: int,
        forma: tuple[int, int, int],
        max_frames: int,
        tiempo_max_s: float,
    ) -> Generator[Frame]:
        proceso = self._abrir(Herramienta.FFMPEG, argumentos, escribir=False)
        vigilante = _Vigilante(proceso, tiempo_max_s)
        try:
            flujo = proceso.stdout
            assert flujo is not None
            leidos = 0
            while datos := _leer_exacto(flujo, tamano):
                vigilante.revisar()
                if len(datos) != tamano:
                    raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"ffmpeg: frame incompleto tras {leidos}")
                leidos += 1
                if leidos > max_frames:
                    raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"ffmpeg: más de {max_frames} frames")
                yield np.frombuffer(datos, dtype=np.uint8).reshape(forma)
            vigilante.terminar(proceso.wait())
            if leidos == 0:
                raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, "ffmpeg: ningún frame")
        finally:
            vigilante.cerrar()

    def escribir_frames(
        self, argumentos: list[str], frames: Iterable[Frame], ancho: int, alto: int, tiempo_max_s: float
    ) -> int:
        """Entrega frames RGB a ffmpeg por tubería. Devuelve cuántos escribió."""
        _validar_frame(ancho, alto)
        _validar_tiempo(tiempo_max_s)
        proceso = self._abrir(Herramienta.FFMPEG, argumentos, escribir=True)
        vigilante = _Vigilante(proceso, tiempo_max_s)
        try:
            flujo = proceso.stdin
            assert flujo is not None
            escritos = 0
            for frame in frames:
                vigilante.revisar()
                if frame.shape != (alto, ancho, 3) or frame.dtype != np.uint8:
                    raise ErrorRevisor(Codigo.VALIDACION, f"frame {escritos} con forma o tipo inesperado")
                escritos += 1
                if escritos > FRAMES_MAX:
                    raise ErrorRevisor(Codigo.VALIDACION, f"más de {FRAMES_MAX} frames")
                try:
                    flujo.write(np.ascontiguousarray(frame).tobytes())
                except OSError as e:
                    vigilante.revisar()
                    detalle = f"ffmpeg: cerró la entrada en el frame {escritos}"
                    raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, detalle) from e
            if escritos == 0:
                raise ErrorRevisor(Codigo.VALIDACION, "ningún frame para escribir")
            try:
                flujo.close()
            except OSError as e:
                raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, "ffmpeg: cerró la entrada al final") from e
            vigilante.terminar(proceso.wait())
            return escritos
        finally:
            vigilante.cerrar()


class _Vigilante:
    """Mata el proceso al vencer el tiempo y garantiza que nunca quede vivo al salir."""

    def __init__(self, proceso: subprocess.Popen[bytes], tiempo_max_s: float) -> None:
        self._proceso = proceso
        self._tiempo = tiempo_max_s
        self._vencido = threading.Event()
        self._reloj = threading.Timer(tiempo_max_s, self._vencer)
        self._reloj.daemon = True
        self._reloj.start()

    def _vencer(self) -> None:
        self._vencido.set()
        self._proceso.kill()

    def revisar(self) -> None:
        if self._vencido.is_set():
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"ffmpeg: superó {self._tiempo:.0f} s")

    def terminar(self, codigo: int) -> None:
        self.revisar()
        if codigo != 0:
            raise ErrorRevisor(Codigo.HERRAMIENTA_FALLO, f"ffmpeg: terminó con código {codigo}")

    def cerrar(self) -> None:
        self._reloj.cancel()
        if self._proceso.poll() is None:
            self._proceso.kill()
        for flujo in (self._proceso.stdin, self._proceso.stdout):
            if flujo is not None and not flujo.closed:
                try:
                    flujo.close()
                except OSError:
                    # El proceso ya terminó y la tubería se rompió: no queda nada que cerrar.
                    continue
        self._proceso.wait()
