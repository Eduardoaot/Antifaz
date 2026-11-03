# Matriz de pruebas de Antifaz

**Estado:** Fase 0. No existe código todavía, así que **ningún caso se ha ejecutado**.

**Valores de Estado:**
- `pendiente`: se automatizará o ejecutará en la fase indicada.
- `manual: <quién>`: necesita a una persona o hardware que no hay en el equipo de desarrollo. Tampoco se ha ejecutado, y no cuenta como aprobado hasta tener evidencia.
- `fuera de alcance: solo Windows`: conserva su ID por si macOS vuelve.

Al ejecutar un caso, el Estado pasa a `automatizado` o `manual`, con enlace a su evidencia. La columna Fase indica cuándo debe quedar cubierto por primera vez. Los límites citados están en [RANGOS.md](RANGOS.md).

## Archivos: sin contenido (ARC)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-001 | 1 | Imagen totalmente negra | Cargar y analizar | "No encontramos nada riesgoso", aclarando que la revisión es orientativa | pendiente |
| ARC-002 | 1 | Imagen totalmente blanca | Cargar y analizar | Igual que ARC-001 | pendiente |
| ARC-003 | 1 | Imagen de un solo color | Cargar y analizar | Igual que ARC-001 | pendiente |
| ARC-004 | 1 | Imagen de ruido | Cargar y analizar | Igual que ARC-001 o propuestas de baja confianza; no se cierra | pendiente |
| ARC-005 | 1 | Cielo vacío | Cargar y analizar | Igual que ARC-001 | pendiente |

## Archivos: tamaños extremos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-006 | 1 | Imagen de 1×1 px | Cargar, analizar, ocultar y exportar | No se cierra; avisa que es demasiado pequeña para analizarla bien y no se presenta como revisada | pendiente |
| ARC-007 | 1 | Imagen de más de 100 MP | Cargar imagen dentro del límite | Procesa con progreso y sin rebasar memoria, o explica el límite | pendiente |
| ARC-008 | 1 | Panorámica muy alargada | Cargar imagen con relación de aspecto extrema | Procesa si está en el límite; si no, mensaje específico. La UI no se deforma | pendiente |
| ARC-009 | 3 | Video 8K | Cargar y crear proxy | Procesa sobre proxy con tiempo estimado | pendiente |
| ARC-010 | 3 | Video de 1 frame | Cargar, ocultar y exportar | Funciona; ningún cálculo divide entre cero | pendiente |
| ARC-011 | 3 | Video de varias horas | Cargar video por encima del máximo | Rechazo explicado, o aviso con tiempo estimado si cabe. Sin bloquear la UI | pendiente |
| ARC-012 | 1 | Archivo de 0 bytes | Cargar | "Este archivo está vacío"; el resto del lote sigue | pendiente |

## Archivos: corruptos y maliciosos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-013 | 1 | Imagen corrupta | Cargar archivo con bytes alterados | Error claro; sin cierre ni advertencias falsas de "revisado" | pendiente |
| ARC-014 | 1 | Imagen truncada | Cargar archivo cortado a la mitad | Error claro; no se analiza como imagen parcial sin avisar | pendiente |
| ARC-015 | 1 | `.txt` renombrado a `.jpg` | Cargar | "Este archivo no es una imagen"; se identifica por contenido | pendiente |
| ARC-016 | 1 | `.exe` renombrado a `.jpg` | Cargar | Igual que ARC-015; nunca se ejecuta | pendiente |
| ARC-017 | 1 | Bomba de descompresión | Cargar imagen con dimensiones gigantes declaradas | Rechazo antes de decodificar, sin pico de memoria | pendiente |

