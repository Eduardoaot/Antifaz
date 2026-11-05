# Antifaz

App de escritorio que revisa fotos y videos antes de publicarlos, explica el riesgo con fuentes y oculta lo privado. **Todo el análisis es local: ninguna foto ni video sale del dispositivo.**

Estado: Fase 1 implementada, con pendientes en `qa/REPORTE_FASE_1.md`. Solo revisa caras y ubicación en metadatos. Cada fase espera la aprobación del responsable.

## Decisiones vigentes

- **Plataforma:** solo Windows, solo CPU. Sin macOS, MPS, VoiceOver ni CUDA por ahora: no hay con qué probarlos.
- **Licencia:** proyecto personal, sin venta. Repo público con AGPL-3.0. Se permiten modelos no comerciales, aislados tras interfaces por si cambia el plan.
- **Sin Fase 7:** sin API de Instagram, QR por Wi-Fi ni "Copiar descripción". La app exporta a una carpeta.
- **Menores:** no se estima edad. Con cualquier cara se pregunta "¿Hay menores en esta foto?".
- **Nombre:** cambiable. Lee `brand/brand.json`; no lo escribas a mano en código ni en el catálogo.

## Arquitectura

`app/main` (único con acceso al sistema), `app/preload` (sin dependencias: corre con sandbox), `app/shared` (Zod y lógica pura), `app/renderer` (React sin rutas ni Node), `sidecar/revisor` (Python).

Electron + React/TypeScript (strict) + sidecar Python 3.12 con uv.

- **IPC:** stdio con mensajes delimitados por longitud, sin abrir puertos. Zod en la UI y Pydantic en el sidecar, que siempre valida de nuevo.
- **Rutas:** el proceso main entrega IDs opacos; el renderer nunca ve rutas reales.
- **Modelos:** ver la tabla en `docs/INVESTIGACION.md`. Los pesos se descargan aparte, con hash, y nunca durante un análisis. No se versionan.
- **Cero tráfico:** CSP, bloqueo en la sesión de Electron, auditoría de sockets en Python y test con captura.
- **Datos sensibles:** caché cifrada con llave solo en memoria. Embeddings solo en RAM salvo que el usuario guarde. La recuperación guarda ediciones, sin píxeles.
- **Exportación fail-closed:** verificación contra lista blanca antes de escribir, archivo temporal y renombrado atómico. Las imágenes se recodifican desde píxeles y sus bytes se revisan con `metadatos.py`. En video se usarán ffprobe y exiftool.
- **Huella:** cada archivo tiene un SHA-256. Las decisiones solo valen para esos mismos bytes: si cambia, no se aplican ni se exporta.
- **Ocultamiento:** texto, códigos, documentos y matrículas con relleno sólido por defecto. Difuminado y pixelado usan los colores de la imagen por decisión del responsable (2026-11-06), así que **no son irreversibles** y la app lo avisa. Solo el bloque sólido lo es. No se debe decir que un difuminado es irrecuperable.
- **Contenido:** CLIP avisa sobre la imagen completa (armas, extremismo, desnudez, sugerente), y NudeNet da zonas de desnudez y de contenido sugerente. Siempre se dice "podría", nunca se afirma. La desnudez se marca sola para ocultar con bloque sólido, y la persona decide. Las muestras sensibles nunca se versionan.
- **Texto y códigos:** RapidOCR y zxing-cpp en local. El contenido leído nunca se muestra, ni se guarda, ni va a los logs: solo se usa para clasificar.
- **Selección manual:** SlimSAM por clic y rectángulo, con alternativa por coordenadas para usar sin mouse. Las siluetas viven en memoria: si se pierden, se oculta toda la caja.
- **Caras:** dos niveles. Con confianza de 0.6 o más es "cara" y pregunta por menores. Por debajo es "podría ser una cara", sin esa pregunta.

## Reglas de validación

Detalle en `qa/PLAN_QA.md`, `qa/RANGOS.md` y `qa/MATRIZ_PRUEBAS.md`.

1. Toda entrada se valida: ausencia, tipo incorrecto, rangos y relaciones entre valores. El backend nunca confía en la UI.
2. Sin condicionales incompletos: `switch`/`match` exhaustivos. Prohibido `catch` vacío y `except: pass`.
3. Todo parámetro configurable está en `qa/RANGOS.md`. Si agregas uno, agrega su fila y sus pruebas de límites.
4. **Fail-closed:** un error nunca produce un archivo aparentemente limpio ni algo presentado como revisado sin estarlo. Si se pierde un objeto, se marca para revisión y se sigue ocultando.
5. Errores tipados con código interno, mensaje en tono de marca y log técnico local. Los logs nunca llevan imágenes, texto de OCR ni rutas sin anonimizar.

## Catálogo de riesgos

`rules/catalogo.json`, validado con `rules/catalogo.schema.json`.

**Regla de oro:** no se inventan citas. Si no hay fuente abierta y leída, la regla queda `pendiente_de_verificar` con una `nota`. Distingue ley, recomendación oficial, política de plataforma y prensa. El extinto INAI siempre va con `vigente: false`.

## Marca

`brand/BRAND.md` y `brand/tokens.json`. Colores de riesgo solo para advertencias, siempre con ícono y texto. Tono: español de México, de "tú", tranquilo. Nunca "seguro para publicar" ni "es ilegal".

## Comandos

```
# App
npm install
cd sidecar && uv sync --python 3.12 && cd ..
.venv\Scripts\python tools\descargar_modelos.py
npm run iniciar

# Pruebas
npm run tipos; npm run lint; npm run cobertura; npm run e2e
cd sidecar; .venv\Scripts\ruff check revisor; .venv\Scripts\pyright; .venv\Scripts\python -m pytest
```

Si tocas `brand/tokens.json`, corre `tools/generar_tokens_css.py`. Dentro de la terminal de Claude Code, `ELECTRON_RUN_AS_NODE` hace que Electron corra como Node: las E2E ya lo limpian.

Herramientas, con Python 3.14 desde la raíz:

```
python -m venv .venv
.venv\Scripts\pip install -r tools\requirements.txt
.venv\Scripts\python tools\validar_catalogo.py          # agrega --urls para abrir cada enlace
.venv\Scripts\python -m unittest tools\test_validar_catalogo.py
.venv\Scripts\python tools\revisar_contraste.py
.venv\Scripts\python tools\revisar_nombre.py
```

## Convenciones

- Identificadores de dominio y documentos en español; TypeScript `strict` + `noImplicitReturns`; pyright estricto.
- Git: no subas al remoto sin que el responsable lo pida. El repo es público.
- Terminado significa: tests en verde en Windows local y CI, matriz de la fase ejecutada, cero errores de linter y tipado, y app ejecutada con capturas revisadas en claro y oscuro. Lo manual pendiente se marca pendiente, nunca aprobado.
- No uses user-agents falsos ni intentes saltar bloqueos de sitios. Si un sitio no se deja leer, la fuente queda pendiente y se revisa a mano.
