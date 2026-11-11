import { describe, expect, it, vi } from 'vitest';
import { esquemaListaPistas, esquemaPosicion, esquemaCoordenadaProxy, LIMITES } from '../../app/shared/contrato';
import type { RespuestaSidecar } from '../../app/main/sidecar';
import { ERROR_VIDEO_NO_ABIERTO, esVideo, Videos } from '../../app/main/videos';

const RUTA = 'C:\\Users\\persona\\videos\\fiesta.mp4';
const abierto: RespuestaSidecar['resultado'] = {
  ok: true,
  datos: {
    video_id: 'v1', ancho: 1920, alto: 1080, duracion_s: 3.0, fps: 30, frames: 90, posiciones: 72,
    proxy_ancho: 852, proxy_alto: 480, tiene_audio: true, pistas_sin_revisar: 1, huella: 'a'.repeat(64),
  },
};

function falso(respuestas: RespuestaSidecar['resultado'][]) {
  const cola = [...respuestas];
  const pedir = vi.fn((_comando: Record<string, unknown>): Promise<RespuestaSidecar> => {
    const resultado = cola.shift();
    if (resultado === undefined) return Promise.resolve({ resultado: { ok: true, datos: {} }, binario: null });
    return Promise.resolve({ resultado, binario: null });
  });
  return { pedir, videos: new Videos(pedir) };
}

describe('esVideo', () => {
  it.each(['a.mp4', 'A.MOV', 'b.m4v', 'c.webm', 'd.mkv', 'C:\\x.y\\z.Mp4'])('%s es video', (ruta) => {
    expect(esVideo(ruta)).toBe(true);
  });
  it.each(['a.jpg', 'video', 'C:\\carpeta.mp4\\foto.png', 'a.mp4.jpg', ''])('%s no es video', (ruta) => {
    expect(esVideo(ruta)).toBe(false);
  });
});

describe('Videos: las rutas no salen de main', () => {
  it('entrega id opaco, solo el nombre y los datos del video', async () => {
    const { videos, pedir } = falso([abierto]);
    const r = await videos.abrir(RUTA);
    expect(pedir).toHaveBeenCalledWith({ tipo: 'abrir_video', ruta: RUTA });
    if (!r.ok) throw new Error('debía abrir');
    expect(r.datos.nombre).toBe('fiesta.mp4');
    expect(JSON.stringify(r.datos)).not.toContain('persona');
    expect(r.datos.id).not.toBe('v1');
    expect(r.datos).toMatchObject({ posiciones: 72, proxyAncho: 852, proxyAlto: 480, pistasSinRevisar: 1, tieneAudio: true });
    expect(videos.sidecarId(r.datos.id)).toEqual({ ok: true, datos: 'v1' });
  });

  it('pasa el error del sidecar tal cual', async () => {
    const error = { codigo: 'VIDEO_DEMASIADO_LARGO', mensaje: 'largo' };
    const { videos } = falso([{ ok: false, error }]);
    expect(await videos.abrir(RUTA)).toEqual({ ok: false, error });
  });

  it('rechaza una respuesta del sidecar fuera de contrato', async () => {
    const { videos } = falso([{ ok: true, datos: { video_id: 'v1' } }]);
    await expect(videos.abrir(RUTA)).rejects.toThrow();
  });

  it('si el sidecar se reinicia, el video ya no está abierto y lo dice', async () => {
    const { videos } = falso([abierto]);
    const r = await videos.abrir(RUTA);
    if (!r.ok) throw new Error('debía abrir');
    videos.alReiniciarSidecar();
    expect(videos.sidecarId(r.datos.id)).toEqual({ ok: false, error: ERROR_VIDEO_NO_ABIERTO });
  });

  it('un id desconocido no está abierto', () => {
    const { videos } = falso([]);
    expect(videos.sidecarId('nada').ok).toBe(false);
    expect(videos.ruta('nada')).toBeUndefined();
  });

  it('cerrar avisa al sidecar y olvida la ruta', async () => {
    const { videos, pedir } = falso([abierto]);
    const r = await videos.abrir(RUTA);
    if (!r.ok) throw new Error('debía abrir');
    await videos.cerrar(r.datos.id);
    expect(pedir).toHaveBeenLastCalledWith({ tipo: 'cerrar_video', video_id: 'v1' });
    expect(videos.ruta(r.datos.id)).toBeUndefined();
  });
});

describe('Contrato de video', () => {
  const pista = (id: string) => ({ pista_id: id, efecto: 'solido', intensidad: 80 });

  it('pistas: límites, repetidas y efecto desconocido', () => {
    expect(esquemaListaPistas.safeParse([]).success).toBe(true);
    expect(esquemaListaPistas.safeParse(Array.from({ length: LIMITES.videoPistas }, (_, i) => pista(String(i)))).success).toBe(true);
    expect(esquemaListaPistas.safeParse(Array.from({ length: LIMITES.videoPistas + 1 }, (_, i) => pista(String(i)))).success).toBe(false);
    expect(esquemaListaPistas.safeParse([pista('a'), pista('a')]).success).toBe(false);
    expect(esquemaListaPistas.safeParse([{ pista_id: 'a', efecto: 'borroso' }]).success).toBe(false);
    expect(esquemaListaPistas.safeParse([{ pista_id: '', efecto: 'solido' }]).success).toBe(false);
    expect(esquemaListaPistas.safeParse(null).success).toBe(false);
  });

  it.each([
    [esquemaPosicion, 0, true], [esquemaPosicion, LIMITES.videoPosicionMax, true],
    [esquemaPosicion, -1, false], [esquemaPosicion, LIMITES.videoPosicionMax + 1, false],
    [esquemaPosicion, 1.5, false], [esquemaPosicion, Number.NaN, false], [esquemaPosicion, Infinity, false], [esquemaPosicion, '3', false], [esquemaPosicion, null, false],
    [esquemaCoordenadaProxy, 0, true], [esquemaCoordenadaProxy, LIMITES.videoProxyLadoMax - 1, true],
    [esquemaCoordenadaProxy, -1, false], [esquemaCoordenadaProxy, LIMITES.videoProxyLadoMax, false],
  ])('%#: rango', (esquema, valor, valido) => {
    expect(esquema.safeParse(valor).success).toBe(valido);
  });
});
