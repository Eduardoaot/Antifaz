# Matriz de pruebas de Antifaz

**Estado:** Fase 1 en cierre y Fase 2 en curso. Un caso de la Fase 1 solo dice `automatizado` si hay una prueba real detrás; lo demás conserva su motivo. Los casos de fases posteriores no se han ejecutado.

**Valores de Estado:**
- `pendiente`: se automatizará o ejecutará en la fase indicada.
- `manual: <quién>`: necesita a una persona o hardware que no hay en el equipo de desarrollo. Tampoco se ha ejecutado, y no cuenta como aprobado hasta tener evidencia.
- `fuera de alcance: solo Windows`: conserva su ID por si macOS vuelve.

Al ejecutar un caso, el Estado pasa a `automatizado` o `manual`, con enlace a su evidencia. La columna Fase indica cuándo debe quedar cubierto por primera vez. Los límites citados están en [RANGOS.md](RANGOS.md).

## Archivos: sin contenido (ARC)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-001 | 1 | Imagen totalmente negra | Cargar y analizar | "No encontramos nada riesgoso", aclarando que la revisión es orientativa | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-002 | 1 | Imagen totalmente blanca | Cargar y analizar | Igual que ARC-001 | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-003 | 1 | Imagen de un solo color | Cargar y analizar | Igual que ARC-001 | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-004 | 1 | Imagen de ruido | Cargar y analizar | Igual que ARC-001 o propuestas de baja confianza; no se cierra | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-005 | 1 | Cielo vacío | Cargar y analizar | Igual que ARC-001 | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |

## Archivos: tamaños extremos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-006 | 1 | Imagen de 1×1 px | Cargar, analizar, ocultar y exportar | No se cierra; avisa que es demasiado pequeña para analizarla bien y no se presenta como revisada | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-007 | 1 | Imagen de más de 100 MP | Cargar imagen dentro del límite | Procesa con progreso y sin rebasar memoria, o explica el límite | automatizado: sidecar/tests/test_analisis.py, test_cargador.py |
| ARC-008 | 1 | Panorámica muy alargada | Cargar imagen con relación de aspecto extrema | Procesa si está en el límite; si no, mensaje específico. La UI no se deforma | automatizado: sidecar/tests/test_cargador.py |
| ARC-009 | 3 | Video 8K | Cargar y crear proxy | Procesa sobre proxy con tiempo estimado | pendiente |
| ARC-010 | 3 | Video de 1 frame | Cargar, ocultar y exportar | Funciona; ningún cálculo divide entre cero | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |
| ARC-011 | 3 | Video de varias horas | Cargar video por encima del máximo | Rechazo explicado, o aviso con tiempo estimado si cabe. Sin bloquear la UI | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |
| ARC-012 | 1 | Archivo de 0 bytes | Cargar | "Este archivo está vacío"; el resto del lote sigue | automatizado: sidecar/tests/test_cargador.py |

## Archivos: corruptos y maliciosos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-013 | 1 | Imagen corrupta | Cargar archivo con bytes alterados | Error claro; sin cierre ni advertencias falsas de "revisado" | automatizado: sidecar/tests/test_cargador.py |
| ARC-014 | 1 | Imagen truncada | Cargar archivo cortado a la mitad | Error claro; no se analiza como imagen parcial sin avisar | automatizado: sidecar/tests/test_cargador.py |
| ARC-015 | 1 | `.txt` renombrado a `.jpg` | Cargar | "Este archivo no es una imagen"; se identifica por contenido | automatizado: sidecar/tests/test_cargador.py |
| ARC-016 | 1 | `.exe` renombrado a `.jpg` | Cargar | Igual que ARC-015; nunca se ejecuta | automatizado: sidecar/tests/test_cargador.py |
| ARC-017 | 1 | Bomba de descompresión | Cargar imagen con dimensiones gigantes declaradas | Rechazo antes de decodificar, sin pico de memoria | automatizado: sidecar/tests/test_cargador.py |

## Archivos: formatos de imagen

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-018 | 1 | JPG | Cargar, ocultar y exportar | Salida correcta y sin metadatos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-019 | 1 | PNG con transparencia | Cargar, ocultar y exportar | La transparencia no oculta ni revela contenido; lo oculto queda sobrescrito también en los píxeles transparentes | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-020 | 1 | HEIC | Cargar, ocultar y exportar | Salida correcta y sin metadatos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-021 | 1 | HEIF | Cargar, ocultar y exportar | Salida correcta y sin metadatos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-022 | 1 | WebP | Cargar, ocultar y exportar | Salida correcta y sin metadatos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-023 | 1 | AVIF | Cargar, ocultar y exportar | Salida correcta y sin metadatos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-024 | 3 | GIF animado | Cargar | Se trata como video, o se explica la limitación. Nunca se revisa solo el primer frame sin decirlo | pendiente |
| ARC-025 | 1 | RAW | Cargar, ocultar y exportar | Se revela y exporta; sin metadatos de cámara | pendiente: probado solo con LibRaw simulado; falta un RAW real |
| ARC-026 | 1 | CMYK | Cargar, ocultar y exportar | Colores razonables, sin colores invertidos | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-027 | 1 | 16 bits por canal | Cargar, ocultar y exportar | Se conserva o convierte sin artefactos; máscara aplicada | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-028 | 1 | Escala de grises | Cargar, ocultar y exportar | Funciona con el efecto completo | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-029 | 1 | Perfiles de color | Cargar imagen Display P3 o Adobe RGB | Se convierte a sRGB sin que el perfil conserve datos personales | pendiente: probado sRGB y perfil dañado; falta una muestra Display P3 o Adobe RGB |
| ARC-030 | 1 | Orientación EXIF rotada | Cargar las 8 orientaciones | Se ve bien; la máscara coincide con la zona tras aplicar la orientación | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-031 | 3 | Live Photo | Cargar foto y video asociados | Se avisa que el movimiento es parte del archivo; foto y video salen por separado, sin identificadores de enlace | pendiente |

