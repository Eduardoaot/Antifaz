# Reporte de QA: Fase 3 (en curso)

Fecha: 6 de noviembre de 2026. Equipo de referencia: Intel i5-10210U (4 núcleos, 8 hilos), 16 GB de RAM, sin GPU, Windows 11.

**La fase no está terminada.** El video ya está en la app: se abre, se elige con un clic lo que se quiere ocultar, EdgeTAM lo sigue y se exporta un MP4. **Nunca se ha probado con FFmpeg real**, porque el sistema de permisos impide que el asistente lo ejecute: la primera prueba con un video real la hace el responsable.

## Decisiones del responsable (6 de noviembre de 2026)

- **Beta:** videos de hasta **3 segundos**, con seguimiento a **24 fps** (hasta 72 frames rastreados). Si el video trae menos fps, se rastrea cada frame.
- **Tolerancia:** se acepta un frame de más sobre los 3 s, con tope de 0.05 s, porque un clip "de 3 s" del teléfono suele durar 3.003 s.
- **Método de seguimiento:** EdgeTAM, con el benchmark de abajo.

## Benchmark en el equipo de referencia

`tools/benchmark_video.py`, con 4 núcleos y proxy de 480 px. Video sintético de 3 s a 24 fps, rastreando los 72 frames. Resultados en `docs/benchmark_video.json`.

| Método | Segundos por frame | Segundos por video de 3 s | Memoria pico | Frames con algo visible | Peor frame |
|---|---|---|---|---|---|
| SAM 2.1 tiny | 6.74 | 486 (8.1 min) | 2.8 GB | 0% | 0% |
| EdgeTAM | 1.85 | 133 (2.2 min) | 2.6 GB | 0% | 0% |
| CSRT | 0.037 | 2.6 | 0.4 GB | 0% | 0% |
| YuNet en cada frame | 0.033 | 2.4 | 0.4 GB | 28% | 100% |

**Cómo leerlo:**
- Con 24 fps el objeto se mueve poco entre frames, así que SAM 2.1, EdgeTAM y CSRT no dejaron nada visible. En la prueba corta anterior, con menos fps, se escapaba entre 20% y 35%.
- YuNet no sirve sola: es un detector de caras, y cuando no detecta la cara en un frame, ese frame queda destapado completo.
- **El video sintético es un caso fácil:** una cara sobre un fondo difuminado, sin oclusiones, giros ni cambios de luz. Ahí es donde CSRT, que sigue una caja por apariencia, suele fallar en video real, y donde SAM y EdgeTAM son más robustos. Hasta medir con videos reales, el 0% de CSRT no prueba que funcione en la práctica.
- SAM 2.1 eligió solo 60% de la cara con el clic del frame 0. EdgeTAM eligió 99%.
- CSRT no viene en el OpenCV del sidecar: requiere cambiar a `opencv-contrib-python-headless` (Apache-2.0). EdgeTAM y SAM 2.1 requieren PyTorch.

Corrida parcial anterior, de 10 s, detenida al cambiar la decisión: SAM 2.1 tardó 5.6 s por frame a 5 fps y 7.3 s a 10 fps.

**Elegido: EdgeTAM.**

## Lo que ya está

