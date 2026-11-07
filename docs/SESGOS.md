# Sesgos

La app no debe tratar distinto a nadie por su tono de piel, su género, su edad o su origen. Ningún detector cumple eso al 100%, así que aquí no se promete "cero sesgos": se dice qué se evita por diseño, qué se mide y qué falta.

## Por diseño

- **No se infiere ningún grupo.** La app no estima edad, género, tono de piel ni origen de nadie. La pregunta "¿Hay menores en esta foto?" sale con cualquier cara segura, sin mirar cómo es la persona. Por eso se descartó MiVOLO (ver `docs/INVESTIGACION.md`).
- **Recall antes que precisión.** Una cara que no se detecta no se puede ocultar. Los umbrales favorecen encontrar de más, y una detección dudosa se muestra como "podría ser una cara" en vez de descartarse.
- **La persona decide.** Los avisos de contenido dicen "podría" y nada se oculta solo, salvo la desnudez, que se marca y se puede desmarcar. Un clasificador sesgado no puede tapar ni borrar a alguien sin que la persona lo vea.
- **El baño va aparte.** Su puntaje no compite con el de desnudez, para que una escena común no cambie lo que se avisa.
- **Lenguaje.** Los avisos describen objetos y lugares, nunca a la persona.

## Qué se mide

`tools/medir_sesgo.py`, por grupo:

| Métrica | Por qué importa |
|---|---|
| Recall de caras | Una cara que se escapa queda visible en la copia |
| Recall de caras seguras (confianza de 0.6 o más) | De eso depende la pregunta de menores |
| Falsas alarmas de desnudez y contenido sugerente | Estos clasificadores marcan de más ciertos cuerpos y tonos de piel |

La brecha es la diferencia entre el mejor y el peor grupo. Solo cuentan grupos con al menos 30 fotos, y cada tasa lleva su intervalo de 95%. La propuesta es que ninguna brecha pase de 5 puntos. **Falta que el responsable la apruebe**, igual que el recall mínimo de `qa/PLAN_QA.md`.

Grupos sugeridos: tono de piel en la escala Monk (10 tonos, agrupados si hay pocas fotos), edad aparente y género percibido. Las etiquetas solo existen en el dataset de evaluación.

## Pendiente

- **Dataset.** Hace falta uno balanceado y con licencia que permita este uso, revisada antes de descargarlo. No se versiona: tiene fotos de personas. Hasta tenerlo, ningún caso SES de `qa/MATRIZ_PRUEBAS.md` está aprobado.
- **Fotos con poca luz y caras de perfil, por grupo.** La brecha suele crecer ahí (VIS-002 a VIS-019).
- **Agrupar personas (SFace).** Cuando llegue, se mide también cuántas veces confunde a dos personas distintas, por grupo. Agrupar solo sugiere: la persona confirma cada cara.
- **Video.** Las mismas métricas, sobre frames del proxy.