## Archivos: formatos de video

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-032 | 3 | Frame rate variable | Cargar, rastrear y exportar | Máscaras sincronizadas con el frame correcto; audio en sincronía | pendiente |
| ARC-033 | 3 | Video sin audio | Cargar y exportar | Exporta sin error y sin pista de audio inventada | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |
| ARC-034 | 3 | HDR | Cargar, ocultar y exportar | Conversión a SDR sin colores lavados; máscaras correctas | pendiente |
| ARC-035 | 3 | 10 bits | Cargar, ocultar y exportar | Se convierte al formato de salida sin artefactos | pendiente |
| ARC-036 | 3 | 60 fps | Cargar, rastrear y exportar | Sin frames sin ocultar | pendiente |
| ARC-037 | 3 | 120 fps | Cargar, rastrear y exportar | Sin frames sin ocultar; salida dentro de los fps permitidos | pendiente |
| ARC-038 | 3 | Metadato de rotación | Cargar video con rotación de 90, 180 y 270° | Vista y máscara alineadas; la salida se ve derecha | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |
| ARC-039 | 3 | Códec HEVC | Cargar y exportar | Vista previa desde el sidecar; exporta bien | pendiente |
| ARC-040 | 3 | Códec AV1 | Cargar y exportar | Igual que ARC-039, o limitación explicada | pendiente |
| ARC-041 | 3 | Códec ProRes | Cargar y exportar | Igual que ARC-039 | pendiente |
| ARC-042 | 3 | Corrupción a la mitad | Cargar video dañado en medio | "No pudimos analizar los segundos X–Y"; no se presenta como revisado | pendiente |
| ARC-043 | 3 | Video vertical | Flujo completo | UI y salida correctas | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |
| ARC-044 | 3 | Video horizontal | Flujo completo | UI y salida correctas | pendiente: la lectura con ffprobe está automatizada en sidecar/tests/test_video.py; falta el flujo completo |

## Archivos: nombres, rutas y sistema de archivos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-045 | 1 | Nombre con emojis | Cargar y exportar | Funciona; el log anonimiza el nombre | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-046 | 1 | Nombre con acentos | Cargar y exportar | Funciona | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-047 | 1 | Nombre con ñ | Cargar y exportar | Funciona | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-048 | 1 | Nombre con espacios | Cargar y exportar | Funciona, también al pasarlo a FFmpeg | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-049 | 1 | Ruta de más de 260 caracteres | Cargar y exportar | Funciona, o mensaje claro con qué hacer | automatizado: sidecar/tests/test_cargador.py, test_exportar.py |
| ARC-050 | 1 | Carpeta de red | Cargar y exportar desde una ruta UNC | Funciona; si la red se cae, mensaje claro y sin archivo parcial | manual: responsable del proyecto o testers con carpeta de red |
| ARC-051 | 1 | Carpeta en la nube | Cargar archivo solo en línea de OneDrive u otro servicio | Funciona o explica; se avisa si exportar a esa carpeta lo sube a la nube | manual: responsable del proyecto o testers con carpeta sincronizada |
| ARC-052 | 1 | Origen de solo lectura | Cargar desde una carpeta de solo lectura | Funciona; nada se escribe en el origen | pendiente: sin prueba todavía |
| ARC-053 | 1 | Destino de solo lectura | Exportar a una carpeta de solo lectura | Mensaje claro y opción de elegir otra carpeta | automatizado: sidecar/tests/test_exportar.py (archivo de solo lectura) |
| ARC-054 | 1 | Disco lleno | Exportar en un disco sin espacio | Se detiene; sin archivo final; temporales limpios; se explica qué hacer | automatizado: sidecar/tests/test_exportar.py (error de disco simulado, no un disco lleno real) |
| ARC-055 | 1 | Archivo borrado durante el proceso | Borrar el origen mientras se analiza | Mensaje claro; no se presenta como revisado | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/main.test.ts |
| ARC-056 | 1 | Archivo movido durante el proceso | Mover el origen mientras se analiza | Mensaje claro; no se presenta como revisado | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/main.test.ts |
| ARC-057 | 1 | Mismo archivo cargado dos veces | Cargarlo otra vez | Se avisa y no se duplica sin querer; también si se carga desde otra ruta | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/main.test.ts |
| ARC-058 | 2 | 500 archivos a la vez | Cargar el máximo del lote | Sin congelar la UI; progreso por archivo; se puede cancelar | automatizado: tests-ui/e2e/app.spec.ts (500 fotos en 2.4 s, la interfaz responde y se cancela). El progreso es el estado de cada foto en la lista; no hay aserción de que avance |
| ARC-059 | 2 | 501 archivos a la vez | Cargar uno más que el máximo | Se explica el límite y tú decides; ninguno se descarta en silencio | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/main.test.ts. El límite cuenta las fotos ya abiertas |

## Contenido visual: caras (VIS)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-001 | 1 | Multitud de más de 100 caras | Analizar y ocultar todo | Sin congelar la UI; advertencias agrupadas; progreso visible | automatizado: sidecar/tests/test_analisis.py (multitud sintética de 121 caras repetidas) |
| VIS-002 | 1 | Caras de perfil | Medir en el dataset | Dentro del recall aprobado | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-003 | 1 | Caras parciales | Medir en el dataset | Dentro del recall aprobado | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-004 | 1 | Caras con lentes | Medir en el dataset | Dentro del recall aprobado | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-005 | 1 | Caras con cubrebocas | Medir en el dataset | Dentro del recall aprobado | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-006 | 1 | Caras con maquillaje | Medir en el dataset | Dentro del recall aprobado | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-007 | 1 | Cara reflejada en un espejo | Analizar | Se propone; el usuario decide | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-008 | 1 | Cara reflejada en una ventana | Analizar | Se propone si se detecta; la limitación queda documentada | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-009 | 1 | Cara en un póster | Analizar | Se propone; el usuario la ignora con un clic | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-010 | 1 | Cara en una pantalla | Analizar | Se propone junto con la advertencia de pantalla, si aplica | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-011 | 1 | Foto dentro de la foto | Analizar | Se propone; el usuario decide | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |

