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
  /** Tamaño de un sticker, en veces el tamaño que la app elige sola. Por debajo de 1 ya no tapa toda la zona. */
  escalaSticker: { min: 0.1, max: 2, porDefecto: 1, paso: 0.05 },
  /** Posición del sticker, en fracciones de los semiejes de su zona (0 es centrado). Movido, ya no tapa toda la zona. */
  posicionSticker: { max: 10, paso: 0.05, pasoGrande: 0.25 },
  /** Giro del sticker, en grados. El sidecar gira también su parte opaca: sigue tapando lo mismo. */
  rotacionSticker: { max: 180, paso: 15 },
  /** Cuánto se estira el sticker a lo ancho o a lo alto, en veces su forma original. Deformado, ya no tapa toda la zona. */
  estiramientoSticker: { min: 0.4, max: 2.5, porDefecto: 1, paso: 0.05 },
  loteArchivos: 500,
  ocultamientos: 5000,
  jpegCalidad: { min: 60, max: 100, porDefecto: 92 },
  ladoVista: 1600,
  pincel: { min: 1, max: 512, porDefecto: 32 },
  /** Zoom del visor: 1 es "ajustar a la ventana". Solo cambia la vista, nunca la exportación. */
  zoom: { min: 1, max: 8, porDefecto: 1 },
  /** Comparar antes y después: porcentaje del ancho que muestra la original. Solo cambia la vista. */
  comparacion: { min: 0, max: 100, porDefecto: 50 },
  /**
   * Rótulos "Original" y "Tu copia": según el % del ancho que queda de su lado, se desvanecen entre
   * `oculto` (invisible) y `visible` (opaco), en vez de desaparecer de golpe.
   */
  rotuloComparacion: { oculto: 10, visible: 26 },
  /** Si una zona empieza a menos de esto del borde superior (en % del alto), su número va abajo. */
  margenEtiqueta: 8,
  /** Al ajustar a la ventana, una foto chica no se estira más de esto: se vería suave y con artefactos. */
  ajusteMaxEscala: 2,
  puntosTrazo: 5000,
  // Video (Fase 3). Coinciden con sidecar/revisor/esquemas.py.
  videoPistas: 50,
  videoPosicionMax: 999,
  videoProxyLadoMax: 4096,
  /** Texto que se agrega al nombre de cada copia, como "-copia". Puede quedar vacío. */
  sufijoExportacion: 40,
  /** Lado de las miniaturas de la lista de fotos, en píxeles. Solo es vista. */
  ladoMiniatura: 160,
} as const;

/**
 * Cada emoji es un efecto propio: así la recuperación, las zonas manuales y el video lo aceptan igual.
 * Coinciden con TipoEmoji de sidecar/revisor/esquemas.py. Se dibujan sobre bloque sólido.
 */
export const EMOJIS = ['emoji_sonrisa', 'emoji_lentes', 'emoji_gato', 'emoji_estrella', 'emoji_mono'] as const;
export type Emoji = (typeof EMOJIS)[number];

export const esquemaEfecto = z.enum(['solido', 'difuminado', 'pixelado', ...EMOJIS] as const);
export type Efecto = z.infer<typeof esquemaEfecto>;

export const esEmoji = (e: Efecto): e is Emoji => (EMOJIS as readonly string[]).includes(e);

/**
 * Diámetro del círculo totalmente opaco de cada emoji, en fracción de su lado. Solo sirve para dibujar
 * el marco al moverlo; la imagen real la calcula el sidecar. sidecar/tests/test_efectos.py lo comprueba.
 */
export const FRACCION_OPACA_EMOJI: Readonly<Record<Emoji, number>> = {
  emoji_sonrisa: 0.87,
  emoji_lentes: 0.87,
  emoji_gato: 0.59,
  emoji_estrella: 0.48,
  emoji_mono: 0.64,
};

/** Hasta cuántas veces el lado de su zona crece el emoji. Coincide con EMOJI_ESCALA_MAX de efectos.py. */
export const EMOJI_ESCALA_MAX = 2;

