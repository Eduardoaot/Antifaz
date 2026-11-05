"""Descarga los modelos y comprueba su hash. Un modelo alterado se borra y no se usa.

Se ejecuta aparte de la app, nunca durante un análisis.
"""
from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

CARPETA = Path(__file__).resolve().parent.parent / "sidecar" / "modelos"
MODELOS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    CARPETA.mkdir(parents=True, exist_ok=True)
    for nombre, (url, esperado) in MODELOS.items():
        destino = CARPETA / nombre
        if destino.exists() and hashlib.sha256(destino.read_bytes()).hexdigest() == esperado:
            print(f"OK: {nombre} ya estaba")
            continue
        with urllib.request.urlopen(url, timeout=120) as respuesta:
            datos = respuesta.read()
        if hashlib.sha256(datos).hexdigest() != esperado:
            print(f"ERROR: {nombre} no coincide con el hash esperado; no se guardó")
            return 1
        destino.write_bytes(datos)
        print(f"OK: {nombre} descargado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
