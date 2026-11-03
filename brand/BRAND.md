# Marca de Antifaz

Estado: propuesta de la Fase 0, pendiente de que elijas logo y eslogan.

## Nombre

- Se escribe **Antifaz**: con mayúscula inicial y sin artículos ni sufijos ("App", "AI", "Pro").
- Sin relación con Instagram ni Meta: nada de "Insta", "Gram", su degradado o su ícono de cámara.
- No es una herramienta oficial: sin escudos, logos ni colores de gobierno. Citamos fuentes oficiales, pero no somos oficiales.

### Cómo cambiar el nombre

Nombre, eslogan, slug e identificadores viven solo en `brand/brand.json`. `tools/revisar_nombre.py` falla si el nombre aparece escrito en código o en el catálogo. `app_id` es neutro a propósito, para que renombrar no rompa instalaciones.

Para renombrar: cambia `brand.json`, regenera el logotipo y actualiza los documentos que nombran la marca (`brand/`, `docs/`, `qa/`, `CLAUDE.md`). El símbolo no lleva texto y puede quedarse.

### Disponibilidad (consultada el 3 de noviembre de 2026)

Una búsqueda web no sustituye una búsqueda fonética en IMPI, ni el resultado de IMPI es un dictamen.

| Dónde | Resultado |
|---|---|
| [miquel-moreno/antifaz](https://github.com/miquel-moreno/antifaz) | **La colisión más seria:** gateway de privacidad que enmascara datos personales y reserva nombre y logo. Por eso el logo debe distinguirse del suyo |
| [antifazco/Antifaz](https://github.com/antifazco/Antifaz) | Parece un grupo musical (sin confirmar) |
| App Store México y Mac EE. UU. | Sin resultados en la API |
| Google Play | Ninguna app con ese nombre en lo visible (lista truncada) |
| `@antifaz` en Instagram | Ocupado |
| `antifaz.com` | Registrado desde 2001, redirige a una página de venta. Expira el 2026-12-01 |
| `antifaz.app` | Registrado el 2026-11-01 en Porkbun |
| `antifaz.mx` | Sin determinar: consulta el WHOIS de NIC México |
| IMPI | Sin revisar |

**Decisión actual:** seguir con Antifaz como proyecto personal, sin registrar nada. Si algún día se distribuye o vende, conviene revisar IMPI primero.

### Cómo revisar en IMPI

No hallé una guía oficial paso a paso; esta es una propuesta.

1. En [MARCia](https://marcia.impi.gob.mx/marcas/search/quick), busca `ANTIFAZ` en las clases 9 (software descargable) y 42 (SaaS y desarrollo). La 41 solo aplica si ofreces servicios de foto o video. Confirma las clases en la Clasificación de Niza, porque no pude abrir la página de la OMPI.
2. Repite con variantes: ANTIFACES, ANTI FAZ, ANTIFAS, ANTIFACE, ANTIFAZ APP.
3. Haz la [búsqueda fonética de Marcanet](https://acervomarcas.impi.gob.mx:8181/marcanet/vistas/common/datos/bsqFoneticaCompleta.pgi). No cargó desde aquí, y Marcanet parece estar en migración.
4. Revisa titular, estado y productos de cada coincidencia.
5. Consulta a un agente de propiedad industrial antes de pagar.

### Nombres de respaldo

Revisados el 3 de noviembre de 2026 en dominios, App Store México, GitHub y búsqueda web. IMPI, `.mx` e Instagram siguen sin revisar. Los significados son de memoria, porque la RAE bloqueó la consulta.

| Nombre | `.com` | `.app` | Nota |
|---|---|---|---|
| Tapujo | Sin registro | Sin registro | El más limpio. Puede sonar a ocultar algo turbio |
| Rebozo | Ocupado | Sin registro | Cálido y mexicano. El logo dejaría de ser máscara |
| Embozo | Ocupado | Sin registro | Palabra poco conocida |

## Eslogan

Propuesto: **"Publica sin exponerte."** Alternativas: "Revisa antes de publicar." y "Lo tuyo, antes de compartirlo."

## Logo

Bocetos en `brand/sketches/`. Recomiendo **A**: es el único dibujado sobre una cuadrícula de 16×16, así que se ve nítido en el tamaño más difícil.

| Opción | Archivo | A favor | En contra |
|---|---|---|---|
| A, píxeles | `a-pixeles.svg` | Nítido a 16 px; une máscara y píxel | Menos cálido |
| B, encuadre | `b-marco.svg` | Dice "foto" de inmediato | Se empasta a 16 px |
| C, curvas | `c-ojos-pixel.svg` | El más amable | Lo de foto se nota poco |
| D, lucha libre | `d-lucha.svg` | Más carácter y más mexicano | Menos tranquilo; puede sonar a superhéroe |

**Reglas:** simple, geométrico y vectorial. Reconocible de 16 a 1024 px. Una sola tinta, en positivo y negativo. Sin copiar máscaras de luchadores reales. Nada de candados, escudos policiales ni ojos que vigilan. El ícono no lleva texto.

**Pendiente tras elegir:** pulir el logo; hacer logo horizontal e isotipo en versiones clara, oscura y monocroma; generar ícono `.ico` y PNG. El `.icns` queda fuera porque el proyecto es solo Windows.

## Color

Valores en `brand/tokens.json`. Compruébalos con `tools/revisar_contraste.py`.

- **Marca:** índigo profundo, `#3A3590` en claro y `#B5B0FF` en oscuro.
- **Riesgo, reservado solo para advertencias:** alto rojo, medio ámbar, bajo gris. Elegí gris y no azul para no confundirlo con el índigo.
- **Nunca solo color:** el riesgo siempre lleva ícono y texto. La simulación lo justifica: en modo claro con deuteranopia, rojo y ámbar quedan a solo 4.1 ΔE.

## Tipografía

Máximo dos familias, ambas OFL 1.1 e incluidas en la app, sin CDN.

- **Atkinson Hyperlegible Next:** toda la interfaz.
- **Inter:** cifras y tiempos, con numerales tabulares. "Inter" es nombre reservado según su README: se distribuye sin modificar ni crear subconjuntos.

CI debe comprobar `ñ á é í ó ú ü ¿ ¡` con fontTools, porque no hallé listas oficiales de glifos.

## Tono de voz

Español de México, de "tú", claro y tranquilo. Informa, no regaña ni asusta.

- **Bien:** "Se ve una matrícula. Alguien podría usarla para identificar tu auto o tu casa."
- **Mal:** "¡PELIGRO! Estás exponiendo datos."
- **Errores:** qué pasó, por qué y qué puedes hacer. Nunca códigos ni stack traces en pantalla.
- **Nunca decir:** "seguro para publicar", "es ilegal" o "no queda nada". La revisión es orientativa.
- **Menores:** nunca afirmar una edad. Se dice "Podría haber menores en la foto" y se pide confirmación.

Aviso visible: "Antifaz es una herramienta orientativa y no constituye asesoría legal."

## Iconografía

Propuesta: [Lucide](https://lucide.dev), un solo set de trazo (licencia ISC). Nombres por confirmar en la Fase 1, al instalarlo.

| Categoría | Ícono |
|---|---|
| Caras de terceros | `users` |
| Posibles menores | `baby` |
| Documentos de identidad | `id-card` |
| Información financiera | `credit-card` |
| Boletos y viajes | `plane` |
| Ubicación | `map-pin` |
| Matrículas | `car` |
| Objetos de valor | `gem` |
| Pantallas | `monitor` |
| Contacto personal | `phone` |
| Información médica | `stethoscope` |
| Códigos | `qr-code` |
