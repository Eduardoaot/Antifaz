"""Detección de caras con YuNet, filtrada por la geometría de sus puntos faciales."""

from __future__ import annotations

import hashlib
import logging
import math
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


def _decodificar_candidatas(salida: Any) -> list[tuple[float, float, float, float, float]]:
    return [
        (float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14]))
        for f in salida
        if forma_de_cara([float(v) for v in f[:14]])
    ]


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


def forma_de_cara(f: list[float]) -> bool:
    """Si los 5 puntos de YuNet se acomodan como en una cara, sin importar el giro.

    `f` es [x, y, ancho, alto, ojo derecho x, y, ojo izquierdo x, y, nariz x, y, boca derecha x, y,
    boca izquierda x, y]. Solo usa distancias entre puntos, así una cara de lado o acostada pasa igual.
    """
    x, y, w, h = f[0], f[1], f[2], f[3]
    if w <= 0 or h <= 0:
        return False
    ojo_d, ojo_i = (f[4], f[5]), (f[6], f[7])
    nariz, boca_d, boca_i = (f[8], f[9]), (f[10], f[11]), (f[12], f[13])
    margen_x, margen_y = 0.15 * w, 0.15 * h
    for px, py in (ojo_d, ojo_i, nariz, boca_d, boca_i):
        if not (x - margen_x <= px <= x + w + margen_x and y - margen_y <= py <= y + h + margen_y):
            return False
    centro_ojos = ((ojo_d[0] + ojo_i[0]) / 2, (ojo_d[1] + ojo_i[1]) / 2)
    centro_boca = ((boca_d[0] + boca_i[0]) / 2, (boca_d[1] + boca_i[1]) / 2)
    entre_ojos = math.dist(ojo_d, ojo_i)
    ojos_a_boca = math.dist(centro_ojos, centro_boca)
    ancho_boca = math.dist(boca_d, boca_i)
    lado = max(w, h)
    if not (0.12 * lado <= entre_ojos <= 0.8 * lado and 0.15 * lado <= ojos_a_boca <= 0.9 * lado):
        return False
    # De frente la boca está a ~1.1 veces la distancia entre ojos; de perfil, los ojos se juntan.
    if not 0.5 <= ojos_a_boca / entre_ojos <= 3.0:
        return False
    if not 0.25 * entre_ojos <= ancho_boca <= 1.6 * entre_ojos:
        return False
    # La nariz queda entre los ojos y la boca, no lejos de ambos.
    cerca_de_ojos = math.dist(nariz, centro_ojos) < 1.2 * ojos_a_boca
    cerca_de_boca = math.dist(nariz, centro_boca) < 1.2 * ojos_a_boca
    return cerca_de_ojos and cerca_de_boca


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
        return _decodificar_candidatas(salida)

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
