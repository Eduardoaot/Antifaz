# Rangos y parámetros de Antifaz

**Estado:** propuesta de la Fase 0. **"(propuesta)" marca un valor sin medir,** que se confirma o se ajusta con benchmark en la fase correspondiente. Los valores de efectos también son propuestas propias, no números derivados de estudios.

Cada parámetro de este archivo tiene pruebas parametrizadas de mínimo-1, mínimo, máximo, máximo+1, null, tipo incorrecto, NaN e Infinity.

## Reglas generales de validación

- **Doble validación:** la UI valida con Zod para dar respuesta inmediata. El sidecar valida de nuevo con Pydantic en modo estricto y nunca confía en la UI.
- **Sin ajuste silencioso:** un valor escrito fuera de rango se rechaza, no se recorta. Los sliders y controles de arrastre solo pueden producir valores dentro del rango.
- **Comportamiento estándar ante un valor inválido:**
  - **UI:** marca el campo con texto e ícono, explica el rango, conserva el último valor válido y no aplica el cambio.
  - **Sidecar:** responde con un error tipado `VALIDACION`, no ejecuta nada y escribe un log sin datos personales.
- **Límites de archivo:** se comprueban leyendo encabezados, antes de decodificar los píxeles.

### Normalización de entradas de texto en la UI

| Entrada | Campo entero | Campo decimal | Motivo |
|---|---|---|---|
| Vacío, solo espacios | Inválido | Inválido | Ausencia |
| `null`, `undefined`, `None` | Inválido | Inválido | Ausencia |
| `" 5 "` | 5 | 5 | Se recortan espacios de los extremos |
| `5 5` | Inválido | Inválido | Espacio interno |
| `abc`, emoji | Inválido | Inválido | No es número |
| `-5` | Según el rango | Según el rango | Se valida como número y luego por rango |
| `-0` | 0 | 0 | Se normaliza |
| `2.5` | Inválido | 2.5 | Un entero no admite decimales |
| `2.0` | Inválido | 2.0 | Un entero se escribe sin decimales |
| `0,5` | Inválido | 0.5 | La coma decimal se acepta en la UI, sea cual sea la región del sistema |
| `1,000` | Inválido | Inválido | Ambiguo: puede ser mil o uno |
| `1e10` | Inválido | Inválido | No se acepta notación científica |
| `NaN`, `Infinity`, `-Infinity` | Inválido | Inválido | No son valores finitos |
| `0x10`, `٣`, `５` | Inválido | Inválido | Solo dígitos ASCII |
| Mayor que 2^53-1 en valor absoluto | Inválido | Inválido | Evita desbordamiento y pérdida de precisión |
| Texto pegado de más de 64 caracteres | Inválido | Inválido | Se rechaza antes de analizarlo |

### Reglas del IPC (sidecar)

- Solo se aceptan números JSON finitos. Un número enviado como texto se rechaza: la normalización anterior es exclusiva de la UI.
- Un entero enviado como decimal se rechaza. También los booleanos enviados en lugar de números.
- Campos faltantes, campos desconocidos, listas vacías donde se requiere contenido y objetos vacíos se rechazan.
- Un mensaje de más de 16 MiB (propuesta) se rechaza. Los píxeles no viajan por el canal de control.

## Efectos de ocultamiento

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `efecto.tipo` | enum: `solido`, `difuminado`, `pixelado`, `emoji` | n/a | n/a | `solido` para texto, códigos, documentos y matrículas; `difuminado` para caras | Estándar. Un tipo desconocido nunca cae en "sin efecto" |
| `efecto.intensidad` | entero, % | 1 | 100 | 80 | Estándar. En difuminado y pixelado, menos intensidad es más fácil de reconocer |
| `efecto.aviso_intensidad_baja` | entero, % | 1 | 100 | 30 (propuesta) | Estándar. Por debajo de este valor se avisa: "Con poca intensidad es más fácil reconocer lo que hay debajo" |
| `efecto.sigma_px` | decimal, px | 25 | 1000 | max(25, 25% del lado corto de la región) | Estándar |
| `efecto.pixel_px` | entero, px | 8 (propuesta) | 256 (propuesta) | max(16, 10% del lado corto de la región) (propuesta) | Estándar. Cada bloque toma el color promedio de lo que cubre |
| `efecto.color_solido` | enum de colores fijos | n/a | n/a | Negro | Estándar. Nunca se usa el promedio de la región: es lo que lo hace irreversible |
| `efecto.emoji` | enum de emojis incluidos | n/a | n/a | Primero de la lista | Estándar. Se dibuja sobre relleno sólido |

