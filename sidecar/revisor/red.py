"""Corta intentos de red desde Python. No alcanza a librerías nativas: por eso hay test con captura."""

from __future__ import annotations

import sys
from typing import Any

EVENTOS_DE_RED = {
    "socket.connect",
    "socket.bind",
    "socket.listen",
    "socket.sendto",
    "socket.sendmsg",
    "socket.getaddrinfo",
    "socket.gethostbyname",
    "urllib.Request",
}


class RedProhibida(RuntimeError):
    """El análisis es local: ningún código del sidecar debe tocar la red."""


def _auditar(evento: str, _argumentos: tuple[Any, ...]) -> None:
    if evento in EVENTOS_DE_RED:
        raise RedProhibida(evento)


def bloquear_red() -> None:
    # Un hook de auditoría no se puede quitar una vez instalado.
    sys.addaudithook(_auditar)
