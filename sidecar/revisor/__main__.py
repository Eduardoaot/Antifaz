"""Punto de entrada: python -m revisor --modelos RUTA [--logs RUTA]."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .red import bloquear_red
from .servidor import Sesion, configurar_registro, servir


def main() -> int:
    bloquear_red()
    argumentos = argparse.ArgumentParser()
    argumentos.add_argument("--modelos", type=Path, required=True)
    argumentos.add_argument("--logs", type=Path, default=None)
    opciones = argumentos.parse_args()
    configurar_registro(opciones.logs)
    entrada, salida = sys.stdin.buffer, sys.stdout.buffer
    # Un print accidental de una librería corrompería los marcos: stdout queda solo para el protocolo.
    sys.stdout = sys.stderr
    servir(entrada, salida, Sesion(opciones.modelos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