## Archivos: formatos de imagen

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-018 | 1 | JPG | Cargar, ocultar y exportar | Salida correcta y sin metadatos | pendiente |
| ARC-019 | 1 | PNG con transparencia | Cargar, ocultar y exportar | La transparencia no oculta ni revela contenido; lo oculto queda sobrescrito también en los píxeles transparentes | pendiente |
| ARC-020 | 1 | HEIC | Cargar, ocultar y exportar | Salida correcta y sin metadatos | pendiente |
| ARC-021 | 1 | HEIF | Cargar, ocultar y exportar | Salida correcta y sin metadatos | pendiente |
| ARC-022 | 1 | WebP | Cargar, ocultar y exportar | Salida correcta y sin metadatos | pendiente |
| ARC-023 | 1 | AVIF | Cargar, ocultar y exportar | Salida correcta y sin metadatos | pendiente |
| ARC-024 | 3 | GIF animado | Cargar | Se trata como video, o se explica la limitación. Nunca se revisa solo el primer frame sin decirlo | pendiente |
| ARC-025 | 1 | RAW | Cargar, ocultar y exportar | Se revela y exporta; sin metadatos de cámara | pendiente |
| ARC-026 | 1 | CMYK | Cargar, ocultar y exportar | Colores razonables, sin colores invertidos | pendiente |
| ARC-027 | 1 | 16 bits por canal | Cargar, ocultar y exportar | Se conserva o convierte sin artefactos; máscara aplicada | pendiente |
| ARC-028 | 1 | Escala de grises | Cargar, ocultar y exportar | Funciona con el efecto completo | pendiente |
| ARC-029 | 1 | Perfiles de color | Cargar imagen Display P3 o Adobe RGB | Se convierte a sRGB sin que el perfil conserve datos personales | pendiente |
| ARC-030 | 1 | Orientación EXIF rotada | Cargar las 8 orientaciones | Se ve bien; la máscara coincide con la zona tras aplicar la orientación | pendiente |
| ARC-031 | 3 | Live Photo | Cargar foto y video asociados | Se avisa que el movimiento es parte del archivo; foto y video salen por separado, sin identificadores de enlace | pendiente |

## Archivos: formatos de video

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-032 | 3 | Frame rate variable | Cargar, rastrear y exportar | Máscaras sincronizadas con el frame correcto; audio en sincronía | pendiente |
| ARC-033 | 3 | Video sin audio | Cargar y exportar | Exporta sin error y sin pista de audio inventada | pendiente |
| ARC-034 | 3 | HDR | Cargar, ocultar y exportar | Conversión a SDR sin colores lavados; máscaras correctas | pendiente |
| ARC-035 | 3 | 10 bits | Cargar, ocultar y exportar | Se convierte al formato de salida sin artefactos | pendiente |
| ARC-036 | 3 | 60 fps | Cargar, rastrear y exportar | Sin frames sin ocultar | pendiente |
| ARC-037 | 3 | 120 fps | Cargar, rastrear y exportar | Sin frames sin ocultar; salida dentro de los fps permitidos | pendiente |
| ARC-038 | 3 | Metadato de rotación | Cargar video con rotación de 90, 180 y 270° | Vista y máscara alineadas; la salida se ve derecha | pendiente |
| ARC-039 | 3 | Códec HEVC | Cargar y exportar | Vista previa desde el sidecar; exporta bien | pendiente |
| ARC-040 | 3 | Códec AV1 | Cargar y exportar | Igual que ARC-039, o limitación explicada | pendiente |
| ARC-041 | 3 | Códec ProRes | Cargar y exportar | Igual que ARC-039 | pendiente |
| ARC-042 | 3 | Corrupción a la mitad | Cargar video dañado en medio | "No pudimos analizar los segundos X–Y"; no se presenta como revisado | pendiente |
| ARC-043 | 3 | Video vertical | Flujo completo | UI y salida correctas | pendiente |
| ARC-044 | 3 | Video horizontal | Flujo completo | UI y salida correctas | pendiente |

## Archivos: nombres, rutas y sistema de archivos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ARC-045 | 1 | Nombre con emojis | Cargar y exportar | Funciona; el log anonimiza el nombre | pendiente |
| ARC-046 | 1 | Nombre con acentos | Cargar y exportar | Funciona | pendiente |
| ARC-047 | 1 | Nombre con ñ | Cargar y exportar | Funciona | pendiente |
| ARC-048 | 1 | Nombre con espacios | Cargar y exportar | Funciona, también al pasarlo a FFmpeg | pendiente |
| ARC-049 | 1 | Ruta de más de 260 caracteres | Cargar y exportar | Funciona, o mensaje claro con qué hacer | pendiente |
| ARC-050 | 1 | Carpeta de red | Cargar y exportar desde una ruta UNC | Funciona; si la red se cae, mensaje claro y sin archivo parcial | manual: responsable del proyecto o testers con carpeta de red |
| ARC-051 | 1 | Carpeta en la nube | Cargar archivo solo en línea de OneDrive u otro servicio | Funciona o explica; se avisa si exportar a esa carpeta lo sube a la nube | manual: responsable del proyecto o testers con carpeta sincronizada |
| ARC-052 | 1 | Origen de solo lectura | Cargar desde una carpeta de solo lectura | Funciona; nada se escribe en el origen | pendiente |
| ARC-053 | 1 | Destino de solo lectura | Exportar a una carpeta de solo lectura | Mensaje claro y opción de elegir otra carpeta | pendiente |
| ARC-054 | 1 | Disco lleno | Exportar en un disco sin espacio | Se detiene; sin archivo final; temporales limpios; se explica qué hacer | pendiente |
| ARC-055 | 1 | Archivo borrado durante el proceso | Borrar el origen mientras se analiza | Mensaje claro; no se presenta como revisado | pendiente |
| ARC-056 | 1 | Archivo movido durante el proceso | Mover el origen mientras se analiza | Mensaje claro; no se presenta como revisado | pendiente |
| ARC-057 | 1 | Mismo archivo cargado dos veces | Cargarlo otra vez | Se avisa y no se duplica sin querer; también si se carga desde otra ruta | pendiente |
| ARC-058 | 2 | 500 archivos a la vez | Cargar el máximo del lote | Sin congelar la UI; progreso por archivo; se puede cancelar | pendiente |
| ARC-059 | 2 | 501 archivos a la vez | Cargar uno más que el máximo | Se explica el límite y tú decides; ninguno se descarta en silencio | pendiente |

