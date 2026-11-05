"""Mensajes del IPC. El sidecar nunca confía en la UI: todo se valida aquí, en modo estricto.

Los límites vienen de qa/RANGOS.md. Si cambias uno, cambia también ese documento.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_BYTES_MENSAJE = 16 * 1024 * 1024
MAX_OCULTAMIENTOS = 5000
LADO_MAX_PX = 30000
PREVISTA_LADO_MIN = 64
PREVISTA_LADO_MAX = 4096


class Estricto(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)


TipoEfecto = Literal["solido", "difuminado", "pixelado"]


class Ocultamiento(Estricto):
    x: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    y: Annotated[int, Field(ge=0, le=LADO_MAX_PX - 1)]
    ancho: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]
    alto: Annotated[int, Field(ge=1, le=LADO_MAX_PX)]
    efecto: TipoEfecto
    intensidad: Annotated[int, Field(ge=1, le=100)] = 80
    dilatacion_px: Annotated[int, Field(ge=8, le=512)] = 8
    dilatacion_pct: Annotated[float, Field(ge=0, le=50)] = 10.0


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


class Cerrar(Estricto):
    tipo: Literal["cerrar"]
    imagen_id: Annotated[str, Field(min_length=1, max_length=64)]


Comando = Annotated[
    Ping | AbrirImagen | Analizar | Previsualizar | Exportar | Cerrar,
    Field(discriminator="tipo"),
]


class Solicitud(Estricto):
    id: Annotated[int, Field(ge=0, le=2**53 - 1)]
    comando: Comando
