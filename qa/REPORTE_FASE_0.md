# Reporte de QA: Fase 0

Fecha: 3 de noviembre de 2026. Esta fase no incluye código de la app, así que no se ejecutó ninguna prueba de producto y los 243 casos de la matriz siguen sin correr.

## Qué se probó

| Prueba | Resultado |
|---|---|
| Esquema y reglas de negocio del catálogo (`validar_catalogo.py`) | Pasa: 18 reglas, 11 verificadas, 7 pendientes |
| Tests del validador con catálogos mal formados (9 tests) | Pasan |
| Enlaces del catálogo (`--urls`) | 11 de 15 responden 200. Meta y Facebook rechazan al robot (400). AEPD falla por certificado en esta red |
| Lectura de esas 4 URLs por otra vía (WebFetch) | Se pudieron leer |
| Cotejo independiente de citas contra los documentos | 15 fuentes revisadas, 7 con correcciones |
| Contraste AA, 17 pares en cada tema (`revisar_contraste.py`) | Pasa. Mínimo de texto: 5.66:1 |
| Simulación de protanopia, deuteranopia y tritanopia | Ver hallazgos |
| Nombre centralizado (`revisar_nombre.py`) | Pasa |
| Cotejo de la matriz contra el brief, 165 conceptos | Todos presentes |
| Bocetos renderizados a 64, 32 y 16 px, en ambos temas y en una tinta | Revisados en capturas con Edge |
| Tablero a 400 px de ancho | Sin desborde horizontal (`scrollWidth` = `clientWidth` = 400) |

El cotejo de la matriz busca palabras clave: confirma que cada tema aparece, no que cada fila esté bien escrita.

## Qué falló y cómo se corrigió

1. **Citas que exageraban.** El revisor independiente encontró afirmaciones más fuertes que sus fuentes.
   - UBI-02 (fachadas) y UBI-03 (uniformes) bajaron a `pendiente_de_verificar`. Después volvieron a `verificada` con los comunicados de la SSPC, que respaldan la dirección y la escuela, aunque no mencionan esos objetos.
   - DOC-01 ya no dice "hacerse pasar por ti". MAT-01 ya no dice "o tu casa". UBI-03 ya no habla de horarios.
   - FIN-01 ganó la fuente que sustenta el riesgo de fraude.
   - Las etiquetas de maleta pasaron a su propia regla pendiente (VIA-02), porque ninguna fuente las menciona.
   - Se corrigieron la clave y la fecha de la resolución del INE.
2. **Resumen de Meta con datos no confirmados.** "Visas" no aparecía en lo leído. Se reescribió.
3. **Scripts rotos en la consola de Windows.** `revisar_contraste.py` fallaba al imprimir ΔE por cp1252. Los tres scripts ahora fuerzan UTF-8.
4. **El comprobador de enlaces reportaba como rotos sitios que solo bloquean robots.** Ahora los lista como "sin comprobar", separados de los enlaces muertos.
5. **User-agent de navegador en las comprobaciones.** Se bloqueó un intento con ese user-agent, y lo quité del validador. Ya había usado el mismo disfraz en una descarga anterior de la SSPC, que de todos modos no pasó el bloqueo. El proyecto ya no lo usa, y queda escrito en `CLAUDE.md`.

## Hallazgos abiertos

- **Daltonismo:** en modo claro con deuteranopia, riesgo alto y medio quedan a 4.1 ΔE, casi iguales. En tritanopia oscuro quedan a 8.2 ΔE. El ícono y el texto obligatorios lo resuelven, pero hay que comprobarlo en la app en la Fase 1.
- **Matrícula:** el ejemplo de tono del brief dice "identificar tu auto o tu casa". `BRAND.md` y el tablero conservan esa frase como ejemplo de voz; el catálogo usa la versión sin "o tu casa", que es lo que aguanta la fuente.
- **Reglas verificadas con fuentes débiles:**
  - PAN-01 se apoya en una sola fuente española de 2018.
  - UBI-01 y VIA-01 dependen de fuentes de España.
  - MED-01 se apoya en Meta solo para información de terceros tomada de historiales o documentos oficiales.

## Pendiente

**Lo que necesita a una persona:**
- Decidir antes de entregar a testers qué hacer con las 7 reglas pendientes: CAR-01, VIA-02, UBI-04, MAT-01, VAL-01, VAL-02 y COD-01.

**Resuelto por el responsable del proyecto:**
- Logo B, eslogan "Comparte lo que quieres que vean" e índigo como color de marca.
- Texto de los dos comunicados de la SSPC, pegado desde su navegador.
- La exportación siempre borra los metadatos.

**Lo que no se comprobó:**
- Valores de `RANGOS.md` y presupuestos de `PLAN_QA.md`: son propuestas sin medir.
- Reglamento de 2011 de la LFPDPPP: falta cotejarlo en el DOF.
- Título completo de la guía del INAI: la portada es una imagen.
- `.mx`, IMPI y clases de Niza del nombre.
- Licencia de InsightFace para el caso de testers, antes de usarlo.
- GitHub Actions: aún no hay workflow, llega en la Fase 1.

**Generados tras la elección:** logo horizontal e isotipo en 4 variantes, dibujo propio de 16 px, 9 PNG e `icono.ico` con 7 tamaños. Revisados en capturas. El `.ico` aún no se ha visto en la barra de tareas de Windows: se comprueba en la Fase 1.

## Decisiones de esta fase que conviene que revises

En `qa/RANGOS.md`:
- Dilatación mínima de 8 px, sin poder bajarla.
- Video: máximo 7200 s y aviso a partir de 180 s, sin medir aún.