## Contenido visual: caras (VIS)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-001 | 1 | Multitud de más de 100 caras | Analizar y ocultar todo | Sin congelar la UI; advertencias agrupadas; progreso visible | pendiente |
| VIS-002 | 1 | Caras de perfil | Medir en el dataset | Dentro del recall aprobado | pendiente |
| VIS-003 | 1 | Caras parciales | Medir en el dataset | Dentro del recall aprobado | pendiente |
| VIS-004 | 1 | Caras con lentes | Medir en el dataset | Dentro del recall aprobado | pendiente |
| VIS-005 | 1 | Caras con cubrebocas | Medir en el dataset | Dentro del recall aprobado | pendiente |
| VIS-006 | 1 | Caras con maquillaje | Medir en el dataset | Dentro del recall aprobado | pendiente |
| VIS-007 | 1 | Cara reflejada en un espejo | Analizar | Se propone; el usuario decide | pendiente |
| VIS-008 | 1 | Cara reflejada en una ventana | Analizar | Se propone si se detecta; la limitación queda documentada | pendiente |
| VIS-009 | 1 | Cara en un póster | Analizar | Se propone; el usuario la ignora con un clic | pendiente |
| VIS-010 | 1 | Cara en una pantalla | Analizar | Se propone junto con la advertencia de pantalla, si aplica | pendiente |
| VIS-011 | 1 | Foto dentro de la foto | Analizar | Se propone; el usuario decide | pendiente |

## Contenido visual: falsos positivos

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-012 | 1 | Estatua | Analizar | Si se marca, se puede ignorar; tasa medida y documentada | pendiente |
| VIS-013 | 1 | Muñeco | Analizar | Igual que VIS-012 | pendiente |
| VIS-014 | 1 | Mascota | Analizar | Igual que VIS-012 | pendiente |
| VIS-015 | 1 | Dibujo | Analizar | Igual que VIS-012 | pendiente |

## Contenido visual: condiciones de captura

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VIS-016 | 1 | Poca luz | Medir en el dataset | Recall medido; la advertencia de revisión orientativa sigue visible | pendiente |
| VIS-017 | 1 | Foto nocturna | Medir en el dataset | Igual que VIS-016 | pendiente |
| VIS-018 | 1 | Contraluz | Medir en el dataset | Igual que VIS-016 | pendiente |
| VIS-019 | 1 | Desenfoque de movimiento | Medir en el dataset | Igual que VIS-016 | pendiente |

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
| ENT-001 | 1 | Modo claro | Flujo completo y capturas | Contraste AA; regresión visual en verde | pendiente |
| ENT-002 | 1 | Modo oscuro | Flujo completo y capturas | Igual que ENT-001 | pendiente |
| ENT-003 | 1 | Cambio del tema con la app abierta | Cambiar el tema de Windows durante un análisis | Cambia sin reiniciar; el proceso sigue | pendiente |
| ENT-004 | 1 | Alto contraste de Windows | Activar un tema de contraste real y usar la app | Todo visible y usable. También hay prueba automatizada con `forcedColors` | manual: responsable del proyecto con guion |

