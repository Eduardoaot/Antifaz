/**
 * Contrato entre renderer, main y sidecar. Zod aquí da respuesta rápida; el sidecar valida de nuevo.
 * Los límites vienen de qa/RANGOS.md.
 */
import { z } from 'zod';

export const LIMITES = {
  ladoMax: 30000,
  intensidad: { min: 1, max: 100, porDefecto: 80, avisoBaja: 30 },
  dilatacionPx: { min: 8, max: 512, porDefecto: 8 },
  dilatacionPct: { min: 0, max: 50, porDefecto: 10 },
  loteArchivos: 500,
  ocultamientos: 5000,
  jpegCalidad: { min: 60, max: 100, porDefecto: 92 },
  ladoVista: 1600,
  pincel: { min: 1, max: 512, porDefecto: 32 },
  puntosTrazo: 5000,
  // Video (Fase 3). Coinciden con sidecar/revisor/esquemas.py.
  videoPistas: 50,
  videoPosicionMax: 999,
  videoProxyLadoMax: 4096,
} as const;

/**
 * Cada emoji es un efecto propio: así la recuperación, las zonas manuales y el video lo aceptan igual.
 * Coinciden con TipoEmoji de sidecar/revisor/esquemas.py. Se dibujan sobre bloque sólido.
 */
export const EMOJIS = ['emoji_sonrisa', 'emoji_lentes', 'emoji_gato', 'emoji_estrella'] as const;
export type Emoji = (typeof EMOJIS)[number];

export const esquemaEfecto = z.enum(['solido', 'difuminado', 'pixelado', ...EMOJIS] as const);
export type Efecto = z.infer<typeof esquemaEfecto>;

export const esEmoji = (e: Efecto): e is Emoji => (EMOJIS as readonly string[]).includes(e);

export const ETIQUETA_EMOJI: Readonly<Record<Emoji, string>> = {
  emoji_sonrisa: '😀 Carita sonriente',
  emoji_lentes: '😎 Carita con lentes',
  emoji_gato: '🐱 Gato',
  emoji_estrella: '⭐ Estrella',
};

export const esquemaTema = z.enum(['sistema', 'claro', 'oscuro']);
export type Tema = z.infer<typeof esquemaTema>;

/** Lo que main avisa al renderer cuando se quiere cerrar con cambios sin exportar. */
export const esquemaAvisoCierre = z.strictObject({
  /** Falso si el último guardado de la recuperación falló: cerrar perdería las decisiones. */
  recuperacionSegura: z.boolean(),
});
export type AvisoCierre = z.infer<typeof esquemaAvisoCierre>;

export const TITULO_CIERRE = 'Tienes cambios sin exportar';
/** Lo usan el aviso de la app y el de Windows, que solo aparece si la interfaz no responde. */
export function textoCierre(recuperacionSegura: boolean): string {
  return recuperacionSegura
    ? 'Si cierras ahora, tus decisiones no se exportan. La próxima vez que abras podrás recuperarlas.'
    : 'Si cierras ahora, tus decisiones no se exportan y se perderán, porque no pudimos guardarlas.';
}

const enteroEnRango = (min: number, max: number) => z.number().int().min(min).max(max);

export const esquemaOcultamiento = z.strictObject({
  x: enteroEnRango(0, LIMITES.ladoMax - 1),
  y: enteroEnRango(0, LIMITES.ladoMax - 1),
  ancho: enteroEnRango(1, LIMITES.ladoMax),
  alto: enteroEnRango(1, LIMITES.ladoMax),
  efecto: esquemaEfecto,
  intensidad: enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max),
  dilatacion_px: enteroEnRango(LIMITES.dilatacionPx.min, LIMITES.dilatacionPx.max),
  dilatacion_pct: z.number().min(LIMITES.dilatacionPct.min).max(LIMITES.dilatacionPct.max),
  mascara_id: z.string().min(1).max(64).nullable(),
});
export type Ocultamiento = z.infer<typeof esquemaOcultamiento>;

export const esquemaListaOcultamientos = z.array(esquemaOcultamiento).max(LIMITES.ocultamientos);

export const esquemaArchivoId = z.uuid();

export const esquemaHallazgo = z.strictObject({
  id: z.string().min(1),
  regla_id: z.string().min(1),
  caja: z
    .strictObject({ x: z.number().int(), y: z.number().int(), ancho: z.number().int(), alto: z.number().int() })
    .nullable(),
  confianza: z.number().min(0).max(1),
  requiere_revision: z.boolean(),
  posicion: z.string().nullable(),
});
export type Hallazgo = z.infer<typeof esquemaHallazgo>;

export const esquemaMotivo = z.enum(['metadatos', 'demasiado_pequena', 'modelo_no_disponible', 'deteccion_fallo', 'contenido_no_disponible', 'contenido_fallo', 'texto_fallo', 'codigos_fallo', 'objetos_no_disponible', 'objetos_fallo']);
export type Motivo = z.infer<typeof esquemaMotivo>;

