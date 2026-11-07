"""Falla si el nombre de la marca aparece escrito fuera de los lugares permitidos.

El código y el catálogo deben leerlo de brand/brand.json. Los documentos pueden nombrarlo.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PERMITIDOS = ("brand/", "docs/", "qa/", "CLAUDE.md", "README.md", "LICENSE", "tools/test_")
# Carpetas generadas y fuera de git: cachés de pruebas y resultados locales.
IGNORADOS = {
    ".git", ".venv", "node_modules", "dist", "out", "__pycache__",
    ".hypothesis", ".pytest_cache", ".ruff_cache", "coverage", "test-results", "playwright-report",
}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    nombre = json.loads((RAIZ / "brand/brand.json").read_text(encoding="utf-8"))["nombre"].lower()
    hallazgos = []
    for ruta in RAIZ.rglob("*"):
        relativa = ruta.relative_to(RAIZ).as_posix()
        if not ruta.is_file() or IGNORADOS & set(ruta.parts) or relativa.startswith(PERMITIDOS):
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if nombre in texto.lower():
            hallazgos.append(relativa)
    for h in hallazgos:
        print(f"ERROR nombre escrito a mano en {h}: usa brand/brand.json")
    print("OK: nombre centralizado" if not hallazgos else f"{len(hallazgos)} archivo(s) con el nombre")
    return 1 if hallazgos else 0


if __name__ == "__main__":
    sys.exit(main())