## Entorno: forma de la ventana

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-005 | 1 | Tamaño mínimo | Reducir al mínimo | Nada se corta ni se encima | pendiente |
| ENT-006 | 1 | Maximizado | Maximizar | La UI aprovecha el espacio | pendiente |
| ENT-007 | 1 | Pantalla dividida | Usar Win+flechas | Nada se corta | pendiente |
| ENT-008 | 1 | Varios monitores con distinto DPI | Abrir la app en cada monitor | Se ve nítida; nada se corta | manual: testers con dos monitores |
| ENT-009 | 1 | Mover la ventana entre monitores | Arrastrar entre monitores con distinto DPI | Se reajusta; la máscara sigue alineada | manual: testers con dos monitores |
| ENT-010 | 1 | Escalado de 100% a 200% | Probar 100, 125, 150 y 200%, incluso con la app abierta | Regresión visual en 100 y 200%; máscara alineada | pendiente |
| ENT-011 | 1 | Rotación de pantalla en tablet | Girar una tablet con Windows | Se reacomoda sin perder trabajo | manual: testers con tablet Windows |

## Entorno: teclado

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-012 | 1 | Distribución Español México | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-013 | 1 | Distribución Español España | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-014 | 1 | Distribución Inglés US | Usar atajos y campos | Funcionan | manual: responsable del proyecto con guion |
| ENT-015 | 1 | Cambiar la distribución con la app abierta | Cambiar con Win+Espacio | Atajos y escritura siguen bien | manual: responsable del proyecto con guion |
| ENT-016 | 1 | Atajos en todas las distribuciones | Probar cada atajo, comparando por `code` y por carácter | Cada atajo funciona o tiene alternativa | pendiente |
| ENT-017 | 1 | Acentos y teclas muertas | Escribir á, ñ, ü en campos de texto | Se escriben bien; ningún atajo interfiere | manual: responsable del proyecto con guion |
| ENT-018 | 1 | Método de entrada asiático (IME) | Componer texto con IME de japonés o chino | La composición no dispara atajos ni se pierde | manual: responsable del proyecto con guion |
| ENT-019 | 1 | Uso completo sin mouse | Flujo de foto completo solo con teclado. En la Fase 3 también video | Todo es alcanzable, sin trampas de foco | pendiente |

## Entorno: idioma y región

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-020 | 1 | Sistema en inglés | Ejecutar con la configuración regional en inglés | La app sigue en español, sin textos mezclados | pendiente |
| ENT-021 | 1 | Región con coma decimal | Ejecutar con región que usa coma | Los decimales se leen bien; ningún archivo interno usa la región | pendiente |
| ENT-022 | 1 | Formatos de fecha distintos | Ejecutar con otro formato de fecha | Fechas sin ambigüedad en UI y reportes | pendiente |

## Entorno: red

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-023 | 1 | Sin internet | Usar la app con los modelos ya instalados | Todo funciona, incluida la Guía de privacidad | pendiente |
| ENT-024 | 8 | Internet se cae durante la descarga de modelos | Cortar la red a la mitad | Reanuda o reinicia; verifica el hash; nunca usa un modelo incompleto | pendiente |
| ENT-025 | 8 | Proxy corporativo | Descargar modelos detrás de un proxy | Funciona o explica cómo instalarlos; el análisis no usa la red | manual: responsable del proyecto con proxy local o testers |

## Entorno: hardware y energía

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-026 | 1 | Sin GPU | Flujo completo en CPU, que es el modo del MVP | Funciona; es el modo por defecto en local y CI | pendiente |
| ENT-027 | 8 | GPU con poca memoria | Usar en un equipo con GPU débil | Funciona en CPU, sin intentar usar esa GPU | manual: testers con ese equipo |
| ENT-028 | 8 | Laptop con GPU híbrida | Usar en un equipo con dos GPU | Funciona en CPU; el video de la UI se ve bien | manual: testers con ese equipo |
| ENT-029 | 3 | Batería baja | Procesar con batería baja | Avisa antes de un proceso largo; no pierde trabajo | manual: responsable del proyecto en su laptop |
| ENT-030 | 3 | Modo ahorro de energía | Procesar con ahorro activado | Más lento, sin error; estimación actualizada | manual: responsable del proyecto en su laptop |
| ENT-031 | 3 | Suspensión a mitad de un proceso | Suspender y reanudar durante un tracking | Reanuda o reinicia el bloque; nunca presenta como terminado | manual: responsable del proyecto en su laptop |
| ENT-032 | 1 | Cierre forzado | Terminar el proceso durante un análisis y una exportación | Al abrir, ofrece recuperar; temporales limpios; sin archivo final parcial | pendiente |

