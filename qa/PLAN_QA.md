# Plan de QA de Antifaz

**Estado:** propuesta de la Fase 0. Todavía no existe código, así que ninguna prueba se ha ejecutado.

**Documentos relacionados:**
- [RANGOS.md](RANGOS.md): parámetros, límites y reglas de normalización.
- [MATRIZ_PRUEBAS.md](MATRIZ_PRUEBAS.md): cada caso extremo con ID, pasos y estado.
- [GUIA_TESTERS.md](GUIA_TESTERS.md): checklist para las personas que prueben la app.

## 1. Alcance

| Tema | Decisión |
|---|---|
| Sistema operativo | Solo Windows. macOS y VoiceOver quedan fuera; sus casos conservan ID en la matriz para no perderlos. |
| Cómputo | Solo CPU en el MVP. CUDA queda fuera porque no hay hardware con qué probarlo; OpenVINO se evalúa aparte. |
| CI | GitHub Actions en `windows-latest`. Según la documentación consultada, el runner tiene 2 CPU y 8 GB, sin GPU. En repos públicos los runners estándar son gratis. |
| Fases | 1 a 6 y 8. Sin Fase 7 (API de Instagram), QR por Wi-Fi ni "Copiar descripción". |
| Equipo de desarrollo | Intel i5-10210U, 16 GB de RAM, Intel UHD. |

**Principio rector:** es una herramienta de privacidad. Un error nunca puede producir un archivo que parezca limpio sin estarlo, y un caso sin ejecutar nunca se reporta como aprobado.

**Lo que este plan no promete:** ningún detector es perfecto. Las pruebas pueden confirmar que los metadatos se eliminaron y que lo sobrescrito no se recupera, pero no que se detectó todo. La app lo dice como revisión orientativa, nunca como "seguro para publicar".

## 2. Pirámide de pruebas

| Nivel | Qué cubre | Python (sidecar) | TypeScript (UI y main) |
|---|---|---|---|
| Unitarias | Lógica, validaciones, efectos, metadatos, exportación | pytest | Vitest |
| Límites parametrizados | Cada parámetro de `RANGOS.md`: mínimo-1, mínimo, máximo, máximo+1, null, tipo incorrecto, NaN e Infinity | pytest parametrize | Vitest `each` |
| Propiedades | Miles de entradas generadas | Hypothesis | fast-check |
| Fuzzing de archivos | Archivos corruptos o aleatorios en el cargador; la app nunca se cierra de golpe | Hypothesis con corpus de mutaciones de bytes | n/a |
| Mutación | Que los tests sí detecten errores en módulos críticos | mutmut | Stryker |
| Integración | UI ↔ sidecar ↔ modelos ↔ FFmpeg | pytest con procesos reales | Vitest con IPC real |
| E2E | Flujo completo de foto y de video, temas y tamaños de ventana | n/a | Playwright para Electron |
| Regresión visual | Capturas en claro y oscuro, a 100% y 200%, en tamaño mínimo y máximo | n/a | Playwright `toHaveScreenshot` |
| Accesibilidad automatizada | Reglas WCAG detectables, `forcedColors`, `reducedMotion`, contraste, daltonismo | n/a | axe-core, Playwright y CDP |
| Calidad de detección | Recall y precisión por categoría | pytest con dataset de evaluación | n/a |
| Manual | Lo que una máquina no puede juzgar | Guiones de la matriz | Guiones de la matriz |

**Propiedades mínimas previstas:**
- Cualquier máscara válida aplicada a cualquier imagen válida produce una imagen del mismo tamaño en la que la zona enmascarada cambió.
- Fuera de la máscara dilatada, los píxeles no cambian más allá de lo que introduzca la recodificación.
- Una imagen exportada nunca conserva metadatos fuera de la lista blanca.
- Dos entradas que solo difieren dentro de la zona enmascarada producen la misma zona de salida.
- Un mensaje inválido en el IPC siempre recibe un error tipado, nunca un cierre.

