"""Bucle del sidecar: mensajes por stdio con prefijo de longitud. Un mensaje malo nunca lo cierra.

Marco: 4 bytes big-endian con la longitud, y luego el contenido. Si una respuesta trae
`binario_bytes`, el siguiente marco son esos bytes. Así los píxeles no viajan en el JSON
ni tocan el disco.
"""

from __future__ import annotations

import io
import json
import logging
import logging.handlers
import traceback
import uuid
from pathlib import Path
from typing import Any, BinaryIO, NoReturn, assert_never

from PIL import Image
from pydantic import ValidationError

from . import analisis, cargador, efectos, exportar, pincel, segmentar, seguimiento, video_app
from .caras import ModeloNoDisponible
from .errores import Codigo, ErrorRevisor
from .esquemas import (
    MAX_BYTES_MENSAJE,
    AbrirImagen,
    AbrirVideo,
    Analizar,
    Cerrar,
    CerrarVideo,
    Exportar,
    ExportarVideo,
    Ping,
    Pintar,
    PistaElegida,
    Previsualizar,
    QuitarPista,
    Segmentar,
    SeguirVideo,
    Solicitud,
    VistaVideo,
)
from .herramientas import Herramientas

registro = logging.getLogger(__name__)

VERSION_PROTOCOLO = 1
CALIDAD_VISTA = 85
BYTES_LONGITUD = 4


class FinDeEntrada(Exception):
    """La UI cerró el canal: toca terminar."""


def _rechazar_constante(valor: str) -> NoReturn:
    raise ValueError(f"constante JSON no finita: {valor}")


def _leer_exacto(entrada: BinaryIO, cantidad: int) -> bytes:
    datos = b""
    while len(datos) < cantidad:
        parte = entrada.read(cantidad - len(datos))
        if not parte:
            raise FinDeEntrada
        datos += parte
    return datos


def escribir_marco(salida: BinaryIO, contenido: bytes) -> None:
    salida.write(len(contenido).to_bytes(BYTES_LONGITUD, "big"))
    salida.write(contenido)
    salida.flush()


def registrar_excepcion(e: BaseException) -> None:
    """Solo tipo y funciones: el texto de una excepción puede incluir rutas personales."""
    pila = [f"{Path(c.filename).name}:{c.name}:{c.lineno}" for c in traceback.extract_tb(e.__traceback__)]
    registro.error("%s en %s", type(e).__name__, " > ".join(pila[-6:]))


