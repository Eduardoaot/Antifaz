/** Lógica pura de la revisión de una foto. Sin React ni Electron, para probarla a fondo. */
import { catalogo, etiquetaNivel, reglaDe, type Nivel, type Regla } from './catalogo';
import {
  EMOJI_ESCALA_MAX,
  esEmoji,
  FRACCION_OPACA_EMOJI,
  LIMITES,
  type Analisis,
  type Decision,
  type Edicion,
  type Efecto,
  type Emoji,
  type Hallazgo,
  type Motivo,
  type Ocultamiento,
  type Origen,
  type Punto,
} from './contrato';
import { leerEnRango } from './numeros';

export const HISTORIAL_PASOS = 100;

export type Herramienta = 'ninguna' | 'clic' | 'rectangulo' | 'pincel';

export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface ZonaManual extends Caja {
  id: string;
  efecto: Efecto;
  mascara_id: string | null;
  origen: Origen;
}

export interface Revision {
  decisiones: Readonly<Record<string, Decision>>;
  efectos: Readonly<Record<string, Efecto>>;
  intensidad: number;
  hayMenores: boolean | null;
  manuales: readonly ZonaManual[];
  /** Tamaño del sticker de cada cara, en veces el que la app elige sola. Sin entrada, 1. */
  escalas: Readonly<Record<string, number>>;
  /** Posición del sticker de cada cara, en fracciones de los semiejes de su zona. Sin entrada, centrado. */
  posiciones: Readonly<Record<string, Posicion>>;
  /** Intensidad propia de una zona. Sin entrada, la de toda la foto (`intensidad`). */
  intensidades: Readonly<Record<string, number>>;
}

export interface Posicion {
  x: number;
  y: number;
}

export const REVISION_INICIAL: Revision = {
  decisiones: {},
  efectos: {},
  intensidad: LIMITES.intensidad.porDefecto,
  hayMenores: null,
  manuales: [],
  escalas: {},
  posiciones: {},
  intensidades: {},
};

export interface Historial {
  pasado: readonly Revision[];
  actual: Revision;
  futuro: readonly Revision[];
}

export const nuevoHistorial = (actual: Revision = REVISION_INICIAL): Historial => ({ pasado: [], actual, futuro: [] });

export function aplicarCambio(h: Historial, siguiente: Revision): Historial {
  if (siguiente === h.actual) return h;
  return { pasado: [...h.pasado, h.actual].slice(-HISTORIAL_PASOS), actual: siguiente, futuro: [] };
}

export function deshacer(h: Historial): Historial {
  const previo = h.pasado.at(-1);
  if (previo === undefined) return h;
  return { pasado: h.pasado.slice(0, -1), actual: previo, futuro: [h.actual, ...h.futuro] };
}

export function rehacer(h: Historial): Historial {
  const [siguiente, ...resto] = h.futuro;
  if (siguiente === undefined) return h;
  return { pasado: [...h.pasado, h.actual], actual: siguiente, futuro: resto };
}

const esVisual = (h: Hallazgo): boolean => h.caja !== null;

export function decidir(r: Revision, hallazgoId: string, decision: Decision): Revision {
  return { ...r, decisiones: { ...r.decisiones, [hallazgoId]: decision } };
}

export function elegirEfecto(r: Revision, hallazgoId: string, efecto: Efecto): Revision {
  return { ...r, efectos: { ...r.efectos, [hallazgoId]: efecto } };
}

/** Decide lo mismo para varias zonas a la vez, por ejemplo todas las de un tipo de riesgo. */
export function decidirVarias(r: Revision, ids: readonly string[], decision: Decision): Revision {
  if (ids.length === 0) return r;
  const decisiones: Record<string, Decision> = { ...r.decisiones };
  for (const id of ids) decisiones[id] = decision;
  return { ...r, decisiones };
}

/** Mismo efecto para varias zonas. Las tuyas guardan su efecto en ellas mismas. */
export function elegirEfectoVarias(r: Revision, ids: readonly string[], efecto: Efecto): Revision {
  if (ids.length === 0) return r;
  const propios = new Set(r.manuales.map((z) => z.id));
  const efectos: Record<string, Efecto> = { ...r.efectos };
  for (const id of ids) if (!propios.has(id)) efectos[id] = efecto;
  const elegidas = new Set(ids);
  return { ...r, efectos, manuales: r.manuales.map((z) => (elegidas.has(z.id) ? { ...z, efecto } : z)) };
}

/** Lleva cualquier número al rango de la intensidad. Lo que no es un número vuelve al valor por defecto. */
export function limitarIntensidad(valor: number): number {
  if (!Number.isFinite(valor)) return LIMITES.intensidad.porDefecto;
  return Math.min(LIMITES.intensidad.max, Math.max(LIMITES.intensidad.min, Math.round(valor)));
}

export const intensidadDe = (r: Revision, id: string): number => r.intensidades[id] ?? r.intensidad;

/** Intensidad propia para varias zonas: las demás siguen con la de toda la foto. */
export function elegirIntensidadVarias(r: Revision, ids: readonly string[], valor: number): Revision {
  if (ids.length === 0) return r;
  const intensidades: Record<string, number> = { ...r.intensidades };
  for (const id of ids) intensidades[id] = limitarIntensidad(valor);
  return { ...r, intensidades };
}

/** La intensidad de toda la foto. Es global de verdad: borra las que cada zona tenía. */
export function elegirIntensidadGlobal(r: Revision, valor: number): Revision {
  return { ...r, intensidad: limitarIntensidad(valor), intensidades: {} };
}

/** El valor si todos coinciden; null si son distintos o no hay ninguno. */
export function valorComun<T>(valores: readonly T[]): T | null {
  const [primero, ...resto] = valores;
  if (primero === undefined) return null;
  return resto.every((v) => v === primero) ? primero : null;
}

/** La intensidad solo cambia algo en el difuminado y el pixelado. */
export const usaIntensidad = (efecto: Efecto): boolean => efecto === 'difuminado' || efecto === 'pixelado';

