"""Mide si la app trata distinto a distintos grupos de personas. No es parte de la app.

Qué mide, por grupo (por ejemplo, tono de piel en la escala Monk, género percibido o edad aparente):
- Recall de caras: cuántas caras reales encuentra YuNet con el umbral de la app. Una cara que no se
  encuentra no se puede ocultar, y tampoco dispara la pregunta de menores.
- Recall de "cara segura" (confianza de 0.6 o más): de eso depende la pregunta "¿Hay menores?".
- Falsas alarmas de desnudez y contenido sugerente en fotos que no lo tienen. Los clasificadores de
  este tipo marcan de más ciertos cuerpos y tonos de piel; aquí se cuenta cuánto.

La brecha es la diferencia entre el mejor y el peor grupo. Solo se compara con grupos de al menos
`--minimo` fotos: con menos, la diferencia es ruido. El umbral de brecha es una propuesta hasta que
el responsable apruebe uno, como el recall mínimo de qa/PLAN_QA.md.

Las etiquetas de grupo solo existen en el dataset de evaluación. La app nunca estima grupo, edad ni
género de nadie.

Uso, con el Python del sidecar (necesita los modelos):

    sidecar/.venv/Scripts/python tools/medir_sesgo.py --manifiesto C:/datos/sesgo.csv --salida reporte.json

El manifiesto es un CSV con columnas `archivo`, `grupo`, `caras` y `contenido_sensible`:
- `caras`: JSON con las cajas reales, por ejemplo `[[10, 20, 80, 90]]` (x, y, ancho, alto).
- `contenido_sensible`: 1 si la foto tiene desnudez o contenido sugerente, 0 si no.
Ni el dataset ni el manifiesto se versionan: tienen fotos de personas y rutas del equipo. El reporte
solo lleva grupos y conteos, nunca rutas ni imágenes.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

Caja = tuple[int, int, int, int]

IOU_ACIERTO = 0.5
UMBRAL_CARA_APP = 0.25  # sidecar/revisor/esquemas.py, Analizar.umbral_confianza
UMBRAL_CARA_SEGURA = 0.6  # sidecar/revisor/esquemas.py, Analizar.umbral_revision
MINIMO_POR_GRUPO = 30
# Propuesta sin aprobar: hasta 5 puntos de diferencia entre el mejor y el peor grupo.
BRECHA_MAXIMA = 0.05
Z_95 = 1.959964


def iou(a: Caja, b: Caja) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    interseccion = max(0, x1 - x0) * max(0, y1 - y0)
    union = a[2] * a[3] + b[2] * b[3] - interseccion
    return interseccion / union if union > 0 else 0.0


def aciertos(reales: Sequence[Caja], detectadas: Sequence[Caja], minimo_iou: float = IOU_ACIERTO) -> int:
    """Cuántas caras reales encontró el detector. Cada detección cuenta para una sola cara."""
    pares = sorted(
        ((iou(r, d), i, j) for i, r in enumerate(reales) for j, d in enumerate(detectadas)),
        reverse=True,
    )
    usadas_r: set[int] = set()
    usadas_d: set[int] = set()
    for valor, i, j in pares:
        if valor < minimo_iou:
            break
        if i in usadas_r or j in usadas_d:
            continue
        usadas_r.add(i)
        usadas_d.add(j)
    return len(usadas_r)


def wilson(exitos: int, total: int) -> tuple[float, float]:
    """Intervalo de 95% para una proporción. Con pocos datos es ancho, y así debe leerse."""
    if total <= 0:
        raise ValueError("total debe ser positivo")
    if not 0 <= exitos <= total:
        raise ValueError("éxitos fuera de rango")
    p = exitos / total
    centro = (p + Z_95**2 / (2 * total)) / (1 + Z_95**2 / total)
    radio = Z_95 * math.sqrt(p * (1 - p) / total + Z_95**2 / (4 * total**2)) / (1 + Z_95**2 / total)
    return max(0.0, centro - radio), min(1.0, centro + radio)


@dataclass
class Conteo:
    exitos: int = 0
    total: int = 0

    def tasa(self) -> float | None:
        return self.exitos / self.total if self.total > 0 else None


@dataclass
class Grupo:
    fotos: int = 0
    caras: Conteo = field(default_factory=Conteo)
    caras_seguras: Conteo = field(default_factory=Conteo)
    falsas_alarmas: Conteo = field(default_factory=Conteo)


@dataclass(frozen=True)
class Brecha:
    metrica: str
    mejor: str
    peor: str
    diferencia: float
    excede: bool


def brecha(
    grupos: dict[str, Grupo], metrica: str, minimo: int, maxima: float, mayor_es_mejor: bool
) -> Brecha | None:
    """Diferencia entre el mejor y el peor grupo con datos suficientes. None si hay menos de dos."""
    tasas: list[tuple[float, str]] = []
    for nombre, g in grupos.items():
        conteo: Conteo = getattr(g, metrica)
        tasa = conteo.tasa()
        if tasa is not None and conteo.total >= minimo:
            tasas.append((tasa, nombre))
    if len(tasas) < 2:
        return None
    tasas.sort(reverse=mayor_es_mejor)
    (mejor_tasa, mejor), (peor_tasa, peor) = tasas[0], tasas[-1]
    diferencia = abs(mejor_tasa - peor_tasa)
    return Brecha(metrica, mejor, peor, round(diferencia, 4), diferencia > maxima)


@dataclass(frozen=True)
class Foto:
    archivo: Path
    grupo: str
    caras: tuple[Caja, ...]
    contenido_sensible: bool


def leer_manifiesto(filas: Iterable[dict[str, str]], base: Path) -> list[Foto]:
    """Valida cada fila. Una fila inválida detiene todo: un reporte con datos a medias engaña."""
    fotos: list[Foto] = []
    for n, fila in enumerate(filas, start=2):
        try:
            grupo = fila["grupo"].strip()
            if not grupo:
                raise ValueError("grupo vacío")
            crudas = json.loads(fila["caras"] or "[]")
            if not isinstance(crudas, list):
                raise ValueError("caras debe ser una lista")
            caras: list[Caja] = []
            for c in crudas:
                if not (isinstance(c, list) and len(c) == 4 and all(isinstance(v, int) for v in c)):
                    raise ValueError("cada caja debe ser [x, y, ancho, alto] con enteros")
                if c[0] < 0 or c[1] < 0 or c[2] < 1 or c[3] < 1:
                    raise ValueError("caja fuera de rango")
                caras.append((c[0], c[1], c[2], c[3]))
            sensible = fila["contenido_sensible"].strip()
            if sensible not in ("0", "1"):
                raise ValueError("contenido_sensible debe ser 0 o 1")
            archivo = (base / fila["archivo"]).resolve()
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            # Sin el contenido de la fila: puede traer rutas.
            raise ValueError(f"fila {n} inválida: {type(e).__name__}: {e}") from e
        fotos.append(Foto(archivo, grupo, tuple(caras), sensible == "1"))
    if not fotos:
        raise ValueError("el manifiesto no tiene fotos")
    return fotos


def medir(fotos: Sequence[Foto], carpeta_modelos: Path) -> dict[str, Grupo]:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "sidecar"))
    from revisor import analisis, cargador, contenido
    from revisor.caras import DetectorCaras

    detector = DetectorCaras(carpeta_modelos)
    revisor = contenido.revisor_de(carpeta_modelos)
    grupos: dict[str, Grupo] = {}
    for foto in fotos:
        g = grupos.setdefault(foto.grupo, Grupo())
        g.fotos += 1
        imagen = cargador.abrir(str(foto.archivo))
        detectadas = detector.detectar(imagen.pixeles, UMBRAL_CARA_APP)
        cajas = [(c.x, c.y, c.ancho, c.alto) for c in detectadas]
        seguras = [(c.x, c.y, c.ancho, c.alto) for c in detectadas if c.confianza >= UMBRAL_CARA_SEGURA]
        g.caras.total += len(foto.caras)
        g.caras.exitos += aciertos(foto.caras, cajas)
        g.caras_seguras.total += len(foto.caras)
        g.caras_seguras.exitos += aciertos(foto.caras, seguras)
        if not foto.contenido_sensible:
            escena = revisor.escena(imagen.pixeles)
            alarma = max(escena["DES-01"], escena["SUG-01"]) >= analisis.UMBRAL_ESCENA
            g.falsas_alarmas.total += 1
            g.falsas_alarmas.exitos += int(alarma)
    return grupos


def reporte(grupos: dict[str, Grupo], minimo: int, maxima: float) -> dict[str, object]:
    brechas = [
        b
        for b in (
            brecha(grupos, "caras", minimo, maxima, mayor_es_mejor=True),
            brecha(grupos, "caras_seguras", minimo, maxima, mayor_es_mejor=True),
            brecha(grupos, "falsas_alarmas", minimo, maxima, mayor_es_mejor=False),
        )
        if b is not None
    ]
    por_grupo: dict[str, object] = {}
    for nombre, g in sorted(grupos.items()):
        datos: dict[str, object] = {"fotos": g.fotos}
        for metrica in ("caras", "caras_seguras", "falsas_alarmas"):
            conteo: Conteo = getattr(g, metrica)
            tasa = conteo.tasa()
            datos[metrica] = {
                **asdict(conteo),
                "tasa": None if tasa is None else round(tasa, 4),
                "ic95": None if tasa is None else [round(v, 4) for v in wilson(conteo.exitos, conteo.total)],
                "suficiente": conteo.total >= minimo,
            }
        por_grupo[nombre] = datos
    return {
        "minimo_por_grupo": minimo,
        "brecha_maxima": maxima,
        "grupos": por_grupo,
        "brechas": [asdict(b) for b in brechas],
        "aprobado": bool(brechas) and not any(b.excede for b in brechas),
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    opciones = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    opciones.add_argument("--manifiesto", type=Path, required=True)
    opciones.add_argument(
        "--modelos", type=Path, default=Path(__file__).resolve().parent.parent / "sidecar" / "modelos"
    )
    opciones.add_argument("--minimo", type=int, default=MINIMO_POR_GRUPO)
    opciones.add_argument("--brecha", type=float, default=BRECHA_MAXIMA)
    opciones.add_argument("--salida", type=Path)
    args = opciones.parse_args()
    if args.minimo < 1 or not 0 < args.brecha < 1:
        print("ERROR: --minimo debe ser 1 o más y --brecha estar entre 0 y 1")
        return 2
    with args.manifiesto.open(encoding="utf-8", newline="") as archivo:
        fotos = leer_manifiesto(csv.DictReader(archivo), args.manifiesto.parent)
    resultado = reporte(medir(fotos, args.modelos), args.minimo, args.brecha)
    texto = json.dumps(resultado, ensure_ascii=False, indent=2)
    if args.salida is not None:
        args.salida.write_text(texto + "\n", encoding="utf-8")
    print(texto)
    if not resultado["brechas"]:
        print(
            "SIN DATOS SUFICIENTES: hacen falta dos grupos o más con el mínimo de fotos. No se aprueba nada."
        )
        return 1
    print(
        "APROBADO" if resultado["aprobado"] else "BRECHA EXCESIVA: revisa umbrales y modelos antes de seguir."
    )
    return 0 if resultado["aprobado"] else 1


if __name__ == "__main__":
    sys.exit(main())