## Máscaras

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `mascara.dilatacion_px` | entero, px | 8 | 512 (propuesta) | 8 | Estándar. El mínimo evita dejar bordes sin ocultar |
| `mascara.dilatacion_pct` | decimal, % del lado corto | 0 | 50 | 10 | Estándar. Se usa el mayor entre este valor y `dilatacion_px` |
| `mascara.multiplicador_cara` | decimal | 1.0 | 3.0 | 1.3 | Estándar |
| `mascara.cobertura` | decimal, % de la imagen | Más de 0 | 100 | Calculado | 0%: se rechaza con "La máscara está vacía". 100%: se permite tras confirmar |
| `pincel.tamano_px` | entero, px de la foto original | 1 | 512 | 32 | Estándar. En la UI es un slider, que no puede salirse del rango. Un tamaño par da un píxel de más, nunca de menos |
| `pincel.puntos` | entero, puntos por trazo | 1 | 5000 (propuesta) | n/a | La UI omite los puntos a menos de un cuarto del tamaño del anterior. Al llegar al límite toma la primera parte y avisa "Tu trazo era muy largo". El sidecar rechaza más puntos o un punto fuera de la imagen |
| `rectangulo.x`, `rectangulo.y` | entero, px | 0 | Ancho-1, alto-1 | n/a | Estándar |
| `rectangulo.ancho`, `rectangulo.alto` | entero, px | 1 | Hasta el borde de la imagen | n/a | Estándar. No se recorta en silencio. Si cubre toda la imagen, se pide confirmar |
| `silueta.margen` | Igual que `mascara.dilatacion_px` y `dilatacion_pct` | n/a | n/a | n/a | Si la silueta ya no está en memoria, se oculta toda su caja |

## Detección

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `deteccion.umbral_confianza` | decimal | 0 | 1 | 0.25 (propuesta, favorece recall) | Estándar |
| `deteccion.umbral_revision` | decimal | 0 | 1 | 0.6 (medido en una muestra chica) | Estándar. Debe ser mayor o igual que `umbral_confianza`, o se rechaza. Por debajo se dice "podría ser una cara" y no se pregunta por menores |
| `caras.umbral_confirmar` | decimal | n/a | n/a | 0.6 (medido en una muestra chica) | Constante interna. Una detección dudosa por debajo de este valor se descarta. Si no se puede confirmar, se conserva |
| `contenido.umbral_escena` | decimal | n/a | n/a | 0.35; extremismo 0.6 (medido en una muestra chica) | Constante interna. Por encima se avisa sobre toda la imagen |
| `contenido.desnudez_segura` | decimal | n/a | n/a | 0.7 (medido en una muestra chica) | Constante interna. Por debajo, la zona solo cuenta si la escena suma 0.1 o más en desnudez y sugerente |
| `objetos.umbral` | decimal, por clase | n/a | n/a | Placa y letrero 0.1; joya y tarjeta 0.15; pantallas y bandera 0.2; armas 0.3 (medido en una muestra chica) | Constante interna |
| `contenido.umbral_zonas` | decimal | n/a | n/a | 0.25 (propuesta, favorece recall) | Constante interna. Por debajo de `umbral_revision` se marca con duda |
| `ocr.umbral_texto` | decimal | 0 | 1 | 0.3 (propuesta) | Estándar |
| `clic.x`, `clic.y` | entero, px de la imagen original | 0 | Ancho-1, alto-1 | n/a | Fuera de la imagen: se ignora y se avisa "Ese punto queda fuera de la imagen". El sidecar lo rechaza |

