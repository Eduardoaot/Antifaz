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
| `efecto.tipo` | enum: `solido`, `difuminado`, `pixelado`, `emoji_sonrisa`, `emoji_lentes`, `emoji_gato`, `emoji_estrella`, `emoji_mono` | n/a | n/a | `solido` para texto, códigos, documentos y matrículas; `difuminado` para caras | Estándar. Un tipo desconocido nunca cae en "sin efecto" |
| `efecto.intensidad` | entero, % | 1 | 100 | 80 | Estándar. En difuminado y pixelado, menos intensidad es más fácil de reconocer |
| `efecto.aviso_intensidad_baja` | entero, % | 1 | 100 | 30 (propuesta) | Estándar. Por debajo de este valor se avisa: "Con poca intensidad es más fácil reconocer lo que hay debajo" |
| `efecto.sigma_px` | decimal, px | 25 | 1000 | max(25, 25% del lado corto de la región) | Estándar |
| `efecto.pixel_px` | entero, px | 8 (propuesta) | 256 (propuesta) | max(16, 10% del lado corto de la región) (propuesta) | Estándar. Cada bloque toma el color promedio de lo que cubre |
| `efecto.color_solido` | enum de colores fijos | n/a | n/a | Negro | Estándar. Nunca se usa el promedio de la región: es lo que lo hace irreversible |
| `efecto.emoji` | Cada emoji es un valor de `efecto.tipo` (ver `sidecar/recursos/emojis/ORIGEN.md`) | n/a | n/a | Ninguno: la persona lo elige | Estándar. Tapa lo que se oculta (ver `efecto.forma`): primero se rellena con el color principal del emoji y luego el emoji, centrado, crece hasta que su parte opaca lo cubre. Fuera de eso, lo transparente deja ver la foto. Un PNG con hash distinto detiene la operación |
| `efecto.forma` | enum: `caja`, `elipse` | n/a | n/a | `elipse` en caras (CAR-01); `caja` en todo lo demás, incluidas las zonas manuales | Estándar. Solo la usa el emoji. Con silueta, el emoji tapa la silueta. `elipse` tapa el óvalo inscrito en la zona con margen, que con el margen de caras (×1.3, 10 % y 8 px) contiene toda la caja del detector; si la caja toca la orilla de la foto, se tapa la caja completa |
| `efecto.emoji_escala_max` | decimal, veces el lado mayor de la caja | 1 | 2 | 2 | Constante (`EMOJI_ESCALA_MAX` en `efectos.py`), no configurable. Si el emoji no alcanza a tapar la caja con ese tamaño, lo que falta queda con su color principal |
| `efecto.escala` | decimal, veces el tamaño que se elige solo | 0.25 | 2 | 1 | Estándar. Paso de 0.05 en el control. Solo cambia a un emoji sobre una cara con `efecto.nucleo`, en óvalo, sin silueta y lejos de la orilla; en lo demás, por debajo de 1 no se encoge. Más chico que 1 solo oculta el óvalo de la cara del detector con `dilatacion_px`, y el emoji nunca queda más chico que lo que lo tapa. El control de la UI calcula su mínimo aproximado (`escalaMinimaSticker`); el sidecar calcula el exacto |
| `efecto.nucleo` | caja entera `{x, y, ancho, alto}` o nulo | dentro de la zona | dentro de la zona | nulo | Relación: debe quedar dentro de `x, y, ancho, alto` del ocultamiento; si no, se rechaza. Es la caja del detector de caras (`nucleo` del hallazgo CAR-01), recortada a la foto |
| `efecto.desplazamiento_x`, `efecto.desplazamiento_y` | decimal, fracciones de los semiejes del óvalo de la zona | -2 | 2 | 0 (centrado) | Estándar. Paso de 0.05 con flechas o cruceta y de 0.25 con Mayús. Solo cuenta con `efecto.nucleo` (como `efecto.escala`); sin él, el emoji queda centrado. Movido, solo oculta el óvalo de la cara del detector y el emoji crece lo necesario para seguir tapándolo desde donde quedó. La UI no lo deja alejarse más de `escala − mínimo` semiejes (imán, `limitarPosicion`) y al encogerlo lo acerca al centro |

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
| `objetos.umbral` | decimal, por clase | n/a | n/a | Placa y letrero 0.1; joya y tarjeta 0.15; pantallas y bandera 0.2; armas 0.3 (medido en una muestra chica); ventana con vista 0.2 (propuesta sin medir) | Constante interna |
| `contenido.umbral_bano` | decimal | n/a | n/a | 0.6 (propuesta sin medir) | Constante interna. Comparación aparte de las frases de riesgo para no quitarle puntaje a la desnudez. Solo avisa, con riesgo bajo |
| `nivel.mostrado` | regla, no número | n/a | n/a | Nivel del catálogo | La pregunta de menores es neutral hasta responderla; con un "sí", ella, las caras y el baño suben a alto. Con poca confianza, medio baja a bajo. Alto nunca baja |
| `contenido.umbral_zonas` | decimal | n/a | n/a | 0.25 (propuesta, favorece recall) | Constante interna. Por debajo de `umbral_revision` se marca con duda |
| `ocr.umbral_texto` | decimal | 0 | 1 | 0.3 (propuesta) | Estándar |
| `clic.x`, `clic.y` | entero, px de la imagen original | 0 | Ancho-1, alto-1 | n/a | Fuera de la imagen: se ignora y se avisa "Ese punto queda fuera de la imagen". El sidecar lo rechaza |