export const ETIQUETA_EMOJI: Readonly<Record<Emoji, string>> = {
  emoji_sonrisa: '😀 Carita sonriente',
  emoji_lentes: '😎 Carita con lentes',
  emoji_gato: '🐱 Gato',
  emoji_estrella: '⭐ Estrella',
  emoji_mono: '🙈 Mono con los ojos tapados',
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

const esquemaCajaImagen = z.strictObject({
  x: enteroEnRango(0, LIMITES.ladoMax - 1),
  y: enteroEnRango(0, LIMITES.ladoMax - 1),
  ancho: enteroEnRango(1, LIMITES.ladoMax),
  alto: enteroEnRango(1, LIMITES.ladoMax),
});

interface CajaEntera { x: number; y: number; ancho: number; alto: number }

export const nucleoDentro = (n: CajaEntera, caja: CajaEntera): boolean =>
  n.x >= caja.x && n.y >= caja.y && n.x + n.ancho <= caja.x + caja.ancho && n.y + n.alto <= caja.y + caja.alto;

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
  /** Solo la usa el emoji: en caras tapa el óvalo para ajustarse a la cara; si no, el rectángulo completo. */
  forma: z.enum(['caja', 'elipse']),
  /** La cara que vio el detector, sin el margen. Permite hacer el emoji más chico sin destaparla. */
  nucleo: esquemaCajaImagen.nullable(),
  /** Tamaño del emoji en veces el que la app elige sola. Los demás efectos lo ignoran. */
  escala: z.number().min(LIMITES.escalaSticker.min).max(LIMITES.escalaSticker.max),
  /** Desplazamiento del emoji en fracciones de los semiejes de su zona. Solo con `nucleo`. */
  desplazamiento_x: z.number().min(-LIMITES.posicionSticker.max).max(LIMITES.posicionSticker.max),
  desplazamiento_y: z.number().min(-LIMITES.posicionSticker.max).max(LIMITES.posicionSticker.max),
  /** Giro del emoji en grados, a favor de las manecillas. Los demás efectos lo ignoran. */
  rotacion: z.number().min(-LIMITES.rotacionSticker.max).max(LIMITES.rotacionSticker.max),
  /** Estiramiento del emoji a lo ancho y a lo alto, antes de girarlo. Los demás efectos lo ignoran. */
  estiramiento_x: z.number().min(LIMITES.estiramientoSticker.min).max(LIMITES.estiramientoSticker.max),
  estiramiento_y: z.number().min(LIMITES.estiramientoSticker.min).max(LIMITES.estiramientoSticker.max),
}).refine((o) => o.nucleo === null || nucleoDentro(o.nucleo, o), {
  message: 'La cara debe quedar dentro de su zona',
  path: ['nucleo'],
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
  /** Solo en caras: la caja del detector, sin el margen que se agrega para ocultar. */
  nucleo: esquemaCajaImagen.nullable().optional(),
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

export const esquemaPistaElegida = z.strictObject({
  pista_id: z.string().min(1).max(64),
  efecto: esquemaEfecto,
  intensidad: enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max),
});
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
  /** En este frame se perdió un objeto: conviene revisarlo (a veces se ocultó de más; a veces no hay cuadro). */
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
  /** Nombre de la carpeta donde se guardó, si fue la carpeta de tus ajustes o la de un lote. */
  carpeta: string | null;
}

// --- Ajustes ------------------------------------------------------------------------------------

/** "automatico": PNG si la foto era PNG; si no, JPG. */
export const esquemaFormatoCopia = z.enum(['jpg', 'png', 'automatico']);
export type FormatoCopia = z.infer<typeof esquemaFormatoCopia>;

