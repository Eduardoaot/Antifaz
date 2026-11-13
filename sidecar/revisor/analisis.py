"""Arma las advertencias de una imagen y dice con honestidad qué se revisó y qué no."""

from __future__ import annotations

import logging
from typing import Any

from . import codigos, contenido, objetos, texto
from .caras import Cara, DetectorCaras, ModeloNoDisponible
from .cargador import ImagenCargada

registro = logging.getLogger(__name__)

# Lo que esta versión sabe revisar. La UI compara contra el catálogo para decir qué falta.
REGLAS_DE_CARAS = ("CAR-01", "MEN-01")
REGLA_DE_METADATOS = "UBI-01"
REGLAS_DE_CONTENIDO = ("ARM-01", "EXT-01", "DES-01", "SUG-01")
REGLA_DE_BANO = "INT-01"
# Propuesta sin medir (2026-11-06). Es riesgo bajo y solo avisa: nunca oculta nada por sí sola.
UMBRAL_BANO = 0.6
# Medido en una muestra chica: imágenes comunes hasta 0.19, ejemplos de riesgo desde 0.71.
UMBRAL_ESCENA = 0.35
# Las protestas con banderas comunes dieron hasta 0.50, y los ejemplos reales desde 0.72.
UMBRAL_ESCENA_EXTREMISMO = 0.6
# Falsas alarmas de desnudez: confianza hasta 0.66 con escena hasta 0.10 (celulares, comida, monitores).
DESNUDEZ_SEGURA = 0.7
ESCENA_RESPALDA_DESNUDEZ = 0.1
UMBRAL_ZONAS = 0.25
# Medido en una muestra chica: falsas alarmas hasta 0.49, caras reales dudosas desde 0.82.
UMBRAL_CONFIRMAR_CARA = 0.6
REGLAS_DE_TEXTO = ("CON-01", "DOC-01", "FIN-01", "MED-01", "VIA-01")
REGLA_DE_CODIGOS = "COD-01"


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


def _nucleo(cara: Cara, img_ancho: int, img_alto: int) -> dict[str, int] | None:
    """La caja del detector, recortada a la foto. Permite hacer un sticker más chico sin destapar la cara."""
    x0, y0 = max(0, cara.x), max(0, cara.y)
    x1, y1 = min(img_ancho, cara.x + cara.ancho), min(img_alto, cara.y + cara.alto)
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x": x0, "y": y0, "ancho": x1 - x0, "alto": y1 - y0}


def _umbral_escena(regla: str) -> float:
    return UMBRAL_ESCENA_EXTREMISMO if regla == "EXT-01" else UMBRAL_ESCENA


def _zona_creible(zona: contenido.Zona, escena: dict[str, float]) -> bool:
    if zona.regla_id == "SUG-01":
        # Una parte cubierta (por ejemplo, un traje de baño) no basta para llamarla sugerente.
        return escena["SUG-01"] >= _umbral_escena(zona.regla_id)
    if zona.regla_id != "DES-01" or zona.confianza >= DESNUDEZ_SEGURA:
        return True
    return escena["DES-01"] + escena["SUG-01"] >= ESCENA_RESPALDA_DESNUDEZ


def _confirmar_dudosas(
    caras: list[Cara], imagen: ImagenCargada, carpeta_modelos: Any, umbral_revision: float
) -> list[Cara]:
    """Quita falsas alarmas como relojes o texturas. Una cara con confianza alta nunca se descarta.

    Si no se puede confirmar, se conserva: ante la duda, avisar de más.
    """
    dudosas = [c for c in caras if c.confianza < umbral_revision]
    if not dudosas:
        return caras
    try:
        revisor = contenido.revisor_de(carpeta_modelos)
        return [
            c
            for c in caras
            if c.confianza >= umbral_revision
            or revisor.probabilidad_cara(imagen.pixeles, c.x, c.y, c.ancho, c.alto) >= UMBRAL_CONFIRMAR_CARA
        ]
    except Exception as e:  # noqa: BLE001 - sin confirmación se conservan todas
        registro.warning("No se pudieron confirmar caras dudosas: %s", type(e).__name__)
        return caras


def _revisar_objetos(
    imagen: ImagenCargada,
    carpeta_modelos: Any,
    umbral_revision: float,
    escena: dict[str, float],
    hallazgos: list[dict[str, object]],
    motivos: list[str],
    revisadas: list[str],
) -> set[str]:
    """Devuelve las reglas que ya tienen zona, para no repetir su aviso general."""
    try:
        encontrados = objetos.detector_de(carpeta_modelos).buscar(imagen.pixeles)
    except ModeloNoDisponible as e:
        registro.error("Detector de objetos no disponible: %s", e)
        motivos.append("objetos_no_disponible")
        return set()
    except Exception as e:  # noqa: BLE001 - parcial, nunca limpio
        registro.error("Falló el detector de objetos: %s", type(e).__name__)
        motivos.append("objetos_fallo")
        return set()
    revisadas.extend(objetos.REGLAS_DE_OBJETOS)
    # Una bandera no significa nada por sí sola: solo cuenta si la escena ya parece extremista.
    extremista = escena["EXT-01"] >= UMBRAL_ESCENA_EXTREMISMO
    validos = [o for o in encontrados if o.regla_id != "EXT-01" or extremista]
    for i, o in enumerate(validos):
        hallazgos.append(
            {
                "id": f"objeto-{i}",
                "regla_id": o.regla_id,
                "caja": {"x": o.x, "y": o.y, "ancho": o.ancho, "alto": o.alto},
                "confianza": round(o.confianza, 3),
                "requiere_revision": o.confianza < umbral_revision,
                "posicion": describir_posicion(o.x, o.y, o.ancho, o.alto, imagen.ancho, imagen.alto),
            }
        )
    return {o.regla_id for o in validos}