function ocultarVarios(r: Revision, hallazgos: readonly Hallazgo[]): Revision {
  const decisiones: Record<string, Decision> = { ...r.decisiones };
  for (const h of hallazgos) decisiones[h.id] = 'ocultar';
  return { ...r, decisiones };
}

/** Oculta todo lo que tiene zona en la imagen. */
export const ocultarTodo = (r: Revision, hallazgos: readonly Hallazgo[]): Revision =>
  ocultarVarios(r, hallazgos.filter(esVisual));

/**
 * Oculta lo que la pantalla muestra como riesgo alto. Las caras entran solo si dijiste que hay
 * menores: sin respuesta, una cara es riesgo bajo y la pregunta sigue a la vista.
 */
export function ocultarRiesgoAlto(r: Revision, hallazgos: readonly Hallazgo[]): Revision {
  return ocultarVarios(r, hallazgos.filter((h) => esVisual(h) && nivelMostrado(h, r) === 'alto'));
}

/** Responder que sí hay menores oculta todas las caras; responder que no, no quita lo ya oculto. */
export function responderMenores(r: Revision, hallazgos: readonly Hallazgo[], hay: boolean): Revision {
  const conRespuesta: Revision = { ...r, hayMenores: hay };
  return hay ? ocultarVarios(conRespuesta, hallazgos.filter((h) => h.regla_id === 'CAR-01')) : conRespuesta;
}

export function efectoDe(r: Revision, h: Hallazgo): Efecto {
  // Una zona tuya guarda su efecto en ella misma.
  const manual = r.manuales.find((z) => z.id === h.id);
  if (manual !== undefined) return manual.efecto;
  return r.efectos[h.id] ?? (h.regla_id === 'CAR-01' ? 'difuminado' : 'solido');
}

/** Regla con la que una zona tuya se trata como cualquier hallazgo con caja (por ejemplo, el sticker). */
export const REGLA_MANUAL = 'MANUAL';

/** Tu zona como hallazgo con caja y sin cara del detector: así comparte el sticker con todo lo demás. */
export function hallazgoDeManual(z: ZonaManual): Hallazgo {
  return {
    id: z.id,
    regla_id: REGLA_MANUAL,
    caja: { x: z.x, y: z.y, ancho: z.ancho, alto: z.alto },
    confianza: 1,
    requiere_revision: false,
    posicion: null,
    nucleo: null,
  };
}

// --- Tamaño y posición del sticker en cualquier zona --------------------------------------------

// Al centésimo: 0.95 debe ser 0.95, no 0.9500000000000001, para compararlo y guardarlo tal cual.
const redondearPaso = (v: number): number =>
  Math.round(Math.round(v / LIMITES.escalaSticker.paso) * LIMITES.escalaSticker.paso * 100) / 100;

/**
 * Cualquier zona con emoji puede cambiar de tamaño y moverse: caras, pecho, texto, placas o tus zonas.
 * En una cara, lo que no puede destaparse es la cara del detector; en lo demás, la zona completa, y el
 * sidecar mantiene el relleno debajo aunque el emoji se mueva.
 */
export function ajustaSticker(r: Revision, h: Hallazgo): boolean {
  return h.caja !== null && esEmoji(efectoDe(r, h));
}

/** Verdadero si lo que no puede destaparse es una cara del detector (y no la zona completa). */
export const tieneNucleo = (h: Hallazgo): boolean => h.nucleo !== undefined && h.nucleo !== null;

/** Las zonas cuyo sticker se puede mover ahora: las ocultas con emoji, detectadas o tuyas. */
export function zonasConSticker(r: Revision, hallazgos: readonly Hallazgo[]): Hallazgo[] {
  const detectadas = hallazgos.filter((h) => r.decisiones[h.id] === 'ocultar' && ajustaSticker(r, h));
  return [...detectadas, ...r.manuales.map(hallazgoDeManual).filter((h) => ajustaSticker(r, h))];
}

/** El margen que el sidecar agrega a una zona de cara (`region_dilatada` en efectos.py). */
const margenZona = (c: Caja): number =>
  Math.max(LIMITES.dilatacionPx.porDefecto, Math.ceil((Math.min(c.ancho, c.alto) * LIMITES.dilatacionPct.porDefecto) / 100));

/**
 * Hasta dónde puede encogerse el sticker: lo que mide la cara del detector frente a la zona con margen.
 * Es una aproximación para el control; el sidecar calcula el mínimo exacto y nunca baja de él.
 */
export function escalaMinimaSticker(h: Hallazgo): number {
  const { min } = LIMITES.escalaSticker;
  if (h.caja === null || h.nucleo === undefined || h.nucleo === null) return 1;
  const margen = margenZona(h.caja);
  const nucleo = LIMITES.dilatacionPx.porDefecto;
  const proporcion = Math.max(
    (h.nucleo.ancho + 2 * nucleo) / (h.caja.ancho + 2 * margen),
    (h.nucleo.alto + 2 * nucleo) / (h.caja.alto + 2 * margen),
  );
  if (!Number.isFinite(proporcion)) return 1;
  // Hacia arriba, al paso del control: así el control no ofrece tamaños que el sidecar no daría.
  const paso = LIMITES.escalaSticker.paso;
  return Math.min(1, Math.max(min, redondearPaso(Math.ceil(proporcion / paso - 1e-9) * paso)));
}

/** Fuera de rango o no numérico, se limita; 1 se guarda como "sin cambio". */
export function limitarEscala(valor: number): number {
  const { min, max, porDefecto } = LIMITES.escalaSticker;
  if (!Number.isFinite(valor)) return porDefecto;
  return Math.min(max, Math.max(min, redondearPaso(valor)));
}

export const escalaDe = (r: Revision, id: string): number => r.escalas[id] ?? LIMITES.escalaSticker.porDefecto;

const sinClave = <T,>(m: Readonly<Record<string, T>>, id: string): Record<string, T> =>
  Object.fromEntries(Object.entries(m).filter(([clave]) => clave !== id));

export const posicionDe = (r: Revision, id: string): Posicion => r.posiciones[id] ?? { x: 0, y: 0 };

/** Al centésimo, hacia el centro: redondear nunca debe sacar al sticker de donde tapa la cara. */
const haciaElCentro = (v: number): number => Math.trunc(v * 100) / 100 || 0;