export const esquemaAnalisis = z.strictObject({
  hallazgos: z.array(esquemaHallazgo),
  cobertura: z.strictObject({
    completa: z.boolean(),
    motivos: z.array(esquemaMotivo),
    reglas_revisadas: z.array(z.string()),
  }),
});
export type Analisis = z.infer<typeof esquemaAnalisis>;

export const esquemaImagenAbierta = z.strictObject({
  imagen_id: z.string().min(1),
  ancho: z.number().int().positive(),
  alto: z.number().int().positive(),
  formato: z.string(),
  tiene_alfa: z.boolean(),
  huella: z.string().length(64),
});

export const esquemaSegmentado = z.strictObject({
  mascara_id: z.string().min(1),
  caja: z.strictObject({ x: z.number().int(), y: z.number().int(), ancho: z.number().int(), alto: z.number().int() }),
});
export type Segmentado = z.infer<typeof esquemaSegmentado>;

const esquemaPunto = z.strictObject({ x: enteroEnRango(0, LIMITES.ladoMax - 1), y: enteroEnRango(0, LIMITES.ladoMax - 1) });
export type Punto = z.infer<typeof esquemaPunto>;

/** Un trazo del pincel, en píxeles de la imagen original. */
export const esquemaTrazo = z.strictObject({
  puntos: z.array(esquemaPunto).min(1).max(LIMITES.puntosTrazo),
  tamano: enteroEnRango(LIMITES.pincel.min, LIMITES.pincel.max),
});

export const esquemaOrigen = z.enum(['rectangulo', 'silueta', 'pincel']);
export type Origen = z.infer<typeof esquemaOrigen>;

export const esquemaExportado = z.strictObject({
  formato: z.string(),
  bytes: z.number().int().positive(),
  zonas_ocultas: z.number().int().nonnegative(),
});

// --- Video (Fase 3) -----------------------------------------------------------------------------

export const esquemaVideoAbierto = z.strictObject({
  video_id: z.string().min(1).max(64),
  ancho: z.number().int().positive(),
  alto: z.number().int().positive(),
  duracion_s: z.number().positive(),
  fps: z.number().positive(),
  frames: z.number().int().positive(),
  posiciones: z.number().int().positive().max(LIMITES.videoPosicionMax + 1),
  proxy_ancho: z.number().int().positive().max(LIMITES.videoProxyLadoMax),
  proxy_alto: z.number().int().positive().max(LIMITES.videoProxyLadoMax),
  tiene_audio: z.boolean(),
  pistas_sin_revisar: z.number().int().nonnegative(),
  huella: z.string().length(64),
});

export const esquemaSeguido = z.strictObject({
  pista_id: z.string().min(1).max(64),
  frames_revisar: z.number().int().nonnegative(),
  posiciones_revisar: z.array(z.number().int().nonnegative()),
  frames_con_objeto: z.number().int().nonnegative(),
  frames_rastreados: z.number().int().positive(),
});

export const esquemaPistaElegida = z.strictObject({ pista_id: z.string().min(1).max(64), efecto: esquemaEfecto });
export type PistaElegida = z.infer<typeof esquemaPistaElegida>;
export const esquemaListaPistas = z
  .array(esquemaPistaElegida)
  .max(LIMITES.videoPistas)
  .refine((lista) => new Set(lista.map((p) => p.pista_id)).size === lista.length, 'pista repetida');

export const esquemaVideoExportado = z.strictObject({
  bytes: z.number().int().positive(),
  pistas_ocultas: z.number().int().nonnegative(),
  frames: z.number().int().positive(),
  frames_revisar: z.number().int().nonnegative(),
});

export const esquemaPosicion = z.number().int().min(0).max(LIMITES.videoPosicionMax);
export const esquemaCoordenadaProxy = z.number().int().min(0).max(LIMITES.videoProxyLadoMax - 1);

export interface VideoInfo {
  id: string;
  /** Solo el nombre, nunca la carpeta. */
  nombre: string;
  ancho: number;
  alto: number;
  duracion: number;
  fps: number;
  frames: number;
  /** Frames que se pueden ver y elegir: los que se rastrean. */
  posiciones: number;
  proxyAncho: number;
  proxyAlto: number;
  tieneAudio: boolean;
  pistasSinRevisar: number;
}

export interface VistaVideo {
  mime: string;
  datos: Uint8Array;
  /** En este frame se perdió un objeto: se ocultó de más y conviene revisarlo. */
  revisar: boolean;
}

export interface Seguido {
  pistaId: string;
  framesRevisar: number;
  posicionesRevisar: number[];
  framesConObjeto: number;
  framesRastreados: number;
}