## Contenido visual: falsos positivos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-012 | 1 | Estatua | Analizar | Si se marca, se puede ignorar; tasa medida y documentada | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-013 | 1 | Muñeco | Analizar | Igual que VIS-012 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-014 | 1 | Mascota | Analizar | Igual que VIS-012 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-015 | 1 | Dibujo | Analizar | Igual que VIS-012 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |

## Contenido visual: condiciones de captura

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-016 | 1 | Poca luz | Medir en el dataset | Recall medido; la advertencia de revisión orientativa sigue visible | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-017 | 1 | Foto nocturna | Medir en el dataset | Igual que VIS-016 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-018 | 1 | Contraluz | Medir en el dataset | Igual que VIS-016 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |
| VIS-019 | 1 | Desenfoque de movimiento | Medir en el dataset | Igual que VIS-016 | pendiente: falta el dataset de evaluación con fotos reales y licencia clara |

## Contenido visual: texto, placas y documentos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-020 | 2 | Texto rotado | Analizar con varios ángulos | Se detecta dentro del recall aprobado | pendiente |
| VIS-021 | 2 | Texto en espejo | Analizar también la imagen volteada | Igual que VIS-020 | pendiente |
| VIS-022 | 2 | Texto escrito a mano | Analizar | La región de texto se propone aunque el reconocedor falle | pendiente |
| VIS-023 | 2 | Texto parcialmente cubierto | Analizar | Se propone la región visible | pendiente |
| VIS-024 | 2 | Matrículas de otros países | Medir en el dataset | Recall medido; sin depender de un formato mexicano | pendiente |
| VIS-025 | 2 | Documento parcialmente visible | Analizar maqueta recortada | Se propone con texto de revisión | pendiente |
| VIS-026 | 2 | Pantalla con reflejos | Analizar | Se propone la pantalla aunque el texto sea ilegible | pendiente |

## Contenido visual: video

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-027 | 5 | Cortes rápidos | Rastrear un objeto con cortes | Se revalida tras cada corte; lo dudoso se marca | pendiente |
| VIS-028 | 5 | Persona que sale y regresa | Rastrear | Se reidentifica o se marca para revisión; no se deja de ocultar en silencio | pendiente |
| VIS-029 | 5 | Dos personas que se cruzan | Mostrar a una y ocultar a la otra | No se intercambian; con baja confianza, se ocultan ambas y se marca | pendiente |
| VIS-030 | 5 | Zoom | Rastrear durante un zoom | La máscara sigue cubriendo el objeto | pendiente |
| VIS-031 | 5 | Cámara temblorosa | Rastrear | La máscara cubre el objeto; el margen compensa | pendiente |
| VIS-032 | 5 | Transiciones | Rastrear a través de una transición | No se pierde en silencio; se marca para revisión | pendiente |
| VIS-033 | 5 | Fundidos | Rastrear a través de un fundido | Igual que VIS-032 | pendiente |
| VIS-034 | 5 | Filtros de color | Rastrear en video con filtro | Calidad medida; lo dudoso se marca | pendiente |

## Entorno: tema (ENT)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-001 | 1 | Modo claro | Flujo completo y capturas | Contraste AA; regresión visual en verde | automatizado: tests-ui/e2e/app.spec.ts |
| ENT-002 | 1 | Modo oscuro | Flujo completo y capturas | Igual que ENT-001 | automatizado: tests-ui/e2e/app.spec.ts |
| ENT-003 | 1 | Cambio del tema con la app abierta | Cambiar el tema de Windows durante un análisis | Cambia sin reiniciar; el proceso sigue | automatizado: tests-ui/e2e/app.spec.ts |
| ENT-004 | 1 | Alto contraste de Windows | Activar un tema de contraste real y usar la app | Todo visible y usable. También hay prueba automatizada con `forcedColors` | manual: responsable del proyecto con guion |

## Entorno: forma de la ventana

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-005 | 1 | Tamaño mínimo | Reducir al mínimo | Nada se corta ni se encima | automatizado: tests-ui/e2e/app.spec.ts |
| ENT-006 | 1 | Maximizado | Maximizar | La UI aprovecha el espacio | pendiente: probado 1920×1080, no el estado maximizado |
| ENT-007 | 1 | Pantalla dividida | Usar Win+flechas | Nada se corta | pendiente: probado a 800 px de ancho, no en pantalla dividida real |
| ENT-008 | 1 | Varios monitores con distinto DPI | Abrir la app en cada monitor | Se ve nítida; nada se corta | manual: testers con dos monitores |
| ENT-009 | 1 | Mover la ventana entre monitores | Arrastrar entre monitores con distinto DPI | Se reajusta; la máscara sigue alineada | manual: testers con dos monitores |
| ENT-010 | 1 | Escalado de 100% a 200% | Probar 100, 125, 150 y 200%, incluso con la app abierta | Regresión visual en 100 y 200%; máscara alineada | automatizado: tests-ui/e2e/app.spec.ts (solo 200%) |
| ENT-011 | 1 | Rotación de pantalla en tablet | Girar una tablet con Windows | Se reacomoda sin perder trabajo | manual: testers con tablet Windows |

## Entorno: teclado

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-012 | 1 | Distribución Español México | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-013 | 1 | Distribución Español España | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-014 | 1 | Distribución Inglés US | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-015 | 1 | Cambiar la distribución con la app abierta | Cambiar con Win+Espacio | Atajos y escritura siguen bien | manual: responsable del proyecto con guion |
| ENT-016 | 1 | Atajos en todas las distribuciones | Probar cada atajo, comparando por `code` y por carácter | Cada atajo funciona o tiene alternativa | pendiente: atajos probados solo con una distribución de teclado |
| ENT-017 | 1 | Acentos y teclas muertas | Escribir á, ñ, ü en campos de texto | Se escriben bien; ningún atajo interfiere | manual: responsable del proyecto con guion |
| ENT-018 | 1 | Método de entrada asiático (IME) | Componer texto con IME de japonés o chino | La composición no dispara atajos ni se pierde | manual: responsable del proyecto con guion |
| ENT-019 | 1 | Uso completo sin mouse | Flujo de foto completo solo con teclado. En la Fase 3 también video | Todo es alcanzable, sin trampas de foco | automatizado: tests-ui/e2e/app.spec.ts |