/**
 * Cuánto puede alejarse el centro, en semiejes. Al centésimo y hacia abajo, con tolerancia para que
 * 0.85 − 0.75 dé 0.1 y no 0.09: redondear nunca debe alargarlo.
 */
const radioSticker = (h: Hallazgo, escala: number): number =>
  Math.max(0, Math.floor(((Number.isFinite(escala) ? escala : 0) - escalaMinimaSticker(h)) * 100 + 1e-6) / 100);

/**
 * La posición más cercana a la pedida desde la que el sticker, con esa escala, sigue tapando la cara.
 * En fracciones de los semiejes, la cara cabe en un círculo de radio `escalaMinimaSticker` y el emoji
 * tapa uno de radio `escala`: el centro puede alejarse hasta la diferencia. Más lejos, se queda en el
 * borde (el imán). El sidecar lo comprueba en píxeles y, si no alcanza, agranda el emoji.
 */
export function limitarPosicion(h: Hallazgo, escala: number, p: Posicion): Posicion {
  const { max } = LIMITES.posicionSticker;
  const recorte = (v: number): number => (Number.isFinite(v) ? Math.min(max, Math.max(-max, v)) : 0);
  const x = recorte(p.x);
  const y = recorte(p.y);
  const radio = radioSticker(h, escala);
  const distancia = Math.hypot(x, y);
  const factor = distancia > radio ? (distancia === 0 ? 0 : radio / distancia) : 1;
  return { x: haciaElCentro(x * factor), y: haciaElCentro(y * factor) };
}

/** Verdadero si el sticker ya no puede alejarse más del centro con su tamaño actual. */
export function enElTope(h: Hallazgo, escala: number, p: Posicion): boolean {
  const radio = radioSticker(h, escala);
  return Math.hypot(p.x, p.y) >= radio - 0.011;
}

export interface CambioSticker {
  escala?: number;
  posicion?: Posicion;
}

/**
 * Cambia el tamaño, la posición o ambos. El tamaño nunca baja del mínimo de la cara, y al encogerlo
 * el sticker se acerca al centro lo necesario para seguir tapándola.
 */
export function ajustarSticker(r: Revision, h: Hallazgo, cambio: CambioSticker): Revision {
  const escala = cambio.escala === undefined ? escalaDe(r, h.id) : Math.max(escalaMinimaSticker(h), limitarEscala(cambio.escala));
  const posicion = limitarPosicion(h, escala, cambio.posicion ?? posicionDe(r, h.id));
  const previa = posicionDe(r, h.id);
  if (escala === escalaDe(r, h.id) && posicion.x === previa.x && posicion.y === previa.y) return r;
  const sin = <T,>(m: Readonly<Record<string, T>>): Record<string, T> => sinClave(m, h.id);
  const centrado = posicion.x === 0 && posicion.y === 0;
  return {
    ...r,
    escalas: escala === LIMITES.escalaSticker.porDefecto ? sin(r.escalas) : { ...sin(r.escalas), [h.id]: escala },
    posiciones: centrado ? sin(r.posiciones) : { ...sin(r.posiciones), [h.id]: posicion },
  };
}

export const stickerAjustado = (r: Revision, id: string): boolean => id in r.escalas || id in r.posiciones;

/** Regresa el sticker al tamaño y lugar que la app eligió sola. */
export function restablecerSticker(r: Revision, id: string): Revision {
  if (!stickerAjustado(r, id)) return r;
  return { ...r, escalas: sinClave(r.escalas, id), posiciones: sinClave(r.posiciones, id) };
}

/**
 * Dónde se ve el sticker, en píxeles de la imagen: centro y lado. Aproximado (la imagen real la dibuja
 * el sidecar); sirve para el marco con el que se mueve y se cambia de tamaño.
 */
export function geometriaSticker(caja: Caja, emoji: Emoji, escala: number, p: Posicion): { cx: number; cy: number; lado: number } {
  const margen = margenZona(caja);
  const semiX = caja.ancho / 2 + margen;
  const semiY = caja.alto / 2 + margen;
  const base = 2 * Math.max(semiX, semiY);
  const justo = Math.min(base / FRACCION_OPACA_EMOJI[emoji], base * EMOJI_ESCALA_MAX);
  return { cx: caja.x + caja.ancho / 2 + p.x * semiX, cy: caja.y + caja.alto / 2 + p.y * semiY, lado: justo * escala };
}

/** Semiejes del óvalo de la zona, en píxeles de la imagen: convierten un arrastre en posición. */
export function semiejesZona(caja: Caja): { x: number; y: number } {
  const margen = margenZona(caja);
  return { x: caja.ancho / 2 + margen, y: caja.alto / 2 + margen };
}

export function construirOcultamientos(r: Revision, hallazgos: readonly Hallazgo[]): Ocultamiento[] {
  const salida: Ocultamiento[] = [];
  for (const h of hallazgos) {
    if (h.caja === null || r.decisiones[h.id] !== 'ocultar') continue;
    salida.push({
      ...h.caja,
      efecto: efectoDe(r, h),
      intensidad: intensidadDe(r, h.id),
      dilatacion_px: LIMITES.dilatacionPx.porDefecto,
      dilatacion_pct: LIMITES.dilatacionPct.porDefecto,
      mascara_id: null,
      // Con el margen de las caras, el óvalo contiene toda la cara detectada: el emoji puede ajustarse a ella.
      forma: h.regla_id === 'CAR-01' ? 'elipse' : 'caja',
      nucleo: ajustaSticker(r, h) ? (h.nucleo ?? null) : null,
      escala: ajustaSticker(r, h) ? escalaDe(r, h.id) : LIMITES.escalaSticker.porDefecto,
      desplazamiento_x: ajustaSticker(r, h) ? posicionDe(r, h.id).x : 0,
      desplazamiento_y: ajustaSticker(r, h) ? posicionDe(r, h.id).y : 0,
    });
  }
  for (const z of r.manuales) {
    const ajusta = esEmoji(z.efecto);
    salida.push({
      x: z.x,
      y: z.y,
      ancho: z.ancho,
      alto: z.alto,
      efecto: z.efecto,
      intensidad: intensidadDe(r, z.id),
      dilatacion_px: LIMITES.dilatacionPx.porDefecto,
      // Un rectángulo o un trazo ya son lo que se pidió: solo llevan el margen mínimo.
      // La silueta del modelo puede quedarse corta, así que lleva el margen completo.
      dilatacion_pct: z.origen === 'silueta' ? LIMITES.dilatacionPct.porDefecto : 0,
      mascara_id: z.mascara_id,
      // Lo que dibujaste a mano se tapa completo; con silueta, el emoji se ajusta a ella en el sidecar.
      forma: 'caja',
      nucleo: null,
      escala: ajusta ? escalaDe(r, z.id) : LIMITES.escalaSticker.porDefecto,
      desplazamiento_x: ajusta ? posicionDe(r, z.id).x : 0,
      desplazamiento_y: ajusta ? posicionDe(r, z.id).y : 0,
    });
  }
  return salida;
}

