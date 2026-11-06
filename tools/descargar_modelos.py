"""Descarga los modelos y las herramientas de video, y comprueba su hash. Lo alterado no se guarda.

Se ejecuta aparte de la app, nunca durante un análisis. Si una descarga falla (algunas réplicas de
SourceForge no pasan la verificación TLS), baja el zip con el navegador y pásalo con
`--zips CARPETA`: se verifica con el mismo hash. El sidecar vuelve a comprobar el hash de cada
herramienta antes de usarla (ver sidecar/revisor/herramientas.py).
"""
from __future__ import annotations

import hashlib
import argparse
import io
import shutil
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

CARPETA = Path(__file__).resolve().parent.parent / "sidecar" / "modelos"
HERRAMIENTAS = Path(__file__).resolve().parent.parent / "sidecar" / "herramientas"
EDGETAM = "https://huggingface.co/yonigozlan/EdgeTAM-hf/resolve/c266ce53b3fc00f0f495b583f6a116c4e57f53bb/"
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
    # EdgeTAM para seguir objetos en video (Apache-2.0), con la revisión fijada.
    "edgetam/config.json": (
        EDGETAM + "config.json",
        "0827d003132f67efc496928f4fe5dd4125fcac518950c4eabe1d1f85e245c82a",
    ),
    "edgetam/model.safetensors": (
        EDGETAM + "model.safetensors",
        "8858f8e4757b0b96dab8763f296ecffd845efbbbf698f64163cfa20a63d5fff4",
    ),
    "edgetam/preprocessor_config.json": (
        EDGETAM + "preprocessor_config.json",
        "247f7be8f3979e98bc8e89b94c3e6542f6f1506070c97fbcc983f53a64a9bf86",
    ),
    "edgetam/processor_config.json": (
        EDGETAM + "processor_config.json",
        "f8a68e865cfad115c1c2763f3d93eca7b1c622da06da2a9273eb437fb2389b6d",
    ),
    "edgetam/video_preprocessor_config.json": (
        EDGETAM + "video_preprocessor_config.json",
        "0b05a4bdcd7bb31e7bc12d5882e6a4f4ea7fcc8063d2240ab225e57561658233",
    ),
}
# Este modelo solo se publica dentro del paquete de Python.
DENTRO_DE_ZIP = {"nudenet-320n.onnx": "nudenet/320n.onnx"}

# Herramientas de video. El hash del zip es el que publica cada proyecto (GitHub y exiftool.org).
# FFmpeg: build "essentials" de gyan.dev, GPL-3.0, compatible con AGPL-3.0.
# exiftool: Perl Artistic o GPL. Se publica en exiftool.org y las versiones viejas pasan a SourceForge.
PAQUETES = {
    "ffmpeg": (
        "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
        "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
        "ffmpeg-9.0.2-essentials_build/",
        {"bin/ffmpeg.exe": "ffmpeg.exe", "bin/ffprobe.exe": "ffprobe.exe", "LICENSE": "LICENSE"},
    ),
    "exiftool": (
        "https://downloads.sourceforge.net/project/exiftool/exiftool-13.61_64.zip",
        "ab75b37515385a753aa60a58f68ffffe1ff81e43b319df9540978fb19e0580e5",
        "exiftool-13.61_64/",
        # Con "(-k)" en el nombre espera una tecla al terminar: se renombra.
        {"exiftool(-k).exe": "exiftool.exe", "exiftool_files/": "exiftool_files/"},
    ),
}


def _instalar_paquete(
    nombre: str, url: str, esperado: str, prefijo: str, mapa: dict[str, str], zips: Path | None
) -> bool:
    """Extrae solo lo indicado en `mapa` a una carpeta temporal y la renombra al final."""
    destino = HERRAMIENTAS / nombre
    marca = destino / ".sha256"
    if marca.exists() and marca.read_text(encoding="ascii").strip() == esperado:
        print(f"OK: {nombre} ya estaba")
        return True
    local = zips / url.rsplit("/", 1)[-1] if zips is not None else None
    if local is not None and local.is_file():
        datos = local.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=600) as respuesta:
            datos = respuesta.read()
    if hashlib.sha256(datos).hexdigest() != esperado:
        print(f"ERROR: {nombre} no coincide con el hash esperado; no se guardó")
        return False
    temporal = HERRAMIENTAS / f".{nombre}.tmp"
    shutil.rmtree(temporal, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(datos)) as paquete:
        for info in paquete.infolist():
            if info.is_dir() or not info.filename.startswith(prefijo):
                continue
            relativo = info.filename[len(prefijo):]
            salida = _destino_en_mapa(relativo, mapa)
            if salida is None:
                continue
            ruta = (temporal / salida).resolve()
            if not ruta.is_relative_to(temporal.resolve()):
                print(f"ERROR: {nombre} trae una ruta fuera de su carpeta; no se guardó")
                shutil.rmtree(temporal, ignore_errors=True)
                return False
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(paquete.read(info))
    (temporal / ".sha256").write_text(esperado, encoding="ascii")
    shutil.rmtree(destino, ignore_errors=True)
    # El antivirus de Windows puede retener por unos segundos los .exe recién escritos.
    for intento in range(20):
        try:
            temporal.rename(destino)
            break
        except PermissionError:
            if intento == 19:
                print(f"ERROR: no se pudo mover {nombre} a su carpeta; vuelve a intentarlo")
                return False
            time.sleep(0.5)
    print(f"OK: {nombre} instalado")
    return True


def _destino_en_mapa(relativo: str, mapa: dict[str, str]) -> str | None:
    for origen, salida in mapa.items():
        if origen.endswith("/") and relativo.startswith(origen):
            return salida + relativo[len(origen):]
        if relativo == origen:
            return salida
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    opciones = argparse.ArgumentParser(description=__doc__)
    opciones.add_argument("--zips", type=Path, help="carpeta con los zips de herramientas ya descargados")
    zips: Path | None = opciones.parse_args().zips
    CARPETA.mkdir(parents=True, exist_ok=True)
    HERRAMIENTAS.mkdir(parents=True, exist_ok=True)
    for nombre, (url, esperado, prefijo, mapa) in PAQUETES.items():
        if not _instalar_paquete(nombre, url, esperado, prefijo, mapa, zips):
            return 1
    for nombre, (url, esperado) in MODELOS.items():
        destino = CARPETA / nombre
        destino.parent.mkdir(parents=True, exist_ok=True)
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