## Entorno: idioma y región

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-020 | 1 | Sistema en inglés | Ejecutar con la configuración regional en inglés | La app sigue en español, sin textos mezclados | pendiente: sin prueba con el sistema en inglés |
| ENT-021 | 1 | Región con coma decimal | Ejecutar con región que usa coma | Los decimales se leen bien; ningún archivo interno usa la región | pendiente: la coma se acepta en el campo, pero falta probar con esa región configurada |
| ENT-022 | 1 | Formatos de fecha distintos | Ejecutar con otro formato de fecha | Fechas sin ambigüedad en UI y reportes | pendiente: sin prueba con otro formato de fecha |

## Entorno: red

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-023 | 1 | Sin internet | Usar la app con los modelos ya instalados | Todo funciona, incluida la Guía de privacidad | automatizado: tests-ui/e2e/app.spec.ts (sin conexiones hacia afuera) |
| ENT-024 | 8 | Internet se cae durante la descarga de modelos | Cortar la red a la mitad | Reanuda o reinicia; verifica el hash; nunca usa un modelo incompleto | pendiente |
| ENT-025 | 8 | Proxy corporativo | Descargar modelos detrás de un proxy | Funciona o explica cómo instalarlos; el análisis no usa la red | manual: responsable del proyecto con proxy local o testers |

## Entorno: hardware y energía

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-026 | 1 | Sin GPU | Flujo completo en CPU, que es el modo del MVP | Funciona; es el modo por defecto en local y CI | automatizado: toda la batería corre en CPU, en este equipo sin GPU dedicada |
| ENT-027 | 8 | GPU con poca memoria | Usar en un equipo con GPU débil | Funciona en CPU, sin intentar usar esa GPU | manual: testers con ese equipo |
| ENT-028 | 8 | Laptop con GPU híbrida | Usar en un equipo con dos GPU | Funciona en CPU; el video de la UI se ve bien | manual: testers con ese equipo |
| ENT-029 | 3 | Batería baja | Procesar con batería baja | Avisa antes de un proceso largo; no pierde trabajo | manual: responsable del proyecto en su laptop |
| ENT-030 | 3 | Modo ahorro de energía | Procesar con ahorro activado | Más lento, sin error; estimación actualizada | manual: responsable del proyecto en su laptop |
| ENT-031 | 3 | Suspensión a mitad de un proceso | Suspender y reanudar durante un tracking | Reanuda o reinicia el bloque; nunca presenta como terminado | manual: responsable del proyecto en su laptop |
| ENT-032 | 1 | Cierre forzado | Terminar el proceso durante un análisis y una exportación | Al abrir, ofrece recuperar; temporales limpios; sin archivo final parcial | automatizado: tests-ui/e2e/app.spec.ts |

## Entorno: permisos e instancias

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-033 | n/a | Acceso a carpetas denegado en macOS | Denegar el permiso en macOS | Mensaje claro | fuera de alcance: solo Windows |
| ENT-034 | 8 | Antivirus bloquea el sidecar | Bloquear el sidecar con Windows Security o simular que no arranca | Explica qué pasó y qué hacer; no presenta nada como revisado | manual: responsable del proyecto con guion |
| ENT-035 | 8 | Usuario sin permisos de administrador | Instalar y usar con cuenta estándar | Se instala por usuario y funciona | manual: responsable del proyecto con cuenta estándar |
| ENT-036 | 1 | Dos instancias abiertas | Abrir la app dos veces | Se enfoca la existente; proyectos y temporales no se pisan | automatizado: tests-ui/e2e/app.spec.ts |
| ENT-037 | 1 | Dos ventanas abiertas | Intentar una segunda ventana del mismo proyecto | Se enfoca la existente; sin conflicto de guardado | automatizado: tests-ui/e2e/app.spec.ts |