## Entorno: permisos e instancias

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ENT-033 | n/a | Acceso a carpetas denegado en macOS | Denegar el permiso en macOS | Mensaje claro | fuera de alcance: solo Windows |
| ENT-034 | 8 | Antivirus bloquea el sidecar | Bloquear el sidecar con Windows Security o simular que no arranca | Explica qué pasó y qué hacer; no presenta nada como revisado | manual: responsable del proyecto con guion |
| ENT-035 | 8 | Usuario sin permisos de administrador | Instalar y usar con cuenta estándar | Se instala por usuario y funciona | manual: responsable del proyecto con cuenta estándar |
| ENT-036 | 1 | Dos instancias abiertas | Abrir la app dos veces | Se enfoca la existente; proyectos y temporales no se pisan | pendiente |
| ENT-037 | 1 | Dos ventanas abiertas | Intentar una segunda ventana del mismo proyecto | Se enfoca la existente; sin conflicto de guardado | pendiente |

## Accesibilidad (ACC)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ACC-001 | 1 | NVDA | Flujo de foto completo con guion. En Fase 3, también video | Todo se entiende y se puede usar | manual: responsable del proyecto o testers con NVDA |
| ACC-002 | 1 | Narrador | Flujo de foto completo con guion | Igual que ACC-001 | manual: responsable del proyecto o testers con Narrador |
| ACC-003 | n/a | VoiceOver | Flujo completo en macOS | Igual que ACC-001 | fuera de alcance: solo Windows |
| ACC-004 | 1 | Todos los controles con etiqueta | axe-core en cada pantalla | Sin controles sin nombre | pendiente |
| ACC-005 | 1 | Advertencias anunciadas automáticamente | Revisar regiones vivas por test y escuchar con NVDA | Se anuncian al aparecer, sin saturar | manual: responsable del proyecto o testers con NVDA |
| ACC-006 | 1 | Descripción en texto de cada advertencia | Analizar imagen con matrícula de prueba | Texto tipo "Se detectó 1 matrícula en la parte inferior izquierda" | pendiente |
| ACC-007 | 1 | Ocultar todo y exportar sin ver la imagen | Flujo con pantalla apagada y lector de pantalla | Se completa con éxito y se confirma el resultado | manual: testers usuarios de lector de pantalla |
| ACC-008 | 1 | Resumen por archivo | Revisar el resumen de cada archivo | Hay texto que el lector lee completo | pendiente |
| ACC-009 | 1 | Protanopia | Emular por CDP y comparar capturas | El riesgo se distingue con ícono y texto | pendiente |
| ACC-010 | 1 | Deuteranopia | Igual que ACC-009 | Igual que ACC-009 | pendiente |
| ACC-011 | 1 | Tritanopia | Igual que ACC-009 | Igual que ACC-009 | pendiente |
| ACC-012 | 1 | Nada depende solo del color | Revisar capturas en escala de grises | Todos los estados se distinguen | pendiente |
| ACC-013 | 1 | Zoom al 200% | Aumentar el zoom de la app al 200% | Sin pérdida de contenido ni scroll en dos ejes fuera de la imagen | pendiente |
| ACC-014 | 1 | Texto grande del sistema | Activar texto grande en Windows | El texto crece sin cortarse | manual: responsable del proyecto con guion |
| ACC-015 | 1 | Reducir movimiento | Emular `reducedMotion` | Sin animaciones no esenciales | pendiente |
| ACC-016 | 1 | Foco siempre visible | Tabular por cada pantalla | El foco se ve en claro, oscuro y contraste alto | pendiente |
| ACC-017 | 1 | Objetivos de clic suficientes | Medir con test los controles interactivos | Cumplen WCAG 2.2 criterio 2.5.8 como mínimo | pendiente |
| ACC-018 | 1 | Verificación automática WCAG 2.2 AA | axe-core en cada pantalla y estado | Sin violaciones | pendiente |
| ACC-019 | 8 | Revisión manual con lector de pantalla | Recorrer la app completa con NVDA antes de entregar | Hallazgos corregidos o documentados | manual: responsable del proyecto o testers con NVDA |

