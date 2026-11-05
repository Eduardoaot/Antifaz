"""Descarga los modelos y comprueba su hash. Un modelo alterado se borra y no se usa.

Se ejecuta aparte de la app, nunca durante un análisis.
"""
from __future__ import annotations

import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

CARPETA = Path(__file__).resolve().parent.parent / "sidecar" / "modelos"
MODELOS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "clip-vit-base-patch32-q.onnx": (
        "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/model_quantized.onnx",
        "0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328",
    ),
    "clip-tokenizer.json": (
        "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
        "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd",
    ),
    "owlvit-base-patch32-q.onnx": (
        "https://huggingface.co/Xenova/owlvit-base-patch32/resolve/main/onnx/model_quantized.onnx",
        "06af49bd5db977936bcddad2b45d0031072673517579d15b8cb42bf015a94156",
    ),
    "owlvit-tokenizer.json": (
        "https://huggingface.co/Xenova/owlvit-base-patch32/resolve/main/tokenizer.json",
        "50b24e94079fb11cb1503f65fef0ed08044186a1cd118c79683991554d9a5b23",
    ),
    "slimsam-encoder-q.onnx": (
        "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_quantized.onnx",
        "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971",
    ),
    "slimsam-decoder-q.onnx": (
        "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/prompt_encoder_mask_decoder_quantized.onnx",
        "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2",
    ),
    "nudenet-320n.onnx": (
        "https://files.pythonhosted.org/packages/1c/ee/1aa02d44ba958cc77e16ff1e41a0aac5e721037db7bf62b9c9d124917f87/nudenet-3.4.2-py3-none-any.whl",
        "c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f",
    ),
}
# Este modelo solo se publica dentro del paquete de Python.
DENTRO_DE_ZIP = {"nudenet-320n.onnx": "nudenet/320n.onnx"}


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
        if nombre in DENTRO_DE_ZIP:
            with zipfile.ZipFile(io.BytesIO(datos)) as paquete:
                datos = paquete.read(DENTRO_DE_ZIP[nombre])
        if hashlib.sha256(datos).hexdigest() != esperado:
            print(f"ERROR: {nombre} no coincide con el hash esperado; no se guardó")
            return 1
        destino.write_bytes(datos)
        print(f"OK: {nombre} descargado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
