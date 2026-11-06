"""Script para limpiar archivos de caché y temporales en Antifaz."""

from pathlib import Path
import shutil
import sys

RAIZ = Path(__file__).resolve().parent.parent

# Carpetas de caché y artefactos temporales
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
    "tests-ui/capturas",
]

# Archivos específicos de caché
ARCHIVOS_CACHE = [
    ".coverage",
    ".eslintcache",
]


def limpiar_cache(incluir_profundo: bool = False) -> None:
    eliminados_archivos = 0
    eliminadas_carpetas = 0

    print(f"Limpiando caché en: {RAIZ}\n")

    # 1. Eliminar carpetas fijas de caché
    for rel in CARPETAS_CACHE:
        carpeta = RAIZ / rel
        if carpeta.exists() and carpeta.is_dir():
            shutil.rmtree(carpeta, ignore_errors=True)
            print(f"  [x] Carpeta eliminada: {rel}")
            eliminadas_carpetas += 1

    # 2. Eliminar archivos individuales de caché
    for rel in ARCHIVOS_CACHE:
        archivo = RAIZ / rel
        if archivo.exists() and archivo.is_file():
            archivo.unlink(missing_ok=True)
            print(f"  [x] Archivo eliminado: {rel}")
            eliminados_archivos += 1

    # 3. Eliminar recursivamente __pycache__ y *.pyc
    for pycache in RAIZ.rglob("__pycache__"):
        if ".git" not in pycache.parts and ".venv" not in pycache.parts:
            shutil.rmtree(pycache, ignore_errors=True)
            print(f"  [x] Pycache eliminado: {pycache.relative_to(RAIZ)}")
            eliminadas_carpetas += 1

    for pyc in RAIZ.rglob("*.pyc"):
        if ".git" not in pyc.parts and ".venv" not in pyc.parts:
            pyc.unlink(missing_ok=True)
            eliminados_archivos += 1

    for tmp in RAIZ.rglob("*.tmp"):
        if ".git" not in tmp.parts:
            tmp.unlink(missing_ok=True)
            print(f"  [x] Temporal eliminado: {tmp.relative_to(RAIZ)}")
            eliminados_archivos += 1

    if incluir_profundo:
        for extra in ["node_modules", ".venv", "sidecar/.venv"]:
            carpeta_extra = RAIZ / extra
            if carpeta_extra.exists():
                print(f"  [!] Eliminando dependencia/entorno: {extra}...")
                shutil.rmtree(carpeta_extra, ignore_errors=True)
                eliminadas_carpetas += 1

    print(f"\nListo: se eliminaron {eliminadas_carpetas} carpetas y {eliminados_archivos} archivos de caché.")


if __name__ == "__main__":
    profundo = "--profundo" in sys.argv
    limpiar_cache(incluir_profundo=profundo)
