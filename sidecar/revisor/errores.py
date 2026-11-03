"""Errores tipados: código interno, mensaje para la persona y detalle técnico para el log."""

from __future__ import annotations

from enum import StrEnum


class Codigo(StrEnum):
    MENSAJE_INVALIDO = "MENSAJE_INVALIDO"
    VALIDACION = "VALIDACION"
    ARCHIVO_VACIO = "ARCHIVO_VACIO"
    ARCHIVO_NO_ENCONTRADO = "ARCHIVO_NO_ENCONTRADO"
    ARCHIVO_DEMASIADO_PESADO = "ARCHIVO_DEMASIADO_PESADO"
    NO_ES_IMAGEN = "NO_ES_IMAGEN"
    IMAGEN_CORRUPTA = "IMAGEN_CORRUPTA"
    IMAGEN_DEMASIADO_GRANDE = "IMAGEN_DEMASIADO_GRANDE"
    IMAGEN_MUY_ALARGADA = "IMAGEN_MUY_ALARGADA"
    ANIMACION_NO_SOPORTADA = "ANIMACION_NO_SOPORTADA"
    SIN_PERMISOS = "SIN_PERMISOS"
    DISCO_LLENO = "DISCO_LLENO"
    RUTA_INVALIDA = "RUTA_INVALIDA"
    DESTINO_EXISTE = "DESTINO_EXISTE"
    DESTINO_ES_ORIGEN = "DESTINO_ES_ORIGEN"
    IMAGEN_NO_ABIERTA = "IMAGEN_NO_ABIERTA"
    REGION_FUERA_DE_IMAGEN = "REGION_FUERA_DE_IMAGEN"
    EXPORTACION_NO_VERIFICADA = "EXPORTACION_NO_VERIFICADA"
    MEMORIA_INSUFICIENTE = "MEMORIA_INSUFICIENTE"
    INTERNO = "INTERNO"


MENSAJES: dict[Codigo, str] = {
    Codigo.MENSAJE_INVALIDO: "No pudimos entender esa solicitud. Intenta de nuevo y, si se repite, reporta el problema.",
    Codigo.VALIDACION: "Uno de los valores no es válido. Revísalo e intenta de nuevo.",
    Codigo.ARCHIVO_VACIO: "Este archivo está vacío, así que no hay nada que revisar. Prueba con otro.",
    Codigo.ARCHIVO_NO_ENCONTRADO: "No encontramos el archivo. Puede que se haya movido o borrado. Vuelve a cargarlo.",
    Codigo.ARCHIVO_DEMASIADO_PESADO: "Este archivo pesa más de lo que podemos abrir (1 GB). Prueba con una versión más ligera.",
    Codigo.NO_ES_IMAGEN: "Este archivo no es una imagen, aunque su nombre lo parezca. Prueba con otro.",
    Codigo.IMAGEN_CORRUPTA: "No pudimos leer esta imagen completa: parece dañada o incompleta. Prueba con otra copia.",
    Codigo.IMAGEN_DEMASIADO_GRANDE: (
        "Esta imagen es más grande de lo que podemos abrir sin riesgo (200 megapíxeles o 30,000 píxeles por lado). "
        "Prueba con una versión más pequeña."
    ),
    Codigo.IMAGEN_MUY_ALARGADA: "Esta imagen es demasiado alargada para revisarla bien. Recórtala e intenta de nuevo.",
    Codigo.ANIMACION_NO_SOPORTADA: (
        "Esta imagen está animada y por ahora solo revisamos imágenes fijas. "
        "No la marcamos como revisada para no dejar cuadros sin ver."
    ),
    Codigo.SIN_PERMISOS: "No tenemos permiso para usar esa carpeta o archivo. Elige otra ubicación.",
    Codigo.DISCO_LLENO: "No hay espacio suficiente en el disco. Libera espacio o elige otra ubicación. No se guardó ningún archivo.",
    Codigo.RUTA_INVALIDA: "No podemos usar esa ubicación. Elige otra carpeta o nombre de archivo (JPG o PNG).",
    Codigo.DESTINO_EXISTE: "Ya existe un archivo con ese nombre. Elige otro nombre o confirma que quieres reemplazarlo.",
    Codigo.DESTINO_ES_ORIGEN: "Para no perder tu original, guarda la copia con otro nombre o en otra carpeta.",
    Codigo.IMAGEN_NO_ABIERTA: "Esta imagen ya no está abierta. Vuelve a cargarla.",
    Codigo.REGION_FUERA_DE_IMAGEN: "Una de las zonas queda fuera de la imagen. Ajústala e intenta de nuevo.",
    Codigo.EXPORTACION_NO_VERIFICADA: (
        "No pudimos comprobar que el archivo saliera limpio, así que no lo guardamos. Intenta de nuevo."
    ),
    Codigo.MEMORIA_INSUFICIENTE: "No hay memoria suficiente para esta imagen. Cierra otros programas e intenta de nuevo.",
    Codigo.INTERNO: "Algo salió mal de nuestro lado y no se completó la acción. Intenta de nuevo.",
}


class ErrorRevisor(Exception):
    """Error esperado. `detalle` va al log: nunca debe incluir rutas, texto de OCR ni píxeles."""

    def __init__(self, codigo: Codigo, detalle: str = "") -> None:
        super().__init__(codigo.value)
        self.codigo = codigo
        self.detalle = detalle

    @property
    def mensaje(self) -> str:
        return MENSAJES[self.codigo]