## Interacción (INT)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| INT-001 | 1 | Doble clic rápido | Doble clic en cada acción principal | Se ejecuta una sola vez | pendiente |
| INT-002 | 1 | Clic repetido en "Exportar" | Clic varias veces seguidas | Una sola exportación | pendiente |
| INT-003 | 1 | Cancelar a la mitad y volver a empezar | Cancelar análisis y exportación, y reintentar | Limpia, sin estado colgado ni archivo parcial | pendiente |
| INT-004 | 1 | Deshacer y rehacer | Secuencias de edición | El estado coincide en cada paso, también en la vista y la exportación | pendiente |
| INT-005 | 1 | Deshacer sin historial | Deshacer en un proyecto nuevo | Botón desactivado; el atajo no hace nada | pendiente |
| INT-006 | 1 | Rehacer sin historial | Rehacer sin nada que rehacer | Igual que INT-005 | pendiente |
| INT-007 | 1 | Superar el límite del historial | Hacer más ediciones que `historial.pasos` | Se descarta lo más antiguo, sin error | pendiente |
| INT-008 | 1 | Arrastrar un archivo no soportado | Arrastrar `.pdf` o `.zip` | Mensaje claro; sigue lo demás | pendiente |
| INT-009 | 1 | Arrastrar una carpeta | Arrastrar una carpeta | Carga lo soportado con resumen, o explica | pendiente |
| INT-010 | 1 | Arrastrar archivos mientras otro se procesa | Arrastrar durante un análisis | Se encolan; el análisis actual sigue | pendiente |
| INT-011 | 1 | Cerrar con cambios sin guardar | Cerrar la ventana | Pregunta antes de cerrar; también con Alt+F4 | pendiente |
| INT-012 | 2 | Clic fuera de la imagen | Clic de selección fuera | Sin máscara; aviso claro | pendiente |
| INT-013 | 2 | Clic en el borde exacto | Clic en la primera y última fila y columna | Máscara válida, sin error de índice | pendiente |
| INT-014 | 1 | Zoom extremo | Zoom al mínimo y al máximo, editando | Máscara alineada; UI estable | pendiente |
| INT-015 | 1 | Sliders en sus extremos | Llevar cada slider a mín y máx | Aplica sin error; efecto correcto | pendiente |
| INT-016 | 1 | Escribir "-5" en campo numérico | Probar cada campo | Según [RANGOS.md](RANGOS.md); mensaje claro | pendiente |
| INT-017 | 1 | Escribir "abc" | Igual que INT-016 | Rechazo; se conserva el valor válido | pendiente |
| INT-018 | 1 | Escribir "999999" | Igual que INT-016 | Rechazo si rebasa; sin recorte silencioso | pendiente |
| INT-019 | 1 | Dejar vacío | Igual que INT-016 | Rechazo; se conserva el valor válido | pendiente |
| INT-020 | 1 | Escribir "1e10" | Igual que INT-016 | Rechazo | pendiente |
| INT-021 | 1 | Escribir "0,5" | Igual que INT-016 | 0.5 en campos decimales; rechazo en enteros | pendiente |
| INT-022 | 1 | Pegar texto largo | Pegar miles de caracteres | Rechazo sin congelar | pendiente |

## Seguridad y privacidad (SEG)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| SEG-001 | 1 | Sin tráfico durante el análisis | Capturar tráfico y auditar sockets durante el análisis | Cero conexiones de la app y del sidecar | pendiente |
| SEG-002 | 1 | Temporales borrados al terminar | Comparar la carpeta temporal antes y después | Sin restos | pendiente |
| SEG-003 | 1 | Temporales borrados tras cierre forzado | Matar el proceso y abrir de nuevo | Se limpian al abrir; lo anterior es ilegible sin la llave | pendiente |
| SEG-004 | 3 | Sin frames sin difuminar en temporales | Revisar el disco durante y después de un proceso de video | Solo caché cifrada; ningún frame legible | pendiente |
| SEG-005 | 1 | Exportado sin EXIF | Revisar con `exiftool -a -G1 -ee` | Nada fuera de la lista blanca | pendiente |
| SEG-006 | 1 | Exportado sin GPS, XMP ni IPTC | Revisar una imagen que sí los tenía | Nada | pendiente |
| SEG-007 | 1 | Sin miniatura EXIF | Revisar imagen con miniatura sin ocultar | Sin miniatura ni imagen embebida | pendiente |
| SEG-008 | 3 | Sin GPS en contenedores MP4 y MOV | Revisar con `ffprobe` y `exiftool` un video con GPS | Nada, incluidos `udta` y streams de datos | pendiente |
| SEG-009 | 1 | Sin nombre del dispositivo | Revisar foto y video con marca y modelo | Nada | pendiente |
| SEG-010 | 1 | Irreversibilidad | Intentar recuperar: correlación con el original y reconstrucción sencilla en sólido, difuminado y pixelado | Dos entradas distintas en la zona dan la misma salida; no se recupera nada | pendiente |
| SEG-011 | 6 | El reporte no tiene datos sensibles | Generar el reporte y buscar texto OCR, rutas y recortes | Nada | pendiente |
| SEG-012 | 6 | "Reportar un problema" sin datos sensibles | Generar el archivo y revisarlo | Sin imágenes; logs anonimizados; solo sale si lo mandas tú | pendiente |
| SEG-013 | 4 | Embeddings fuera del disco | Cerrar proyecto sin elegir guardar y buscar restos | Nada en disco | pendiente |
| SEG-014 | 1 | Sin estimación de edad | Revisar la salida, reportes y logs | Ningún dato de edad | pendiente |