**Fuentes de datos de prueba:** el repo es público, así que todas las muestras son sintéticas o tienen licencia clara. No se suben documentos, caras, placas ni tarjetas reales. Los números de tarjeta son de prueba, y los documentos son maquetas generadas y marcadas como ficticias.

## 3. Herramientas específicas

- **Playwright con Electron:** su soporte sigue marcado como experimental. Los diálogos nativos no se pueden interceptar, así que se simulan desde el proceso main. El build endurecido necesita su propia prueba de humo, porque desactivar el fuse `nodeCliInspect` puede impedir que Playwright arranque.
- **axe-core:** se ejecuta en cada pantalla y estado relevante. Solo detecta una parte de los problemas, así que no sustituye la revisión manual de WCAG 2.2 AA.
- **Preferencias emuladas:** `forcedColors`, `contrast` y `reducedMotion` desde Playwright. Los temas de contraste reales de Windows se revisan a mano.
- **Daltonismo:** protanopia, deuteranopia y tritanopia con `Emulation.setEmulatedVisionDeficiency` vía CDP. La comprobación es que cada nivel de riesgo se distinga también por ícono y texto.
- **Lectores de pantalla:** NVDA y Narrador con guion manual. Guidepup se puede evaluar como humo nocturno no bloqueante, pero no está confirmado que maneje apps de escritorio.
- **Metadatos:** `ffprobe` y `exiftool -a -G1 -ee` contra una lista blanca.
- **Red:** captura de tráfico durante el análisis, junto con auditoría de sockets en Python. Ninguna capa se da por suficiente por sí sola.
- **Tipado y lint:** TypeScript `strict` y `noImplicitReturns`, ESLint con `switch-exhaustiveness-check`, pyright en modo estricto y Ruff.

## 4. Umbrales de cobertura

| Módulo | Cobertura mínima |
|---|---|
| Lógica general | 90% |
| Validaciones | 100% |
| Efectos de ocultamiento | 100% |
| Limpieza de metadatos | 100% |
| Exportación | 100% |

**Mutación (propuesta):** se aplica a validaciones, efectos, metadatos y exportación. El umbral se fija tras la primera corrida real. Cada mutante superviviente se mata con un test o se justifica por escrito.

**Catálogo:** cada regla cumple el esquema y tiene al menos una fuente con URL y fecha de consulta, o está marcada `pendiente_de_verificar`. Antes de la entrega a testers, cada regla pendiente necesita una decisión explícita: se queda con ese aviso o se quita.

**Nombre:** un test falla si "Antifaz" aparece fuera de los lugares permitidos, para que el renombrado siga siendo sencillo.

## 5. Dónde corre cada cosa

| Prueba | Local (i5, antes de commit) | CI en cada cambio | CI semanal |
|---|---|---|---|
| Lint y tipado estricto | Sí | Sí | |
| Unitarias y límites | Sí | Sí | |
| Propiedades, perfil corto | Sí | Sí | |
| Propiedades, perfil largo | | | Sí |
| Fuzzing, corpus corto | Sí | Sí | |
| Fuzzing, corrida larga | | | Sí |
| Integración | Por módulo tocado | Sí | |
| E2E y axe-core | Humo | Sí | |
| Regresión visual | Bajo demanda | Sí | |
| Validación del catálogo | Sí | Sí | |
| Comprobación de URLs del catálogo | Bajo demanda | | Sí (solo avisa, porque una caída ajena no debe romper el build) |
| Mutación | | | Sí |
| Estrés: lote de 500 y video de 1 hora sintético | | | Sí |
| Calidad de detección | Bajo demanda | Al cambiar modelos o umbrales | Sí |
| Rendimiento | Referencia en el i5 | Solo detectar regresiones grandes | Sí |
| Manual: NVDA, Narrador, DPI, temas de contraste | Antes de cerrar la fase | | |