## Sesgos

Herramienta: `tools/medir_sesgo.py`. Política en `docs/SESGOS.md`.

| Parámetro | Tipo | Mín | Máx | Default | Ante un valor inválido |
|---|---|---|---|---|---|
| `sesgo.minimo_por_grupo` | entero, fotos | 1 | Sin límite | 30 (propuesta) | La herramienta sale con código 2. Un grupo con menos fotos no se compara |
| `sesgo.brecha_maxima` | decimal, proporción | Más de 0 | Menos de 1 | 0.05 (propuesta, falta aprobarla) | La herramienta sale con código 2. Por encima, la medición no se aprueba |
| `sesgo.iou_acierto` | decimal | n/a | n/a | 0.5 | Constante interna. Una cara cuenta como encontrada con IoU de 0.5 o más |

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
| `proxy.lado_corto_px` | entero, px | 240 (propuesta) | 720 (propuesta) | 480 (medido: EdgeTAM tarda 1.85 s por frame en el i5) | Estándar |
| `tracking.fps` | decimal, fps | 1 (propuesta) | 30 (propuesta) | 24 (beta; decisión del responsable, 2026-11-06) | Estándar. Entre frames rastreados se interpola y se amplía la máscara. Si el video tiene menos fps, se rastrea cada frame |
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
| `vista.zoom` | decimal, veces el tamaño ajustado a la ventana; niveles 1, 1.5, 2, 3, 4, 6 y 8 | 1 (100 %) | 8 (800 %) | 1: ajustar a la ventana | Se ajusta al límite más cercano; NaN o infinito vuelven a 1. Solo cambia la vista, nunca la exportación. Menos de 100 % no aporta, porque la imagen ya cabe completa; más de 800 % solo agranda la vista previa, que mide como máximo 1600 px (`ladoVista`) |
| `vista.comparacion` | entero, % del ancho que muestra la original | 0 | 100 | 50 | Se ajusta al límite más cercano y se redondea; NaN o infinito vuelven a 50. En la UI es un slider y arrastrar la línea sobre la imagen. Solo cambia la vista: mientras se compara, las herramientas no actúan y las marcas se ocultan |
| `vista.margen_etiqueta` | % del alto de la foto | n/a | n/a | 8 | Constante (`LIMITES.margenEtiqueta`). El número de una zona va encima de ella; si la zona empieza a menos de este margen del borde superior, va debajo, y si tampoco cabe, dentro. Así no tapa lo que marca. Alto no positivo o NaN: dentro |
| `vista.rotulo_comparacion` | % del ancho que queda del lado de cada rótulo | n/a | n/a | 10 (oculto) y 26 (opaco) | Constante (`LIMITES.rotuloComparacion`). "Original" y "Tu copia" se desvanecen de forma lineal entre los dos valores en vez de desaparecer de golpe. Un valor no finito o negativo: oculto |
| `vista.ajuste_max_escala` | decimal, veces el tamaño real de la foto | n/a | n/a | 2 (200 %) | Constante (`LIMITES.ajusteMaxEscala`). Al ajustar a la ventana, una foto chica no se estira más de esto, porque se vería suave y con artefactos; para verla más grande está el zoom. Un valor no finito o no positivo no limita |
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