## Regla 1: validación de entradas (VAL)

Cada caso se aplica a cada función, comando del IPC y control, en la UI y de nuevo en el sidecar. Se genera por parámetro desde [RANGOS.md](RANGOS.md).

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| VAL-001 | 1 | null | Enviar a cada parámetro | Rechazo tipado | pendiente |
| VAL-002 | 1 | undefined o campo faltante | Igual | Rechazo tipado | pendiente |
| VAL-003 | 1 | None | Igual, en Python | Rechazo tipado | pendiente |
| VAL-004 | 1 | Cadena vacía | Igual | Rechazo tipado | pendiente |
| VAL-005 | 1 | Lista vacía | Igual | Rechazo tipado, salvo que el esquema la permita | pendiente |
| VAL-006 | 1 | Objeto vacío | Igual | Rechazo tipado | pendiente |
| VAL-007 | 1 | Texto donde va número | Igual | Rechazo tipado | pendiente |
| VAL-008 | 1 | Decimal donde va entero | Igual | Rechazo tipado | pendiente |
| VAL-009 | 1 | NaN | Igual | Rechazo tipado | pendiente |
| VAL-010 | 1 | Infinity | Igual | Rechazo tipado | pendiente |
| VAL-011 | 1 | -Infinity | Igual | Rechazo tipado | pendiente |
| VAL-012 | 1 | Notación científica "1e10" | Igual | Rechazo tipado | pendiente |
| VAL-013 | 1 | Coma decimal "0,5" | Igual | La UI normaliza en campos decimales; el sidecar rechaza texto | pendiente |
| VAL-014 | 1 | Espacios | Igual | La UI recorta extremos; el sidecar rechaza texto | pendiente |
| VAL-015 | 1 | Emojis | Igual | Rechazo tipado en números; se aceptan solo en textos libres | pendiente |
| VAL-016 | 1 | Negativos | Igual | Rechazo, salvo que el rango los permita | pendiente |
| VAL-017 | 1 | Cero | Igual | Según el rango | pendiente |
| VAL-018 | 1 | Mínimo-1 | Igual | Rechazo tipado | pendiente |
| VAL-019 | 1 | Mínimo | Igual | Aceptado | pendiente |
| VAL-020 | 1 | Mínimo+1 | Igual | Aceptado | pendiente |
| VAL-021 | 1 | Máximo-1 | Igual | Aceptado | pendiente |
| VAL-022 | 1 | Máximo | Igual | Aceptado | pendiente |
| VAL-023 | 1 | Máximo+1 | Igual | Rechazo tipado | pendiente |
| VAL-024 | 1 | Valores gigantes | Igual, incluidos 2^53 y 1e308 | Rechazo tipado, sin desbordamiento | pendiente |
| VAL-025 | 3 | Inicio mayor que fin | Enviar rango invertido | Rechazo tipado | pendiente |
| VAL-026 | 3 | Inicio igual a fin | Enviar rango de duración cero | Rechazo tipado | pendiente |
| VAL-027 | 3 | Rango fuera de la duración | Enviar fin mayor que la duración | Rechazo tipado | pendiente |
| VAL-028 | 1 | Coordenadas fuera de la imagen | Enviar x o y fuera | Rechazo tipado | pendiente |
| VAL-029 | 1 | Máscara vacía | Enviar máscara sin píxeles | Rechazo tipado con mensaje | pendiente |
| VAL-030 | 1 | Máscara al 100% de la imagen | Enviar máscara completa | Se pide confirmar; luego se aplica | pendiente |
| VAL-031 | 1 | Esquemas tipados en las fronteras | Revisar que cada comando tenga Zod y Pydantic, por test de contrato | Sin comandos sin esquema; ambos coinciden | pendiente |
| VAL-032 | 1 | El sidecar no confía en la UI | Mandar comandos inválidos directo al sidecar | Rechazo tipado, sin depender de la UI | pendiente |