| Pieza | Qué hace | Pruebas |
|---|---|---|
| `tools/descargar_modelos.py` | Descarga FFmpeg 9.0.2 (build de gyan.dev, GPL-3.0) y exiftool 13.61 con el hash que publica cada proyecto. `--zips CARPETA` instala desde zips descargados a mano | n/a |
| `sidecar/revisor/herramientas.py` | Antes de ejecutar, verifica el hash del binario y del árbol de scripts de exiftool. Ejecuta sin shell, con `file:` y `-protocol_whitelist file,pipe`, entorno mínimo y tiempo máximo. Lee y escribe frames por tubería: los frames sin ocultar nunca tocan el disco (SEG-004). La salida de error de la herramienta nunca va al log | `test_herramientas.py`, `test_herramientas_tuberias.py` |
| `sidecar/revisor/video.py` | Interpreta ffprobe y valida contra `qa/RANGOS.md`. Rechaza más de una pista de video, rotaciones que no sean múltiplo de 90° y contenedores fuera de la lista | `test_video.py` |
| `sidecar/revisor/pistas.py` | Zona oculta por frame a partir de cualquier método. Interpola entre frames rastreados; si el objeto se pierde, oculta la caja que cubre las dos posiciones conocidas y lo marca para revisión; agrega `pista.margen_frames` antes y después. Al escalar del proxy, nada cubierto queda fuera | `test_pistas.py` |
| `sidecar/revisor/seguimiento.py` | EdgeTAM detrás de la interfaz `Seguidor`. Antes de cargar los pesos verifica el hash de sus cinco archivos y los carga sin red. Sigue el objeto desde un punto o una caja en cualquier frame, hacia adelante y hacia atrás, e informa el avance. Si un frame queda sin máscara, es un error y no se toma como "sin objeto" | `test_seguimiento.py`, con una corrida real en un subproceso con la red bloqueada |
| `sidecar/revisor/video_app.py` | Abrir (huella, ffprobe y proxy en memoria), vista de un frame con las zonas ocultas, seguir, quitar y exportar. La exportación decodifica a resolución completa por tubería, oculta cada frame con los mismos efectos que en fotos, codifica H.264 y AAC sin metadatos a un temporal, lo revisa con `metadatos_video.py`, exiftool y ffprobe, y solo entonces lo renombra. Si cambió el original o salen más o menos frames, no se guarda nada | `test_video_app.py` |
| App (`ModoVideo.tsx`, `videos.ts`, canales `video:*`) | Botón **Video**, clic para seguir, coordenadas sin mouse, efecto por objeto, aviso de frames por revisar, cancelar y exportar. Dice que en video no hay detección automática | `videos.test.ts`, E2E del modo de video |
| `sidecar/revisor/metadatos_video.py` | Revisa los bytes del MP4 exportado con lista blanca de cajas. Rechaza `udta`, `meta`, `uuid`, `©xyz` (GPS), fechas distintas de cero, pistas que no sean de video o audio, nombre de compresor y perfiles ICC | `test_metadatos_video.py` |

## Resultados

| Prueba | Resultado |
|---|---|
| Sidecar | 852 pasan (333 nuevas). La corrida real de EdgeTAM tarda 64 s |
| Interfaz y main | 218 pasan |
| Tipado estricto y lint | Sin errores |
| E2E | 41 pasan y 4 se omiten (ejemplos locales del responsable). Las de video no abren un video, para no ejecutar FFmpeg |
| Capturas | Modo de video vacío en claro y oscuro, revisadas |

Corrida del 6 de noviembre de 2026 en el i5-10210U. **CI no ha corrido** porque no hay commit.

## Bloqueos

1. **Ejecutar FFmpeg y exiftool reales:** el sistema de permisos bloqueó ejecutar los binarios descargados. Sin eso no se ha confirmado que la salida real de FFmpeg (`-map_metadata -1 -fflags +bitexact`) pase el verificador MP4, ni probado ffprobe con videos reales. Si no pasa, la exportación falla cerrada y se ajusta la lista. Las pruebas de tuberías usan un Python verificado por hash como FFmpeg falso.
2. **Rutas largas con `file:`:** falta confirmar que FFmpeg acepta `file:\\?\C:\...`.

## Pendiente

1. **Primera prueba con FFmpeg real**, a cargo del responsable: abrir un video de hasta 3 s, seguir un objeto y exportar. Si la exportación falla con "No pudimos comprobar que el archivo saliera limpio", es probable que FFmpeg escriba una caja que la lista blanca no conoce: se revisa el log y se ajusta la lista, sin relajar la regla.
2. Confirmar rutas largas y con acentos con FFmpeg y exiftool.
3. Sin barra de avance real durante el seguimiento: el protocolo es de pedido y respuesta. Se muestra el tiempo estimado y se puede cancelar.
4. Casos de la matriz: ARC-024 (GIF), ARC-031 (Live Photo), ARC-042 (video dañado a la mitad), SEG-004, SEG-008 y FCL-008 con FFmpeg real.
5. Detección automática en video (caras, texto y placas): Fase 4.