## Accesibilidad (ACC)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ACC-001 | 1 | NVDA | Flujo de foto completo con guion. En Fase 3, también video | Todo se entiende y se puede usar | manual: responsable del proyecto o testers con NVDA |
| ACC-002 | 1 | Narrador | Flujo de foto completo con guion | Igual que ACC-001 | manual: responsable del proyecto o testers con Narrador |
| ACC-003 | n/a | VoiceOver | Flujo completo en macOS | Igual que ACC-001 | fuera de alcance: solo Windows |
| ACC-004 | 1 | Todos los controles con etiqueta | axe-core en cada pantalla | Sin controles sin nombre | automatizado: tests-ui/e2e/app.spec.ts (axe-core; solo detecta una parte de los problemas) |
| ACC-005 | 1 | Advertencias anunciadas automáticamente | Revisar regiones vivas por test y escuchar con NVDA | Se anuncian al aparecer, sin saturar | manual: responsable del proyecto o testers con NVDA |
| ACC-006 | 1 | Descripción en texto de cada advertencia | Analizar imagen con matrícula de prueba | Texto tipo "Se detectó 1 matrícula en la parte inferior izquierda" | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/logica.test.ts |
| ACC-007 | 1 | Ocultar todo y exportar sin ver la imagen | Flujo con pantalla apagada y lector de pantalla | Se completa con éxito y se confirma el resultado | manual: testers usuarios de lector de pantalla |
| ACC-008 | 1 | Resumen por archivo | Revisar el resumen de cada archivo | Hay texto que el lector lee completo | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/logica.test.ts |
| ACC-009 | 1 | Protanopia | Emular por CDP y comparar capturas | El riesgo se distingue con ícono y texto | automatizado: tests-ui/e2e/app.spec.ts (simulación y comprobación de ícono y texto) |
| ACC-010 | 1 | Deuteranopia | Igual que ACC-009 | Igual que ACC-009 | automatizado: tests-ui/e2e/app.spec.ts (simulación y comprobación de ícono y texto) |
| ACC-011 | 1 | Tritanopia | Igual que ACC-009 | Igual que ACC-009 | automatizado: tests-ui/e2e/app.spec.ts (simulación y comprobación de ícono y texto) |
| ACC-012 | 1 | Nada depende solo del color | Revisar capturas en escala de grises | Todos los estados se distinguen | automatizado: tests-ui/e2e/app.spec.ts (simulación y comprobación de ícono y texto) |
| ACC-013 | 1 | Zoom al 200% | Aumentar el zoom de la app al 200% | Sin pérdida de contenido ni scroll en dos ejes fuera de la imagen | automatizado: tests-ui/e2e/app.spec.ts |
| ACC-014 | 1 | Texto grande del sistema | Activar texto grande en Windows | El texto crece sin cortarse | manual: responsable del proyecto con guion |
| ACC-015 | 1 | Reducir movimiento | Emular `reducedMotion` | Sin animaciones no esenciales | pendiente: regla CSS presente y emulada, sin aserción |
| ACC-016 | 1 | Foco siempre visible | Tabular por cada pantalla | El foco se ve en claro, oscuro y contraste alto | pendiente: sin aserción automática; revisar con teclado |
| ACC-017 | 1 | Objetivos de clic suficientes | Medir con test los controles interactivos | Cumplen WCAG 2.2 criterio 2.5.8 como mínimo | automatizado: tests-ui/e2e/app.spec.ts (axe-core; solo detecta una parte de los problemas) |
| ACC-018 | 1 | Verificación automática WCAG 2.2 AA | axe-core en cada pantalla y estado | Sin violaciones | automatizado: tests-ui/e2e/app.spec.ts (axe-core; solo detecta una parte de los problemas) |
| ACC-019 | 8 | Revisión manual con lector de pantalla | Recorrer la app completa con NVDA antes de entregar | Hallazgos corregidos o documentados | manual: responsable del proyecto o testers con NVDA |

