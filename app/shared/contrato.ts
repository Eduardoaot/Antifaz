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
} as const;

export const esquemaEfecto = z.enum(['solido', 'difuminado', 'pixelado']);
export type Efecto = z.infer<typeof esquemaEfecto>;

export const esquemaTema = z.enum(['sistema', 'claro', 'oscuro']);
export type Tema = z.infer<typeof esquemaTema>;

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

export const esquemaMotivo = z.enum(['metadatos', 'demasiado_pequena', 'modelo_no_disponible', 'deteccion_fallo', 'contenido_no_disponible', 'contenido_fallo']);
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

export const esquemaExportado = z.strictObject({
  formato: z.string(),
  bytes: z.number().int().positive(),
  zonas_ocultas: z.number().int().nonnegative(),
});

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
export const esquemaEdicion = z.strictObject({
  archivoId: esquemaArchivoId,
  decisiones: z.record(z.string(), esquemaDecision),
  efectos: z.record(z.string(), esquemaEfecto),
  intensidad: enteroEnRango(LIMITES.intensidad.min, LIMITES.intensidad.max),
  hayMenores: z.boolean().nullable(),
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
  cerrar(id: string): Promise<void>;
  cancelar(): Promise<void>;
  abrirFuente(url: string): Promise<void>;
  obtenerTema(): Promise<Tema>;
  definirTema(tema: Tema): Promise<void>;
  guardarEdiciones(ediciones: Edicion[]): Promise<void>;
  recuperar(): Promise<Recuperacion>;
  descartarRecuperacion(): Promise<void>;
}

export const ERROR_INTERNO: ErrorApp = {
  codigo: 'INTERNO',
  mensaje: 'Algo salió mal de nuestro lado y no se completó la acción. Intenta de nuevo.',
};

export const ERROR_VALIDACION: ErrorApp = {
  codigo: 'VALIDACION',
  mensaje: 'Uno de los valores no es válido. Revísalo e intenta de nuevo.',
};
