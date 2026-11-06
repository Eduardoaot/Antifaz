"""Limpia cachés y archivos generados del proyecto para liberar espacio. Idea original de Ricardo.

Uso:
    npm run limpiar                      # cachés y compilados; se regeneran solos
    python tools/limpiar_cache.py --profundo --si
                                         # además borra node_modules y los .venv (hay que reinstalar)

Nunca toca los modelos (sidecar/modelos), las herramientas de video (sidecar/herramientas) ni el
código. No entra a carpetas de dependencias al buscar: así es rápido y no daña ningún entorno.
Si algo no se puede borrar, lo dice y termina con código 1.
"""

from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Carpetas de caché y artefactos generados.
CARPETAS_CACHE = [
    "out",
    "dist",
    "coverage",
    "playwright-report",
    "test-results",
    ".pytest_cache",
    ".ruff_cache",
    ".hypothesis",
    "sidecar/.pytest_cache",
    "sidecar/.ruff_cache",
    "sidecar/.hypothesis",
    "sidecar/htmlcov",
    "tests-ui/capturas",
]

# Archivos de caché. sidecar/.coverage guarda rutas de tu equipo.
ARCHIVOS_CACHE = [
    ".coverage",
    "sidecar/.coverage",
    ".eslintcache",
]

# Al buscar __pycache__, *.pyc y *.tmp no se entra aquí: son dependencias, datos o git.
NO_RECORRER = {".git", "node_modules", ".venv", "modelos", "herramientas"}

# Solo con --profundo. Hay que reinstalar después (ver CLAUDE.md, "Comandos").
PROFUNDAS = ["node_modules", ".venv", "sidecar/.venv"]


@dataclass
class Resultado:
    carpetas: int = 0
    archivos: int = 0
    fallos: list[str] = field(default_factory=list)


def _relativa(ruta: Path, raiz: Path) -> str:
    return ruta.relative_to(raiz).as_posix()


def _borrar_carpeta(ruta: Path, raiz: Path, resultado: Resultado, mostrar: bool = True) -> None:
    try:
        shutil.rmtree(ruta)
    except OSError as e:
        resultado.fallos.append(f"{_relativa(ruta, raiz)} ({e.strerror or type(e).__name__})")
        return
    resultado.carpetas += 1
    if mostrar:
        print(f"  [x] Carpeta eliminada: {_relativa(ruta, raiz)}")


def _borrar_archivo(ruta: Path, raiz: Path, resultado: Resultado, mostrar: bool = True) -> None:
    try:
        ruta.unlink()
    except FileNotFoundError:
        return
    except OSError as e:
        resultado.fallos.append(f"{_relativa(ruta, raiz)} ({e.strerror or type(e).__name__})")
        return
    resultado.archivos += 1
    if mostrar:
        print(f"  [x] Archivo eliminado: {_relativa(ruta, raiz)}")


def _recorrer(raiz: Path) -> Iterator[tuple[Path, list[str], list[str]]]:
    """Como os.walk, pero sin entrar a dependencias ni datos."""
    for actual, carpetas, archivos in os.walk(raiz):
        carpetas[:] = [c for c in carpetas if c not in NO_RECORRER]
        yield Path(actual), carpetas, archivos


def _entorno_en_uso(raiz: Path) -> Path | None:
    """El .venv con el que corre este script, si es uno del proyecto: no se puede borrar a sí mismo."""
    prefijo = Path(sys.prefix).resolve()
    for rel in (".venv", "sidecar/.venv"):
        if (raiz / rel).resolve() == prefijo:
            return raiz / rel
    return None


def limpiar_cache(raiz: Path = RAIZ, incluir_profundo: bool = False) -> Resultado:
    resultado = Resultado()
    print(f"Limpiando caché en: {raiz}\n")

    for rel in CARPETAS_CACHE:
        carpeta = raiz / rel
        if carpeta.is_dir():
            _borrar_carpeta(carpeta, raiz, resultado)

    for rel in ARCHIVOS_CACHE:
        archivo = raiz / rel
        if archivo.is_file():
            _borrar_archivo(archivo, raiz, resultado)

    pycaches = 0
    for actual, carpetas, archivos in _recorrer(raiz):
        if "__pycache__" in carpetas:
            carpetas.remove("__pycache__")
            antes = resultado.carpetas
            _borrar_carpeta(actual / "__pycache__", raiz, resultado, mostrar=False)
            pycaches += resultado.carpetas - antes
        for nombre in archivos:
            if nombre.endswith(".pyc"):
                _borrar_archivo(actual / nombre, raiz, resultado, mostrar=False)
            elif nombre.endswith(".tmp"):
                _borrar_archivo(actual / nombre, raiz, resultado)
    if pycaches:
        print(f"  [x] {pycaches} carpetas __pycache__ eliminadas")

    if incluir_profundo:
        en_uso = _entorno_en_uso(raiz)
        for rel in PROFUNDAS:
            carpeta = raiz / rel
            if not carpeta.exists():
                continue
            if en_uso is not None and carpeta.resolve() == en_uso.resolve():
                resultado.fallos.append(f"{rel} (es el entorno con el que corre este script; usa otro Python)")
                continue
            print(f"  [!] Eliminando dependencia/entorno: {rel}...")
            _borrar_carpeta(carpeta, raiz, resultado)

    print(f"\nListo: se eliminaron {resultado.carpetas} carpetas y {resultado.archivos} archivos de caché.")
    if resultado.fallos:
        print(f"\nNo se pudieron eliminar {len(resultado.fallos)}. ¿Está la app o algún editor usándolos?")
        for fallo in resultado.fallos:
            print(f"  [ ] {fallo}")
    return resultado


def main(argumentos: list[str]) -> int:
    desconocidos = [a for a in argumentos if a not in ("--profundo", "--si")]
    if desconocidos:
        print(f"Opción desconocida: {' '.join(desconocidos)}. Usa --profundo y, para confirmarlo, --si.")
        return 2
    profundo = "--profundo" in argumentos
    if profundo and "--si" not in argumentos:
        print(
            "--profundo borra node_modules, .venv y sidecar/.venv. Después hay que reinstalar todo "
            "(npm install y uv sync, que vuelve a bajar PyTorch).\n"
            "Si estás seguro, repite el comando con --profundo --si."
        )
        return 2
    return 1 if limpiar_cache(RAIZ, incluir_profundo=profundo).fallos else 0


if __name__ == "__main__":
    # La consola de Windows no siempre usa UTF-8: sin esto, los acentos rompen la salida.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    sys.exit(main(sys.argv[1:]))
