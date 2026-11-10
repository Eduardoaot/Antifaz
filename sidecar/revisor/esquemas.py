"""Mensajes del IPC. El sidecar nunca confía en la UI: todo se valida aquí, en modo estricto.

Los límites vienen de qa/RANGOS.md. Si cambias uno, cambia también ese documento.
"""

from __future__ import annotations

from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_BYTES_MENSAJE = 16 * 1024 * 1024
MAX_OCULTAMIENTOS = 5000
LADO_MAX_PX = 30000
PREVISTA_LADO_MIN = 64
PREVISTA_LADO_MAX = 4096
PINCEL_MIN = 1
PINCEL_MAX = 512
PUNTOS_TRAZO_MAX = 5000
# Tamaño del sticker sobre una cara, en veces el que se elige solo. Coincide con LIMITES.escalaSticker.
ESCALA_STICKER_MIN = 0.25
ESCALA_STICKER_MAX = 2.0


class Estricto(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)


# Cada emoji es un efecto propio: así la recuperación, las zonas manuales y el video lo aceptan igual.
# Coinciden con EMOJIS de app/shared/contrato.ts y con los archivos de revisor/emojis.py.
TipoEmoji = Literal["emoji_sonrisa", "emoji_lentes", "emoji_gato", "emoji_estrella"]
TipoEfecto = Literal["solido", "difuminado", "pixelado"] | TipoEmoji


def es_emoji(efecto: str) -> bool:
    return efecto in get_args(TipoEmoji)


class CajaImagen(Estricto):
    x: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    y: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    ancho: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]
    alto: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]


class Ocultamiento(Estricto):
    x: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    y: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    ancho: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]
    alto: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]
    efecto: TipoEfecto
    intensidad: Annotated[int, Field(ge=1, le=100)] = 80
    dilatacion_px: Annotated[int, Field(ge=8, le=512)] = 8
    dilatacion_pct: Annotated[float, Field(ge=0, le=50)] = 10.0
    # Silueta guardada en el sidecar. Si ya no está, se oculta toda la caja.
    mascara_id: Annotated[str | None, Field(min_length=1, max_length=64)] = None
    # Solo la usa el emoji: "elipse" (caras) tapa el óvalo de la zona con margen para ajustarse a la cara;
    # "caja" tapa el rectángulo completo. Con silueta, manda la silueta.
    forma: Literal["caja", "elipse"] = "caja"
    # La cara que vio el detector, sin margen. Solo con ella el emoji puede ser más chico que su zona.
    nucleo: CajaImagen | None = None
    # Tamaño del emoji en veces el que se elige solo. Nunca queda más chico de lo que tapa el núcleo.
    escala: Annotated[float, Field(ge=ESCALA_STICKER_MIN, le=ESCALA_STICKER_MAX)] = 1.0

    @model_validator(mode="after")
    def nucleo_dentro(self) -> Ocultamiento:
        n = self.nucleo
        if n is not None and not (
            n.x >= self.x
            and n.y >= self.y
            and n.x + n.ancho <= self.x + self.ancho
            and n.y + n.alto <= self.y + self.alto
        ):
            raise ValueError("el núcleo debe quedar dentro de la zona")
        return self


class Ping(Estricto):
    tipo: Literal["ping"]


class AbrirImagen(Estricto):
    tipo: Literal["abrir_imagen"]
    ruta: Annotated[str, Field(min_length=1, max_length=32767)]


