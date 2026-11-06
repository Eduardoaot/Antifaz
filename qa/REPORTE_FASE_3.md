# Reporte de QA: Fase 3 (recién empezada)

Fecha: 6 de noviembre de 2026.

**La fase apenas empieza.** Como pide `qa/PLAN_QA.md`, arranca con un benchmark de seguimiento en video. Todavía no hay código de video en la app.

## Benchmark de seguimiento

`tools/benchmark_video.py` genera un video sintético con una cara que cruza la escena, se mueve brusco y se acerca. Como se conoce dónde está la cara en cada frame, mide además del tiempo lo que importa para privacidad: en cuántos frames la zona oculta deja ver parte de lo que se eligió en el frame 0.

Compara cuatro métodos:
- SAM 2.1 tiny y EdgeTAM, con Transformers y PyTorch, ambos Apache-2.0 y con la revisión fijada.
- CSRT de OpenCV.
- YuNet detectando caras en cada frame.

Corre con su propio entorno (`uv run`), así que no cambia las dependencias del sidecar.

```
py -3.12 -m uv run tools/benchmark_video.py --hilos 4 --segundos 10 --fps 5 10 15 --salida docs/benchmark_video.json
```

**Corrida completa: pendiente.** Se detuvo a pedido antes de terminar.

**Prueba corta, solo para validar el script:** 2 s de video a 10 fps de tracking, con 4 núcleos de un i7-13700KF. El movimiento es exagerado, porque la cara cruza la pantalla en un segundo. **No sirve para decidir.**

| Método | Segundos por frame | Minutos por minuto de video | Frames con algo visible |
|---|---|---|---|
| SAM 2.1 tiny | 3.29 | 33 | 22% |
| EdgeTAM | 0.75 | 7.5 | 20% |
| CSRT | 0.017 | 0.2 | 35% |
| YuNet | 0.010 | 0.1 | 42% |

## Pendiente

1. Correr el benchmark completo **en el i5-10210U de referencia**. Este equipo es varias veces más rápido, y limitarlo a 4 núcleos solo es una aproximación.
2. Con esos números, el responsable elige el método y fija proxy, fps de tracking y duración máxima en `qa/RANGOS.md`.
3. Conseguir FFmpeg, ffprobe y exiftool con hash fijado. Todavía no están en el proyecto.
