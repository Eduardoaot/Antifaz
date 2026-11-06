# Reporte de QA: Fase 2 (en curso)

Fecha: 6 de noviembre de 2026. Equipo: Intel i5-10210U, 16 GB de RAM, Intel UHD, Windows 11.

**La fase no está terminada.** Ya están el detector de objetos, la selección por clic, el pincel y la Guía de privacidad. Faltan el dataset de evaluación y una fuente para ARM-01 (ver abajo). La Fase 1 tampoco está cerrada: ver `qa/REPORTE_FASE_1.md`.

## Alcance ampliado

A pedido del responsable, tras probar la app, se agregó revisión de contenido, que no estaba en el brief original: armas, militares, símbolos extremistas, desnudez y contenido sugerente.

## Lo que ya hace

| Revisión | Cómo | Se puede tapar | Fuente |
|---|---|---|---|
| Desnudez | NudeNet y CLIP | Sí, por zona. Se marca sola con bloque sólido | Verificada |
| Contenido sugerente | NudeNet y CLIP | Sí, por zona | Pendiente |
| Armas y militares | OWL-ViT y CLIP | Por zona si ubica el arma; si no, solo avisa sobre la imagen | Pendiente: Meta no prohíbe mostrarlas por sí solo |
| Símbolos extremistas | CLIP y OWL-ViT | La bandera por zona si la ubica; si no, solo avisa | Verificada |
| Teléfonos, correos y direcciones | OCR y patrones | Sí | Verificada |
| CURP, RFC y palabras de documentos | OCR y patrones | Sí | Verificada |
| Tarjetas (Luhn), CLABE y palabras financieras | OCR y patrones | Sí | Verificada |
| Palabras médicas | OCR y patrones | Sí | Verificada |
| Palabras de boletos | OCR y patrones | Sí | Verificada |
| Pases de abordar | Formato BCBP del código | Sí | Verificada |
| Códigos QR y de barras | zxing-cpp | Sí | Pendiente |
| Placas | OWL-ViT | Sí | Pendiente |
| Pantallas | OWL-ViT | Sí | Verificada |
| Tarjetas | OWL-ViT y OCR | Sí | Verificada |
| Joyas | OWL-ViT | Sí | Pendiente |
| Letreros | OWL-ViT | Sí | Pendiente |
| Cualquier cosa, a mano | Clic con SlimSAM, rectángulo, pincel o coordenadas | Sí | No aplica |

El texto y el contenido de los códigos nunca se muestran, ni se guardan, ni van a los logs.

## Resultados

| Prueba | Resultado |
|---|---|
| Sidecar | 519 pasan; cobertura de 97%, con `cargador`, `exportar` y `pincel` al 100% |
| Interfaz y main | 187 pasan |
| E2E con la app real | 39 pasan; 4 omitidas porque usan los ejemplos locales del responsable (`REVISOR_MUESTRAS`) |
| Tipado estricto y lint | Sin errores |
| Analizar una foto sintética de 12 MP | De 4.6 a 8 s (objetivo propuesto: 15 s); no se volvió a medir |

Corrida completa del 6 de noviembre de 2026, después de los cambios de abajo, en otro equipo con Windows 11. **CI sigue sin correr** porque los commits no se han subido.

## Qué falló y se corrigió

- Leer la salida de NudeNet fallaba con una sola fila.
- El aviso más grave quedaba al final, debajo de todas las caras. Ahora se ordena por riesgo.
- El título decía "solo caras y ubicación" sin importar qué se había revisado. Ahora nombra lo que se revisó en esa foto, y si un modelo falla, esa regla sigue como no revisada.

## Limitaciones conocidas