/** Lo más delicado se marca solo. Sin deshacer lo que ya se decidió, por ejemplo al recuperar. */
export function aplicarDecisionesIniciales(r: Revision, hallazgos: readonly Hallazgo[]): Revision {
  const nuevas = hallazgos.filter((h) => h.regla_id === 'DES-01' && esVisual(h) && r.decisiones[h.id] === undefined);
  return nuevas.length === 0 ? r : ocultarVarios(r, nuevas);
}

const NOMBRE_REVISADO: Readonly<Record<string, string>> = {
  'CAR-01': 'caras',
  'UBI-01': 'ubicación guardada en el archivo',
  'DES-01': 'desnudez',
  'SUG-01': 'contenido sugerente',
  'ARM-01': 'armas',
  'EXT-01': 'símbolos extremistas',
  'CON-01': 'datos en texto legible (contacto, documentos, finanzas, salud y viajes)',
  'COD-01': 'códigos QR y de barras',
  'MAT-01': 'placas',
  'PAN-01': 'pantallas',
  'VAL-02': 'joyas',
  'UBI-04': 'letreros',
  'UBI-06': 'ventanas',
  'INT-01': 'baños',
};

/** Dice qué se revisó de verdad en esta foto, no lo que la app sabría revisar. */
export function textoRevisado(analisis: Analisis): string {
  const nombres = analisis.cobertura.reglas_revisadas.flatMap((id) => NOMBRE_REVISADO[id] ?? []);
  if (nombres.length === 0) return 'La revisión es orientativa. En esta foto no pudimos revisar nada.';
  const aviso = analisis.cobertura.reglas_revisadas.includes('CON-01')
    ? ' Un documento o una tarjeta sin texto legible podría pasar sin aviso.'
    : '';
  return `La revisión es orientativa. En esta foto revisamos: ${nombres.join(', ')}.${aviso}`;
}

const PESO_NIVEL: Readonly<Record<string, number>> = { alto: 0, medio: 1, bajo: 2 };

/** Lo más grave primero, y lo seguro antes que lo dudoso. El orden también numera las zonas. */
export function ordenarHallazgos(hallazgos: readonly Hallazgo[]): Hallazgo[] {
  const peso = (h: Hallazgo): number => PESO_NIVEL[reglaDe(h.regla_id).nivel_riesgo] ?? 3;
  return [...hallazgos].sort((a, b) => peso(a) - peso(b) || b.confianza - a.confianza);
}

/** Sin zona no se puede tapar todavía: se dice para que la persona pueda recortar. */
export function soloAvisaSinZona(h: Hallazgo): boolean {
  return h.caja === null && !['MEN-01', 'UBI-01', 'INT-01'].includes(h.regla_id);
}

/** Una pregunta no es una advertencia: no lleva color de riesgo hasta que se responde. */
export type NivelMostrado = Nivel | 'pregunta';

/** Reglas que se vuelven riesgo alto si la persona dice que hay menores. */
const SUBEN_CON_MENORES: ReadonlySet<string> = new Set(['CAR-01', 'INT-01']);

/**
 * Nivel que se muestra, según el contexto. Menos alarma con lo cotidiano y nunca menos con lo grave:
 * - La pregunta de menores es neutral hasta que se responde. Con un "sí", ella y las caras suben a alto.
 * - Con poca confianza, lo de riesgo medio se muestra como bajo.
 * - Lo de riesgo alto nunca baja por sí solo.
 */
export function nivelMostrado(h: Hallazgo, r: Revision): NivelMostrado {
  const regla = reglaDe(h.regla_id);
  if (regla.requiere_confirmacion === true) return r.hayMenores === true ? 'alto' : 'pregunta';
  if (r.hayMenores === true && SUBEN_CON_MENORES.has(h.regla_id)) return 'alto';
  if (h.requiere_revision && regla.nivel_riesgo === 'medio') return 'bajo';
  return regla.nivel_riesgo;
}

export function etiquetaNivelMostrado(nivel: NivelMostrado): string {
  return nivel === 'pregunta' ? 'Pregunta' : etiquetaNivel(nivel);
}

/** Cuántas advertencias hay, sin contar preguntas. */
export const contarAdvertencias = (hallazgos: readonly Hallazgo[]): number =>
  hallazgos.filter((h) => reglaDe(h.regla_id).requiere_confirmacion !== true).length;

/** Lo que aún pide una decisión: zonas sin resolver y la pregunta de menores. */
export function pendientes(r: Revision, hallazgos: readonly Hallazgo[]): Hallazgo[] {
  return hallazgos.filter((h) => {
    if (reglaDe(h.regla_id).requiere_confirmacion === true) return r.hayMenores === null;
    return esVisual(h) && r.decisiones[h.id] === undefined;
  });
}

export function reglasNoRevisadas(analisis: Analisis): Regla[] {
  const revisadas = new Set(analisis.cobertura.reglas_revisadas);
  return catalogo.reglas.filter((r) => !revisadas.has(r.id));
}