## Archivos

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `lote.archivos` | entero, fotos abiertas a la vez | 1 | 500 | n/a | Cuenta las ya abiertas, porque la recuperación guarda hasta 500. Si no caben todas, se pregunta si abrir las primeras; las que quedan fuera se dicen en un solo aviso. Nunca se descartan en silencio |
| `archivo.tamano_bytes` (imagen) | entero | 1 | 1 GiB (propuesta) | n/a | 0 bytes: "Este archivo está vacío". Rechazo por archivo; el lote sigue |
| `archivo.tamano_bytes` (video) | entero | 1 | 20 GiB (propuesta) | n/a | Igual que imagen |
| `imagen.megapixeles` | decimal, MP | Más de 0 | 200 (propuesta) | n/a | Rechazo antes de decodificar, como protección contra bombas de descompresión |
| `imagen.lado_px` | entero, px | 1 | 30000 (propuesta) | n/a | Rechazo por archivo |
| `imagen.relacion_aspecto` | decimal, lado largo entre lado corto | 1 | 100 (propuesta) | n/a | Rechazo por archivo, con mensaje específico |
| `imagen.deteccion_lado_min_px` | entero, px | 1 | 64 | 16 (propuesta) | Debajo de este lado se avisa que es demasiado pequeña para analizarla bien, y no se presenta como revisada |
| `gif.frames` | entero | 1 | 5000 (propuesta) | n/a | Rechazo por archivo |

## Video de entrada

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `video.duracion_s` | decimal, s | Más de 0 (1 frame es válido) | 3 (beta; decisión del responsable, 2026-11-06), más un frame de tolerancia con tope de 0.05 s | n/a | Por encima: rechazo explicado. Antes la propuesta era 7200. La tolerancia acepta clips de 3.003 s (29.97 fps), también por decisión del responsable |
| `video.duracion_aviso_s` | entero, s | 1 | `video.duracion_s` máx. | 3 (beta: igual al máximo, así que no se pide confirmar) | Por encima se muestra el tiempo estimado y se pide confirmar |
| `video.lado_px` | entero, px | 16 (propuesta) | 8192 (propuesta, cubre 8K) | n/a | Rechazo por archivo |
| `video.fps` | decimal, fps | Más de 0 | 240 (propuesta) | n/a | Rechazo por archivo. El frame rate variable es válido |

Implementado en `sidecar/revisor/video.py`, que lee la salida de ffprobe. También se rechazan, con `VIDEO_NO_SOPORTADO`, más de una pista de video y una rotación que no sea múltiplo de 90°. Un video de duración 0 con un frame vale y su duración es la de ese frame.

## Herramientas de video

FFmpeg 9.0.2 y exiftool 13.61, con hash fijado en `sidecar/revisor/herramientas.py`. Si el hash no coincide, no se ejecutan (`HERRAMIENTA_NO_DISPONIBLE`).

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `herramienta.tiempo_max_s` | decimal, s | 1 | 21600 (6 h, propuesta) | Según la llamada | `VALIDACION` y no se ejecuta. Al agotarse: `HERRAMIENTA_FALLO`, sin archivo final |
| `ffprobe.tiempo_max_s` | decimal, s | n/a | n/a | 60 (propuesta) | Fijo en código |
| `herramienta.salida_bytes` | entero, bytes | 0 | 64 MiB (propuesta) | n/a | `HERRAMIENTA_FALLO` |

## Procesamiento de video

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `proxy.lado_corto_px` | entero, px | 240 (propuesta) | 720 (propuesta) | 360 (medido en docs/benchmarks: mejor tiempo con 0 % visible en el i5-1245U) | Estándar |
| `tracking.fps` | decimal, fps | 1 (propuesta) | 30 (propuesta) | 24 (beta; decisión del responsable, 2026-11-06) | Estándar. Entre frames rastreados se interpola y se amplía la máscara. Si el video tiene menos fps, se rastrea cada frame |
| `tracking.paso_clave` | entero, frames del proxy | 1 | 24 | 8 (medido en docs/benchmarks: 0 % visible; ~22 s por 3 s y ~89 s por 15 s a proxy 360) | Estándar. EdgeTAM corre una sola vez sobre esos keyframes (video corto); CSRT rellena los huecos trasladando la silueta y uniéndola a la caja ampliada. Si CSRT se pierde, máscara vacía y `pistas` marca revisión |
| `tracking.margen_caja_csrt_pct` | decimal, % | n/a | n/a | 15 | Constante interna. Amplía la caja de CSRT antes de unirla a la silueta trasladada |
| `tracking.margen_caja_csrt_px` | entero, px | n/a | n/a | 8 | Constante interna. Piso del margen de la caja de CSRT |
| `bloque.frames` | entero, frames | 30 (propuesta) | 3000 (propuesta) | 300 (propuesta) | Estándar |
| `pista.margen_frames` | entero, frames | 0 | 120 (propuesta) | 5 | Estándar. Oculta antes y después de cada pista |
| `pista.inicio_ms` | entero, ms | 0 | Menor que `fin_ms` | 0 | Estándar. `inicio` mayor o igual que `fin`: se rechaza |
| `pista.fin_ms` | entero, ms | Mayor que `inicio_ms` | Duración del video | Duración | Estándar. Fuera de la duración: se rechaza, sin recortar en silencio |
| `cortes.umbral` | decimal | 0 (propuesta) | 100 (propuesta) | Se define con benchmark | Estándar |
| `cache.tamano_gb` | decimal, GB | 1 (propuesta) | 50 (propuesta) | 10 (propuesta) | Estándar. Si no hay espacio libre, se avisa antes de empezar |