- **Muestra chica.** Los umbrales salen de 197 fotos de Wikimedia Commons con etiquetas por búsqueda (ver `docs/INVESTIGACION.md`).
- **Desnudez sin medir:** a propósito no se descargaron desnudos, así que no se sabe cuántos se escaparían con la regla nueva.
- **Sin detectar:** gafetes, llaves y números de casa, porque el detector casi no los encuentra.
- **Falsa alarma ya vista:** en el dibujo de ejemplo, una manga se marcó como "desnudez" con 0.4 de confianza.
- **El OCR no leyó árabe,** y falta probarlo con ñ y acentos, fotos reales, texto rotado, en espejo o manuscrito.
- **Un documento o una tarjeta sin texto legible puede pasar sin aviso.** La app lo dice.
- **Palabras y números pueden dar falsas alarmas:** por ejemplo, "hospital" en un letrero, o una fecha que parece teléfono.
- **NudeNet revisa a 320 px:** puede perder personas pequeñas en fotos grandes.
- **La foto del reloj:** los dos niveles no bastaron y seguía dando dos posibles caras. Ahora cada detección dudosa se confirma con CLIP. Se comprobó con un recorte de la captura (0.06), no con la foto original: **falta que el responsable la vuelva a probar.**
- **Una cara real dudosa puede descartarse sin aviso** si CLIP le da menos de 0.6. En la muestra, ninguna bajó de 0.82.
- **Prueba intermitente:** "recuperación sobre una foto que cambió" falló una vez en una corrida completa, sin error guardado. Después pasó en 24 repeticiones y en la corrida completa siguiente. Causa desconocida.

## Pincel (6 de noviembre de 2026)

Se pinta sobre la imagen y cada trazo se vuelve una zona nueva, con su silueta. Sirve para tapar lo que la detección o el clic dejaron fuera.

- **Solo agrega.** No hay borrador: quitar parte de una silueta podría destapar algo. Para reducir una zona, se quita y se rehace. **Decisión para revisar.**
- El tamaño va de 1 a 512 px de la foto original (32 por defecto) y se elige con un slider. Un tamaño par da un píxel de más, nunca de menos.
- Lleva el margen mínimo de 8 px, como el rectángulo, porque es lo que se pintó. La silueta de SlimSAM sigue con el margen completo.
- Un trazo admite hasta 5000 puntos (propuesta). Al llegar al límite se toma la primera parte y se avisa.
- El sidecar convierte el trazo en silueta y la guarda en memoria. Si se pierde, por un reinicio o una recuperación, se oculta toda su caja.
- **Cambio de paso:** la confirmación de "cubre toda la imagen" ahora vale para rectángulos, siluetas y trazos (VAL-030). Mide la caja, no la máscara: puede preguntar de más, nunca de menos.
- **Sin alternativa por teclado propia:** quien no usa mouse puede tapar la misma zona con las coordenadas.

## Límite de 500 fotos (ARC-058 y ARC-059)

**Se corrigió una falla:** el límite se contaba por selección, no por fotos abiertas. Se podían abrir 300 y luego otras 300. Con más de 500 fotos editadas, la recuperación rechazaba el guardado completo sin avisar. Quedaba el archivo de recuperación anterior y el aviso de cierre seguía prometiendo recuperar.

Ahora el límite cuenta las fotos ya abiertas. Si no caben todas, se pregunta si abrir las primeras. Las que quedan fuera se dicen en un solo aviso, no en uno por foto. Una foto ya abierta, o repetida en la selección, no ocupa otro lugar. La prueba de propiedades encontró que una ruta repetida podía saltarse el límite, y se corrigió antes de terminar.

500 fotos chicas cargan en 2.4 s y la interfaz responde mientras tanto. No se midió con 500 fotos de 12 MP.

## Temporales de una exportación interrumpida

Si la app se cierra entre escribir el temporal y renombrarlo, queda un `.<hex>.parcial` en la carpeta de destino. Ahora se borra en la siguiente exportación a esa carpeta. Solo se tocan archivos con ese nombre exacto y con más de un minuto, para no borrar uno en uso.

## Pruebas E2E que fallaban en el commit anterior

El commit `6a96a52` se subió sin correr las E2E. Al correrlas fallaron 3: Guía de privacidad, rectángulo con el mouse y coordenadas sin mouse. En los tres casos falló la prueba, no la app: los textos para lector de pantalla agregados en ese commit ("Quitar tu zona 1", ": Placas de autos y motos") hacían que el selector encontrara varios elementos. Se corrigieron los selectores.

## Pendiente de la Fase 2

1. Dataset de evaluación y recall mínimo por categoría, que necesitan tu aprobación.
2. Buscar una fuente oficial sobre fotos de armas o uniformes para ARM-01.
3. Probar el pincel con tableta y pantalla táctil (manual).

## Licencias nuevas

SlimSAM (Apache-2.0), OWL-ViT (Apache-2.0), CLIP (MIT), NudeNet (AGPL-3.0 en su repo, compatible con este proyecto), RapidOCR (Apache-2.0), zxing-cpp (Apache-2.0).