export function textoMotivo(motivo: Motivo): string {
  switch (motivo) {
    case 'metadatos':
      return 'No pudimos leer los metadatos de este archivo. Al exportar se quitan de todos modos.';
    case 'demasiado_pequena':
      return 'La imagen es demasiado pequeña para analizarla bien.';
    case 'modelo_no_disponible':
      return 'Falta el modelo para detectar caras, así que no revisamos si hay personas.';
    case 'deteccion_fallo':
      return 'La detección de caras falló, así que no revisamos si hay personas.';
    case 'contenido_no_disponible':
      return 'Faltan los modelos de contenido, así que no revisamos desnudez, contenido sugerente, armas ni extremismo.';
    case 'objetos_no_disponible':
      return 'Falta el detector de objetos, así que no revisamos placas, pantallas, joyas ni letreros.';
    case 'objetos_fallo':
      return 'El detector de objetos falló, así que no revisamos placas, pantallas, joyas ni letreros.';
    case 'texto_fallo':
      return 'No pudimos leer el texto de la imagen, así que no revisamos teléfonos, correos ni documentos.';
    case 'codigos_fallo':
      return 'No pudimos revisar si hay códigos QR o de barras.';
    case 'contenido_fallo':
      return 'La revisión de contenido falló, así que no revisamos desnudez, contenido sugerente, armas ni extremismo.';
    default: {
      const inalcanzable: never = motivo;
      throw new Error(`Motivo desconocido: ${String(inalcanzable)}`);
    }
  }
}

export type Veredicto = 'parcial' | 'con_advertencias' | 'leve' | 'sin_hallazgos';

/** Una revisión fallida o parcial nunca se presenta como limpia. */
export function veredicto(analisis: Analisis): Veredicto {
  if (!analisis.cobertura.completa) return 'parcial';
  if (analisis.hallazgos.length === 0) return 'sin_hallazgos';
  // Solo riesgo bajo y preguntas: una foto con amigos no debe sonar a peligro.
  const leve = analisis.hallazgos.every((h) => {
    const regla = reglaDe(h.regla_id);
    return regla.requiere_confirmacion === true || regla.nivel_riesgo === 'bajo';
  });
  return leve ? 'leve' : 'con_advertencias';
}

export function tituloVeredicto(v: Veredicto): string {
  switch (v) {
    case 'parcial':
      return 'No pudimos revisar esta foto por completo';
    case 'con_advertencias':
      return 'Revisa estas advertencias';
    case 'leve':
      return 'Solo encontramos detalles menores en lo que revisamos';
    case 'sin_hallazgos':
      return 'No encontramos nada riesgoso en lo que revisamos';
    default: {
      const inalcanzable: never = v;
      throw new Error(`Veredicto desconocido: ${String(inalcanzable)}`);
    }
  }
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export function describirHallazgo(h: Hallazgo): string {
  switch (h.regla_id) {
    case 'CAR-01':
      if (h.requiere_revision) return `Podría ser una cara, ${h.posicion ?? 'en la imagen'}. No estamos seguros: revísala.`;
      return `Se detectó una cara ${h.posicion ?? 'en la imagen'}.`;
    case 'MEN-01':
      return reglaDe('MEN-01').texto_aviso ?? 'Podría haber menores en la foto';
    case 'UBI-01':
      return 'Este archivo guarda el lugar donde se tomó.';
    default: {
      const regla = reglaDe(h.regla_id);
      return `${regla.texto_aviso ?? regla.que_detecta}${h.posicion === null ? '' : ` ${h.posicion}`}.`;
    }
  }
}

/** Resumen en texto de un archivo, para quien no puede ver la imagen. */
export function resumenTexto(nombre: string, analisis: Analisis, r: Revision): string {
  const partes = [`${nombre}.`, `${tituloVeredicto(veredicto(analisis))}.`];
  const zonas = analisis.hallazgos.filter((h) => h.regla_id === 'CAR-01');
  if (zonas.length > 0) {
    const seguras = zonas.filter((h) => !h.requiere_revision).length;
    const posibles = zonas.length - seguras;
    const ocultas = zonas.filter((h) => r.decisiones[h.id] === 'ocultar').length;
    const conteo = [
      ...(seguras > 0 ? [plural(seguras, 'cara detectada', 'caras detectadas')] : []),
      ...(posibles > 0 ? [plural(posibles, 'posible cara', 'posibles caras')] : []),
    ];
    partes.push(`${conteo.join(' y ')}, ${ocultas} para ocultar.`);
    partes.push(...zonas.map(describirHallazgo));
  }
  for (const h of analisis.hallazgos) {
    if (h.regla_id === 'CAR-01') continue;
    partes.push(`${etiquetaNivelMostrado(nivelMostrado(h, r))}: ${describirHallazgo(h)}`);
  }
  partes.push(...analisis.cobertura.motivos.map(textoMotivo));
  return partes.join(' ');
}

/** Exportar nunca se bloquea, pero una revisión parcial o sin terminar no sale sin que se sepa. */
export function textoConfirmacion(faltan: number, parcial: boolean): string {
  const partes: string[] = [];
  if (parcial) partes.push('Esta foto no se revisó por completo, así que podría tener algo que no vimos.');
  if (faltan > 0) {
    partes.push(`Hay ${plural(faltan, 'advertencia', 'advertencias')} sin decidir. Lo que no marques para ocultar saldrá visible en la copia.`);
  }
  partes.push('Tú decides.');
  return partes.join(' ');
}

export const efectoManual = (z: ZonaManual): Efecto => z.efecto;

const origenPorMascara = (mascaraId: string | null): Origen => (mascaraId === null ? 'rectangulo' : 'silueta');

export function agregarManual(
  r: Revision,
  id: string,
  caja: Caja,
  mascaraId: string | null,
  origen: Origen = origenPorMascara(mascaraId),
): Revision {
  return { ...r, manuales: [...r.manuales, { ...caja, id, efecto: 'solido', mascara_id: mascaraId, origen }] };
}

export function textoOrigen(origen: Origen): string {
  switch (origen) {
    case 'rectangulo':
      return 'rectángulo';
    case 'silueta':
      return 'silueta';
    case 'pincel':
      return 'trazo a mano';
    default: {
      const inalcanzable: never = origen;
      throw new Error(`Origen desconocido: ${String(inalcanzable)}`);
    }
  }
}

/**
 * Suma un punto al trazo del pincel. Omite los que casi no se movieron, para no mandar miles
 * de puntos repetidos, y nunca pasa del límite: el resto del trazo se descarta.
 * Devuelve el mismo arreglo si no agregó nada.
 */
export function agregarPuntoTrazo(trazo: readonly Punto[], punto: Punto, tamano: number): readonly Punto[] {
  const ultimo = trazo.at(-1);
  if (trazo.length >= LIMITES.puntosTrazo) return trazo;
  if (ultimo !== undefined) {
    const paso = Math.max(1, Math.floor(tamano / 4));
    if (Math.hypot(punto.x - ultimo.x, punto.y - ultimo.y) < paso) return trazo;
  }
  return [...trazo, punto];
}

export const trazoLleno = (trazo: readonly Punto[]): boolean => trazo.length >= LIMITES.puntosTrazo;

export function quitarManual(r: Revision, id: string): Revision {
  // Su sticker se va con ella: un id nuevo con el mismo nombre no debe heredar tamaño ni posición.
  return {
    ...r,
    manuales: r.manuales.filter((z) => z.id !== id),
    escalas: sinClave(r.escalas, id),
    posiciones: sinClave(r.posiciones, id),
    intensidades: sinClave(r.intensidades, id),
  };
}

export function efectoDeManual(r: Revision, id: string, efecto: Efecto): Revision {
  return { ...r, manuales: r.manuales.map((z) => (z.id === id ? { ...z, efecto } : z)) };
}

export const cubreTodo = (c: Caja, ancho: number, alto: number): boolean =>
  c.x === 0 && c.y === 0 && c.ancho >= ancho && c.alto >= alto;

interface Marco {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pasa un punto de la pantalla a la imagen. Devuelve null si cae fuera, salvo que se pida ajustarlo al borde. */
export function aPuntoDeImagen(
  clienteX: number,
  clienteY: number,
  marco: Marco,
  ancho: number,
  alto: number,
  ajustar = false,
): { x: number; y: number } | null {
  if (marco.width <= 0 || marco.height <= 0) return null;
  const x = Math.floor(((clienteX - marco.left) / marco.width) * ancho);
  const y = Math.floor(((clienteY - marco.top) / marco.height) * alto);
  if (ajustar) return { x: Math.min(ancho - 1, Math.max(0, x)), y: Math.min(alto - 1, Math.max(0, y)) };
  return x >= 0 && y >= 0 && x < ancho && y < alto ? { x, y } : null;
}

/** Rectángulo entre dos puntos, sin importar en qué dirección se arrastró. Un clic sin arrastrar no cuenta. */
export function cajaEntre(a: { x: number; y: number }, b: { x: number; y: number }): Caja | null {
  const ancho = Math.abs(a.x - b.x) + 1;
  const alto = Math.abs(a.y - b.y) + 1;
  if (ancho < 2 || alto < 2) return null;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), ancho, alto };
}