- **Las capturas de referencia se generan en CI**, para que sean comparables entre corridas.
- **El video de 1 hora** solo prueba límites y flujo por bloques con video sintético, sin tracking completo, porque en CPU no es viable.

## 6. Presupuestos de rendimiento (propuesta, sin medir)

Ninguno de estos valores se ha medido. Son objetivos iniciales para el i5-10210U. En cada fase se mide primero, se confirma o se ajusta el valor con tu aprobación, y solo entonces el test empieza a fallar al rebasarlo.

| Operación | Objetivo propuesto | Se fija en |
|---|---|---|
| App lista para usar tras abrirla | 5 s | Fase 1 |
| Análisis básico de una foto de 12 MP | 15 s | Fase 1 |
| Exportación de una foto de 12 MP | 3 s | Fase 1 |
| Preparar el clic con SAM (encoder) | 10 s | Fase 2 |
| Respuesta a un clic ya preparado (decoder) | 500 ms | Fase 2 |
| OCR de una foto de 12 MP | 15 s | Fase 2 |
| Lote de 500 fotos | Se define tras medir | Fase 2 |
| Tracking de 1 minuto de video | Se define con el benchmark | Fase 3 |
| Pico de memoria del sidecar en fotos | 6 GB | Fase 1 |
| Pico de memoria del sidecar en video | 8 GB | Fase 3 |

**Regla de la Fase 3:** empieza con benchmark. Si el CPU no alcanza, se ajustan proxy, fps de tracking o duración máxima antes de seguir. Los valores de video de [RANGOS.md](RANGOS.md) cambian con esa medición.

## 7. Calidad de detección

**Prioridad:** recall sobre precisión. Dejar escapar algo es peor que advertir de más.

**El recall mínimo por categoría no se fija hoy.** Sin modelo ni dataset, cualquier número sería inventado. El proceso es:
1. En la fase que introduce la categoría (ver la tabla), se arma el dataset de evaluación sintético o con licencia.
2. Se mide la línea base por categoría y se publica en el reporte de fase.
3. Tú apruebas el mínimo para esa categoría.
4. Desde entonces, el test falla si el recall baja de ese mínimo.

| Categoría | Fase de medición |
|---|---|
| Caras de terceros | 1 |
| Ubicación: GPS en metadatos | 1 |
| Contacto personal, información financiera, información médica (OCR) | 2 |
| Códigos QR y de barras, boletos y viajes | 2 |
| Documentos de identidad, pantallas, objetos de valor | 2 |
| Matrículas | 2 |
| Ubicación: letreros, números de casa, fachadas, uniformes, gafetes | 2 |
| Mismas categorías en video | 4 |

**Posibles menores:** no hay métrica de edad porque no se estima ninguna. La prueba es de comportamiento: con cualquier cara detectada aparece la pregunta "¿Hay menores en esta foto?", y ningún artefacto contiene una edad. Sí se mide el recall de caras, porque de él depende esa pregunta.

## 8. Definición de terminado

Una fase está terminada cuando se cumple todo esto:
1. Todos los tests pasan en Windows, en local y en CI.
2. La matriz de esa fase está ejecutada.
3. No hay errores de linter ni de tipado en modo estricto.
4. La app se ejecutó de verdad, con capturas revisadas en modo claro y oscuro.
5. Se entregó el reporte de QA de la fase: qué se probó, qué falló, qué se corrigió y qué queda pendiente.

**Lo manual que dependa de ti o de los testers queda marcado como pendiente, nunca como aprobado.** Tampoco se puede cerrar un caso de la matriz sin evidencia: test, captura o resultado anotado.

## 9. Reporte por fase

Cada `qa/REPORTE_FASE_N.md` incluye:
- Versión o commit probado y equipo usado.
- Resultado de tests y cobertura por módulo.
- IDs de la matriz ejecutados, fallidos y pendientes.
- Fallos encontrados y cómo se corrigieron.
- Mediciones de rendimiento y de calidad de detección.
- Riesgos abiertos y decisiones que necesitan tu aprobación.
