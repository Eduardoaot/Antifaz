# Marca de Antifaz

Estado: aprobada por el responsable del proyecto el 3 de noviembre de 2026 (logo B, eslogan propio e índigo).

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

**"Comparte lo que quieres que vean"**

## Logo

**Elegido: B, un antifaz dentro de las esquinas de un encuadre de foto.** Las esquinas van sueltas para no parecerse al ícono de cámara de Instagram. Los otros bocetos siguen en `brand/sketches/`.

| Archivo | Uso |
|---|---|
| `brand/logo/horizontal-{claro,oscuro,mono-negro,mono-blanco}.svg` | Símbolo + nombre. El texto está en trazos |
| `brand/logo/isotipo-{claro,oscuro,mono-negro,mono-blanco}.svg` | Solo el símbolo |
| `brand/logo/isotipo-16.svg` | Dibujo propio para 16 px, en cuadrícula de píxeles |
| `brand/icon/icono-{16...1024}.png` e `icono.ico` | Ícono de la app, sin texto, sobre mosaico índigo |

**Tamaño chico:** a 16 px el dibujo grande se empasta, así que ese tamaño usa un dibujo propio.

**Regenerar:** todo sale de `tools/generar_logo.py`, que lee el nombre de `brand.json`.

**Reglas:** simple, geométrico y vectorial. Reconocible de 16 a 1024 px. Una sola tinta, en positivo y negativo. Sin copiar máscaras de luchadores reales. Nada de candados, escudos policiales ni ojos que vigilan. El ícono no lleva texto. El `.icns` queda fuera porque el proyecto es solo Windows.

## Color

Valores en `brand/tokens.json`. Compruébalos con `tools/revisar_contraste.py`.

- **Marca:** índigo profundo, `#3A3590` en claro y `#B5B0FF` en oscuro.
- **Riesgo, reservado solo para advertencias:** alto rojo, medio ámbar, bajo gris. Elegí gris y no azul para no confundirlo con el índigo.
- **Nunca solo color:** el riesgo siempre lleva ícono y texto. La simulación lo justifica: en modo claro con deuteranopia, rojo y ámbar quedan a solo 4.1 ΔE.
- **Neutros (ajuste del 8 de noviembre de 2026, decisión del responsable):** el índigo y el riesgo no cambian.
  - Superficies casi neutras en oscuro (`#121219`, `#1B1B26`): el violeta saturado en áreas grandes cansaba la vista. El índigo se queda en lo que se acciona: botón principal, foco y selección.
  - `superficie-2` para campos y filas dentro de un panel.
  - Dos bordes: `borde-control` (3:1) solo en botones y campos; `borde-sutil`, decorativo y sin mínimo, en cajas y separadores.
  - `lienzo`: gris medio-oscuro sin tinte detrás de la foto, `#2B2B2E` en los dos temas, como en los editores de fotos. Un fondo con tinte desplaza cómo se perciben la piel y los tonos, y uno claro hace que la foto se vea más apagada. Es decorativo: no tiene mínimo de contraste.
  - Una confirmación positiva, como "copia guardada", va en índigo con ícono, nunca en verde: el verde se lee como "seguro", y la marca no promete eso.

## Tipografía

Una sola familia en la interfaz, OFL 1.1 e incluida en la app, sin CDN. Decisión del responsable (2026-11-08): antes la interfaz usaba Atkinson Hyperlegible Next e Inter solo para cifras.

- **Inter:** toda la interfaz. Cifras y tiempos con numerales tabulares. "Inter" es nombre reservado según su README: se distribuye sin modificar ni crear subconjuntos.
- **Atkinson Hyperlegible Next:** ya no se usa en la interfaz. Se conserva en `brand/fonts/` porque `tools/generar_logo.py` dibuja con ella el texto del logotipo, y las pruebas de OCR y las muestras E2E la usan para dibujar texto.

Archivos y licencias en `brand/fonts/`. Comprobado con fontTools: ambas incluyen `ñ á é í ó ú ü ¿ ¡` y sus mayúsculas.

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