export type CajaLeida = { ok: true; caja: Caja } | { ok: false; mensaje: string };
export type PuntoLeido = { ok: true; x: number; y: number } | { ok: false; mensaje: string };

export function leerPunto(textoX: string, textoY: string, ancho: number, alto: number): PuntoLeido {
  const x = leerEnRango(textoX, 0, ancho - 1);
  const y = leerEnRango(textoY, 0, alto - 1);
  if (!x.ok || !y.ok) return { ok: false, mensaje: `Escribe X de 0 a ${ancho - 1} y Y de 0 a ${alto - 1}.` };
  return { ok: true, x: x.valor, y: y.valor };
}

export function leerCaja(v: { x: string; y: string; ancho: string; alto: string }, ancho: number, alto: number): CajaLeida {
  const punto = leerPunto(v.x, v.y, ancho, alto);
  if (!punto.ok) return punto;
  const w = leerEnRango(v.ancho, 1, ancho);
  const h = leerEnRango(v.alto, 1, alto);
  if (!w.ok || !h.ok) return { ok: false, mensaje: `Escribe un ancho de 1 a ${ancho} y un alto de 1 a ${alto}.` };
  if (punto.x + w.valor > ancho || punto.y + h.valor > alto) return { ok: false, mensaje: 'Esa zona se sale de la imagen. Ajusta los valores.' };
  return { ok: true, caja: { x: punto.x, y: punto.y, ancho: w.valor, alto: h.valor } };
}

const TITULO_CATEGORIA: Readonly<Record<string, string>> = {
  caras_terceros: 'Personas',
  posibles_menores: 'Personas',
  desnudez: 'Contenido íntimo o sugerente',
  contenido_sugerente: 'Contenido íntimo o sugerente',
  armas: 'Armas y grupos armados',
  extremismo: 'Armas y grupos armados',
  documentos_identidad: 'Documentos y datos',
  informacion_financiera: 'Documentos y datos',
  contacto_personal: 'Documentos y datos',
  informacion_medica: 'Documentos y datos',
  boletos_viajes: 'Viajes y ubicación',
  ubicacion: 'Viajes y ubicación',
  matriculas: 'Viajes y ubicación',
  objetos_valor: 'Objetos y pantallas',
  pantallas: 'Objetos y pantallas',
  codigos: 'Objetos y pantallas',
  espacios_intimos: 'Contenido íntimo o sugerente',
};

/** Reglas agrupadas por tema, para la Guía de privacidad. */
export function agruparReglas(): { titulo: string; reglas: Regla[] }[] {
  const grupos = new Map<string, Regla[]>();
  for (const regla of catalogo.reglas) {
    const titulo = TITULO_CATEGORIA[regla.categoria];
    if (titulo === undefined) throw new Error(`Categoría sin título: ${regla.categoria}`);
    grupos.set(titulo, [...(grupos.get(titulo) ?? []), regla]);
  }
  return [...grupos].map(([titulo, reglas]) => ({ titulo, reglas }));
}