## Interacción (INT)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| INT-001 | 1 | Doble clic rápido | Doble clic en cada acción principal | Se ejecuta una sola vez | automatizado: tests-ui/e2e/app.spec.ts |
| INT-002 | 1 | Clic repetido en "Exportar" | Clic varias veces seguidas | Una sola exportación | automatizado: tests-ui/e2e/app.spec.ts |
| INT-003 | 1 | Cancelar a la mitad y volver a empezar | Cancelar análisis y exportación, y reintentar | Limpia, sin estado colgado ni archivo parcial | automatizado: tests-ui/e2e/app.spec.ts |
| INT-004 | 1 | Deshacer y rehacer | Secuencias de edición | El estado coincide en cada paso, también en la vista y la exportación | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/logica.test.ts |
| INT-005 | 1 | Deshacer sin historial | Deshacer en un proyecto nuevo | Botón desactivado; el atajo no hace nada | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/logica.test.ts |
| INT-006 | 1 | Rehacer sin historial | Rehacer sin nada que rehacer | Igual que INT-005 | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/logica.test.ts |
| INT-007 | 1 | Superar el límite del historial | Hacer más ediciones que `historial.pasos` | Se descarta lo más antiguo, sin error | automatizado: tests-ui/unit/logica.test.ts |
| INT-008 | 1 | Arrastrar un archivo no soportado | Arrastrar `.pdf` o `.zip` | Mensaje claro; sigue lo demás | pendiente: arrastrar y soltar no se prueba aún; el código comparte camino con abrir |
| INT-009 | 1 | Arrastrar una carpeta | Arrastrar una carpeta | Carga lo soportado con resumen, o explica | pendiente: arrastrar y soltar no se prueba aún; la carpeta sí se rechaza al abrir |
| INT-010 | 1 | Arrastrar archivos mientras otro se procesa | Arrastrar durante un análisis | Se encolan; el análisis actual sigue | pendiente: arrastrar y soltar no se prueba aún |
| INT-011 | 1 | Cerrar con cambios sin guardar | Cerrar la ventana | Pregunta antes de cerrar; también con Alt+F4 | automatizado: tests-ui/e2e/app.spec.ts (aviso propio de la app). Alt+F4 dispara el mismo evento de cierre, pero la tecla en sí no se ha probado |
| INT-012 | 2 | Clic fuera de la imagen | Clic de selección fuera | Sin máscara; aviso claro | automatizado: tests-ui/e2e/app.spec.ts (coordenadas fuera), sidecar/tests/test_segmentar.py, test_pincel.py. Con el mouse no hay forma de hacer clic fuera: el lienzo es la imagen |
| INT-013 | 2 | Clic en el borde exacto | Clic en la primera y última fila y columna | Máscara válida, sin error de índice | pendiente |
| INT-014 | 1 | Zoom extremo | Zoom al mínimo y al máximo, editando | Máscara alineada; UI estable | pendiente: no hay zoom de imagen todavía; pasa a la Fase 2 |
| INT-015 | 1 | Sliders en sus extremos | Llevar cada slider a mín y máx | Aplica sin error; efecto correcto | pendiente: no hay sliders todavía; el campo de intensidad sí se probó en sus extremos |
| INT-016 | 1 | Escribir "-5" en campo numérico | Probar cada campo | Según [RANGOS.md](RANGOS.md); mensaje claro | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-017 | 1 | Escribir "abc" | Igual que INT-016 | Rechazo; se conserva el valor válido | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-018 | 1 | Escribir "999999" | Igual que INT-016 | Rechazo si rebasa; sin recorte silencioso | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-019 | 1 | Dejar vacío | Igual que INT-016 | Rechazo; se conserva el valor válido | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-020 | 1 | Escribir "1e10" | Igual que INT-016 | Rechazo | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-021 | 1 | Escribir "0,5" | Igual que INT-016 | 0.5 en campos decimales; rechazo en enteros | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-022 | 1 | Pegar texto largo | Pegar miles de caracteres | Rechazo sin congelar | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/numeros.test.ts |
| INT-023 | 2 | Trazo con el pincel | Pintar, deshacer, rehacer y exportar | Solo lo pintado, con el margen mínimo, sale tapado; el resto queda igual | automatizado: tests-ui/e2e/app.spec.ts, sidecar/tests/test_pincel.py |
| INT-024 | 2 | Pincel que sale del lienzo | Arrastrar fuera de la imagen | El trazo sigue por el borde; el sidecar rechaza puntos fuera | automatizado: sidecar/tests/test_pincel.py, tests-ui/unit/logica.test.ts (sin E2E) |
| INT-025 | 2 | Trazo muy largo | Más de 5000 puntos | Toma la primera parte y avisa | automatizado: tests-ui/unit/logica.test.ts, sidecar/tests/test_pincel.py (el aviso en pantalla no tiene E2E) |
| INT-026 | 2 | Pincel en sus extremos | Tamaño 1 y 512, puntos en las esquinas | Máscara válida; fuera de rango se rechaza | automatizado: sidecar/tests/test_pincel.py, tests-ui/unit/logica.test.ts |
| INT-027 | 2 | Trazo tras reiniciar el sidecar o recuperar | Recuperar una edición con un trazo | Se oculta toda la caja del trazo y sigue diciendo "trazo a mano" | automatizado: sidecar/tests/test_segmentar.py (máscara perdida), tests-ui/unit/logica.test.ts (origen recuperado) |
| INT-028 | 3 | Ocultar con emoji | Elegir cada emoji en una cara, una zona manual y un objeto de video; exportar a JPG y PNG | El emoji se ajusta a la cara (óvalo) o a la silueta, y tapa el rectángulo completo en zonas dibujadas a mano, sin rectángulo negro; la exportación pasa la verificación | automatizado: sidecar/tests/test_exportar.py, tests-ui/unit/logica.test.ts. Falta revisar en pantalla, en claro y oscuro (manual) |
| INT-030 | 3 | Zoom del visor | Acercar y alejar con botones, Ctrl + rueda y teclas + − 0; probar los extremos 100 % y 800 % | El punto bajo el cursor se queda en su lugar; en los extremos el botón se desactiva y no pasa del límite; la exportación no cambia | automatizado: tests-ui/unit/logica.test.ts (niveles, límites, ajuste y anclaje), tests-ui/e2e/app.spec.ts (botones, teclas y extremos, en claro y oscuro). Ctrl + rueda y el anclaje al cursor sin E2E |
| INT-031 | 3 | Moverse por la imagen ampliada | Arrastrar con "Solo ver", con el botón central y con las flechas; usar clic, rectángulo y pincel ya ampliada | Se mueve sin seleccionar nada; las herramientas marcan el punto correcto con cualquier zoom | pendiente: manual. El punto se calcula con el mismo `aPuntoDeImagen`, ya probado |
| INT-032 | 3 | Resaltado entre panel e imagen | Pasar el mouse y el foco por las filas, y el mouse por las marcas; clic en una marca con "Solo ver" | Se resalta la misma zona en ambos lados; el clic lleva el foco a su fila; con teclado, la imagen ampliada se mueve hasta la zona; en alto contraste se ve con el color del sistema | automatizado: tests-ui/unit/logica.test.ts (zona bajo el puntero), tests-ui/e2e/app.spec.ts (fila y marca a la vez, clic en la marca lleva el foco a su fila, axe, capturas en claro y oscuro). Alto contraste y movimiento con teclado de la imagen ampliada: manual |
| INT-029 | 3 | Emoji tras recuperar | Elegir un emoji, cerrar de golpe y recuperar | El emoji elegido se conserva | automatizado: tests-ui/unit/logica.test.ts (sin E2E) |

