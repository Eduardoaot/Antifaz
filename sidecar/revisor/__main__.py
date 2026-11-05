"""Punto de entrada: python -m revisor --modelos RUTA [--logs RUTA]."""

from __future__ import annotations

import argparse
import os
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
    entrada = sys.stdin.buffer
    # Una librería que escriba en stdout corrompería los marcos. Se reserva una copia del canal
    # para el protocolo y el descriptor 1, que usan también las librerías nativas, va a stderr.
    salida = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    servir(entrada, salida, Sesion(opciones.modelos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