export function aEdicion(archivoId: string, r: Revision): Edicion {
  return {
    archivoId,
    decisiones: { ...r.decisiones },
    efectos: { ...r.efectos },
    intensidad: r.intensidad,
    hayMenores: r.hayMenores,
    manuales: r.manuales.map((z) => ({ ...z })),
    escalas: { ...r.escalas },
    posiciones: Object.fromEntries(Object.entries(r.posiciones).map(([id, p]) => [id, { ...p }])),
    intensidades: { ...r.intensidades },
  };
}

export function desdeEdicion(e: Edicion): Revision {
  return {
    decisiones: e.decisiones,
    efectos: e.efectos,
    intensidad: e.intensidad,
    hayMenores: e.hayMenores,
    manuales: e.manuales.map((z) => ({ ...z, origen: z.origen ?? origenPorMascara(z.mascara_id) })),
    escalas: e.escalas,
    posiciones: e.posiciones,
    intensidades: e.intensidades,
  };
}

export function hayCambios(r: Revision): boolean {
  return (
    Object.keys(r.decisiones).length > 0 ||
    Object.keys(r.efectos).length > 0 ||
    r.hayMenores !== null ||
    r.manuales.length > 0 ||
    Object.keys(r.escalas).length > 0 ||
    Object.keys(r.posiciones).length > 0 ||
    Object.keys(r.intensidades).length > 0 ||
    r.intensidad !== LIMITES.intensidad.porDefecto
  );
}

// --- Visor: zoom y zona resaltada ---------------------------------------------------------------

/** Niveles del zoom del visor. El 1 es "ajustar a la ventana". */
export const NIVELES_ZOOM = [1, 1.5, 2, 3, 4, 6, 8] as const;

/** Lo que está resaltado a la vez en la imagen y en el panel, y de dónde vino. */
export interface Resaltado {
  id: string;
  /** Solo "foco" (teclado) mueve la imagen para mostrar la zona: con el mouse sería brusco. */
  origen: 'mouse' | 'foco' | 'imagen';
}

export function limitarZoom(z: number): number {
  if (!Number.isFinite(z)) return LIMITES.zoom.porDefecto;
  return Math.min(LIMITES.zoom.max, Math.max(LIMITES.zoom.min, z));
}

/** El siguiente nivel hacia arriba o hacia abajo. En los extremos se queda donde está. */
export function pasoZoom(actual: number, direccion: 1 | -1): number {
  const z = limitarZoom(actual);
  if (direccion === 1) return NIVELES_ZOOM.find((n) => n > z + 1e-9) ?? LIMITES.zoom.max;
  return [...NIVELES_ZOOM].reverse().find((n) => n < z - 1e-9) ?? LIMITES.zoom.min;
}

export const textoZoom = (z: number): string => `${Math.round(limitarZoom(z) * 100)} %`;

/** Corte de la comparación antes/después, en % del ancho. Un valor no finito vuelve a la mitad. */
export function limitarCorte(v: number): number {
  if (!Number.isFinite(v)) return LIMITES.comparacion.porDefecto;
  return Math.min(LIMITES.comparacion.max, Math.max(LIMITES.comparacion.min, Math.round(v)));
}

/**
 * Opacidad de un rótulo de la comparación, de 0 a 1, según el % del ancho que queda de su lado.
 * Un valor no finito lo oculta: mejor sin rótulo que uno encima de la otra versión.
 */
export function opacidadRotulo(espacio: number): number {
  if (!Number.isFinite(espacio)) return 0;
  const { oculto, visible } = LIMITES.rotuloComparacion;
  const t = (espacio - oculto) / (visible - oculto);
  return Math.round(Math.min(1, Math.max(0, t)) * 100) / 100;
}

/** Dónde va el número de una zona para no tapar lo que marca. */
export type LadoEtiqueta = 'arriba' | 'abajo' | 'dentro';

/**
 * Por defecto, encima de la zona. Si la zona toca el borde superior, debajo. Si ocupa casi todo el
 * alto, dentro, porque fuera de la imagen no se vería. Las medidas van en píxeles de la foto.
 */
export function ladoEtiqueta(caja: Caja, altoImagen: number): LadoEtiqueta {
  if (!(altoImagen > 0)) return 'dentro';
  const margen = (LIMITES.margenEtiqueta / 100) * altoImagen;
  if (caja.y >= margen) return 'arriba';
  if (caja.y + caja.alto <= altoImagen - margen) return 'abajo';
  return 'dentro';
}

/**
 * Ancho en pantalla de la imagen al 100 %: lo más grande que cabe. Sin alto disponible, manda el ancho.
 * Una foto chica no se estira más de `maxEscala` veces su tamaño real; para verla más grande está el zoom.
 */
export function anchoAjustado(
  disponibleAncho: number,
  disponibleAlto: number | null,
  ancho: number,
  alto: number,
  maxEscala: number = LIMITES.ajusteMaxEscala,
): number | null {
  if (!(disponibleAncho > 0) || ancho <= 0 || alto <= 0) return null;
  const porAlto = disponibleAlto !== null && disponibleAlto > 0 ? (disponibleAlto * ancho) / alto : Number.POSITIVE_INFINITY;
  const porTamano = Number.isFinite(maxEscala) && maxEscala > 0 ? ancho * maxEscala : Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(Math.min(disponibleAncho, porAlto, porTamano)));
}

/**
 * Desplazamiento para que el punto que estaba bajo el cursor siga ahí después del zoom.
 * `fraccion` es dónde cae el punto en la imagen (0 a 1) y `enVentana`, dónde cae en la parte visible.
 */
export function desplazamientoAnclado(fraccion: number, enVentana: number, tamanoNuevo: number, visible: number): number {
  const maximo = Math.max(0, tamanoNuevo - visible);
  const ideal = fraccion * tamanoNuevo - enVentana;
  return Number.isFinite(ideal) ? Math.min(maximo, Math.max(0, ideal)) : 0;
}

/**
 * La zona bajo un punto de la imagen. Si hay varias, la más chica: es la que se quiso señalar.
 * `margen` (en píxeles de la imagen) agranda cada zona para el clic: así una zona diminuta se puede elegir.
 */
