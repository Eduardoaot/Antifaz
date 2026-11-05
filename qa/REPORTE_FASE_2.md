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
| Armas y militares | CLIP | No: solo avisa sobre la imagen completa | Pendiente |
| Símbolos extremistas | CLIP | No: solo avisa sobre la imagen completa | Pendiente |
| Teléfonos, correos y direcciones | OCR y patrones | Sí | Verificada |
| CURP, RFC y palabras de documentos | OCR y patrones | Sí | Verificada |
| Tarjetas (Luhn), CLABE y palabras financieras | OCR y patrones | Sí | Verificada |
| Palabras médicas | OCR y patrones | Sí | Verificada |
| Palabras de boletos | OCR y patrones | Sí | Verificada |
| Pases de abordar | Formato BCBP del código | Sí | Verificada |
| Códigos QR y de barras | zxing-cpp | Sí | Pendiente |

El texto y el contenido de los códigos nunca se muestran, ni se guardan, ni van a los logs.

## Resultados

| Prueba | Resultado |
|---|---|
| Sidecar | 386 pasan |
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

- **Muestra muy chica.** Los umbrales de contenido salen de 21 imágenes. Faltan disfraces, juguetes, noticias, banderas comunes y personas en ropa de playa.
- **Falsa alarma ya vista:** en el dibujo de ejemplo, una manga se marcó como "desnudez" con 0.4 de confianza.
- **El OCR no leyó árabe,** y falta probarlo con ñ y acentos, fotos reales, texto rotado, en espejo o manuscrito.
- **Un documento o una tarjeta sin texto legible puede pasar sin aviso.** La app lo dice.
- **Palabras y números pueden dar falsas alarmas:** por ejemplo, "hospital" en un letrero, o una fecha que parece teléfono.
- **NudeNet revisa a 320 px:** puede perder personas pequeñas en fotos grandes.
- **La foto del reloj:** sigue sin confirmarse que el arreglo de los dos niveles lo resuelva.
- **Prueba intermitente:** "recuperación sobre una foto que cambió" falló una vez en una corrida completa, sin error guardado. Después pasó en 24 repeticiones y en la corrida completa siguiente. Causa desconocida.

## Pendiente de la Fase 2

1. Detector visual: placas, pantallas, gafetes, llaves y joyas.
2. Tapar armas y símbolos por zona.
3. Selección por clic con SAM, pincel y rectángulo.
4. Guía de privacidad.
5. Dataset de evaluación y recall mínimo por categoría, que necesitan tu aprobación.
6. Una persona debe abrir las políticas de Meta sobre organizaciones peligrosas y bienes restringidos: la lectura automática llega truncada.

## Licencias nuevas

CLIP (MIT), NudeNet (AGPL-3.0 en su repo, compatible con este proyecto), RapidOCR (Apache-2.0), zxing-cpp (Apache-2.0).
