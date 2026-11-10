"""Revisión de contenido: de qué trata la imagen (CLIP) y dónde hay zonas sensibles (NudeNet).

La escena no dice dónde está cada cosa: solo permite avisar sobre la imagen completa.
Los puntajes son orientativos y se expresan como "podría": nunca afirman qué muestra la foto.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from .caras import ModeloNoDisponible
from .cargador import Pixeles

ARCHIVO_CLIP = "clip-vit-base-patch32-q.onnx"
SHA256_CLIP = "0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328"
ARCHIVO_TOKENIZADOR = "clip-tokenizer.json"
SHA256_TOKENIZADOR = "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd"
ARCHIVO_NUDENET = "nudenet-320n.onnx"
SHA256_NUDENET = "c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f"

LADO_CLIP = 224
MEDIA_CLIP = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
DESVIACION_CLIP = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
LARGO_TEXTO = 77
RELLENO_TEXTO = 49407

# Cada grupo suma el puntaje de sus frases. Las neutras existen para que una foto común tenga dónde caer.
FRASES_RIESGO: dict[str, tuple[str, ...]] = {
    "ARM-01": (
        "a photo of a person holding a gun or rifle",
        "a photo of soldiers or armed militia in military uniform",
        "a photo of a masked armed fighter",
    ),
    "EXT-01": ("a photo with an extremist or terrorist group flag",),
    "DES-01": ("a photo of a nude person",),
    "SUG-01": (
        "a sexually suggestive picture of a person in revealing clothes",
        "a sexually suggestive anime drawing",
    ),
}
FRASES_NEUTRAS = (
    "a family on vacation at the beach",
    "a selfie of a person",
    "a photo of an airplane or pilot during a flight",
    "a landscape photo",
    "a photo of a document with text",
    "an ordinary photo of daily life",
    "a photo of a wristwatch or clock",
    "an ordinary cartoon or anime drawing",
    "a photo of food or drink",
    "a photo of an animal",
    "a photo of a building or street",
    "a photo of a person at work",
    "a photo of a sports event",
    "a photo of space or the sky",
    "a texture or abstract pattern",
    "a portrait of a person fully dressed",
    "a photo of a national flag at an event",
    "a photo of a police officer or firefighter",
    "a toy or costume party",
)

# Para confirmar una cara dudosa. Incluye caras tapadas o lejanas: no deben descartarse.
FRASES_CARA = (
    "a photo of a human face",
    "a close-up of a person's head",
    "a person wearing a mask or balaclava",
    "a blurry photo of a person's face",
    "a small distant person's face",
    "a drawing of a human face",
)
FRASES_NO_CARA = (
    "a photo of a clock or watch",
    "a photo of an object",
    "a texture or abstract pattern",
    "a photo of an animal",
    "a photo of food or drink",
    "a photo of stars or the sky",
    "a photo of the moon or a planet",
    "a photo of a building",
    "a photo of text",
    "a photo of a plant",
)
MARGEN_RECORTE_CARA = 0.35

# ¿La foto parece tomada en un baño? Va aparte de FRASES_RIESGO a propósito: si compitiera con ellas,
# un desnudo tomado en un baño repartiría su puntaje y DES-01 podría quedar bajo su umbral.
FRASES_BANO = (
    "a photo taken in a bathroom",
    "a mirror selfie in a bathroom",
    "a photo of a shower or bathtub",
    "a photo of a toilet",
)
FRASES_NO_BANO = (
    "a photo taken in a bedroom",
    "a photo taken in a living room",
    "a photo taken in a kitchen",
    "a photo taken in an office",
    "a photo taken in a restaurant or store",
    "a photo taken outdoors",
    "a photo taken at a pool or beach",
    "a close-up photo of an object",
)

ETIQUETAS_NUDENET = (
    "FEMALE_GENITALIA_COVERED",
    "FACE_FEMALE",
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_BREAST_EXPOSED",
    "ANUS_EXPOSED",
    "FEET_EXPOSED",
    "BELLY_COVERED",
    "FEET_COVERED",
    "ARMPITS_COVERED",
    "ARMPITS_EXPOSED",
    "FACE_MALE",
    "BELLY_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_COVERED",
    "FEMALE_BREAST_COVERED",
    "BUTTOCKS_COVERED",
)
REGLA_POR_ETIQUETA = {
    "BUTTOCKS_EXPOSED": "DES-01",
    "FEMALE_BREAST_EXPOSED": "DES-01",
    "FEMALE_GENITALIA_EXPOSED": "DES-01",
    "MALE_GENITALIA_EXPOSED": "DES-01",
    "ANUS_EXPOSED": "DES-01",
    "FEMALE_GENITALIA_COVERED": "SUG-01",
    "FEMALE_BREAST_COVERED": "SUG-01",
    "BUTTOCKS_COVERED": "SUG-01",
    "ANUS_COVERED": "SUG-01",
}
LADO_NUDENET = 320
UMBRAL_NMS = 0.45
# NudeNet marca cada lado del pecho por separado. Se ocultan juntos: dos cuadros sueltos dejan ver la forma.
ETIQUETAS_PECHO = frozenset({"FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED"})
# Son pareja si se solapan en vertical al menos la mitad del más bajo, los separa como mucho 0.6 del ancho
# del más ancho y ninguno mide más del doble que el otro (qa/RANGOS.md, `contenido.pareja_pecho`).
PAREJA_SOLAPE_VERTICAL = 0.5
PAREJA_SEPARACION_MAX = 0.6
PAREJA_PROPORCION_MAX = 2.0
# Las cajas de NudeNet quedan justas sobre la prenda: se agranda cada lado un 15% del tamaño de la zona.
MARGEN_ZONA = 0.15


@dataclass(frozen=True)
class Zona:
    regla_id: str
    x: int
    y: int
    ancho: int
    alto: int
    confianza: float


def leer_verificado(ruta: Path, esperado: str) -> bytes:
    try:
        contenido = ruta.read_bytes()
    except OSError as e:
        raise ModeloNoDisponible("no se pudo leer") from e
    if hashlib.sha256(contenido).hexdigest() != esperado:
        raise ModeloNoDisponible("hash distinto")
    return contenido


def nueva_sesion(contenido: bytes) -> ort.InferenceSession:
    opciones = ort.SessionOptions()
    opciones.log_severity_level = 3
    return ort.InferenceSession(contenido, opciones, providers=["CPUExecutionProvider"])


def _son_pareja(a: Zona, b: Zona) -> bool:
    solape = min(a.y + a.alto, b.y + b.alto) - max(a.y, b.y)
    if solape < PAREJA_SOLAPE_VERTICAL * min(a.alto, b.alto):
        return False
    separacion = max(a.x, b.x) - min(a.x + a.ancho, b.x + b.ancho)
    if separacion > PAREJA_SEPARACION_MAX * max(a.ancho, b.ancho):
        return False
    return (
        max(a.alto, b.alto) <= PAREJA_PROPORCION_MAX * min(a.alto, b.alto)
        and max(a.ancho, b.ancho) <= PAREJA_PROPORCION_MAX * min(a.ancho, b.ancho)
    )


def _unir(a: Zona, b: Zona) -> Zona:
    """Una zona que cubre a las dos. Si una es desnudez, la unión también: gana lo más grave."""
    x0, y0 = min(a.x, b.x), min(a.y, b.y)
    x1, y1 = max(a.x + a.ancho, b.x + b.ancho), max(a.y + a.alto, b.y + b.alto)
    regla = "DES-01" if "DES-01" in (a.regla_id, b.regla_id) else a.regla_id
    return Zona(regla, x0, y0, x1 - x0, y1 - y0, max(a.confianza, b.confianza))


def unir_pechos(pechos: list[Zona]) -> list[Zona]:
    """Une cada lado con su pareja más cercana. Un lado sin pareja se queda como está."""
    centro = [(z.x + z.ancho / 2, z.y + z.alto / 2) for z in pechos]
    candidatas = sorted(
        (float(np.hypot(centro[i][0] - centro[j][0], centro[i][1] - centro[j][1])), i, j)
        for i in range(len(pechos))
        for j in range(i + 1, len(pechos))
        if _son_pareja(pechos[i], pechos[j])
    )
    usadas: set[int] = set()
    salida: list[Zona] = []
    for _, i, j in candidatas:
        if i not in usadas and j not in usadas:
            usadas |= {i, j}
            salida.append(_unir(pechos[i], pechos[j]))
    return salida + [z for k, z in enumerate(pechos) if k not in usadas]


def con_margen(zona: Zona, ancho: int, alto: int) -> Zona:
    mx, my = round(zona.ancho * MARGEN_ZONA), round(zona.alto * MARGEN_ZONA)
    x0, y0 = max(0, zona.x - mx), max(0, zona.y - my)
    x1, y1 = min(ancho, zona.x + zona.ancho + mx), min(alto, zona.y + zona.alto + my)
    return Zona(zona.regla_id, x0, y0, x1 - x0, y1 - y0, zona.confianza)


def decodificar_zonas(salida: Any, ancho: int, alto: int, umbral: float) -> list[Zona]:
    """Convierte la salida de NudeNet en zonas. La imagen entró rellenada hasta quedar cuadrada."""
    filas = np.transpose(salida[0])
    escala = max(ancho, alto) / LADO_NUDENET
    cajas: list[list[int]] = []
    puntajes: list[float] = []
    reglas: list[str] = []
    pecho: list[bool] = []
    for fila in filas:
        clases = fila[4:]
        indice = int(np.argmax(clases))
        puntaje = float(clases[indice])
        regla = REGLA_POR_ETIQUETA.get(ETIQUETAS_NUDENET[indice])
        if regla is None or puntaje < umbral:
            continue
        cx, cy, w, h = (float(v) * escala for v in fila[:4])
        x0, y0 = max(0, round(cx - w / 2)), max(0, round(cy - h / 2))
        x1, y1 = min(ancho, round(cx + w / 2)), min(alto, round(cy + h / 2))
        if x1 > x0 and y1 > y0:
            cajas.append([x0, y0, x1 - x0, y1 - y0])
            puntajes.append(puntaje)
            reglas.append(regla)
            pecho.append(ETIQUETAS_NUDENET[indice] in ETIQUETAS_PECHO)
    if not cajas:
        return []
    indices = [int(v) for v in np.array(cv2.dnn.NMSBoxes(cajas, puntajes, umbral, UMBRAL_NMS)).reshape(-1)]
    zonas = [
        Zona(reglas[i], cajas[i][0], cajas[i][1], cajas[i][2], cajas[i][3], puntajes[i]) for i in indices
    ]
    pechos = [z for i, z in zip(indices, zonas, strict=True) if pecho[i]]
    otras = [z for i, z in zip(indices, zonas, strict=True) if not pecho[i]]
    return [con_margen(z, ancho, alto) for z in unir_pechos(pechos) + otras]


class RevisorContenido:
    def __init__(self, carpeta: Path) -> None:
        tokenizador = Tokenizer.from_str(
            leer_verificado(carpeta / ARCHIVO_TOKENIZADOR, SHA256_TOKENIZADOR).decode("utf-8")
        )
        self._clip = nueva_sesion(leer_verificado(carpeta / ARCHIVO_CLIP, SHA256_CLIP))
        self._nudenet = nueva_sesion(leer_verificado(carpeta / ARCHIVO_NUDENET, SHA256_NUDENET))
        tokenizador.enable_padding(pad_id=RELLENO_TEXTO, length=LARGO_TEXTO)
        tokenizador.enable_truncation(LARGO_TEXTO)
        self._frases = [f for grupo in FRASES_RIESGO.values() for f in grupo] + list(FRASES_NEUTRAS)
        self._grupos = {r: [self._frases.index(f) for f in g] for r, g in FRASES_RIESGO.items()}
        codificado = tokenizador.encode_batch(self._frases)
        self._ids = np.array([e.ids for e in codificado], dtype=np.int64)
        self._mascara = np.array([e.attention_mask for e in codificado], dtype=np.int64)
        codificado_cara = tokenizador.encode_batch([*FRASES_CARA, *FRASES_NO_CARA])
        self._ids_cara = np.array([e.ids for e in codificado_cara], dtype=np.int64)
        self._mascara_cara = np.array([e.attention_mask for e in codificado_cara], dtype=np.int64)
        codificado_bano = tokenizador.encode_batch([*FRASES_BANO, *FRASES_NO_BANO])
        self._ids_bano = np.array([e.ids for e in codificado_bano], dtype=np.int64)
        self._mascara_bano = np.array([e.attention_mask for e in codificado_bano], dtype=np.int64)

    def _entrada_completa(self, pixeles: Pixeles) -> Any:
        """Recorte central de 224 px de la imagen completa, normalizado para CLIP."""
        rgb = pixeles[:, :, :3]
        alto, ancho = rgb.shape[:2]
        escala = LADO_CLIP / min(alto, ancho)
        nuevo = (max(LADO_CLIP, round(ancho * escala)), max(LADO_CLIP, round(alto * escala)))
        reducida = cv2.resize(rgb, nuevo, interpolation=cv2.INTER_AREA if escala < 1 else cv2.INTER_CUBIC)
        y, x = (nuevo[1] - LADO_CLIP) // 2, (nuevo[0] - LADO_CLIP) // 2
        recorte = reducida[y : y + LADO_CLIP, x : x + LADO_CLIP].astype(np.float32) / 255
        return ((recorte - MEDIA_CLIP) / DESVIACION_CLIP).transpose(2, 0, 1)[None].astype(np.float32)

    def escena(self, pixeles: Pixeles) -> dict[str, float]:
        """Probabilidad de cada grupo de riesgo. Suman menos de 1 porque compiten con las frases neutras."""
        entrada = self._entrada_completa(pixeles)
        salidas: Any = self._clip.run(
            ["logits_per_image"],
            {"pixel_values": entrada, "input_ids": self._ids, "attention_mask": self._mascara},
        )
        logits = salidas[0][0]
        exponente = np.exp(logits - logits.max())
        probabilidad = exponente / exponente.sum()
        return {r: float(probabilidad[i].sum()) for r, i in self._grupos.items()}

    def probabilidad_cara(self, pixeles: Pixeles, x: int, y: int, ancho: int, alto: int) -> float:
        """Qué tan probable es que un recorte, con algo de contexto, sea una cara de verdad."""
        alto_img, ancho_img = pixeles.shape[:2]
        mx, my = int(ancho * MARGEN_RECORTE_CARA), int(alto * MARGEN_RECORTE_CARA)
        recorte = pixeles[
            max(0, y - my) : min(alto_img, y + alto + my), max(0, x - mx) : min(ancho_img, x + ancho + mx), :3
        ]
        reducido = cv2.resize(recorte, (LADO_CLIP, LADO_CLIP), interpolation=cv2.INTER_CUBIC)
        normalizado = (reducido.astype(np.float32) / 255 - MEDIA_CLIP) / DESVIACION_CLIP
        salidas: Any = self._clip.run(
            ["logits_per_image"],
            {
                "pixel_values": normalizado.transpose(2, 0, 1)[None].astype(np.float32),
                "input_ids": self._ids_cara,
                "attention_mask": self._mascara_cara,
            },
        )
        logits = salidas[0][0]
        exponente = np.exp(logits - logits.max())
        return float((exponente / exponente.sum())[: len(FRASES_CARA)].sum())

    def probabilidad_bano(self, pixeles: Pixeles) -> float:
        """Qué tan probable es que la foto completa esté tomada en un baño."""
        salidas: Any = self._clip.run(
            ["logits_per_image"],
            {
                "pixel_values": self._entrada_completa(pixeles),
                "input_ids": self._ids_bano,
                "attention_mask": self._mascara_bano,
            },
        )
        logits = salidas[0][0]
        exponente = np.exp(logits - logits.max())
        return float((exponente / exponente.sum())[: len(FRASES_BANO)].sum())

    def zonas(self, pixeles: Pixeles, umbral: float) -> list[Zona]:
        bgr = pixeles[:, :, 2::-1]
        alto, ancho = bgr.shape[:2]
        lado = max(alto, ancho)
        cuadrada = cv2.copyMakeBorder(bgr, 0, lado - alto, 0, lado - ancho, cv2.BORDER_CONSTANT)
        entrada = cv2.dnn.blobFromImage(
            cuadrada, 1 / 255.0, (LADO_NUDENET, LADO_NUDENET), (0, 0, 0), swapRB=True, crop=False
        )
        salida = self._nudenet.run(None, {self._nudenet.get_inputs()[0].name: entrada})[0]
        return decodificar_zonas(salida, ancho, alto, umbral)


@lru_cache(maxsize=1)
def revisor_de(carpeta: Path) -> RevisorContenido:
    """Cargar los modelos tarda: se hace una vez por proceso."""
    return RevisorContenido(carpeta)
