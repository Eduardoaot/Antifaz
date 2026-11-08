/** Lógica pura de la revisión de una foto. Sin React ni Electron, para probarla a fondo. */
import { catalogo, etiquetaNivel, reglaDe, type Regla } from './catalogo';
import {
  LIMITES,
  type Analisis,
  type Decision,
  type Edicion,
  type Efecto,
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
}

export const REVISION_INICIAL: Revision = {
  decisiones: {},
  efectos: {},
  intensidad: LIMITES.intensidad.porDefecto,
  hayMenores: null,
  manuales: [],
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

function ocultarVarios(r: Revision, hallazgos: readonly Hallazgo[]): Revision {
  const decisiones: Record<string, Decision> = { ...r.decisiones };
  for (const h of hallazgos) decisiones[h.id] = 'ocultar';
  return { ...r, decisiones };
}

/** Oculta todo lo que tiene zona en la imagen. */
export const ocultarTodo = (r: Revision, hallazgos: readonly Hallazgo[]): Revision =>
  ocultarVarios(r, hallazgos.filter(esVisual));

/**
 * Oculta lo de riesgo alto. Si podría haber menores, las caras cuentan como riesgo alto,
 * salvo que la persona ya haya dicho que no los hay.
 */
export function ocultarRiesgoAlto(r: Revision, hallazgos: readonly Hallazgo[]): Revision {
  const hayPregunta = hallazgos.some((h) => reglaDe(h.regla_id).requiere_confirmacion === true);
  const carasEnRiesgo = hayPregunta && r.hayMenores !== false;
  return ocultarVarios(
    r,
    hallazgos.filter(
      (h) => esVisual(h) && (reglaDe(h.regla_id).nivel_riesgo === 'alto' || (carasEnRiesgo && h.regla_id === 'CAR-01')),
    ),
  );
}

/** Responder que sí hay menores oculta todas las caras; responder que no, no quita lo ya oculto. */
export function responderMenores(r: Revision, hallazgos: readonly Hallazgo[], hay: boolean): Revision {
  const conRespuesta: Revision = { ...r, hayMenores: hay };
  return hay ? ocultarVarios(conRespuesta, hallazgos.filter((h) => h.regla_id === 'CAR-01')) : conRespuesta;
}

export function efectoDe(r: Revision, h: Hallazgo): Efecto {
  return r.efectos[h.id] ?? (h.regla_id === 'CAR-01' ? 'difuminado' : 'solido');
}

export function construirOcultamientos(r: Revision, hallazgos: readonly Hallazgo[]): Ocultamiento[] {
  const salida: Ocultamiento[] = [];
  for (const h of hallazgos) {
    if (h.caja === null || r.decisiones[h.id] !== 'ocultar') continue;
    salida.push({
      ...h.caja,
      efecto: efectoDe(r, h),
      intensidad: r.intensidad,
      dilatacion_px: LIMITES.dilatacionPx.porDefecto,
      dilatacion_pct: LIMITES.dilatacionPct.porDefecto,
      mascara_id: null,
      // Con el margen de las caras, el óvalo contiene toda la cara detectada: el emoji puede ajustarse a ella.
      forma: h.regla_id === 'CAR-01' ? 'elipse' : 'caja',
    });
  }
  for (const z of r.manuales) {
    salida.push({
      x: z.x,
      y: z.y,
      ancho: z.ancho,
      alto: z.alto,
      efecto: z.efecto,
      intensidad: r.intensidad,
      dilatacion_px: LIMITES.dilatacionPx.porDefecto,
      // Un rectángulo o un trazo ya son lo que se pidió: solo llevan el margen mínimo.
      // La silueta del modelo puede quedarse corta, así que lleva el margen completo.
      dilatacion_pct: z.origen === 'silueta' ? LIMITES.dilatacionPct.porDefecto : 0,
      mascara_id: z.mascara_id,
      // Lo que dibujaste a mano se tapa completo; con silueta, el emoji se ajusta a ella en el sidecar.
      forma: 'caja',
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
  return h.caja === null && !['MEN-01', 'UBI-01'].includes(h.regla_id);
}

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

export type Veredicto = 'parcial' | 'con_advertencias' | 'sin_hallazgos';

/** Una revisión fallida o parcial nunca se presenta como limpia. */
export function veredicto(analisis: Analisis): Veredicto {
  if (!analisis.cobertura.completa) return 'parcial';
  return analisis.hallazgos.length > 0 ? 'con_advertencias' : 'sin_hallazgos';
}

export function tituloVeredicto(v: Veredicto): string {
  switch (v) {
    case 'parcial':
      return 'No pudimos revisar esta foto por completo';
    case 'con_advertencias':
      return 'Revisa estas advertencias';
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
    partes.push(`${etiquetaNivel(reglaDe(h.regla_id).nivel_riesgo)}: ${describirHallazgo(h)}`);
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
  return { ...r, manuales: r.manuales.filter((z) => z.id !== id) };
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
  };
}

export function desdeEdicion(e: Edicion): Revision {
  return {
    decisiones: e.decisiones,
    efectos: e.efectos,
    intensidad: e.intensidad,
    hayMenores: e.hayMenores,
    manuales: e.manuales.map((z) => ({ ...z, origen: z.origen ?? origenPorMascara(z.mascara_id) })),
  };
}

export function hayCambios(r: Revision): boolean {
  return (
    Object.keys(r.decisiones).length > 0 ||
    Object.keys(r.efectos).length > 0 ||
    r.hayMenores !== null ||
    r.manuales.length > 0 ||
    r.intensidad !== LIMITES.intensidad.porDefecto
  );
}