def _revisar_contenido(
    imagen: ImagenCargada,
    carpeta_modelos: Any,
    umbral_revision: float,
    hallazgos: list[dict[str, object]],
    motivos: list[str],
    revisadas: list[str],
) -> None:
    try:
        revisor = contenido.revisor_de(carpeta_modelos)
        escena = revisor.escena(imagen.pixeles)
        zonas = revisor.zonas(imagen.pixeles, UMBRAL_ZONAS)
        bano = revisor.probabilidad_bano(imagen.pixeles)
    except ModeloNoDisponible as e:
        registro.error("Modelos de contenido no disponibles: %s", e)
        motivos.append("contenido_no_disponible")
        return
    except Exception as e:  # noqa: BLE001 - la falla se informa como análisis parcial, nunca como limpio
        registro.error("Falló la revisión de contenido: %s", type(e).__name__)
        motivos.append("contenido_fallo")
        return
    revisadas.extend(REGLAS_DE_CONTENIDO)
    revisadas.append(REGLA_DE_BANO)
    if bano >= UMBRAL_BANO:
        hallazgos.append(
            {
                "id": "escena-INT-01",
                "regla_id": REGLA_DE_BANO,
                "caja": None,
                "confianza": round(bano, 3),
                "requiere_revision": True,
                "posicion": None,
            }
        )
    zonas = [z for z in zonas if _zona_creible(z, escena)]
    for i, zona in enumerate(zonas):
        hallazgos.append(
            {
                "id": f"zona-{i}",
                "regla_id": zona.regla_id,
                "caja": {"x": zona.x, "y": zona.y, "ancho": zona.ancho, "alto": zona.alto},
                "confianza": round(zona.confianza, 3),
                "requiere_revision": zona.confianza < umbral_revision,
                "posicion": describir_posicion(
                    zona.x, zona.y, zona.ancho, zona.alto, imagen.ancho, imagen.alto
                ),
            }
        )
    con_zona = {zona.regla_id for zona in zonas} | _revisar_objetos(
        imagen, carpeta_modelos, umbral_revision, escena, hallazgos, motivos, revisadas
    )
    for regla in REGLAS_DE_CONTENIDO:
        # Si ya se sabe dónde está, el aviso por zona lo cubre.
        if escena[regla] >= _umbral_escena(regla) and regla not in con_zona:
            hallazgos.append(
                {
                    "id": f"escena-{regla}",
                    "regla_id": regla,
                    "caja": None,
                    "confianza": round(escena[regla], 3),
                    "requiere_revision": True,
                    "posicion": None,
                }
            )


def _revisar_texto(
    imagen: ImagenCargada,
    umbral_revision: float,
    hallazgos: list[dict[str, object]],
    motivos: list[str],
    revisadas: list[str],
) -> None:
    try:
        zonas = texto.buscar(imagen.pixeles)
    except Exception as e:  # noqa: BLE001 - parcial, nunca limpio. El mensaje podría traer texto de la imagen
        registro.error("Falló el OCR: %s", type(e).__name__)
        motivos.append("texto_fallo")
        return
    revisadas.extend(REGLAS_DE_TEXTO)
    for i, zona in enumerate(zonas):
        hallazgos.append(
            {
                "id": f"texto-{i}",
                "regla_id": zona.regla_id,
                "caja": {"x": zona.x, "y": zona.y, "ancho": zona.ancho, "alto": zona.alto},
                "confianza": round(zona.confianza, 3),
                "requiere_revision": zona.confianza < umbral_revision,
                "posicion": describir_posicion(
                    zona.x, zona.y, zona.ancho, zona.alto, imagen.ancho, imagen.alto
                ),
            }
        )


def _revisar_codigos(
    imagen: ImagenCargada,
    hallazgos: list[dict[str, object]],
    motivos: list[str],
    revisadas: list[str],
) -> None:
    try:
        encontrados = codigos.buscar(imagen.pixeles)
    except Exception as e:  # noqa: BLE001 - parcial, nunca limpio
        registro.error("Falló la lectura de códigos: %s", type(e).__name__)
        motivos.append("codigos_fallo")
        return
    revisadas.append(REGLA_DE_CODIGOS)
    for i, c in enumerate(encontrados):
        hallazgos.append(
            {
                "id": f"codigo-{i}",
                "regla_id": c.regla_id,
                "caja": {"x": c.x, "y": c.y, "ancho": c.ancho, "alto": c.alto},
                "confianza": 1.0,
                "requiere_revision": False,
                "posicion": describir_posicion(c.x, c.y, c.ancho, c.alto, imagen.ancho, imagen.alto),
            }
        )


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
            caras = _confirmar_dudosas(caras, imagen, carpeta_modelos, umbral_revision)
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
                        "nucleo": _nucleo(cara, imagen.ancho, imagen.alto),
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
    if not imagen.demasiado_pequena:
        _revisar_contenido(imagen, carpeta_modelos, umbral_revision, hallazgos, motivos, revisadas)
        _revisar_texto(imagen, umbral_revision, hallazgos, motivos, revisadas)
        _revisar_codigos(imagen, hallazgos, motivos, revisadas)

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