## Seguridad y privacidad (SEG)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| SEG-001 | 1 | Sin tráfico durante el análisis | Capturar tráfico y auditar sockets durante el análisis | Cero conexiones de la app y del sidecar | automatizado: tests-ui/e2e/app.spec.ts (peticiones del renderer y conexiones TCP del sistema) |
| SEG-002 | 1 | Temporales borrados al terminar | Comparar la carpeta temporal antes y después | Sin restos | automatizado: sidecar/tests/test_exportar.py |
| SEG-003 | 1 | Temporales borrados tras cierre forzado | Matar el proceso y abrir de nuevo | Se limpian al abrir; lo anterior es ilegible sin la llave | pendiente: tras un cierre forzado puede quedar un `.parcial`, que solo trae la salida oculta; falta limpiarlo al abrir |
| SEG-004 | 3 | Sin frames sin difuminar en temporales | Revisar el disco durante y después de un proceso de video | Solo caché cifrada; ningún frame legible | pendiente |
| SEG-005 | 1 | Exportado sin EXIF | Revisar con `exiftool -a -G1 -ee` | Nada fuera de la lista blanca | automatizado: sidecar/tests/test_exportar.py, tests-ui/e2e/app.spec.ts |
| SEG-006 | 1 | Exportado sin GPS, XMP ni IPTC | Revisar una imagen que sí los tenía | Nada | automatizado: sidecar/tests/test_exportar.py, tests-ui/e2e/app.spec.ts |
| SEG-007 | 1 | Sin miniatura EXIF | Revisar imagen con miniatura sin ocultar | Sin miniatura ni imagen embebida | automatizado: sidecar/tests/test_exportar.py, tests-ui/e2e/app.spec.ts |
| SEG-008 | 3 | Sin GPS en contenedores MP4 y MOV | Revisar con `ffprobe` y `exiftool` un video con GPS | Nada, incluidos `udta` y streams de datos | pendiente: el verificador de bytes está automatizado en sidecar/tests/test_metadatos_video.py; falta exportar con FFmpeg y revisar con exiftool |
| SEG-009 | 1 | Sin nombre del dispositivo | Revisar foto y video con marca y modelo | Nada | automatizado: sidecar/tests/test_exportar.py, tests-ui/e2e/app.spec.ts |
| SEG-010 | 1 | Irreversibilidad | Sólido: dos entradas distintas en la zona. Difuminado y pixelado: una cara real y detalle fino | Sólido: misma salida, no se recupera nada. Difuminado y pixelado: **no son irreversibles por decisión del responsable**; la cara deja de detectarse, el detalle fino se pierde y la app avisa | automatizado: sidecar/tests/test_efectos.py, test_exportar.py. No incluye un ataque de reconstrucción contra difuminado o pixelado |
| SEG-011 | 6 | El reporte no tiene datos sensibles | Generar el reporte y buscar texto OCR, rutas y recortes | Nada | pendiente |
| SEG-012 | 6 | "Reportar un problema" sin datos sensibles | Generar el archivo y revisarlo | Sin imágenes; logs anonimizados; solo sale si lo mandas tú | pendiente |
| SEG-013 | 4 | Embeddings fuera del disco | Cerrar proyecto sin elegir guardar y buscar restos | Nada en disco | pendiente |
| SEG-014 | 1 | Sin estimación de edad | Revisar la salida, reportes y logs | Ningún dato de edad | automatizado: sidecar/tests/test_analisis.py |
| SEG-015 | 3 | Emoji irreversible | Dos entradas distintas bajo cada emoji, con y sin silueta, y un difuminado vecino | Misma salida en lo que el emoji tapa (caja, silueta u óvalo de la cara): ahí, lo transparente del emoji muestra su color principal, sin rectángulo negro, y el vecino no toma color de lo oculto | automatizado: sidecar/tests/test_efectos.py |
| SEG-017 | 3 | El óvalo del emoji contiene la cara | Caras de 4 a 400 px, proporción 0.5 a 2, en el centro, cerca y pegadas a la orilla de la foto | El óvalo, o la caja completa si toca la orilla, contiene toda la caja del detector | automatizado: sidecar/tests/test_efectos.py (propiedad con hypothesis); revisión aparte por fuerza bruta de 31 720 casos sin fallas |
| SEG-016 | 3 | Emoji alterado o ausente | Cambiar el hash esperado o el nombre de un PNG de `sidecar/recursos/emojis` | Error tipado `MODELO_NO_DISPONIBLE`; nunca se oculta con otra cosa ni se exporta | automatizado: sidecar/tests/test_efectos.py |

## Regla 1: validación de entradas (VAL)

Cada caso se aplica a cada función, comando del IPC y control, en la UI y de nuevo en el sidecar. Se genera por parámetro desde [RANGOS.md](RANGOS.md).

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VAL-001 | 1 | null | Enviar a cada parámetro | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-002 | 1 | undefined o campo faltante | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-003 | 1 | None | Igual, en Python | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-004 | 1 | Cadena vacía | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-005 | 1 | Lista vacía | Igual | Rechazo tipado, salvo que el esquema la permita | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-006 | 1 | Objeto vacío | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-007 | 1 | Texto donde va número | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-008 | 1 | Decimal donde va entero | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-009 | 1 | NaN | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-010 | 1 | Infinity | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-011 | 1 | -Infinity | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-012 | 1 | Notación científica "1e10" | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-013 | 1 | Coma decimal "0,5" | Igual | La UI normaliza en campos decimales; el sidecar rechaza texto | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-014 | 1 | Espacios | Igual | La UI recorta extremos; el sidecar rechaza texto | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-015 | 1 | Emojis | Igual | Rechazo tipado en números; se aceptan solo en textos libres | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-016 | 1 | Negativos | Igual | Rechazo, salvo que el rango los permita | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-017 | 1 | Cero | Igual | Según el rango | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-018 | 1 | Mínimo-1 | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-019 | 1 | Mínimo | Igual | Aceptado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-020 | 1 | Mínimo+1 | Igual | Aceptado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-021 | 1 | Máximo-1 | Igual | Aceptado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-022 | 1 | Máximo | Igual | Aceptado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-023 | 1 | Máximo+1 | Igual | Rechazo tipado | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-024 | 1 | Valores gigantes | Igual, incluidos 2^53 y 1e308 | Rechazo tipado, sin desbordamiento | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/unit/numeros.test.ts |
| VAL-025 | 3 | Inicio mayor que fin | Enviar rango invertido | Rechazo tipado | pendiente |
| VAL-026 | 3 | Inicio igual a fin | Enviar rango de duración cero | Rechazo tipado | pendiente |
| VAL-027 | 3 | Rango fuera de la duración | Enviar fin mayor que la duración | Rechazo tipado | pendiente |
| VAL-028 | 1 | Coordenadas fuera de la imagen | Enviar x o y fuera | Rechazo tipado | automatizado: sidecar/tests/test_efectos.py, test_esquemas.py |
| VAL-029 | 1 | Máscara vacía | Enviar máscara sin píxeles | Rechazo tipado con mensaje | automatizado: sidecar/tests/test_efectos.py, test_esquemas.py |
| VAL-030 | 1 | Máscara al 100% de la imagen | Enviar máscara completa | Se pide confirmar; luego se aplica | automatizado para rectángulos: tests-ui/e2e/app.spec.ts (coordenadas). La silueta y el trazo usan la misma confirmación sobre su caja, sin E2E propio. Se mide la caja, no la máscara: puede preguntar de más, nunca de menos |
| VAL-031 | 1 | Esquemas tipados en las fronteras | Revisar que cada comando tenga Zod y Pydantic, por test de contrato | Sin comandos sin esquema; ambos coinciden | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/e2e/app.spec.ts |
| VAL-032 | 1 | El sidecar no confía en la UI | Mandar comandos inválidos directo al sidecar | Rechazo tipado, sin depender de la UI | automatizado: sidecar/tests/test_esquemas.py, test_servidor.py, tests-ui/e2e/app.spec.ts |