## Exportación

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `export.preset` | enum: `9:16` (1080×1920), `4:5` (1080×1350), `1:1` (1080×1080), `original` | n/a | n/a | `4:5` en foto, `9:16` en video | Estándar. No hay exportación con un preset desconocido |
| `export.jpeg_calidad` | entero | 60 (propuesta) | 100 | 92 (propuesta) | Estándar |
| `export.crf` | entero | 14 (propuesta) | 30 (propuesta) | 20 (propuesta) | Estándar |
| `export.video_mbps` | decimal, Mbps | 1 (propuesta) | 25 (referencia: API de Instagram) | 16 (propuesta) | Estándar |
| `export.video_fps` | decimal, fps | 23 | 60 | Igual al original, si cabe en el rango | Estándar. Referencia: API de Instagram |
| `export.ruta` | texto | 1 carácter | Sin límite propio; lo define Windows | Carpeta elegida | Sin permisos o sin espacio: la exportación se detiene, no queda archivo final y se explica qué hacer |
| `export.quitar_metadatos` | booleano | n/a | n/a | `true` | Estándar. No se ofrece en la UI; solo admite `true`. Decisión confirmada por el responsable del proyecto: siempre se borran |

Los límites de Instagram cambian, y sus propias fuentes se contradicen (4:5 o 3:4). Por eso son configurables y no se tratan como cifras estables.

## Interfaz y proyecto

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `vista.zoom_pct` | entero, % | 10 | 1600 | Ajustar a la ventana | Estándar |
| `historial.pasos` | entero | 1 | 500 (propuesta) | 100 (propuesta) | Estándar. Deshacer sin historial queda desactivado y no hace nada |
| `tema` | enum: `sistema`, `claro`, `oscuro` | n/a | n/a | `sistema` | Se usa `sistema` y se registra el error |
| `proyecto.nombre` | texto | 1 carácter | 120 caracteres | Nombre sin extensión del primer archivo | Estándar |
| `proyecto.guardar_embeddings` | booleano | n/a | n/a | `false` | Estándar. Ante cualquier duda, no se guardan |
| `ventana.ancho_px`, `ventana.alto_px` | entero, px lógicos | 800 × 600 (propuesta) | Sin límite propio | 1280 × 800 (propuesta) | Windows no permite reducirla más; una posición fuera de pantalla se reubica |
| `sidecar.limite_pedido_s` | entero, s | n/a | n/a | 300 (propuesta) | Constante interna. Al rebasarlo se reinicia el sidecar y se avisa que no se completó |
| `alfa.invisible` | entero | n/a | n/a | 8 (propuesta) | Constante interna. Por debajo, el píxel se borra al exportar, porque su color se recupera con solo subir el alfa |
| `log.tamano_mb` | entero, MB | 1 | 200 (propuesta) | 50 (propuesta) | Estándar |
| `log.retencion_dias` | entero, días | 1 | 90 (propuesta) | 14 (propuesta) | Estándar |

## Relaciones entre valores

| Relación | Regla |
|---|---|
| `inicio_ms` y `fin_ms` | `inicio` menor que `fin`, ambos dentro de la duración. Debe cubrir al menos 1 frame |
| Coordenadas y dimensiones | Todo punto y rectángulo cabe dentro de la imagen |
| Máscara | No vacía. Si cubre el 100%, se pide confirmar |
| `umbral_confianza` y `umbral_revision` | Revisión mayor o igual que confianza |
| `duracion_aviso_s` y `duracion_s` | El aviso no supera el máximo |
| `tracking.fps` y `video.fps` | Se rastrea a `min(tracking.fps, video.fps)`: nunca más frames de los que tiene el video |
| `proxy` y video original | El proxy nunca es mayor que el original; si el original es menor, se usa su tamaño |
| Tamaño de la región y `pixel_px` | Si el bloque es mayor que la región, la región queda como un solo bloque de relleno |
