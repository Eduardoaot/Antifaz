# Investigación de la Fase 0

Consultada el 3 de noviembre de 2026. **⚠** indica lo que no quedó confirmado en una fuente primaria. Esto no es asesoría legal.

## Decisiones de modelos

Licencias revisadas en código y pesos. Como el proyecto es personal, se admiten opciones no comerciales y AGPL, aisladas tras interfaces.

| Función | Elección | Licencia | Evidencia |
|---|---|---|---|
| Clic en foto | MobileSAM (ONNX) | Apache-2.0 | ~3 s en Mac i5; [repo](https://github.com/ChaoningZhang/MobileSAM) |
| Tracking | EdgeTAM o SAM 2.1 tiny | Apache-2.0 | SAM 2.1 tiny: [1956 ms/frame](https://huggingface.co/Pablopigue/sam2-lite) en i7-13620H. EdgeTAM sin cifras en CPU de escritorio ⚠ |
| Detectar caras | [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT | AP 0.88/0.87/0.75 |
| Agrupar personas | [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface); InsightFace si no alcanza | Apache-2.0 / [no comercial](https://github.com/deepinsight/insightface) | Falta revisar si "non-commercial research" cubre a los testers |
| Objetos comunes | YOLO nano | [AGPL-3.0](https://www.ultralytics.com/license) | Velocidad por medir en este CPU |
| Vocabulario abierto | [OWLv2](https://huggingface.co/google/owlv2-base-patch16-ensemble) | Apache-2.0 | [1.5–3.8 s en i9/i7](https://github.com/opencv/opencv/wiki/OpenCV-5-DNN-Benchmarks/6fa56ddf498791a95451451d0daa5e2a233b0313); solo fotos y keyframes |
| OCR | [RapidOCR](https://github.com/RapidAI/RapidOCR) con PP-OCRv5 Latin | Apache-2.0 | Probar ñ y acentos |
| Códigos | [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) | Apache-2.0 | PDF417, Aztec, QR |
| Cortes | [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | BSD-3 | AdaptiveDetector |
| Runtime | [ONNX Runtime](https://pypi.org/project/onnxruntime/); PyTorch solo si el tracking lo exige | MIT / BSD | ORT 15 MB, torch 127 MB en Windows |

**Descartados:**
- [SAM 3](https://github.com/facebookresearch/sam3): 3.44 GB, 6–20 s por encoder en CPU y exige CUDA.
- sam2-lite: CC BY-NC y su mejora real es pequeña.
- [Surya](https://github.com/datalab-to/surya): licencia de pesos restrictiva sin aportar lo suficiente.
- MiVOLO y cualquier estimación de edad: [error de 3.65–5.58 años](https://github.com/WildChlamydia/MiVOLO), con [sesgos documentados por NIST](https://nvlpubs.nist.gov/nistpubs/ir/2024/NIST.IR.8525.pdf).

**Video en este equipo.** i5-10210U sin GPU. Con SAM 2.1 tiny, un minuto a 30 fps tardaría una hora o más. La Fase 3 empieza con un benchmark que decide proxy, fps de tracking y duración máxima.

## Irreversibilidad

El blur y el pixelado no bastan:
- [McPherson et al.](https://ar5iv.arxiv.org/html/1609.00408): con mosaico de 16×16 en caras de 224 px reidentificaron al 57.56% de 530 personas (azar: 0.19%).
- [Hill et al.](https://petsymposium.org/popets/2016/popets-2016-0047.php): recuperaron texto y concluyen que mosaico y desenfoque no son viables para redactar.
- [Depix](https://codeberg.org/spipm/Depixelization_poc): recupera texto pixelado bajo ciertas condiciones.

Valores por defecto (propuesta propia, no derivada de estudios): relleno sólido en texto, códigos, documentos y matrículas; dilatar max(8 px, 10% del lado corto); caras ×1.3; sobrescribir antes de aplicar el efecto; σ = max(25 px, 25% del lado corto); ampliar 5 frames antes y después de cada pista.

## Metadatos

- **Imágenes:** nunca copiar el contenedor. Exportar píxeles decodificados, con la orientación ya aplicada.
- **Video:** selección explícita de streams:
  ```
  ffmpeg -i in.mov -map 0:v:0 -map 0:a:0? -map_metadata -1 -map_chapters -1 -dn -sn \
    -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
    -write_tmcd 0 -movflags +empty_hdlr_name+faststart <encoder> out.mp4
  ```
- **Verificación:** ffprobe y exiftool contra una lista blanca; si sobra algo, se bloquea. Los casos `mebx` y Live Photo no se verificaron en fuente ⚠: se probarán con archivos reales.
- **Licencia de FFmpeg:** build GPL con libx264, compatible con un repo AGPL. Si el proyecto pasa a ser comercial, debe cambiarse: [LGPL sin libx264](https://www.ffmpeg.org/legal.html) y revisión de patentes.

## Stack

**Electron** porque no requiere Rust, tiene el mejor soporte de Playwright y axe funciona directo. El soporte de Electron en Playwright sigue siendo [experimental](https://playwright.dev/docs/api/class-electron). Los widgets propios de Qt requieren [implementar `QAccessible` a mano](https://doc.qt.io/qt-6/accessible-qwidget.html).

**IPC por stdio:** [`utilityProcess` exige stdin `ignore`](https://www.electronjs.org/docs/latest/api/utility-process), así que se usa `child_process.spawn` desde main.

**Cero red:** [CSP](https://www.electronjs.org/docs/latest/tutorial/security), [`onBeforeRequest`](https://www.electronjs.org/docs/latest/api/web-request) y auditoría de sockets. Las librerías nativas podrían evadir el hook de Python ⚠, y la única barrera real es una [regla de firewall](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules), que requiere administrador. Por eso se comprueba con captura de tráfico y no se promete como garantía absoluta.

**CI:** en repos públicos los [runners estándar son gratis](https://docs.github.com/en/billing/concepts/product-billing/github-actions). `windows-latest` tiene [2 CPU y 8 GB](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), sin GPU, y corre como administrador con UAC desactivado: no sirve para probar casos sin privilegios.

## Instagram

- **API:** [solo cuentas profesionales](https://developers.facebook.com/docs/instagram-platform/overview). Las imágenes [exigen URL pública](https://developers.facebook.com/docs/instagram-platform/content-publishing/). La integración está omitida.
- **Formatos oficiales de la API** ([referencia](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)): feed en JPEG sRGB, 4:5 a 1.91:1, ancho 320–1440 px. Reels en MOV/MP4 H.264 o HEVC, 23–60 fps, 4:2:0, AAC hasta 48 kHz.
- **App:** el [Centro de Ayuda](https://help.instagram.com/1631821640426723/) habla de 1.91:1 a 3:4 (leído solo como extracto ⚠) y [otra página](https://help.instagram.com/125114757641244) sigue diciendo 4:5.

**Decisión:** presets configurables, con 1080×1350 (4:5) por defecto en foto.

## Fuentes legales y oficiales

Las fuentes de cada regla están en `rules/catalogo.json`.

### Marco

- [LFPDPPP vigente](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) (DOF 20-03-2025, última reforma 14-11-2025). Art. 2, fr. V y VI: definiciones. Art. 1, fr. II: exceptúa recolección y almacenamiento de uso exclusivamente personal, "sin fines de divulgación". Mi lectura es que publicar en abierto probablemente queda fuera de esa excepción. No hallé criterio oficial.
- **Autoridad:** Secretaría Anticorrupción y Buen Gobierno (art. 2, fr. XV). El INAI se extinguió ([transitorio Quinto](https://dof.gob.mx/nota_detalle.php?codigo=5745905&fecha=20/12/2024)).
- **Guías de la Secretaría:** no encontré ninguna sobre datos personales o redes. Es ausencia en búsquedas, no prueba.

### Corrección sobre la guía del INAI

- **[Edición 2018](https://inicio.inai.org.mx/Guias/Guia_Configuracion_RS.PDF):** solo explica ajustes.
- **[Edición mayo 2023](https://home.inai.org.mx/wp-content/uploads/Guia_Configuracion_RS.pdf):** 61 páginas. La p. 7 dice "no compartas tu dirección o número de teléfono". La p. 32, sobre Instagram, dice "Evita publicar fotos de tu casa, números de teléfono, direcciones de correo electrónico".
- **La lista del brief** (boletos, pasaporte, actas, compras caras, menores, quejas) **no está en ninguna de las dos.** Una búsqueda de esas palabras en el texto extraído de 2023 no halló coincidencias relevantes. Su única fuente abierta es prensa ([N+, 2024](https://www.nmas.com.mx/seguridad/cosas-que-no-debes-publicar-en-redes-sociales-por-seguridad-recomendaciones-inai/)), que además incluye información de familiares y amigos.
- **Título:** el texto extraído dice "Guía para la configuración de privacidad en redes sociales". La portada es una imagen, así que no confirmé el agregado "y Aplicaciones de Contenido".

### Sin confirmar

- **SSPC:** los comunicados [Día de la Internet Segura](https://gabinetedeseguridad.gob.mx/contenido/4533/sspc-presenta-decalogo-de-recomendaciones-en-el-dia-de-la-internet-segura) y [Día de las Redes Sociales](https://gabinetedeseguridad.gob.mx/contenido/5985/la-sspc-emite-recomendaciones-de-seguridad-en-el-dia-mundial-de-las-redes-sociales) están detrás de un bloqueo antirrobots. Según el buscador cubren documentos, ubicación, escuela y rutinas. **Una persona debe abrirlos en un navegador:** podrían sustentar varias reglas.
- **Guardia Nacional:** no hallé una recomendación sobre publicar fotos o viajes.
- **Policía Cibernética de Nuevo León:** solo hallé una [página archivada](https://historico.nl.gob.mx/campanas/conoce-que-tipo-de-delitos-investiga-la-policia-cibernetica-y-denuncia), sin recomendaciones.
- **AEPD E-07336/2014** sobre matrículas: respondió error 500.
- **Reglamento de 2011 de la LFPDPPP:** sigue marcado vigente y habla del "Instituto"; falta cotejarlo en el DOF.

### Revisión independiente de citas

Un revisor cotejó las 15 fuentes del catálogo y encontró correcciones en 7, además de varios `por_que` que afirmaban más que sus fuentes. Resumen en `qa/REPORTE_FASE_0.md`. Limitación: las páginas web se leyeron con un resumidor automático, no como HTML original, así que conviene cotejar las citas textuales antes de mostrarlas como tales en la app.

### Riesgos legales del producto (interpretación, valídala con un abogado)

- **Aviso de privacidad:** hay un argumento para no ser "responsable" si la app no recibe datos, pero no hallé criterio oficial. Conviene publicar un aviso voluntario y exacto.
- **Biometría:** la [guía del INAI de 2018](https://procesos.finanzas.cdmx.gob.mx/OIP/assets/doc/Documento_Consulta/12.%20Guia%20Datos%20Biometricos_Web_Links.pdf) incluye el rostro como biométrico. Detectar para difuminar es más defendible que reconocer. Por eso los embeddings se borran al cerrar.
- **Redacción:** no decir "es ilegal" ni "seguro para publicar". No usar el art. 77 de la LGDNNA contra particulares. Distinguir ley, recomendación y política de Meta.