class Sesion:
    def __init__(self, carpeta_modelos: Path, carpeta_herramientas: Path | None = None) -> None:
        self.carpeta_modelos = carpeta_modelos
        if carpeta_herramientas is None:
            carpeta_herramientas = carpeta_modelos.parent / "herramientas"
        self.herramientas = Herramientas(carpeta_herramientas)
        self.videos: dict[str, video_app.VideoAbierto] = {}
        self.imagenes: dict[str, cargador.ImagenCargada] = {}
        self.preparados: dict[str, dict[str, Any]] = {}
        self.mascaras: dict[str, dict[str, Any]] = {}

    def _imagen(self, imagen_id: str) -> cargador.ImagenCargada:
        imagen = self.imagenes.get(imagen_id)
        if imagen is None:
            raise ErrorRevisor(Codigo.IMAGEN_NO_ABIERTA)
        return imagen

    def _vista(self, pixeles: cargador.Pixeles, lado_max: int) -> bytes:
        imagen = Image.fromarray(pixeles)
        imagen.thumbnail((lado_max, lado_max), Image.Resampling.BILINEAR)
        salida = io.BytesIO()
        if imagen.mode == "RGBA":
            imagen.save(salida, format="PNG")
        else:
            imagen.save(salida, format="JPEG", quality=CALIDAD_VISTA)
        return salida.getvalue()

    def _segmentar(self, comando: Segmentar) -> dict[str, object]:
        imagen = self._imagen(comando.imagen_id)
        if comando.x >= imagen.ancho or comando.y >= imagen.alto:
            raise ErrorRevisor(Codigo.REGION_FUERA_DE_IMAGEN)
        try:
            modelo = segmentar.segmentador_de(self.carpeta_modelos)
        except ModeloNoDisponible as e:
            raise ErrorRevisor(Codigo.MODELO_NO_DISPONIBLE) from e
        preparado = self.preparados.get(comando.imagen_id)
        if preparado is None:
            preparado = modelo.preparar(imagen.pixeles)
            self.preparados[comando.imagen_id] = preparado
        mascara = modelo.segmentar(preparado, comando.x, comando.y)
        if mascara is None:
            raise ErrorRevisor(Codigo.SIN_OBJETO)
        return self._guardar_mascara(comando.imagen_id, mascara)

    def _pintar(self, comando: Pintar) -> dict[str, object]:
        imagen = self._imagen(comando.imagen_id)
        puntos = [(p.x, p.y) for p in comando.puntos]
        mascara = pincel.rasterizar(puntos, comando.tamano, imagen.ancho, imagen.alto)
        return self._guardar_mascara(comando.imagen_id, mascara)

    def _guardar_mascara(self, imagen_id: str, mascara: segmentar.Mascara) -> dict[str, object]:
        mascara_id = uuid.uuid4().hex
        self.mascaras.setdefault(imagen_id, {})[mascara_id] = mascara.recorte
        return {
            "mascara_id": mascara_id,
            "caja": {"x": mascara.x, "y": mascara.y, "ancho": mascara.ancho, "alto": mascara.alto},
        }

    def _video(self, video_id: str) -> video_app.VideoAbierto:
        abierto = self.videos.get(video_id)
        if abierto is None:
            raise ErrorRevisor(Codigo.VIDEO_NO_ABIERTO)
        return abierto

    def _abrir_video(self, ruta: str) -> dict[str, object]:
        abierto = video_app.abrir(self.herramientas, ruta)
        video_id = uuid.uuid4().hex
        self.videos[video_id] = abierto
        info = abierto.info
        return {
            "video_id": video_id,
            "ancho": info.ancho_visible,
            "alto": info.alto_visible,
            "duracion_s": info.duracion_s,
            "fps": info.fps,
            "frames": abierto.total,
            "posiciones": len(abierto.indices),
            "proxy_ancho": abierto.proxy_ancho,
            "proxy_alto": abierto.proxy_alto,
            "tiene_audio": info.tiene_audio,
            "pistas_sin_revisar": info.pistas_sin_revisar,
            "huella": abierto.huella,
        }

    def _ejecutar_video(self, comando: Any) -> tuple[dict[str, object], bytes | None]:
        match comando:
            case AbrirVideo(ruta=ruta):
                return self._abrir_video(ruta), None
            case VistaVideo():
                elegidas = _elegidas(comando.pistas)
                datos, revisar = video_app.vista(self._video(comando.video_id), comando.posicion, elegidas)
                return {"mime": "image/jpeg", "revisar": revisar}, datos
            case SeguirVideo():
                abierto = self._video(comando.video_id)
                seguidor = seguimiento.seguidor_de(self.carpeta_modelos)
                return video_app.seguir(abierto, seguidor, comando.posicion, comando.x, comando.y), None
            case QuitarPista():
                video_app.quitar(self._video(comando.video_id), comando.pista_id)
                return {"quitada": True}, None
            case ExportarVideo():
                elegidas = _elegidas(comando.pistas)
                return video_app.exportar(
                    self.herramientas,
                    self._video(comando.video_id),
                    elegidas,
                    comando.ruta_destino,
                    comando.sobrescribir,
                ), None
            case CerrarVideo(video_id=video_id):
                self.videos.pop(video_id, None)
                return {"cerrado": True}, None
            case _:
                raise ErrorRevisor(Codigo.INTERNO, "comando de video desconocido")

    def ejecutar(self, comando: Any) -> tuple[dict[str, object], bytes | None]:
        match comando:
            case Ping():
                return {"protocolo": VERSION_PROTOCOLO}, None
            case AbrirImagen(ruta=ruta):
                imagen = cargador.abrir(ruta)
                imagen_id = uuid.uuid4().hex
                self.imagenes[imagen_id] = imagen
                return {
                    "imagen_id": imagen_id,
                    "ancho": imagen.ancho,
                    "alto": imagen.alto,
                    "formato": imagen.formato,
                    "tiene_alfa": imagen.tiene_alfa,
                    "huella": imagen.huella,
                }, None
            case Analizar():
                return analisis.analizar(
                    self._imagen(comando.imagen_id),
                    self.carpeta_modelos,
                    comando.umbral_confianza,
                    comando.umbral_revision,
                    comando.multiplicador_cara,
                ), None
            case Previsualizar():
                imagen = self._imagen(comando.imagen_id)
                pixeles, _ = efectos.aplicar(
                    imagen.pixeles, comando.ocultamientos, self.mascaras.get(comando.imagen_id)
                )
                return {"mime": "image/png" if imagen.tiene_alfa else "image/jpeg"}, self._vista(
                    pixeles, comando.lado_max
                )
            case Exportar():
                return exportar.exportar(
                    self._imagen(comando.imagen_id),
                    comando.ocultamientos,
                    comando.ruta_destino,
                    comando.jpeg_calidad,
                    comando.sobrescribir,
                    self.mascaras.get(comando.imagen_id),
                ), None
            case Segmentar():
                return self._segmentar(comando), None
            case Pintar():
                return self._pintar(comando), None
            case (
                AbrirVideo() | VistaVideo() | SeguirVideo() | QuitarPista() | ExportarVideo() | CerrarVideo()
            ):
                return self._ejecutar_video(comando)
            case Cerrar(imagen_id=imagen_id):
                self.imagenes.pop(imagen_id, None)
                self.preparados.pop(imagen_id, None)
                self.mascaras.pop(imagen_id, None)
                return {"cerrada": True}, None
            case _ as desconocido:
                assert_never(desconocido)