## Regla 2: condicionales completos (COD)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| COD-001 | 1 | Exhaustividad en TypeScript | `strict`, `noImplicitReturns` y `switch-exhaustiveness-check` en CI | Build falla si falta un caso | automatizado: tsc estricto y ESLint switch-exhaustiveness-check |
| COD-002 | 1 | Exhaustividad en Python | pyright estricto; `assert_never` en cada `match` | Build falla si falta un caso | automatizado: pyright estricto y assert_never |
| COD-003 | 1 | Caso por defecto que lanza error | Forzar un valor de enum inesperado | Error claro, nunca una continuación silenciosa | automatizado: sidecar/tests/test_cobertura_critica.py, tests-ui/unit/logica.test.ts |
| COD-004 | 1 | Sin `catch` vacío | Regla de ESLint en CI | Build falla si aparece | automatizado: ESLint no-empty |
| COD-005 | 1 | Sin `except: pass` | Reglas de Ruff en CI | Build falla si aparece | automatizado: Ruff S110 |
| COD-006 | 1 | Todo error se registra y se traduce | Forzar errores en cada frontera | Log técnico y mensaje de usuario | automatizado: sidecar/tests/test_servidor.py |
| COD-007 | 1 | Casos que "no deberían pasar" | Revisar en code review y con pruebas de mutación | Error explícito | automatizado: sidecar/tests/test_cobertura_critica.py, tests-ui/unit/logica.test.ts |

## Regla 3: rangos documentados (RAN)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| RAN-001 | 1 | Cada parámetro está en `RANGOS.md` | Test que compara los esquemas con el documento | Sin diferencias | automatizado: revisión manual de qa/RANGOS.md contra esquemas.py y contrato.ts |
| RAN-002 | 1 | Cada parámetro tiene pruebas de límite | Test que genera los casos por parámetro | Todos cubiertos | pendiente: faltan pruebas de límites para los parámetros que aún no se exponen |

## Regla 4: fallo seguro (FCL)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| FCL-001 | 1 | La detección falla | Simular fallo del modelo | Se dice claramente; no se presenta como revisado | automatizado: sidecar/tests/test_analisis.py, tests-ui/e2e/app.spec.ts |
| FCL-002 | 1 | La detección falla parcialmente | Fallar un detector y dejar otros | Dice qué parte no se analizó; no se presenta como revisado | automatizado: sidecar/tests/test_analisis.py, tests-ui/e2e/app.spec.ts |
| FCL-003 | 1 | La detección se cancela | Cancelar a la mitad | Dice qué faltó; no se presenta como revisado | automatizado: tests-ui/e2e/app.spec.ts |
| FCL-004 | 3 | Segmento de video sin analizar | Fallar un bloque | "No pudimos analizar los segundos 0:42–0:58" con los segundos reales | pendiente |
| FCL-005 | 1 | Exportación falla a la mitad | Simular fallo durante la escritura | Sin archivo de salida con apariencia terminada | automatizado: sidecar/tests/test_exportar.py |
| FCL-006 | 1 | Falla la verificación final | Dejar un metadato fuera de la lista blanca | Se bloquea la exportación y se explica | automatizado: sidecar/tests/test_exportar.py |
| FCL-007 | 3 | El tracking pierde un objeto | Simular pérdida | Se marca para revisión; se sigue ocultando el área | pendiente |
| FCL-008 | 3 | Exportación de video interrumpida | Matar FFmpeg a la mitad | Sin archivo final; error claro | pendiente |
| FCL-009 | 1 | No se puede aplicar un efecto | Simular fallo en el efecto | No se exporta sin ese efecto | automatizado: sidecar/tests/test_exportar.py |
| FCL-010 | 1 | Advertencias sin atender al exportar | Exportar con advertencias sin decidir | Se avisa y el usuario decide; no se bloquea la publicación | automatizado: tests-ui/e2e/app.spec.ts |

## Regla 5: errores y logs (ERR)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ERR-001 | 1 | Errores tipados | Comprobar cada error por test | Código interno, mensaje de usuario y log técnico | automatizado: sidecar/tests/test_servidor.py |
| ERR-002 | 1 | Sin códigos ni stack traces en pantalla | Forzar errores en E2E y revisar el texto | Solo mensajes en tono de marca: qué pasó, por qué, qué hacer | automatizado: tests-ui/e2e/app.spec.ts (mensajes de los errores probados) |
| ERR-003 | 1 | Logs sin imágenes | Revisar logs tras un flujo completo | Nada binario ni base64 | automatizado: tests-ui/e2e/app.spec.ts, sidecar/tests/test_servidor.py |
| ERR-004 | 2 | Logs sin texto de OCR | Procesar texto centinela y buscarlo | No aparece | automatizado: tests-ui/e2e/app.spec.ts (teléfono, correo y QR leídos; ninguno llega a los logs) |
| ERR-005 | 1 | Logs sin rutas con datos personales | Usar una ruta centinela y buscarla | Anonimizada | automatizado: tests-ui/e2e/app.spec.ts, sidecar/tests/test_servidor.py |
| ERR-006 | 1 | Recuperación tras cierre de golpe | Matar la app con ediciones y abrirla | Ofrece recuperar, y solo con ediciones, sin píxeles | automatizado: tests-ui/e2e/app.spec.ts |
| ERR-007 | 1 | Error del sidecar | Terminar el sidecar | Mensaje claro; reinicio o guía; sin presentar nada como revisado | automatizado: tests-ui/e2e/app.spec.ts, tests-ui/unit/main.test.ts |

## Comprobación de cobertura del brief

Secciones de casos extremos recorridas una por una: Archivos, Contenido visual, Entorno y sistema, Accesibilidad, Interacción, Seguridad y privacidad. Reglas obligatorias: 1 a 5.

Casos agregados que no aparecen en el brief: ARC-059, INT-007, SEG-012, SEG-013, SEG-014, FCL-006, FCL-008, FCL-009, FCL-010 y ERR-007.
