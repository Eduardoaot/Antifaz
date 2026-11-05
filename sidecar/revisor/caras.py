"""Detección de caras con YuNet. Cuadros de confianza baja se conservan: prioridad al recall."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .cargador import Pixeles

registro = logging.getLogger(__name__)

# Sin esto, OpenCV escribe un aviso por cada mosaico y llena el log.
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)

ARCHIVO_MODELO = "face_detection_yunet_2023mar.onnx"
SHA256_MODELO = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
LADO_VISTA_COMPLETA = 1600
LADO_MOSAICO = 1280
TRASLAPE = 0.2
MAX_LADO_MOSAICOS = 5120
IOU_DUPLICADO = 0.3
UMBRAL_NMS = 0.3
MAX_CARAS = 5000


class ModeloNoDisponible(Exception):
    """El modelo falta o no coincide con el hash esperado."""


@dataclass(frozen=True)
class Cara:
    x: int
    y: int
    ancho: int
    alto: int
    confianza: float


def _iou(a: Cara, b: Cara) -> float:
    x0, y0 = max(a.x, b.x), max(a.y, b.y)
    x1, y1 = min(a.x + a.ancho, b.x + b.ancho), min(a.y + a.alto, b.y + b.alto)
    interseccion = max(0, x1 - x0) * max(0, y1 - y0)
    union = a.ancho * a.alto + b.ancho * b.alto - interseccion
    return interseccion / union if union > 0 else 0.0


def _union(a: Cara, b: Cara) -> Cara:
    x0, y0 = min(a.x, b.x), min(a.y, b.y)
    x1, y1 = max(a.x + a.ancho, b.x + b.ancho), max(a.y + a.alto, b.y + b.alto)
    return Cara(x0, y0, x1 - x0, y1 - y0, max(a.confianza, b.confianza))


def _sin_duplicados(caras: list[Cara]) -> list[Cara]:
    resultado: list[Cara] = []
    for cara in sorted(caras, key=lambda c: c.confianza, reverse=True):
        for i, otra in enumerate(resultado):
            if _iou(cara, otra) >= IOU_DUPLICADO:
                # Ante la duda, ocultar de más: una detección parcial no debe encoger la caja.
                resultado[i] = _union(otra, cara)
                break
        else:
            resultado.append(cara)
    return resultado


class DetectorCaras:
    def __init__(self, carpeta_modelos: Path) -> None:
        ruta = carpeta_modelos / ARCHIVO_MODELO
        try:
            contenido = ruta.read_bytes()
        except OSError as e:
            raise ModeloNoDisponible("no se pudo leer") from e
        if hashlib.sha256(contenido).hexdigest() != SHA256_MODELO:
            raise ModeloNoDisponible("hash distinto")
        # Se carga desde memoria porque OpenCV no abre rutas con acentos en Windows.
        self._modelo = np.frombuffer(contenido, dtype=np.uint8)
        self._configuracion = np.array([], dtype=np.uint8)

    def _detectar_vista(self, bgr: Any, umbral: float) -> list[tuple[float, float, float, float, float]]:
        alto, ancho = bgr.shape[:2]
        detector = cv2.FaceDetectorYN.create(
            "onnx", self._modelo, self._configuracion, (ancho, alto), umbral, UMBRAL_NMS, MAX_CARAS
        )
        _, salida = detector.detect(bgr)
        if salida is None:  # pyright: ignore[reportUnnecessaryComparison]
            return []
        return [(float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])) for f in salida]

    def detectar(self, pixeles: Pixeles, umbral: float) -> list[Cara]:
        rgb = pixeles[:, :, :3]
        alto, ancho = rgb.shape[:2]
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        caras: list[Cara] = []

        def agregar(vista: Any, escala: float, dx: int, dy: int) -> None:
            for x, y, w, h, confianza in self._detectar_vista(vista, umbral):
                x0, y0 = max(0, round(x / escala) + dx), max(0, round(y / escala) + dy)
                x1, y1 = min(ancho, round((x + w) / escala) + dx), min(alto, round((y + h) / escala) + dy)
                if x1 > x0 and y1 > y0:
                    caras.append(Cara(x0, y0, x1 - x0, y1 - y0, confianza))

        largo = max(alto, ancho)
        escala = min(1.0, LADO_VISTA_COMPLETA / largo)
        vista = (
            bgr
            if escala == 1.0
            else cv2.resize(
                bgr,
                (max(1, round(ancho * escala)), max(1, round(alto * escala))),
                interpolation=cv2.INTER_AREA,
            )
        )
        agregar(vista, escala, 0, 0)

        # En fotos grandes, las caras chicas se pierden al reducir: se revisa también por mosaicos.
        if largo > LADO_VISTA_COMPLETA:
            escala_m = min(1.0, MAX_LADO_MOSAICOS / largo)
            base = (
                bgr
                if escala_m == 1.0
                else cv2.resize(
                    bgr, (round(ancho * escala_m), round(alto * escala_m)), interpolation=cv2.INTER_AREA
                )
            )
            paso = max(1, int(LADO_MOSAICO * (1 - TRASLAPE)))
            alto_b, ancho_b = base.shape[:2]
            for y in range(0, max(1, alto_b - LADO_MOSAICO + paso), paso):
                for x in range(0, max(1, ancho_b - LADO_MOSAICO + paso), paso):
                    mosaico = base[y : y + LADO_MOSAICO, x : x + LADO_MOSAICO]
                    agregar(mosaico, escala_m, round(x / escala_m), round(y / escala_m))
        return _sin_duplicados(caras)