def _elegidas(lista: list[PistaElegida]) -> list[video_app.Elegida]:
    return [(p.pista_id, p.efecto, p.intensidad) for p in lista]


def _error(id_solicitud: int | None, codigo: Codigo, mensaje: str | None = None) -> dict[str, object]:
    return {
        "id": id_solicitud,
        "ok": False,
        "error": {"codigo": codigo.value, "mensaje": mensaje or ErrorRevisor(codigo).mensaje},
    }


def _id_seguro(crudo: Any) -> int | None:
    if isinstance(crudo, dict):
        valor = crudo.get("id")  # type: ignore[union-attr]
        if isinstance(valor, int) and not isinstance(valor, bool) and 0 <= valor <= 2**53 - 1:
            return valor
    return None


def atender(sesion: Sesion, contenido: bytes) -> tuple[dict[str, object], bytes | None]:
    """Procesa un mensaje. Nunca lanza: cualquier problema se vuelve una respuesta de error tipada."""
    crudo: Any = None
    try:
        crudo = json.loads(contenido, parse_constant=_rechazar_constante)
        solicitud = Solicitud.model_validate(crudo)
    except (ValueError, UnicodeDecodeError, RecursionError) as e:
        # ValidationError hereda de ValueError. Su texto incluye los valores, así que no se registra.
        registro.warning("Mensaje inválido: %s", type(e).__name__)
        es_validacion = isinstance(e, ValidationError)
        return _error(
            _id_seguro(crudo), Codigo.VALIDACION if es_validacion else Codigo.MENSAJE_INVALIDO
        ), None
    try:
        datos, binario = sesion.ejecutar(solicitud.comando)
    except ErrorRevisor as e:
        registro.warning("%s: %s", e.codigo.value, e.detalle)
        return _error(solicitud.id, e.codigo), None
    except MemoryError as e:
        registrar_excepcion(e)
        return _error(solicitud.id, Codigo.MEMORIA_INSUFICIENTE), None
    except Exception as e:  # noqa: BLE001 - frontera del proceso: se registra y se traduce a un mensaje
        registrar_excepcion(e)
        return _error(solicitud.id, Codigo.INTERNO), None
    if binario is not None:
        datos = {**datos, "binario_bytes": len(binario)}
    return {"id": solicitud.id, "ok": True, "datos": datos}, binario


def servir(entrada: BinaryIO, salida: BinaryIO, sesion: Sesion) -> None:
    while True:
        try:
            longitud = int.from_bytes(_leer_exacto(entrada, BYTES_LONGITUD), "big")
            if longitud > MAX_BYTES_MENSAJE:
                # Se descarta para no perder la alineación de los marcos.
                restante = longitud
                while restante > 0:
                    restante -= len(_leer_exacto(entrada, min(restante, 1024 * 1024)))
                respuesta, binario = _error(None, Codigo.MENSAJE_INVALIDO), None
            else:
                respuesta, binario = atender(sesion, _leer_exacto(entrada, longitud))
        except FinDeEntrada:
            return
        escribir_marco(salida, json.dumps(respuesta, ensure_ascii=False).encode("utf-8"))
        if binario is not None:
            escribir_marco(salida, binario)


def configurar_registro(carpeta: Path | None) -> None:
    if carpeta is None:
        logging.basicConfig(level=logging.WARNING, handlers=[logging.NullHandler()])
        return
    carpeta.mkdir(parents=True, exist_ok=True)
    manejador = logging.handlers.RotatingFileHandler(
        carpeta / "sidecar.log", maxBytes=50 * 1024 * 1024, backupCount=2, encoding="utf-8"
    )
    manejador.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[manejador])
