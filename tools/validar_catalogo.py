"""Valida rules/catalogo.json: esquema, reglas de negocio y, con --urls, cada enlace.

Uso: python tools/validar_catalogo.py [--urls]
Sale con código 1 si algo falla.
"""
from __future__ import annotations

import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

from jsonschema import Draft202012Validator

RAIZ = Path(__file__).resolve().parent.parent
CATEGORIAS = {
    "caras_terceros", "posibles_menores", "documentos_identidad", "informacion_financiera",
    "boletos_viajes", "ubicacion", "matriculas", "objetos_valor", "pantallas",
    "contacto_personal", "informacion_medica", "codigos",
    "desnudez", "contenido_sugerente", "armas", "extremismo",
}
# Mínimos del brief para cada categoría.
PALABRAS_PROHIBIDAS = re.compile(r"peligro|ilegal|delito|seguro para publicar|!", re.IGNORECASE)
AGENTE = "revisor-catalogo/0.1 (comprobador de enlaces)"
# Estos códigos indican que el sitio rechaza robots, no que el enlace esté muerto.
RECHAZO_A_ROBOTS = (400, 401, 403, 429)


def validar(cat: dict, esquema: dict) -> list[str]:
    errores = [
        f"esquema: {'/'.join(map(str, e.path))}: {e.message}"
        for e in Draft202012Validator(esquema).iter_errors(cat)
    ]
    if errores:
        return errores

    reglas = cat["reglas"]
    ids = [r["id"] for r in reglas]
    for repetido in {i for i in ids if ids.count(i) > 1}:
        errores.append(f"id repetido: {repetido}")
    for faltante in CATEGORIAS - {r["categoria"] for r in reglas}:
        errores.append(f"categoría sin regla: {faltante}")

    for r in reglas:
        rid = r["id"]
        if PALABRAS_PROHIBIDAS.search(r["por_que"]):
            errores.append(f"{rid}: el tono de por_que no cumple la marca")
        if len(re.findall(r"[.?]\s|[.?]$", r["por_que"])) > 2:
            errores.append(f"{rid}: por_que tiene más de 2 frases")
        if r["estado"] == "verificada":
            directas = [f for f in r["fuentes"] if f["respaldo"] == "directo" and f["verificacion"] == "abierta"]
            if not directas:
                errores.append(f"{rid}: verificada sin fuente directa abierta")
            if not any(f["tipo"] != "prensa" for f in directas):
                errores.append(f"{rid}: verificada solo con prensa")
        elif "nota" not in r:
            errores.append(f"{rid}: pendiente sin nota que explique por qué")
        for f in r["fuentes"]:
            if f["tipo"] == "documento_historico" and f["vigente"] is not False:
                errores.append(f"{rid}: documento histórico marcado como vigente")

    menores = [r for r in reglas if r["categoria"] == "posibles_menores"]
    for r in menores:
        if r.get("requiere_confirmacion") is not True:
            errores.append(f"{r['id']}: menores debe pedir confirmación")
        if re.search(r"\d+\s*años|es menor|es un menor", r["por_que"] + r.get("texto_aviso", ""), re.IGNORECASE):
            errores.append(f"{r['id']}: no se puede afirmar una edad")
    return errores


def revisar_urls(cat: dict) -> list[str]:
    urls = sorted({f["url"] for f in cat["marco_general"]} | {f["url"] for r in cat["reglas"] for f in r["fuentes"]})
    errores = []
    sin_comprobar = []
    for url in urls:
        peticion = urllib.request.Request(url, headers={"User-Agent": AGENTE})
        try:
            with urllib.request.urlopen(peticion, timeout=40) as respuesta:
                print(f"{respuesta.status} {url}")
        except urllib.error.HTTPError as e:
            print(f"{e.code} {url}")
            if e.code in RECHAZO_A_ROBOTS:
                sin_comprobar.append(url)
            else:
                errores.append(f"url rota ({e.code}): {url}")
        except urllib.error.URLError as e:
            print(f"ERR {url} ({e})")
            # Un certificado rechazado depende de esta red, no prueba que el enlace esté muerto.
            if isinstance(e.reason, ssl.SSLError):
                sin_comprobar.append(url)
            else:
                errores.append(f"url sin respuesta: {url}")
        except (TimeoutError, OSError) as e:
            print(f"ERR {url} ({e})")
            errores.append(f"url sin respuesta: {url}")
    for url in sin_comprobar:
        print(f"SIN COMPROBAR, revisa a mano: {url}")
    return errores


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    cat = json.loads((RAIZ / "rules/catalogo.json").read_text(encoding="utf-8"))
    esquema = json.loads((RAIZ / "rules/catalogo.schema.json").read_text(encoding="utf-8"))
    errores = validar(cat, esquema)
    if not errores and "--urls" in sys.argv[1:]:
        errores = revisar_urls(cat)
    for e in errores:
        print(f"ERROR {e}")
    if errores:
        return 1
    reglas = cat["reglas"]
    verificadas = sum(r["estado"] == "verificada" for r in reglas)
    print(f"OK: {len(reglas)} reglas, {verificadas} verificadas, {len(reglas) - verificadas} pendientes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
