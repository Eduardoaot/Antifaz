"""Objetos con ubicación, con un detector de vocabulario abierto (OWL-ViT).

Cada clase tiene su propio umbral, medido con una muestra chica (ver docs/INVESTIGACION.md).
Llaves, gafetes y números de casa no se incluyen: en esa medición casi no se detectaron.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from tokenizers import Tokenizer

from .cargador import Pixeles
from .contenido import DESVIACION_CLIP, MEDIA_CLIP, leer_verificado, nueva_sesion

ARCHIVO_OWL = "owlvit-base-patch32-q.onnx"
SHA256_OWL = "06af49bd5db977936bcddad2b45d0031072673517579d15b8cb42bf015a94156"
ARCHIVO_TOKENIZADOR_OWL = "owlvit-tokenizer.json"
SHA256_TOKENIZADOR_OWL = "50b24e94079fb11cb1503f65fef0ed08044186a1cd118c79683991554d9a5b23"
LADO_OWL = 768
LARGO_TEXTO = 16
UMBRAL_NMS = 0.3


@dataclass(frozen=True)
class Clase:
    frase: str
    regla_id: str
    umbral: float


CLASES = (
    Clase("a car license plate", "MAT-01", 0.1),
    Clase("a smartphone screen", "PAN-01", 0.2),
    Clase("a computer monitor", "PAN-01", 0.2),
    Clase("a television", "PAN-01", 0.2),
    Clase("a credit card", "FIN-01", 0.15),
    Clase("jewelry or a necklace", "VAL-02", 0.15),
    Clase("a street sign", "UBI-04", 0.1),
    # Propuesta sin medir (2026-11-06): lo que importa es la vista, no la ventana. Riesgo bajo.
    Clase("a window with a view of the street or buildings", "UBI-06", 0.2),
    Clase("a gun", "ARM-01", 0.3),
    Clase("a rifle", "ARM-01", 0.3),
    Clase("a flag", "EXT-01", 0.2),
)
REGLAS_DE_OBJETOS = ("MAT-01", "PAN-01", "VAL-02", "UBI-04", "UBI-06")


@dataclass(frozen=True)
class Objeto:
    regla_id: str
    x: int
    y: int
    ancho: int
    alto: int
    confianza: float


def decodificar(logits: Any, cajas: Any, ancho: int, alto: int) -> list[Objeto]:
    """Las cajas vienen como centro y tamaño, de 0 a 1, sobre la imagen completa."""
    probabilidad = 1 / (1 + np.exp(-logits))
    clases = probabilidad.argmax(axis=1)
    puntajes = probabilidad.max(axis=1)
    por_regla: dict[str, tuple[list[list[int]], list[float]]] = {}
    for caja, indice, puntaje in zip(cajas, clases, puntajes, strict=True):
        clase = CLASES[int(indice)]
        if float(puntaje) < clase.umbral:
            continue
        cx, cy, w, h = (float(v) for v in caja)
        x0, y0 = max(0, round((cx - w / 2) * ancho)), max(0, round((cy - h / 2) * alto))
        x1, y1 = min(ancho, round((cx + w / 2) * ancho)), min(alto, round((cy + h / 2) * alto))
        if x1 > x0 and y1 > y0:
            grupo = por_regla.setdefault(clase.regla_id, ([], []))
            grupo[0].append([x0, y0, x1 - x0, y1 - y0])
            grupo[1].append(float(puntaje))
    salida: list[Objeto] = []
    for regla, (lista, valores) in por_regla.items():
        for i in np.array(cv2.dnn.NMSBoxes(lista, valores, 0.0, UMBRAL_NMS)).reshape(-1):
            x, y, w, h = lista[int(i)]
            salida.append(Objeto(regla, x, y, w, h, valores[int(i)]))
    return salida


class DetectorObjetos:
    def __init__(self, carpeta: Path) -> None:
        tokenizador = Tokenizer.from_str(
            leer_verificado(carpeta / ARCHIVO_TOKENIZADOR_OWL, SHA256_TOKENIZADOR_OWL).decode("utf-8")
        )
        self._sesion = nueva_sesion(leer_verificado(carpeta / ARCHIVO_OWL, SHA256_OWL))
        tokenizador.enable_padding(pad_id=0, length=LARGO_TEXTO)
        tokenizador.enable_truncation(LARGO_TEXTO)
        codificado = tokenizador.encode_batch([c.frase for c in CLASES])
        self._ids = np.array([e.ids for e in codificado], dtype=np.int64)
        self._mascara = np.array([e.attention_mask for e in codificado], dtype=np.int64)

    def buscar(self, pixeles: Pixeles) -> list[Objeto]:
        rgb = pixeles[:, :, :3]
        alto, ancho = rgb.shape[:2]
        reducida = cv2.resize(rgb, (LADO_OWL, LADO_OWL), interpolation=cv2.INTER_LINEAR)
        normalizada = (reducida.astype(np.float32) / 255 - MEDIA_CLIP) / DESVIACION_CLIP
        salidas: Any = self._sesion.run(
            ["logits", "pred_boxes"],
            {
                "pixel_values": normalizada.transpose(2, 0, 1)[None].astype(np.float32),
                "input_ids": self._ids,
                "attention_mask": self._mascara,
            },
        )
        return decodificar(salidas[0][0], salidas[1][0], ancho, alto)


@lru_cache(maxsize=1)
def detector_de(carpeta: Path) -> DetectorObjetos:
    return DetectorObjetos(carpeta)
