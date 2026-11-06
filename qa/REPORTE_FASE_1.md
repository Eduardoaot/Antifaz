# Reporte de QA: Fase 1

Fecha: 5 de noviembre de 2026. Equipo: Intel i5-10210U, 16 GB de RAM, Intel UHD, Windows 11.

**La fase no está terminada según la definición del proyecto.** La app funciona y las pruebas automáticas pasan en este equipo, pero falta correr CI, las pruebas manuales y el dataset de caras. Lo que falta está abajo.

## Qué hay

App de escritorio que abre fotos, detecta caras y GPS, pregunta por menores, explica cada advertencia con sus fuentes, oculta zonas y exporta una copia sin metadatos.

**Solo revisa caras y ubicación guardada en el archivo.** La app lo dice en pantalla y lista las 15 reglas que aún no revisa. OCR, códigos, documentos y selección por clic llegan en la Fase 2.

## Resultados

| Prueba | Resultado |
|---|---|
| Sidecar (pytest, Hypothesis, fuzzing) | 296 pasan |
| Interfaz y main (Vitest, fast-check) | 112 pasan |
| E2E con la app real (Playwright, axe-core) | 32 pasan |
| Tipado estricto (tsc, pyright) | Sin errores |
| Lint (ESLint, Ruff) | Sin errores |
| Catálogo, contraste y nombre centralizado | Pasan |

**Cobertura:**

| Módulo | Cobertura |
|---|---|
| `efectos`, `exportar`, `metadatos`, `esquemas`, `analisis` | 100% |
| `app/shared` y `archivos.ts` | 100% de líneas, 98% de ramas |
| `servidor` | 91% |
| `cargador` | 88% (**el objetivo de validaciones es 100%**) |
| `__main__`, `red` | 0% medido: se ejecutan en subprocesos que el medidor no ve |
| Sidecar en total | 92% |
| `app/main/index.ts` y el renderer | Sin medir; se ejercitan con E2E |

**Matriz, 182 casos de la Fase 1:** 127 automatizados, 38 pendientes con su motivo y 17 manuales sin ejecutar.

## Rendimiento

Medido en este equipo con una foto sintética de 12 MP.

| Operación | Medido | Objetivo propuesto |
|---|---|---|
| Abrir | 0.17 s | n/a |
| Analizar | 1.7 s | 15 s |
| Exportar a JPG | 0.8 s | 3 s |
| Exportar a PNG | 1.7 s | 3 s |

Sin medir: arranque de la app y pico de memoria. Por eso esos presupuestos no hacen fallar ningún test todavía.

## Qué falló y se corrigió

**Fugas de privacidad encontradas por el revisor independiente:**
1. **Exportaba otra foto con las cajas viejas.** Si el archivo cambiaba en disco y el sidecar se reiniciaba, la cara nueva salía visible y la app decía "1 zona oculta". Ahora cada archivo tiene una huella SHA-256: si no coincide, no se guarda nada.
2. **La recuperación aplicaba decisiones a otra foto,** con el mismo efecto. Ahora guarda la huella y descarta las decisiones si no coincide.
3. **Un PNG con alfa muy bajo conservaba el contenido,** recuperable con solo subir el alfa. Ahora esos píxeles se borran.

**Fail-closed:**
4. Una revisión parcial se exportaba sin avisar y con el nombre `-revisada`. Ahora pide confirmar, el sufijo es `-copia` y el estado sigue diciendo "revisión parcial".
5. Se podían cambiar decisiones durante una exportación y el resultado no coincidía con la pantalla. Ahora se bloquean.
6. Sin modelo, las caras se listaban como revisadas. Ahora siguen en "lo que todavía no revisamos".
7. Un PNG con datos dañados se decodificaba como imagen válida, porque Pillow no revisa ese CRC. Ahora se comprueba antes.

**Robustez:**
8. Una excepción de IPC dejaba la foto en "Revisando…" para siempre y frenaba la cola.
9. Un marco corrupto del sidecar tumbaba main o dejaba la promesa colgada. Ahora el proceso se reinicia, y hay un límite de 5 minutos por pedido.
10. Una librería nativa podía corromper el protocolo al escribir en stdout. Ahora el canal está separado.
11. Un error al guardar la recuperación enviaba una ruta al renderer y el aviso de cierre prometía algo falso.
12. El diálogo de recuperación borraba el archivo que estaba ofreciendo.
13. Un EXIF dañado rechazaba la foto entera. Ahora se abre y el análisis queda como parcial.