export interface VideoExportado {
  nombre: string;
  pistasOcultas: number;
  framesRevisar: number;
}

export interface ErrorApp {
  codigo: string;
  mensaje: string;
}
export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: ErrorApp };

export interface ArchivoAbierto {
  id: string;
  /** Solo el nombre, nunca la carpeta: el renderer no conoce rutas. */
  nombre: string;
  ancho: number;
  alto: number;
  formato: string;
  duplicado: boolean;
}

export type ArchivoCargado =
  | { ok: true; archivo: ArchivoAbierto }
  | { ok: false; nombre: string; error: ErrorApp };

export interface Vista {
  mime: string;
  datos: Uint8Array;
}

export interface Exportado {
  nombre: string;
  zonasOcultas: number;
}

export const esquemaDecision = z.enum(['ocultar', 'ignorar']);
export type Decision = z.infer<typeof esquemaDecision>;

/** Ediciones que sobreviven a un cierre de golpe. Nunca lleva píxeles ni rutas al renderer. */
const esquemaManual = z.strictObject({
  id: z.string().min(1).max(64),
  x: enteroEnRango(0, LIMITES.ladoMax - 1),
  y: enteroEnRango(0, LIMITES.ladoMax - 1),
  ancho: enteroEnRango(1, LIMITES.ladoMax),
  alto: enteroEnRango(1, LIMITES.ladoMax),
  efecto: esquemaEfecto,
  mascara_id: z.string().min(1).max(64).nullable(),
  // Opcional: las recuperaciones guardadas antes del pincel no lo traen.
  origen: esquemaOrigen.optional(),
});

export const esquemaEdicion = z.strictObject({
  archivoId: esquemaArchivoId,
  decisiones: z.record(z.string(), esquemaDecision),
  efectos: z.record(z.string(), esquemaEfecto),
  intensidad: enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max),
  hayMenores: z.boolean().nullable(),
  manuales: z.array(esquemaManual).max(LIMITES.ocultamientos).default([]),
});
export type Edicion = z.infer<typeof esquemaEdicion>;

export const esquemaEdiciones = z.array(esquemaEdicion).max(LIMITES.loteArchivos);

export interface Recuperable {
  archivo: ArchivoAbierto;
  edicion: Edicion;
}

export interface Recuperacion {
  recuperables: Recuperable[];
  /** Fotos que cambiaron o desaparecieron: sus decisiones ya no valen. */
  descartadas: string[];
}

/** Lo único que el renderer puede pedir. */
export interface ApiRevisor {
  seleccionarArchivos(): Promise<ArchivoCargado[]>;
  soltarArchivos(archivos: File[]): Promise<ArchivoCargado[]>;
  analizar(id: string): Promise<Resultado<Analisis>>;
  vista(id: string, ocultamientos: Ocultamiento[]): Promise<Resultado<Vista>>;
  exportar(id: string, ocultamientos: Ocultamiento[]): Promise<Resultado<Exportado | null>>;
  segmentar(id: string, x: number, y: number): Promise<Resultado<Segmentado>>;
  pintar(id: string, puntos: Punto[], tamano: number): Promise<Resultado<Segmentado>>;
  cerrar(id: string): Promise<void>;
  cancelar(): Promise<void>;
  abrirFuente(url: string): Promise<void>;
  obtenerTema(): Promise<Tema>;
  definirTema(tema: Tema): Promise<void>;
  guardarEdiciones(ediciones: Edicion[]): Promise<void>;
  recuperar(): Promise<Recuperacion>;
  descartarRecuperacion(): Promise<void>;
  abrirVideo(): Promise<Resultado<VideoInfo | null>>;
  vistaVideo(id: string, posicion: number, pistas: PistaElegida[]): Promise<Resultado<VistaVideo>>;
  seguirVideo(id: string, posicion: number, x: number, y: number): Promise<Resultado<Seguido>>;
  quitarPista(id: string, pistaId: string): Promise<void>;
  exportarVideo(id: string, pistas: PistaElegida[]): Promise<Resultado<VideoExportado | null>>;
  cerrarVideo(id: string): Promise<void>;
  /** Avisa cuando se quiere cerrar con cambios sin exportar. Devuelve la función para dejar de escuchar. */
  alPedirCierre(avisar: (aviso: unknown) => void): () => void;
  /** Solo cierra si main pidió confirmación antes. */
  confirmarCierre(): Promise<void>;
}

export const ERROR_INTERNO: ErrorApp = {
  codigo: 'INTERNO',
  mensaje: 'Algo salió mal de nuestro lado y no se completó la acción. Intenta de nuevo.',
};

export const ERROR_VALIDACION: ErrorApp = {
  codigo: 'VALIDACION',
  mensaje: 'Uno de los valores no es válido. Revísalo e intenta de nuevo.',
};
