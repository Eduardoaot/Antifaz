# Reporte de QA: Fase 4 (en curso)

## Alcance (decisión del responsable, 6 de noviembre de 2026)

1. Detección automática en video: caras, texto, códigos y placas, seguidas en todo el video.
2. Agrupar personas con SFace, con embeddings solo en RAM (SEG-013).
3. Menos alarma con lo cotidiano: "no quiero tener riesgo medio solo por subir una foto con mi amigo".
4. Avisar de ventanas que muestran el exterior y de fotos en un baño.
5. Sin sesgos: medirlos y evitarlos por diseño.

## Lo que ya está

| Pieza | Qué cambia | Pruebas |
|---|---|---|
| Niveles en contexto (`app/shared/logica.ts`) | Una cara, un código o una pantalla son riesgo bajo. La pregunta de menores es neutral ("Pregunta") hasta responderla; con un "sí", ella, las caras y el baño suben a alto. Con poca confianza, medio baja a bajo. Lo alto nunca baja. Veredicto nuevo: "Solo encontramos detalles menores en lo que revisamos". "Ocultar todo lo de riesgo alto" oculta lo que la pantalla marca como alto | NIV-001 a NIV-004 |
| `UBI-06` ventanas | OWL-ViT con "a window with a view of the street or buildings", umbral 0.2. Riesgo bajo, con zona | ESC-003, ESC-004 |
| `INT-01` baños | CLIP en una comparación aparte (baño contra otros lugares), umbral 0.6. Riesgo bajo, aviso sobre la foto completa | ESC-001, ESC-002 |
| Sesgos | `docs/SESGOS.md` y `tools/medir_sesgo.py`: recall de caras, de caras seguras y falsas alarmas de contenido, por grupo, con intervalo de 95% y brecha máxima | SES-001 a SES-006 |

Las dos reglas nuevas quedan `pendiente_de_verificar`: no hay fuente oficial abierta que hable de ventanas o baños. El blog de la AEPD sobre *sharenting* (citado en MEN-01) se leyó el 6 de noviembre de 2026: pide cuidar la intimidad de los menores, pero no menciona baños.

## Resultados

| Prueba | Resultado |
|---|---|
| Interfaz y main | 233 pasan |
| Sidecar (análisis, contenido y objetos) | Pasan, incluida la prueba con el CLIP real: el astronauta no parece un baño |
| Herramientas | `test_medir_sesgo.py`: 11 pasan. Catálogo: 24 reglas, válido |
| E2E | Flujo completo, Guía y daltonismo pasan. Las de contenido con muestras locales se omiten |
| Tipado estricto y lint | Sin errores |

No se corrió la suite completa: los cambios tocan áreas acotadas.

## Pendiente

1. **Detección en video**, siguiente paso. Diseño: los detectores de fotos corren sobre el proxy (caras en todos los frames rastreados; texto, códigos y objetos en frames clave), las detecciones se unen en pistas por cercanía y `pistas.zonas` hace el resto. Si una pista se pierde más de dos frames clave, se oculta de más y se marca para revisión, como en el seguimiento manual.
2. **Medir los umbrales de ventana y baño** con fotos reales. Hoy son propuestas.
3. **Dataset de sesgos** con licencia, y aprobar la brecha máxima (propuesta: 5 puntos).
4. Agrupar personas con SFace.
