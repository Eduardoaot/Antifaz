"""Selección por clic con SlimSAM: un punto da la silueta del objeto.

El encoder tarda unos segundos, pero se corre una vez por imagen. Cada clic después es casi inmediato.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from .cargador import Pixeles
from .contenido import leer_verificado, nueva_sesion

ARCHIVO_ENCODER = "slimsam-encoder-q.onnx"
SHA256_ENCODER = "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971"
ARCHIVO_DECODER = "slimsam-decoder-q.onnx"
SHA256_DECODER = "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2"
LADO = 1024
MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DESVIACION = np.array([0.229, 0.224, 0.225], dtype=np.float32)


@dataclass(frozen=True)
class Mascara:
    """Solo se guarda el recorte de la silueta. Vive en memoria, nunca en disco."""

    x: int
    y: int
    ancho: int
    alto: int
    recorte: NDArray[np.bool_]


class Segmentador:
    def __init__(self, carpeta: Path) -> None:
        self._encoder = nueva_sesion(leer_verificado(carpeta / ARCHIVO_ENCODER, SHA256_ENCODER))
        self._decoder = nueva_sesion(leer_verificado(carpeta / ARCHIVO_DECODER, SHA256_DECODER))

    def preparar(self, pixeles: Pixeles) -> dict[str, Any]:
        rgb = pixeles[:, :, :3]
        alto, ancho = rgb.shape[:2]
        escala = LADO / max(alto, ancho)
        nuevo_alto, nuevo_ancho = max(1, round(alto * escala)), max(1, round(ancho * escala))
        reducida = cv2.resize(rgb, (nuevo_ancho, nuevo_alto), interpolation=cv2.INTER_LINEAR)
        normalizada = (reducida.astype(np.float32) / 255 - MEDIA) / DESVIACION
        lienzo = np.zeros((LADO, LADO, 3), dtype=np.float32)
        lienzo[:nuevo_alto, :nuevo_ancho] = normalizada
        salidas: Any = self._encoder.run(None, {"pixel_values": lienzo.transpose(2, 0, 1)[None]})
        nombres = [s.name for s in self._encoder.get_outputs()]
        return {
            **dict(zip(nombres, salidas, strict=True)),
            "escala": escala,
            "alto": alto,
            "ancho": ancho,
            "nuevo_alto": nuevo_alto,
            "nuevo_ancho": nuevo_ancho,
        }

    def segmentar(self, preparado: dict[str, Any], x: int, y: int) -> Mascara | None:
        """Devuelve None si en ese punto no hay un objeto reconocible."""
        escala = preparado["escala"]
        salidas: Any = self._decoder.run(
            None,
            {
                "input_points": np.array([[[[x * escala, y * escala]]]], dtype=np.float32),
                "input_labels": np.array([[[1]]], dtype=np.int64),
                "image_embeddings": preparado["image_embeddings"],
                "image_positional_embeddings": preparado["image_positional_embeddings"],
            },
        )
        resultado = {s.name: v for s, v in zip(self._decoder.get_outputs(), salidas, strict=True)}
        puntajes = resultado["iou_scores"].reshape(-1)
        mejor = resultado["pred_masks"][0, 0, int(puntajes.argmax())]
        return mascara_desde(
            mejor,
            preparado["nuevo_alto"],
            preparado["nuevo_ancho"],
            preparado["alto"],
            preparado["ancho"],
        )


def mascara_desde(logits: Any, nuevo_alto: int, nuevo_ancho: int, alto: int, ancho: int) -> Mascara | None:
    ampliada = cv2.resize(logits, (LADO, LADO), interpolation=cv2.INTER_LINEAR)[:nuevo_alto, :nuevo_ancho]
    completa = cv2.resize(ampliada, (ancho, alto), interpolation=cv2.INTER_LINEAR) > 0
    ys, xs = np.nonzero(completa)
    if xs.size == 0:
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    return Mascara(x0, y0, x1 - x0, y1 - y0, completa[y0:y1, x0:x1].copy())


@lru_cache(maxsize=1)
def segmentador_de(carpeta: Path) -> Segmentador:
    return Segmentador(carpeta)
