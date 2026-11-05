"""Arma las advertencias de una imagen y dice con honestidad qué se revisó y qué no."""

from __future__ import annotations

import logging
from typing import Any

from .caras import DetectorCaras, ModeloNoDisponible
from .cargador import ImagenCargada

registro = logging.getLogger(__name__)

# Lo que esta versión sabe revisar. La UI compara contra el catálogo para decir qué falta.
REGLAS_DE_CARAS = ("CAR-01", "MEN-01")
REGLA_DE_METADATOS = "UBI-01"


def describir_posicion(x: int, y: int, ancho: int, alto: int, ancho_img: int, alto_img: int) -> str:
    """Posición en palabras, para quien no puede ver la imagen."""
    cx, cy = (x + ancho / 2) / ancho_img, (y + alto / 2) / alto_img
    vertical = "superior" if cy < 1 / 3 else "inferior" if cy > 2 / 3 else "central"
    horizontal = "izquierda" if cx < 1 / 3 else "derecha" if cx > 2 / 3 else "centro"
    if vertical == "central" and horizontal == "centro":
        return "al centro"
    if vertical == "central":
        return f"en el lado {'izquierdo' if horizontal == 'izquierda' else 'derecho'}"
    if horizontal == "centro":
        return f"en la parte {vertical}, al centro"
    return f"en la parte {vertical} {horizontal}"


def _ampliar(
    x: int, y: int, ancho: int, alto: int, factor: float, img_ancho: int, img_alto: int
) -> dict[str, int]:
    nuevo_ancho, nuevo_alto = round(ancho * factor), round(alto * factor)
    x0 = max(0, x - (nuevo_ancho - ancho) // 2)
    y0 = max(0, y - (nuevo_alto - alto) // 2)
    return {
        "x": x0,
        "y": y0,
        "ancho": min(img_ancho - x0, nuevo_ancho),
        "alto": min(img_alto - y0, nuevo_alto),
    }


def analizar(
    imagen: ImagenCargada,
    carpeta_modelos: Any,
    umbral_confianza: float,
    umbral_revision: float,
    multiplicador_cara: float,
) -> dict[str, object]:
    hallazgos: list[dict[str, object]] = []
    motivos: list[str] = []
    revisadas: list[str] = []

    if imagen.tiene_gps:
        hallazgos.append(
            {
                "id": "gps",
                "regla_id": "UBI-01",
                "caja": None,
                "confianza": 1.0,
                "requiere_revision": False,
                "posicion": None,
            }
        )
    if not imagen.metadatos_legibles:
        motivos.append("metadatos")

    if imagen.demasiado_pequena:
        motivos.append("demasiado_pequena")
    else:
        try:
            caras = DetectorCaras(carpeta_modelos).detectar(imagen.pixeles, umbral_confianza)
        except ModeloNoDisponible as e:
            registro.error("Modelo de caras no disponible: %s", e)
            motivos.append("modelo_no_disponible")
        except Exception as e:  # noqa: BLE001 - la falla se informa como análisis parcial, nunca como limpio
            registro.error("Falló la detección de caras: %s", type(e).__name__)
            motivos.append("deteccion_fallo")
        else:
            for i, cara in enumerate(caras):
                hallazgos.append(
                    {
                        "id": f"cara-{i}",
                        "regla_id": "CAR-01",
                        "caja": _ampliar(
                            cara.x,
                            cara.y,
                            cara.ancho,
                            cara.alto,
                            multiplicador_cara,
                            imagen.ancho,
                            imagen.alto,
                        ),
                        "confianza": round(cara.confianza, 3),
                        "requiere_revision": cara.confianza < umbral_revision,
                        "posicion": describir_posicion(
                            cara.x, cara.y, cara.ancho, cara.alto, imagen.ancho, imagen.alto
                        ),
                    }
                )
            revisadas.extend(REGLAS_DE_CARAS)
            # Una posible cara no basta para preguntar por menores: un reloj no lo amerita.
            if any(c.confianza >= umbral_revision for c in caras):
                hallazgos.append(
                    {
                        "id": "menores",
                        "regla_id": "MEN-01",
                        "caja": None,
                        "confianza": 1.0,
                        "requiere_revision": True,
                        "posicion": None,
                    }
                )
    # Una regla que no se pudo revisar debe seguir contando como pendiente.
    if imagen.metadatos_legibles:
        revisadas.append(REGLA_DE_METADATOS)
    return {
        "hallazgos": hallazgos,
        "cobertura": {
            "completa": not motivos,
            "motivos": motivos,
            "reglas_revisadas": revisadas,
        },
    }