/** Caracteres que Windows no acepta en un nombre de archivo. */
const CARACTERES_PROHIBIDOS = /[<>:"/\\|?*\u0000-\u001f]/;

export const esquemaSufijo = z
  .string()
  .max(LIMITES.sufijoExportacion)
  .refine((s) => !CARACTERES_PROHIBIDOS.test(s), 'Sin < > : " / \\ | ? *')
  .refine((s) => !/[. ]$/.test(s), 'Sin punto ni espacio al final');

export const esquemaPreferenciasCopia = z.strictObject({
  /** "carpeta": se guarda directo en la carpeta elegida, sin preguntar. */
  destino: z.enum(['preguntar', 'carpeta']),
  formato: esquemaFormatoCopia,
  sufijo: esquemaSufijo,
});
export type PreferenciasCopia = z.infer<typeof esquemaPreferenciasCopia>;

export const PREFERENCIAS_COPIA_INICIALES: PreferenciasCopia = { destino: 'preguntar', formato: 'automatico', sufijo: '-copia' };

export interface Ajustes {
  tema: Tema;
  copia: PreferenciasCopia;
  /** Solo el nombre de la carpeta elegida, nunca la ruta. Null si no hay o ya no existe. */
  carpeta: string | null;
}

/** Un lote de copias va a una sola carpeta. El renderer solo recibe un id opaco y el nombre. */
export interface Lote {
  loteId: string;
  carpeta: string;
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

const coordenadaSticker = z.number().min(-LIMITES.posicionSticker.max).max(LIMITES.posicionSticker.max);
const factorEstiramiento = z.number().min(LIMITES.estiramientoSticker.min).max(LIMITES.estiramientoSticker.max);

export const esquemaEdicion = z.strictObject({
  archivoId: esquemaArchivoId,
  decisiones: z.record(z.string(), esquemaDecision),
  efectos: z.record(z.string(), esquemaEfecto),
  intensidad: enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max),
  hayMenores: z.boolean().nullable(),
  manuales: z.array(esquemaManual).max(LIMITES.ocultamientos).default([]),
  // Opcional: las recuperaciones guardadas antes de poder cambiar el tamaño del sticker no lo traen.
  escalas: z.record(z.string(), z.number().min(LIMITES.escalaSticker.min).max(LIMITES.escalaSticker.max)).default({}),
  // Opcional por la misma razón: las anteriores a poder mover el sticker no lo traen.
  posiciones: z.record(z.string(), z.strictObject({ x: coordenadaSticker, y: coordenadaSticker })).default({}),
  // Intensidad propia de una zona. Opcional: las recuperaciones anteriores no la traen.
  intensidades: z.record(z.string(), enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max)).default({}),
  // Opcionales por la misma razón: giro del sticker y zonas detectadas que quitaste de la foto.
  rotaciones: z.record(z.string(), z.number().min(-LIMITES.rotacionSticker.max).max(LIMITES.rotacionSticker.max)).default({}),
  estiramientos: z.record(z.string(), z.strictObject({ x: factorEstiramiento, y: factorEstiramiento })).default({}),
  descartadas: z.array(z.string().min(1).max(64)).max(LIMITES.ocultamientos).default([]),
  // Margen/tamaño de la censura auto (`dilatacion_pct`). Opcional: recuperaciones anteriores no lo traen.
  margenes: z.record(z.string(), z.number().min(LIMITES.dilatacionPct.min).max(LIMITES.dilatacionPct.max)).default({}),
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
  /** Prepara una carpeta para varias copias: la de tus ajustes o una que eliges. Null si cancelas. */
  prepararLote(): Promise<Resultado<Lote | null>>;
  exportarEnLote(loteId: string, id: string, ocultamientos: Ocultamiento[]): Promise<Resultado<Exportado>>;
  /** Miniatura de la foto original para la lista. Solo es vista: nunca se guarda. */
  miniatura(id: string): Promise<Resultado<Vista>>;
  segmentar(id: string, x: number, y: number): Promise<Resultado<Segmentado>>;
  pintar(id: string, puntos: Punto[], tamano: number): Promise<Resultado<Segmentado>>;
  cerrar(id: string): Promise<void>;
  cancelar(): Promise<void>;
  abrirFuente(url: string): Promise<void>;
  obtenerTema(): Promise<Tema>;
  definirTema(tema: Tema): Promise<void>;
  obtenerAjustes(): Promise<Ajustes>;
  definirCopia(preferencias: PreferenciasCopia): Promise<Ajustes>;
  /** Abre el selector de carpetas. Devuelve los ajustes con la carpeta nueva, o igual si cancelas. */
  elegirCarpeta(): Promise<Ajustes>;
  guardarEdiciones(ediciones: Edicion[]): Promise<void>;
  recuperar(): Promise<Recuperacion>;
  descartarRecuperacion(): Promise<void>;
  abrirVideo(): Promise<Resultado<VideoInfo | null>>;
  soltarVideo(archivo: File): Promise<Resultado<VideoInfo>>;
  vistaVideo(id: string, posicion: number, pistas: PistaElegida[]): Promise<Resultado<VistaVideo>>;
  seguirVideo(id: string, posicion: number, x: number, y: number): Promise<Resultado<Seguido>>;
  /** Una zona tuya en el video, fija en todos los frames: rectángulo (dos esquinas) o trazo, en el proxy. */
  zonaVideo(id: string, forma: 'rectangulo' | 'pincel', puntos: Punto[], tamano: number): Promise<Resultado<Seguido>>;
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
