# Reporte de QA: Fase 2 (en curso)

Fecha: 6 de noviembre de 2026. Equipo: Intel i5-10210U, 16 GB de RAM, Intel UHD, Windows 11.

**La fase no está terminada.** Faltan el detector visual, la selección por clic y la Guía de privacidad. La Fase 1 tampoco está cerrada: ver `qa/REPORTE_FASE_1.md`.

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
| Cualquier cosa, a mano | Clic con SlimSAM, rectángulo o coordenadas | Sí | No aplica |

El texto y el contenido de los códigos nunca se muestran, ni se guardan, ni van a los logs.

## Resultados

| Prueba | Resultado |
|---|---|
| Sidecar | 393 pasan |
| Interfaz y main | 124 pasan |
| E2E con la app real, incluidas 4 pruebas con los ejemplos locales del responsable | 37 pasan |
| Tipado estricto y lint | Sin errores |
| Analizar una foto sintética de 12 MP | De 4.6 a 8 s (objetivo propuesto: 15 s) |

Estos números son de la última corrida completa, hecha después de todos los cambios del código.

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

## Pendiente de la Fase 2

1. Pincel para corregir una zona: aún no existe.
2. Dataset de evaluación y recall mínimo por categoría, que necesitan tu aprobación.
3. Buscar una fuente oficial sobre fotos de armas o uniformes para ARM-01.

## Licencias nuevas

SlimSAM (Apache-2.0), OWL-ViT (Apache-2.0), CLIP (MIT), NudeNet (AGPL-3.0 en su repo, compatible con este proyecto), RapidOCR (Apache-2.0), zxing-cpp (Apache-2.0).
