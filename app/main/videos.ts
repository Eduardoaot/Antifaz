/**
 * Videos abiertos. Solo aquí viven las rutas: el renderer recibe un id opaco.
 *
 * A diferencia de las fotos, un video no se reabre solo si el sidecar se reinicia: el seguimiento
 * vive en memoria y tarda minutos. Si se pierde, se dice, y la persona vuelve a abrirlo.
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { esquemaVideoAbierto, type ErrorApp, type Resultado, type VideoInfo } from '../shared/contrato';
import type { RespuestaSidecar } from './sidecar';

const nombreDeRuta = (ruta: string): string => ruta.split(/[/\\]/).pop() || basename(ruta);

export const ERROR_VIDEO_NO_ABIERTO: ErrorApp = {
  codigo: 'VIDEO_NO_ABIERTO',
  mensaje: 'Este video ya no está abierto. Vuelve a abrirlo; lo que habías elegido se perdió.',
};

/** Extensiones que se abren como video. El resto se intenta como foto. */
export const EXTENSIONES_VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'mkv'] as const;

export function esVideo(ruta: string): boolean {
  const punto = ruta.lastIndexOf('.');
  if (punto < 0) return false;
  const extension = ruta.slice(punto + 1).toLowerCase();
  return (EXTENSIONES_VIDEO as readonly string[]).includes(extension);
}

interface Registro {
  ruta: string;
  sidecarId: string | null;
}

type Pedir = (comando: Record<string, unknown>) => Promise<RespuestaSidecar>;

export class Videos {
  private registros = new Map<string, Registro>();

  constructor(private readonly pedir: Pedir) {}

  async abrir(ruta: string): Promise<Resultado<VideoInfo>> {
    const { resultado } = await this.pedir({ tipo: 'abrir_video', ruta });
    if (!resultado.ok) return resultado;
    const datos = esquemaVideoAbierto.parse(resultado.datos);
    const id = randomUUID();
    this.registros.set(id, { ruta, sidecarId: datos.video_id });
    return {
      ok: true,
      datos: {
        id,
        nombre: nombreDeRuta(ruta),
        ancho: datos.ancho,
        alto: datos.alto,
        duracion: datos.duracion_s,
        fps: datos.fps,
        frames: datos.frames,
        posiciones: datos.posiciones,
        proxyAncho: datos.proxy_ancho,
        proxyAlto: datos.proxy_alto,
        tieneAudio: datos.tiene_audio,
        pistasSinRevisar: datos.pistas_sin_revisar,
      },
    };
  }

  sidecarId(id: string): Resultado<string> {
    const registro = this.registros.get(id);
    if (registro?.sidecarId == null) return { ok: false, error: ERROR_VIDEO_NO_ABIERTO };
    return { ok: true, datos: registro.sidecarId };
  }

  ruta(id: string): string | undefined {
    return this.registros.get(id)?.ruta;
  }

  nombre(id: string): string | undefined {
    const ruta = this.ruta(id);
    return ruta === undefined ? undefined : nombreDeRuta(ruta);
  }

  alReiniciarSidecar(): void {
    for (const registro of this.registros.values()) registro.sidecarId = null;
  }

  async cerrar(id: string): Promise<void> {
    const registro = this.registros.get(id);
    this.registros.delete(id);
    if (registro?.sidecarId != null) await this.pedir({ tipo: 'cerrar_video', video_id: registro.sidecarId });
  }
}
