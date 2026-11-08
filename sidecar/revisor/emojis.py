"""Emojis incluidos para ocultar zonas. Se dibujan sobre bloque sólido: no conservan nada de la foto.

Origen y licencia en sidecar/recursos/emojis/ORIGEN.md.
"""

from __future__ import annotations

import io
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from .caras import ModeloNoDisponible
from .cargador import Pixeles
from .contenido import leer_verificado
from .errores import Codigo, ErrorRevisor
from .esquemas import TipoEmoji

CARPETA = Path(__file__).resolve().parent.parent / "recursos" / "emojis"

ARCHIVOS: dict[TipoEmoji, tuple[str, str]] = {
    "emoji_sonrisa": ("emoji_u1f600.png", "5f385dbf45c857dfee6070cb41405c3e96c2dcaf2bfb465fa8a1adbf484ffa7c"),
    "emoji_lentes": ("emoji_u1f60e.png", "542ca1bdbcb831a026a9139ef75dacb609867170d06a487e3ae9c7a4ec22b4c6"),
    "emoji_gato": ("emoji_u1f431.png", "51a931f7f61de2442f7c4bb79fa56636b6ead7d9a4bba8cae55bf0523ebc0e08"),
    "emoji_estrella": ("emoji_u2b50.png", "4bd86e289d7b490bbdbe94ab250e81ec5a49b6f3b15acb6d92b3a47a3439cb56"),
}


@lru_cache(maxsize=len(ARCHIVOS))
def cargar(emoji: TipoEmoji) -> Pixeles:
    """RGBA de 8 bits. Si falta o su hash no coincide, se detiene en vez de ocultar con otra cosa."""
    nombre, sha256 = ARCHIVOS[emoji]
    try:
        datos = leer_verificado(CARPETA / nombre, sha256)
    except ModeloNoDisponible as e:
        raise ErrorRevisor(Codigo.MODELO_NO_DISPONIBLE, f"emoji {emoji}") from e
    with Image.open(io.BytesIO(datos)) as imagen:
        pixeles = np.array(imagen.convert("RGBA"), dtype=np.uint8)
    # Se comparte entre llamadas por la caché: nadie debe poder modificarlo.
    pixeles.setflags(write=False)
    return pixeles