export function zonaEnPunto(x: number, y: number, zonas: readonly { id: string; caja: Caja }[], margen = 0): string | null {
  const m = Number.isFinite(margen) && margen > 0 ? margen : 0;
  let elegida: { id: string; area: number } | null = null;
  for (const { id, caja } of zonas) {
    const dentro = x >= caja.x - m && y >= caja.y - m && x < caja.x + caja.ancho + m && y < caja.y + caja.alto + m;
    const area = caja.ancho * caja.alto;
    if (dentro && (elegida === null || area < elegida.area)) elegida = { id, area };
  }
  return elegida?.id ?? null;
}

// --- Panel: grupos por tipo de riesgo y resumen ---------------------------------------------------

const TITULO_GRUPO: Readonly<Record<string, string>> = {
  'CAR-01': 'Caras',
  'MEN-01': 'Menores',
  'DOC-01': 'Documentos de identidad',
  'FIN-01': 'Información financiera',
  'VIA-01': 'Boletos y viajes',
  'VIA-02': 'Etiquetas de maleta',
  'UBI-01': 'Ubicación guardada en el archivo',
  'UBI-02': 'Fachadas y domicilios',
  'UBI-03': 'Uniformes y logos de escuela',
  'UBI-04': 'Letreros',
  'UBI-05': 'Gafetes',
  'UBI-06': 'Ventanas',
  'MAT-01': 'Placas',
  'VAL-01': 'Llaves',
  'VAL-02': 'Joyas y objetos de valor',
  'PAN-01': 'Pantallas',
  'CON-01': 'Datos de contacto',
  'MED-01': 'Información médica',
  'COD-01': 'Códigos QR y de barras',
  'DES-01': 'Desnudez',
  'SUG-01': 'Contenido sugerente',
  'INT-01': 'Baño',
  'ARM-01': 'Armas',
  'EXT-01': 'Símbolos extremistas',
};

export const tituloGrupo = (reglaId: string): string => TITULO_GRUPO[reglaId] ?? reglaDe(reglaId).que_detecta;

const PESO_MOSTRADO: Readonly<Record<NivelMostrado, number>> = { alto: 0, medio: 1, bajo: 2, pregunta: 3 };

export interface Grupo {
  reglaId: string;
  titulo: string;
  /** El nivel más grave de sus zonas. */
  nivel: NivelMostrado;
  hallazgos: Hallazgo[];
}

/** Junta los hallazgos por tipo de riesgo, en el orden en que llegan (lo más grave primero). */
export function agruparHallazgos(hallazgos: readonly Hallazgo[], r: Revision): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const h of hallazgos) {
    const nivel = nivelMostrado(h, r);
    const grupo = grupos.get(h.regla_id);
    if (grupo === undefined) {
      grupos.set(h.regla_id, { reglaId: h.regla_id, titulo: tituloGrupo(h.regla_id), nivel, hallazgos: [h] });
    } else {
      grupo.hallazgos.push(h);
      if (PESO_MOSTRADO[nivel] < PESO_MOSTRADO[grupo.nivel]) grupo.nivel = nivel;
    }
  }
  return [...grupos.values()].sort((a, b) => PESO_MOSTRADO[a.nivel] - PESO_MOSTRADO[b.nivel]);
}

export type EstadoGrupo = 'ocultar' | 'ignorar' | 'mixto' | 'pendiente';

/** Qué pasa con las zonas de un grupo: todas igual, mezcladas, o sin decidir. */
export function estadoDeZonas(r: Revision, ids: readonly string[]): EstadoGrupo {
  const decisiones = ids.map((id) => r.decisiones[id]);
  if (decisiones.length === 0 || decisiones.every((d) => d === undefined)) return 'pendiente';
  const comun = valorComun(decisiones);
  return comun === undefined || comun === null ? 'mixto' : comun;
}

const mayuscula = (texto: string): string => (texto === '' ? texto : `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`);

/** Cómo se nombra una zona dentro de su grupo: por dónde está, sin repetir el tipo de riesgo. */
export function describirZona(h: Hallazgo): string {
  const lugar = mayuscula(h.posicion ?? 'en la imagen');
  return h.requiere_revision ? `${lugar} (no estamos seguros)` : lugar;
}

export interface Conteo {
  alto: number;
  medio: number;
  bajo: number;
  preguntas: number;
  /** Zonas que se pueden tapar, contando las tuyas. */
  zonas: number;
  ocultas: number;
  visibles: number;
  sinDecidir: number;
}

/** Números para el resumen del panel. Una pregunta sin responder cuenta como algo por decidir. */
export function contarRevision(analisis: Analisis, r: Revision): Conteo {
  const conteo: Conteo = { alto: 0, medio: 0, bajo: 0, preguntas: 0, zonas: 0, ocultas: 0, visibles: 0, sinDecidir: 0 };
  for (const h of analisis.hallazgos) {
    const nivel = nivelMostrado(h, r);
    if (nivel === 'pregunta') conteo.preguntas += 1;
    else conteo[nivel] += 1;
    // La pregunta de menores sin responder también pide una decisión.
    if (reglaDe(h.regla_id).requiere_confirmacion === true && r.hayMenores === null) conteo.sinDecidir += 1;
    if (!esVisual(h)) continue;
    conteo.zonas += 1;
    const decision = r.decisiones[h.id];
    if (decision === 'ocultar') conteo.ocultas += 1;
    else if (decision === 'ignorar') conteo.visibles += 1;
    else conteo.sinDecidir += 1;
  }
  conteo.zonas += r.manuales.length;
  conteo.ocultas += r.manuales.length;
  return conteo;
}

/** Para la Guía: lo que la app revisa sola en cada foto y lo que todavía no. */
export function alcanceRevision(): { revisa: string[]; noRevisa: Regla[] } {
  return {
    revisa: Object.values(NOMBRE_REVISADO),
    noRevisa: catalogo.reglas.filter((regla) => !(regla.id in NOMBRE_REVISADO)),
  };
}

/** Si la app busca esta regla sola en cada foto. Las demás quedan para que la persona las revise. */
export const revisaSola = (reglaId: string): boolean => reglaId in NOMBRE_REVISADO;