class Analizar(Estricto):
    tipo: Literal["analizar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]
    umbral_confianza: Annotated[float, Field(ge=0, le=1)] = 0.25
    umbral_revision: Annotated[float, Field(ge=0, le=1)] = 0.6
    multiplicador_cara: Annotated[float, Field(ge=1.0, le=3.0)] = 1.3

    @model_validator(mode="after")
    def revision_no_menor(self) -> Analizar:
        if self.umbral_revision < self.umbral_confianza:
            raise ValueError("umbral_revision debe ser mayor o igual que umbral_confianza")
        return self


class Previsualizar(Estricto):
    tipo: Literal["previsualizar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]
    ocultamientos: Annotated[list[Ocultamiento], Field(max_length=MAX_OCULTAMIENTOS)]
    lado_max: Annotated[int, Field(ge=PREVISTA_LADO_MIN, le=PREVISTA_LADO_MAX)] = 1600


class Exportar(Estricto):
    tipo: Literal["exportar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]
    # Puede ir vacía: quitar metadatos ya es útil aunque no se oculte ninguna zona.
    ocultamientos: Annotated[list[Ocultamiento], Field(max_length=MAX_OCULTAMIENTOS)]
    ruta_destino: Annotated[str, Field(min_length=1, max_length=32767)]
    jpeg_calidad: Annotated[int, Field(ge=60, le=100)] = 92
    sobrescribir: bool = False


class Segmentar(Estricto):
    tipo: Literal["segmentar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]
    x: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    y: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]


class Punto(Estricto):
    x: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    y: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]


class Pintar(Estricto):
    """Un trazo del pincel. Que cada punto quepa en la imagen se revisa al abrirla."""

    tipo: Literal["pintar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]
    puntos: Annotated[list[Punto], Field(min_length=1, max_length=PUNTOS_TRAZO_MAX)]
    tamano: Annotated[int, Field(ge=PINCEL_MIN, le=PINCEL_MAX)]


class Cerrar(Estricto):
    tipo: Literal["cerrar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]


# --- Video (Fase 3) ---------------------------------------------------------------------------
# Posiciones: índice dentro de los frames rastreados (hasta FRAMES_MAX). Coordenadas: en el proxy.
POSICION_MAX = 999
PROXY_LADO_MAX = 4096
PISTAS_MAX = 50
Id = Annotated[str, Field(min_length=1, max_length=64)]


class PistaElegida(Estricto):
    pista_id: Id
    efecto: TipoEfecto


def _sin_repetidas(pistas: list[PistaElegida]) -> list[PistaElegida]:
    if len({p.pista_id for p in pistas}) != len(pistas):
        raise ValueError("pista repetida")
    return pistas


class AbrirVideo(Estricto):
    tipo: Literal["abrir_video"]
    ruta: Annotated[str, Field(min_length=1, max_length=32767)]


class VistaVideo(Estricto):
    tipo: Literal["vista_video"]
    video_id: Id
    posicion: Annotated[int, Field(ge=0, le=POSICION_MAX)]
    pistas: Annotated[list[PistaElegida], Field(max_length=PISTAS_MAX)]

    @model_validator(mode="after")
    def unicas(self) -> VistaVideo:
        _sin_repetidas(self.pistas)
        return self


class SeguirVideo(Estricto):
    tipo: Literal["seguir_video"]
    video_id: Id
    posicion: Annotated[int, Field(ge=0, le=POSICION_MAX)]
    x: Annotated[int, Field(ge=0, le=PROXY_LADO_MAX - 1)]
    y: Annotated[int, Field(ge=0, le=PROXY_LADO_MAX - 1)]


class QuitarPista(Estricto):
    tipo: Literal["quitar_pista"]
    video_id: Id
    pista_id: Id


class ExportarVideo(Estricto):
    tipo: Literal["exportar_video"]
    video_id: Id
    # Puede ir vacía: quitar metadatos ya es útil aunque no se oculte nada.
    pistas: Annotated[list[PistaElegida], Field(max_length=PISTAS_MAX)]
    ruta_destino: Annotated[str, Field(min_length=1, max_length=32767)]
    sobrescribir: bool = False

    @model_validator(mode="after")
    def unicas(self) -> ExportarVideo:
        _sin_repetidas(self.pistas)
        return self


class CerrarVideo(Estricto):
    tipo: Literal["cerrar_video"]
    video_id: Id


Comando = Annotated[
    Ping
    | AbrirImagen
    | Analizar
    | Previsualizar
    | Exportar
    | Segmentar
    | Pintar
    | Cerrar
    | AbrirVideo
    | VistaVideo
    | SeguirVideo
    | QuitarPista
    | ExportarVideo
    | CerrarVideo,
    Field(discriminator="tipo"),
]


class Solicitud(Estricto):
    id: Annotated[int, Field(ge=0, le=2**53 - 1)]
    comando: Comando