**Privacidad en disco:**
14. `recuperacion.json` guardaba rutas en claro. Ahora va cifrado con la cuenta de Windows.

**Interfaz, encontrados revisando capturas:**
15. **Los botones principales se veían vacíos con el mouse encima.** Ningún test lo detectó; ahora hay uno.
16. La imagen se salía de la pantalla al decidir. Ahora se queda a la vista.
17. Lista inválida para lectores de pantalla en los avisos de error.
18. Texto ilegible al pasar el mouse sobre un botón activo.

**Pruebas que mentían:**
19. **El modo oscuro nunca se había probado.** Playwright forzaba el tema claro, y las pruebas "oscuro" pasaban en claro. Ahora comprueban el color de fondo.
20. El preload no cargaba y la app abría en blanco. Ahora, si el puente falla, lo dice en pantalla.

## Lo que queda pendiente

**Necesita decisión tuya:**
- `sidecar/.coverage`, con la ruta de tu PC, sigue público en el historial de GitHub. Ver abajo.
- Subir los commits: **CI nunca se ha ejecutado**, y la definición de terminado lo exige.

**Necesita a una persona, con guion:**
- NVDA y Narrador. Sin esto, la accesibilidad para personas ciegas **no está comprobada**, aunque axe pase.
- Temas de contraste reales de Windows, texto grande, distribuciones de teclado e IME.
- Varios monitores, DPI y tablets.

**Falta para cerrar la fase:**
- **Dataset de caras.** El recall solo se midió con la misma cara repetida: 121 sintéticas y al menos 100 detectadas. Perfiles, cubrebocas, poca luz y reflejos (VIS-002 a VIS-019) **no se han probado**, y no hay recall mínimo aprobado.
- RAW real: se probó con LibRaw simulado. Tampoco hay muestra Display P3 o Adobe RGB.
- Disco lleno real: se simuló el error del sistema.
- Arrastrar y soltar: el código existe, pero no tiene prueba.
- El diálogo nativo de cierre con cambios sin exportar.
- ~~Limpiar `.parcial` tras un cierre forzado.~~ Hecho el 6 de noviembre de 2026: se borran en la siguiente exportación a esa carpeta (ver `REPORTE_FASE_2.md`).
- Confirmar al ocultar el 100% de la imagen (VAL-030).
- ~~Subir `cargador` a 100%.~~ Hecho el 6 de noviembre de 2026: 100% de líneas y ramas.
- Pruebas de mutación: no se han corrido.
- Regresión visual: hay capturas, pero no referencias comparadas. Se generan en CI.

**Cambios frente al plan:**
- `ffprobe` y `exiftool` quedan para el video. En fotos, la verificación lee los bytes con una lista blanca propia.
- Los presets de Instagram son de la Fase 6: hoy se exporta en tamaño original.
- El efecto `emoji` y la selección manual llegan en fases posteriores.
- Las cajas de caras son rectángulos, no la silueta: SAM llega en la Fase 2.

## Decisión de producto para revisar

**Resuelta el 6 de noviembre de 2026, tras probar la app.** El responsable decidió que el difuminado y el pixelado usen los colores de la imagen, aceptando que se podría reconstruir parte del contenido. La app lo avisa junto al control de intensidad. El bloque sólido sigue siendo irreversible y es el default para texto, códigos y documentos.

**Falso positivo reportado:** la imagen de un reloj dio 2 caras. No se pudo reproducir: el reloj de scikit-image y 60 relojes sintéticos no dieron ninguna detección. Se agregaron dos niveles de confianza (ver `docs/INVESTIGACION.md`): por debajo de 0.6 la app dice "podría ser una cara" y no pregunta por menores. **Falta comprobarlo con la foto original del reloj.**

## Fuera de alcance de esta revisión

El revisor no probó RAW real, disco lleno real ni fotos reales con varias personas.