## Regla 2: condicionales completos (COD)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| COD-001 | 1 | Exhaustividad en TypeScript | `strict`, `noImplicitReturns` y `switch-exhaustiveness-check` en CI | Build falla si falta un caso | pendiente |
| COD-002 | 1 | Exhaustividad en Python | pyright estricto; `assert_never` en cada `match` | Build falla si falta un caso | pendiente |
| COD-003 | 1 | Caso por defecto que lanza error | Forzar un valor de enum inesperado | Error claro, nunca una continuación silenciosa | pendiente |
| COD-004 | 1 | Sin `catch` vacío | Regla de ESLint en CI | Build falla si aparece | pendiente |
| COD-005 | 1 | Sin `except: pass` | Reglas de Ruff en CI | Build falla si aparece | pendiente |
| COD-006 | 1 | Todo error se registra y se traduce | Forzar errores en cada frontera | Log técnico y mensaje de usuario | pendiente |
| COD-007 | 1 | Casos que "no deberían pasar" | Revisar en code review y con pruebas de mutación | Error explícito | pendiente |

## Regla 3: rangos documentados (RAN)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| RAN-001 | 1 | Cada parámetro está en `RANGOS.md` | Test que compara los esquemas con el documento | Sin diferencias | pendiente |
| RAN-002 | 1 | Cada parámetro tiene pruebas de límite | Test que genera los casos por parámetro | Todos cubiertos | pendiente |

## Regla 4: fallo seguro (FCL)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| FCL-001 | 1 | La detección falla | Simular fallo del modelo | Se dice claramente; no se presenta como revisado | pendiente |
| FCL-002 | 1 | La detección falla parcialmente | Fallar un detector y dejar otros | Dice qué parte no se analizó; no se presenta como revisado | pendiente |
| FCL-003 | 1 | La detección se cancela | Cancelar a la mitad | Dice qué faltó; no se presenta como revisado | pendiente |
| FCL-004 | 3 | Segmento de video sin analizar | Fallar un bloque | "No pudimos analizar los segundos 0:42–0:58" con los segundos reales | pendiente |
| FCL-005 | 1 | Exportación falla a la mitad | Simular fallo durante la escritura | Sin archivo de salida con apariencia terminada | pendiente |
| FCL-006 | 1 | Falla la verificación final | Dejar un metadato fuera de la lista blanca | Se bloquea la exportación y se explica | pendiente |
| FCL-007 | 3 | El tracking pierde un objeto | Simular pérdida | Se marca para revisión; se sigue ocultando el área | pendiente |
| FCL-008 | 3 | Exportación de video interrumpida | Matar FFmpeg a la mitad | Sin archivo final; error claro | pendiente |
| FCL-009 | 1 | No se puede aplicar un efecto | Simular fallo en el efecto | No se exporta sin ese efecto | pendiente |
| FCL-010 | 1 | Advertencias sin atender al exportar | Exportar con advertencias sin decidir | Se avisa y el usuario decide; no se bloquea la publicación | pendiente |

## Regla 5: errores y logs (ERR)

| ID | Fase | Caso | Pasos | Resultado esperado | Estado |
|---|---|---|---|---|---|
| ERR-001 | 1 | Errores tipados | Comprobar cada error por test | Código interno, mensaje de usuario y log técnico | pendiente |
| ERR-002 | 1 | Sin códigos ni stack traces en pantalla | Forzar errores en E2E y revisar el texto | Solo mensajes en tono de marca: qué pasó, por qué, qué hacer | pendiente |
| ERR-003 | 1 | Logs sin imágenes | Revisar logs tras un flujo completo | Nada binario ni base64 | pendiente |
| ERR-004 | 2 | Logs sin texto de OCR | Procesar texto centinela y buscarlo | No aparece | pendiente |
| ERR-005 | 1 | Logs sin rutas con datos personales | Usar una ruta centinela y buscarla | Anonimizada | pendiente |
| ERR-006 | 1 | Recuperación tras cierre de golpe | Matar la app con ediciones y abrirla | Ofrece recuperar, y solo con ediciones, sin píxeles | pendiente |
| ERR-007 | 1 | Error del sidecar | Terminar el sidecar | Mensaje claro; reinicio o guía; sin presentar nada como revisado | pendiente |

## Comprobación de cobertura del brief

Secciones de casos extremos recorridas una por una: Archivos, Contenido visual, Entorno y sistema, Accesibilidad, Interacción, Seguridad y privacidad. Reglas obligatorias: 1 a 5.

Casos agregados que no aparecen en el brief: ARC-059, INT-007, SEG-012, SEG-013, SEG-014, FCL-006, FCL-008, FCL-009, FCL-010 y ERR-007.
