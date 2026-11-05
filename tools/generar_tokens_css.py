"""Genera app/renderer/src/tokens.css desde brand/tokens.json. Un test comprueba que sigan iguales."""
from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def bloque(valores: dict[str, str]) -> str:
    return "\n".join(f"  --{nombre}: {valor};" for nombre, valor in valores.items())


def generar() -> str:
    tokens = json.loads((RAIZ / "brand/tokens.json").read_text(encoding="utf-8"))
    return (
        "/* Generado por tools/generar_tokens_css.py. No editar a mano. */\n"
        ":root {\n  color-scheme: light;\n" + bloque(tokens["color"]["claro"]) + "\n}\n"
        "@media (prefers-color-scheme: dark) {\n:root {\n  color-scheme: dark;\n"
        + bloque(tokens["color"]["oscuro"])
        + "\n}\n}\n"
    )


if __name__ == "__main__":
    (RAIZ / "app/renderer/src/tokens.css").write_text(generar(), encoding="utf-8", newline="\n")
