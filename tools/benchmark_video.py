# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "torch==2.9.*",
#   "torchvision==0.24.*",
#   "timm>=1,<2",
#   "transformers==5.22.1",
#   "opencv-contrib-python-headless>=4.10,<5",
#   "numpy>=2,<3",
#   "pillow>=11,<13",
#   "psutil>=6,<8",
# ]
# ///
"""Benchmark de la Fase 3: ¿cuánto cuesta seguir un objeto en video con este CPU, y cuánto se escapa?

Uso, desde la raíz del repo (descarga los modelos la primera vez):

    py -3.12 -m uv run tools/benchmark_video.py --hilos 4 --salida docs/benchmark_video.json

Genera un video sintético con una cara que se mueve, así se conoce la respuesta correcta en cada
frame. Por cada método y fps de tracking mide tiempo por frame, minutos por minuto de video,
memoria pico y, lo que importa para privacidad, en cuántos frames la zona oculta deja ver parte
de la cara. Cada configuración corre en un subproceso para medir su memoria por separado.

No es parte de la app: es una herramienta para decidir proxy, fps de tracking y duración máxima.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import psutil
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
CARA = RAIZ / "sidecar" / "tests" / "datos" / "astronauta.jpg"
YUNET = RAIZ / "sidecar" / "modelos" / "face_detection_yunet_2023mar.onnx"
FPS_VIDEO = 30
MODELOS_HF = {
    "sam2.1-tiny": ("facebook/sam2.1-hiera-tiny", "de431c4043854a71d8101e17995dfe596bf101a5"),
    "edgetam": ("yonigozlan/EdgeTAM-hf", "c266ce53b3fc00f0f495b583f6a116c4e57f53bb"),
}
METODOS = ["sam2.1-tiny", "edgetam", "csrt", "yunet", "hibrido"]
PASO_HIBRIDO = 4  # mismo default que sidecar/revisor/seguimiento.py


# --- Video sintético con respuesta conocida ---------------------------------------------------


def _sprite(diametro: int) -> tuple[np.ndarray, np.ndarray]:
    """Recorte circular de la cara del astronauta, con su máscara."""
    imagen = np.array(Image.open(CARA).convert("RGB"))
    # Solo la cara: YuNet la ubica en x 178–269, y 63–176 de la foto de 512 px.
    cara = imagen[55:185, 158:288]
    cara = cv2.resize(cara, (diametro, diametro), interpolation=cv2.INTER_AREA)
    yy, xx = np.ogrid[:diametro, :diametro]
    r = diametro / 2
    return cara, (xx - r + 0.5) ** 2 + (yy - r + 0.5) ** 2 <= r * r


def _trayectoria(t: float, segundos: float, ancho: int, alto: int, base: int) -> tuple[float, float, float]:
    """Centro y escala en el segundo t: cruza la escena, zigzaguea rápido y al final se acerca."""
    f = t / segundos
    if f < 0.5:  # cruza a paso de peatón
        u = f / 0.5
        cx, cy, esc = ancho * (0.15 + 0.7 * u), alto * (0.55 + 0.05 * math.sin(u * 6)), 1.0
    elif f < 0.8:  # movimiento brusco, como una cámara en mano
        u = (f - 0.5) / 0.3
        cx = ancho * (0.85 - 0.35 * u + 0.08 * math.sin(u * 40))
        cy, esc = alto * (0.5 + 0.12 * math.sin(u * 25)), 1.0
    else:  # zoom: la cara crece
        u = (f - 0.8) / 0.2
        cx, cy, esc = ancho * 0.5, alto * 0.5, 1.0 + 1.2 * u
    return cx, cy, esc


Colocacion = tuple[int, int, int]  # x0, y0 y lado del recorte de la cara en ese frame


def generar_video(
    segundos: float, alto: int, fps_video: int = FPS_VIDEO
) -> tuple[list[np.ndarray], list[np.ndarray], list[Colocacion]]:
    """Frames RGB, la silueta de la cara en cada uno y dónde quedó el recorte."""
    ancho = round(alto * 16 / 9) // 2 * 2
    rng = np.random.default_rng(5)
    fondo = cv2.GaussianBlur(rng.integers(0, 255, (alto, ancho, 3), dtype=np.uint8), (0, 0), alto / 60)
    fondo = cv2.normalize(fondo, None, 40, 220, cv2.NORM_MINMAX)
    # Distractor fijo: otra cara, más chica, que no se debe confundir con la seguida.
    cara_d, mascara_d = _sprite(round(alto * 0.12))
    y, x = round(alto * 0.15), round(ancho * 0.7)
    fondo[y : y + cara_d.shape[0], x : x + cara_d.shape[1]][mascara_d] = cara_d[mascara_d]
    base = round(alto * 0.22)
    frames, verdades, colocaciones = [], [], []
    for i in range(max(1, round(segundos * fps_video))):
        cx, cy, esc = _trayectoria(i / fps_video, segundos, ancho, alto, base)
        cara, mascara = _sprite(max(8, round(base * esc)))
        lado = cara.shape[0]
        x0, y0 = round(cx - lado / 2), round(cy - lado / 2)
        frame = fondo.copy()
        verdad = np.zeros((alto, ancho), dtype=bool)
        # Recorte por si la cara toca el borde.
        fx0, fy0 = max(0, x0), max(0, y0)
        fx1, fy1 = min(ancho, x0 + lado), min(alto, y0 + lado)
        sub = mascara[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0]
        frame[fy0:fy1, fx0:fx1][sub] = cara[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0][sub]
        verdad[fy0:fy1, fx0:fx1] = sub
        frames.append(frame)
        verdades.append(verdad)
        colocaciones.append((x0, y0, lado))
    return frames, verdades, colocaciones


def llevar(seleccion: np.ndarray, colocacion: Colocacion, forma: tuple[int, int]) -> np.ndarray:
    """Pone en un frame lo que se eligió en el recorte del frame 0, con el movimiento conocido."""
    x0, y0, lado = colocacion
    escalada = cv2.resize(seleccion.astype(np.uint8), (lado, lado), interpolation=cv2.INTER_NEAREST).astype(bool)
    salida = np.zeros(forma, dtype=bool)
    fx0, fy0 = max(0, x0), max(0, y0)
    fx1, fy1 = min(forma[1], x0 + lado), min(forma[0], y0 + lado)
    if fx1 > fx0 and fy1 > fy0:
        salida[fy0:fy1, fx0:fx1] = escalada[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0]
    return salida


# --- Métodos de seguimiento -------------------------------------------------------------------


def _caja(m: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _mascara_de_caja(caja: tuple[float, float, float, float], forma: tuple[int, int]) -> np.ndarray:
    m = np.zeros(forma, dtype=bool)
    x0, y0, x1, y1 = (round(v) for v in caja)
    m[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)] = True
    return m


def seguir_sam(nombre: str, frames: list[np.ndarray], punto: tuple[int, int]) -> tuple[dict[int, np.ndarray], float]:
    import torch
    from transformers import EdgeTamVideoModel, Sam2VideoModel, Sam2VideoProcessor

    repo, revision = MODELOS_HF[nombre]
    clase = Sam2VideoModel if nombre.startswith("sam2") else EdgeTamVideoModel
    modelo = clase.from_pretrained(repo, revision=revision).to("cpu").eval()
    procesador = Sam2VideoProcessor.from_pretrained(repo, revision=revision)
    inicio = time.perf_counter()
    with torch.inference_mode():
        sesion = procesador.init_video_session(video=frames, inference_device="cpu", dtype=torch.float32)
        procesador.add_inputs_to_inference_session(
            inference_session=sesion, frame_idx=0, obj_ids=1,
            input_points=[[[list(punto)]]], input_labels=[[[1]]],
        )
        modelo(inference_session=sesion, frame_idx=0)
        mascaras: dict[int, np.ndarray] = {}
        for salida in modelo.propagate_in_video_iterator(sesion):
            m = procesador.post_process_masks(
                [salida.pred_masks], original_sizes=[[sesion.video_height, sesion.video_width]]
            )[0]
            mascaras[salida.frame_idx] = m[0, 0].numpy().astype(bool)
    return mascaras, time.perf_counter() - inicio


def seguir_csrt(frames: list[np.ndarray], caja0: tuple[int, int, int, int]) -> tuple[dict[int, np.ndarray], float]:
    rastreador = cv2.legacy.TrackerCSRT_create()
    x0, y0, x1, y1 = caja0
    inicio = time.perf_counter()
    rastreador.init(cv2.cvtColor(frames[0], cv2.COLOR_RGB2BGR), (x0, y0, x1 - x0, y1 - y0))
    forma = frames[0].shape[:2]
    mascaras = {0: _mascara_de_caja(caja0, forma)}
    previa = caja0
    for i, frame in enumerate(frames[1:], start=1):
        ok, (x, y, w, h) = rastreador.update(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
        # Si lo pierde, conserva la última caja: es lo que haría la app antes de marcar para revisión.
        caja = (x, y, x + w, y + h) if ok else previa
        previa = caja
        mascaras[i] = _mascara_de_caja(caja, forma)
    return mascaras, time.perf_counter() - inicio


def seguir_hibrido(frames: list[np.ndarray], punto: tuple[int, int]) -> tuple[dict[int, np.ndarray], float]:
    """Usa el SeguidorHibrido del sidecar (EdgeTAM en keyframes + CSRT)."""
    import sys

    sidecar = str(RAIZ / "sidecar")
    if sidecar not in sys.path:
        sys.path.insert(0, sidecar)
    from revisor.seguimiento import PASO_CLAVE_DEFAULT, Punto, SeguidorEdgeTam, SeguidorHibrido

    assert PASO_CLAVE_DEFAULT == PASO_HIBRIDO
    edgetam = SeguidorEdgeTam(RAIZ / "sidecar" / "modelos")
    hibrido = SeguidorHibrido(edgetam, paso=PASO_HIBRIDO)
    inicio = time.perf_counter()
    mascaras = hibrido.seguir(frames, 0, Punto(punto[0], punto[1]))
    return mascaras, time.perf_counter() - inicio


def seguir_yunet(frames: list[np.ndarray], caja0: tuple[int, int, int, int]) -> tuple[dict[int, np.ndarray], float]:
    """Detecta caras en cada frame y se queda con la más cercana a la anterior. No es tracking."""
    alto, ancho = frames[0].shape[:2]
    detector = cv2.FaceDetectorYN.create(str(YUNET), "", (ancho, alto), 0.25)
    previa = caja0
    mascaras = {}
    inicio = time.perf_counter()
    for i, frame in enumerate(frames):
        _, caras = detector.detect(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
        if caras is not None and len(caras) > 0:
            cx, cy = (previa[0] + previa[2]) / 2, (previa[1] + previa[3]) / 2
            mejor = min(caras, key=lambda c: (c[0] + c[2] / 2 - cx) ** 2 + (c[1] + c[3] / 2 - cy) ** 2)
            x, y, w, h = mejor[:4]
            # El mismo ×1.3 que usa la app para las caras.
            previa = (x - 0.15 * w, y - 0.15 * h, x + 1.15 * w, y + 1.15 * h)
        mascaras[i] = _mascara_de_caja(previa, (alto, ancho))
    return mascaras, time.perf_counter() - inicio


# --- Medición ---------------------------------------------------------------------------------


def _margen(m: np.ndarray) -> int:
    caja = _caja(m)
    if caja is None:
        return 8
    return max(8, math.ceil(min(caja[2] - caja[0], caja[3] - caja[1]) * 0.10))


def _dilatar(m: np.ndarray, margen: int) -> np.ndarray:
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margen + 1, 2 * margen + 1))
    return cv2.dilate(m.astype(np.uint8), nucleo).astype(bool)


def _desplazar(m: np.ndarray, dx: float, dy: float) -> np.ndarray:
    matriz = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(m.astype(np.uint8), matriz, (m.shape[1], m.shape[0]), flags=cv2.INTER_NEAREST).astype(bool)


def _centro(m: np.ndarray) -> tuple[float, float]:
    ys, xs = np.nonzero(m)
    return (float(xs.mean()), float(ys.mean())) if xs.size else (0.0, 0.0)


def zona_en(t: int, rastreados: dict[int, np.ndarray]) -> np.ndarray:
    """Entre dos frames rastreados: las dos máscaras movidas hacia t, unidas y con margen."""
    indices = sorted(rastreados)
    if t in rastreados:
        m = rastreados[t]
        return _dilatar(m, _margen(m))
    a = max((i for i in indices if i < t), default=indices[0])
    b = min((i for i in indices if i > t), default=indices[-1])
    ma, mb = rastreados[a], rastreados[b]
    (xa, ya), (xb, yb) = _centro(ma), _centro(mb)
    u = (t - a) / (b - a) if b != a else 0.0
    union = _desplazar(ma, (xb - xa) * u, (yb - ya) * u) | _desplazar(mb, (xa - xb) * (1 - u), (ya - yb) * (1 - u))
    return _dilatar(union, max(_margen(ma), _margen(mb)))


@dataclass
class Resultado:
    metodo: str
    fps_tracking: int
    lado_proxy: int
    hilos: int
    frames_video: int
    frames_rastreados: int
    s_por_frame_rastreado: float
    minutos_por_minuto_de_video: float
    segundos_por_video: float
    memoria_pico_mb: float
    frames_con_algo_visible_pct: float
    peor_frame_visible_pct: float
    cobertura_media_pct: float
    cara_elegida_en_frame0_pct: float


def correr(metodo: str, fps: int, proxy: int, segundos: float, hilos: int, fps_video: int = FPS_VIDEO) -> Resultado:
    import torch

    torch.set_num_threads(hilos)
    torch.set_num_interop_threads(1)
    cv2.setNumThreads(hilos)
    frames, verdades, colocaciones = generar_video(segundos, proxy, fps_video)
    paso = max(1, round(fps_video / fps))
    indices = list(range(0, len(frames), paso))
    sub = [frames[i] for i in indices]
    caja0 = _caja(verdades[0])
    assert caja0 is not None
    centro0 = (round((caja0[0] + caja0[2]) / 2), round((caja0[1] + caja0[3]) / 2))
    match metodo:
        case "sam2.1-tiny" | "edgetam":
            locales, segundos_cpu = seguir_sam(metodo, sub, centro0)
        case "csrt":
            locales, segundos_cpu = seguir_csrt(sub, caja0)
        case "yunet":
            locales, segundos_cpu = seguir_yunet(sub, caja0)
        case "hibrido":
            locales, segundos_cpu = seguir_hibrido(sub, centro0)
        case _:
            raise SystemExit(f"método desconocido: {metodo}")
    rastreados = {indices[k]: m for k, m in locales.items()}
    # Lo que se debe ocultar es lo que el método eligió en el frame 0, dentro de la cara: así se mide
    # el seguimiento y no la ambigüedad del clic (SAM puede elegir solo la piel, no el pelo).
    x0, y0, lado = colocaciones[0]
    seleccion = rastreados[0][y0 : y0 + lado, x0 : x0 + lado] & verdades[0][y0 : y0 + lado, x0 : x0 + lado]
    if not seleccion.any():
        raise SystemExit("el método no eligió nada de la cara en el frame 0")
    visibles, coberturas = [], []
    forma = frames[0].shape[:2]
    for t in range(len(frames)):
        verdad = llevar(seleccion, colocaciones[t], forma)
        total = int(verdad.sum())
        if total == 0:
            continue
        fuera = int((verdad & ~zona_en(t, rastreados)).sum())
        visibles.append(fuera / total)
        coberturas.append(1 - fuera / total)
    s_frame = segundos_cpu / len(sub)
    return Resultado(
        metodo=metodo, fps_tracking=fps, lado_proxy=proxy, hilos=hilos,
        frames_video=len(frames), frames_rastreados=len(sub),
        s_por_frame_rastreado=round(s_frame, 4),
        minutos_por_minuto_de_video=round(s_frame * fps * 60 / 60, 2),
        segundos_por_video=round(segundos_cpu, 1),
        memoria_pico_mb=round(psutil.Process().memory_info().peak_wset / 2**20 if os.name == "nt" else 0, 0),
        # Un píxel de diferencia en el borde no cuenta: es ruido de redondeo.
        frames_con_algo_visible_pct=round(100 * sum(v > 0.005 for v in visibles) / len(visibles), 1),
        peor_frame_visible_pct=round(100 * max(visibles), 1),
        cobertura_media_pct=round(100 * float(np.mean(coberturas)), 2),
        cara_elegida_en_frame0_pct=round(100 * float(seleccion.sum()) / float(verdades[0].sum()), 1),
    )


def _fijar_nucleos(hilos: int) -> None:
    """Un núcleo físico por hilo: en CPUs con hyperthreading los lógicos pares son núcleos distintos."""
    logicos = psutil.cpu_count(logical=True) or hilos
    fisicos = psutil.cpu_count(logical=False) or hilos
    paso = 2 if logicos >= 2 * fisicos else 1
    psutil.Process().cpu_affinity(list(range(0, min(logicos, hilos * paso), paso))[:hilos])


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--hilos", type=int, default=4, help="núcleos a usar; 4 imita el i5-10210U de referencia")
    p.add_argument("--segundos", type=float, default=10.0)
    p.add_argument("--fps-video", type=int, default=FPS_VIDEO, help="fps del video sintético")
    p.add_argument("--fps", type=int, nargs="+", default=[5, 10])
    p.add_argument("--proxy", type=int, nargs="+", default=[480])
    p.add_argument("--metodos", nargs="+", choices=METODOS, default=METODOS)
    p.add_argument("--salida", type=Path, default=None)
    p.add_argument("--una", nargs=3, metavar=("METODO", "FPS", "PROXY"), help=argparse.SUPPRESS)
    a = p.parse_args()
    if not 1 <= a.hilos <= 256 or not 0 < a.segundos <= 600 or not 1 <= a.fps_video <= 240:
        p.error("hilos de 1 a 256, segundos de más de 0 a 600 y fps del video de 1 a 240")
    if any(not 1 <= f <= a.fps_video for f in a.fps):
        p.error("cada fps de tracking va de 1 al fps del video")
    _fijar_nucleos(a.hilos)

    if a.una is not None:
        metodo, fps, proxy = a.una[0], int(a.una[1]), int(a.una[2])
        print(json.dumps(asdict(correr(metodo, fps, proxy, a.segundos, a.hilos, a.fps_video))))
        return 0

    resultados: list[dict[str, Any]] = []
    for metodo in a.metodos:
        for proxy in a.proxy:
            for fps in a.fps:
                print(f"… {metodo}, {fps} fps, proxy {proxy}", flush=True)
                hecho = subprocess.run(
                    [sys.executable, __file__, "--una", metodo, str(fps), str(proxy),
                     "--hilos", str(a.hilos), "--segundos", str(a.segundos), "--fps-video", str(a.fps_video)],
                    capture_output=True, text=True, encoding="utf-8",
                )
                if hecho.returncode != 0:
                    print(f"   falló: {hecho.stderr.strip().splitlines()[-1:]}", flush=True)
                    resultados.append({"metodo": metodo, "fps_tracking": fps, "lado_proxy": proxy, "error": hecho.stderr[-2000:]})
                    continue
                r = json.loads(hecho.stdout.strip().splitlines()[-1])
                resultados.append(r)
                print(f"   {r['s_por_frame_rastreado']} s/frame, {r['segundos_por_video']} s por video, "
                      f"algo visible en {r['frames_con_algo_visible_pct']}% de frames", flush=True)

    equipo = {
        "cpu": platform.processor(),
        "nucleos_fisicos": psutil.cpu_count(logical=False),
        "nucleos_logicos": psutil.cpu_count(logical=True),
        "ram_gb": round(psutil.virtual_memory().total / 2**30, 1),
        "hilos_usados": a.hilos,
        "segundos_de_video": a.segundos,
        "fps_video": a.fps_video,
        "modelos": MODELOS_HF,
    }
    informe = {"equipo": equipo, "resultados": resultados}
    if a.salida is not None:
        a.salida.write_text(json.dumps(informe, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(informe, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
