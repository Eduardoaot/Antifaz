import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { catalogo } from '../../app/shared/catalogo';
import {
  esquemaEdicion,
  esquemaListaPistas,
  esquemaPreferenciasCopia,
  esquemaSufijo,
  LIMITES,
  PREFERENCIAS_COPIA_INICIALES,
  type Analisis,
  type Hallazgo,
} from '../../app/shared/contrato';
import { extensionCopia, nombreCopia, nombreLibre, VARIANTES_MAX } from '../../app/shared/exportacion';
import {
  REVISION_INICIAL,
  aEdicion,
  agregarManual,
  agruparHallazgos,
  alcanceRevision,
  construirOcultamientos,
  contarRevision,
  decidir,
  decidirVarias,
  describirZona,
  desdeEdicion,
  efectoDe,
  elegirEfectoVarias,
  elegirIntensidadGlobal,
  elegirIntensidadVarias,
  estadoDeZonas,
  hayCambios,
  intensidadDe,
  limitarIntensidad,
  quitarManual,
  responderMenores,
  tituloGrupo,
  usaIntensidad,
  valorComun,
  zonaEnPunto,
} from '../../app/shared/logica';

const zona = (id: string, regla: string, x = 10, extra: Partial<Hallazgo> = {}): Hallazgo => ({
  id, regla_id: regla, caja: { x, y: 10, ancho: 20, alto: 20 }, confianza: 0.9, requiere_revision: false, posicion: 'en la parte superior izquierda', ...extra,
});
const menores: Hallazgo = { id: 'menores', regla_id: 'MEN-01', caja: null, confianza: 1, requiere_revision: true, posicion: null };
const gps: Hallazgo = { id: 'gps', regla_id: 'UBI-01', caja: null, confianza: 1, requiere_revision: false, posicion: null };
const analisis = (hallazgos: Hallazgo[]): Analisis => ({ hallazgos, cobertura: { completa: true, motivos: [], reglas_revisadas: [] } });

describe('decidir varias zonas a la vez', () => {
  it('decide todas las de la lista y deja las demás', () => {
    const r = decidirVarias(REVISION_INICIAL, ['a', 'b'], 'ocultar');
    expect(r.decisiones).toEqual({ a: 'ocultar', b: 'ocultar' });
    expect(decidirVarias(r, ['a'], 'ignorar').decisiones).toEqual({ a: 'ignorar', b: 'ocultar' });
  });

  it('sin zonas no gasta un paso del historial', () => {
    expect(decidirVarias(REVISION_INICIAL, [], 'ocultar')).toBe(REVISION_INICIAL);
    expect(elegirEfectoVarias(REVISION_INICIAL, [], 'solido')).toBe(REVISION_INICIAL);
    expect(elegirIntensidadVarias(REVISION_INICIAL, [], 50)).toBe(REVISION_INICIAL);
  });
});

describe('efecto para varias zonas', () => {
  it('las detectadas lo guardan en efectos y las tuyas en ellas mismas', () => {
    const conManual = agregarManual(REVISION_INICIAL, 'm1', { x: 0, y: 0, ancho: 5, alto: 5 }, null);
    const r = elegirEfectoVarias(conManual, ['c', 'm1'], 'pixelado');
    expect(r.efectos).toEqual({ c: 'pixelado' });
    expect(r.manuales[0]?.efecto).toBe('pixelado');
  });

  it('no toca las zonas tuyas que no se eligieron', () => {
    const con2 = agregarManual(agregarManual(REVISION_INICIAL, 'm1', { x: 0, y: 0, ancho: 5, alto: 5 }, null), 'm2', { x: 9, y: 9, ancho: 5, alto: 5 }, null);
    const r = elegirEfectoVarias(con2, ['m2'], 'emoji_gato');
    expect(r.manuales.map((z) => z.efecto)).toEqual(['solido', 'emoji_gato']);
  });
});

describe('intensidad global e individual', () => {
  it('cada zona usa la global hasta que tiene la suya', () => {
    const r = elegirIntensidadVarias(REVISION_INICIAL, ['a'], 40);
    expect(intensidadDe(r, 'a')).toBe(40);
    expect(intensidadDe(r, 'b')).toBe(LIMITES.intensidad.porDefecto);
  });

  it('la global borra las individuales: es global de verdad', () => {
    const r = elegirIntensidadGlobal(elegirIntensidadVarias(REVISION_INICIAL, ['a', 'b'], 40), 60);
    expect(r.intensidad).toBe(60);
    expect(r.intensidades).toEqual({});
    expect(intensidadDe(r, 'a')).toBe(60);
  });

  it('llega a cada ocultamiento', () => {
    const h = [zona('a', 'CAR-01'), zona('b', 'CON-01', 50)];
    let r = decidirVarias(REVISION_INICIAL, ['a', 'b'], 'ocultar');
    r = elegirIntensidadVarias(r, ['b'], 25);
    r = agregarManual(r, 'm', { x: 0, y: 0, ancho: 5, alto: 5 }, null);
    r = elegirIntensidadVarias(r, ['m'], 99);
    expect(construirOcultamientos(r, h).map((o) => o.intensidad)).toEqual([LIMITES.intensidad.porDefecto, 25, 99]);
  });

  it('siempre queda dentro del rango y entera, con cualquier número', () => {
    fc.assert(fc.property(fc.double(), (v) => {
      const leida = limitarIntensidad(v);
      expect(Number.isInteger(leida)).toBe(true);
      expect(leida).toBeGreaterThanOrEqual(LIMITES.intensidad.min);
      expect(leida).toBeLessThanOrEqual(LIMITES.intensidad.max);
    }));
    expect(limitarIntensidad(Number.NaN)).toBe(LIMITES.intensidad.porDefecto);
    expect(limitarIntensidad(Number.POSITIVE_INFINITY)).toBe(LIMITES.intensidad.porDefecto);
    expect(limitarIntensidad(0)).toBe(LIMITES.intensidad.min);
    expect(limitarIntensidad(1)).toBe(1);
    expect(limitarIntensidad(100)).toBe(100);
    expect(limitarIntensidad(101)).toBe(LIMITES.intensidad.max);
    expect(limitarIntensidad(49.6)).toBe(50);
  });

  it('quitar tu zona se lleva su intensidad', () => {
    const r = elegirIntensidadVarias(agregarManual(REVISION_INICIAL, 'm', { x: 0, y: 0, ancho: 5, alto: 5 }, null), ['m'], 30);
    expect(quitarManual(r, 'm').intensidades).toEqual({});
  });

  it('cuenta como cambio y sobrevive a la recuperación', () => {
    const r = elegirIntensidadVarias(REVISION_INICIAL, ['a'], 33);
    expect(hayCambios(r)).toBe(true);
    const edicion = esquemaEdicion.parse(aEdicion('00000000-0000-4000-8000-000000000000', r));
    expect(desdeEdicion(edicion).intensidades).toEqual({ a: 33 });
  });

  it('una recuperación anterior, sin intensidades, sigue valiendo', () => {
    const vieja = { archivoId: '00000000-0000-4000-8000-000000000000', decisiones: {}, efectos: {}, intensidad: 80, hayMenores: null };
    expect(esquemaEdicion.parse(vieja).intensidades).toEqual({});
  });

  it('la recuperación rechaza intensidades fuera de rango', () => {
    const base = { archivoId: '00000000-0000-4000-8000-000000000000', decisiones: {}, efectos: {}, intensidad: 80, hayMenores: null };
    for (const mala of [0, 101, 50.5, Number.NaN]) {
      expect(esquemaEdicion.safeParse({ ...base, intensidades: { a: mala } }).success).toBe(false);
    }
    for (const buena of [1, 100]) expect(esquemaEdicion.safeParse({ ...base, intensidades: { a: buena } }).success).toBe(true);
  });

  it('solo cambia algo en difuminado y pixelado', () => {
    expect(usaIntensidad('difuminado')).toBe(true);
    expect(usaIntensidad('pixelado')).toBe(true);
    expect(usaIntensidad('solido')).toBe(false);
    expect(usaIntensidad('emoji_mono')).toBe(false);
  });
});

describe('valor común', () => {
  it('es el valor si todos coinciden, y null si no', () => {
    expect(valorComun([3, 3, 3])).toBe(3);
    expect(valorComun([3, 4])).toBeNull();
    expect(valorComun([])).toBeNull();
  });
});

describe('grupos por tipo de riesgo', () => {
  it('junta las zonas del mismo tipo y pone lo más grave primero', () => {
    const grupos = agruparHallazgos([zona('q', 'COD-01'), zona('t1', 'CON-01'), zona('t2', 'CON-01', 60)], REVISION_INICIAL);
    expect(grupos.map((g) => g.reglaId)).toEqual(['CON-01', 'COD-01']);
    expect(grupos[0]?.hallazgos.map((h) => h.id)).toEqual(['t1', 't2']);
    expect(grupos[0]?.titulo).toBe('Datos de contacto');
  });

  it('el nivel del grupo es el más grave de sus zonas', () => {
    // Una cara dudosa baja; con menores, todas suben a alto.
    const caras = [zona('c1', 'CAR-01'), zona('c2', 'CAR-01', 50, { requiere_revision: true })];
    const conMenores = responderMenores(REVISION_INICIAL, [...caras, menores], true);
    expect(agruparHallazgos([...caras, menores], conMenores)[0]?.nivel).toBe('alto');
    expect(agruparHallazgos([menores], REVISION_INICIAL)[0]?.nivel).toBe('pregunta');
  });

  it('un tipo sin título propio usa lo que detecta', () => {
    expect(tituloGrupo('CON-01')).toBe('Datos de contacto');
    for (const r of catalogo.reglas) expect(tituloGrupo(r.id).length).toBeGreaterThan(0);
  });

  it('estado del grupo: pendiente, igual o mixto', () => {
    expect(estadoDeZonas(REVISION_INICIAL, ['a', 'b'])).toBe('pendiente');
    expect(estadoDeZonas(REVISION_INICIAL, [])).toBe('pendiente');
    expect(estadoDeZonas(decidirVarias(REVISION_INICIAL, ['a', 'b'], 'ocultar'), ['a', 'b'])).toBe('ocultar');
    expect(estadoDeZonas(decidirVarias(REVISION_INICIAL, ['a', 'b'], 'ignorar'), ['a', 'b'])).toBe('ignorar');
    expect(estadoDeZonas(decidir(REVISION_INICIAL, 'a', 'ocultar'), ['a', 'b'])).toBe('mixto');
    expect(estadoDeZonas(decidir(decidir(REVISION_INICIAL, 'a', 'ocultar'), 'b', 'ignorar'), ['a', 'b'])).toBe('mixto');
  });

  it('cada zona se nombra por dónde está, y se dice si no estamos seguros', () => {
    expect(describirZona(zona('a', 'CON-01'))).toBe('En la parte superior izquierda');
    expect(describirZona(zona('a', 'CAR-01', 1, { requiere_revision: true, posicion: null }))).toBe('En la imagen (no estamos seguros)');
    expect(describirZona(zona('a', 'CAR-01', 1, { posicion: '' }))).toBe('');
  });

  it('el efecto por defecto no cambia al agrupar', () => {
    expect(efectoDe(REVISION_INICIAL, zona('c', 'CAR-01'))).toBe('difuminado');
    expect(efectoDe(REVISION_INICIAL, zona('t', 'CON-01'))).toBe('solido');
  });
});

describe('resumen del panel', () => {
  it('cuenta niveles, zonas y lo que falta decidir', () => {
    const h = [zona('t', 'CON-01'), zona('q', 'COD-01', 40), zona('c', 'CAR-01', 70), menores, gps];
    let r = decidir(REVISION_INICIAL, 't', 'ocultar');
    r = decidir(r, 'q', 'ignorar');
    r = agregarManual(r, 'm', { x: 0, y: 0, ancho: 5, alto: 5 }, null);
    const c = contarRevision(analisis(h), r);
    // El dato de contacto y la ubicación guardada en el archivo.
    expect(c.alto).toBe(2);
    expect(c.preguntas).toBe(1);
    expect(c.alto + c.medio + c.bajo + c.preguntas).toBe(h.length);
    expect(c.zonas).toBe(4);
    expect(c.ocultas).toBe(2);
    expect(c.visibles).toBe(1);
    // La cara sin decidir y la pregunta de menores sin responder.
    expect(c.sinDecidir).toBe(2);
  });

  it('con la pregunta respondida ya no falta nada', () => {
    const h = [zona('c', 'CAR-01'), menores];
    const r = responderMenores(REVISION_INICIAL, h, true);
    expect(contarRevision(analisis(h), r).sinDecidir).toBe(0);
  });
});

describe('zona bajo el puntero con tolerancia', () => {
  const zonas = [{ id: 'chica', caja: { x: 100, y: 100, ancho: 2, alto: 2 } }];
  it('una zona diminuta se alcanza con un clic cercano', () => {
    expect(zonaEnPunto(96, 100, zonas)).toBeNull();
    expect(zonaEnPunto(96, 100, zonas, 5)).toBe('chica');
    expect(zonaEnPunto(90, 100, zonas, 5)).toBeNull();
  });

  it('un margen inválido se ignora', () => {
    expect(zonaEnPunto(96, 100, zonas, Number.NaN)).toBeNull();
    expect(zonaEnPunto(96, 100, zonas, -10)).toBeNull();
  });
});

describe('Guía: lo que se revisa en general', () => {
  it('reparte todo el catálogo entre lo que se busca y lo que no', () => {
    const { revisa, noRevisa } = alcanceRevision();
    expect(revisa).toContain('caras');
    expect(noRevisa.some((r) => r.id === 'VAL-01')).toBe(true);
    expect(noRevisa.some((r) => r.id === 'CAR-01')).toBe(false);
  });
});

describe('nombre de las copias', () => {
  it('automático conserva PNG y lo demás sale en JPG', () => {
    expect(extensionCopia('automatico', 'PNG')).toBe('png');
    expect(extensionCopia('automatico', ' png ')).toBe('png');
    expect(extensionCopia('automatico', 'JPEG')).toBe('jpg');
    expect(extensionCopia('automatico', 'HEIF')).toBe('jpg');
    expect(extensionCopia('jpg', 'PNG')).toBe('jpg');
    expect(extensionCopia('png', 'JPEG')).toBe('png');
  });

  it('une base, texto y extensión', () => {
    expect(nombreCopia('playa', '-copia', 'jpg')).toBe('playa-copia.jpg');
    expect(nombreCopia('playa', '', 'png')).toBe('playa.png');
  });

  it('nunca reemplaza: busca el siguiente número libre', () => {
    const ocupados = new Set(['a.jpg', 'a (2).jpg']);
    expect(nombreLibre('b.jpg', (n) => ocupados.has(n))).toBe('b.jpg');
    expect(nombreLibre('a.jpg', (n) => ocupados.has(n))).toBe('a (3).jpg');
    expect(nombreLibre('sin-extension', (n) => n === 'sin-extension')).toBe('sin-extension (2)');
  });

  it('si todas las variantes existen, se rinde en vez de reemplazar', () => {
    expect(nombreLibre('a.jpg', () => true)).toBeNull();
    let preguntas = 0;
    nombreLibre('a.jpg', () => { preguntas += 1; return true; });
    expect(preguntas).toBe(VARIANTES_MAX);
  });
});

describe('ajustes de las copias', () => {
  it('el texto del nombre: vacío, normal y el límite', () => {
    expect(esquemaSufijo.safeParse('').success).toBe(true);
    expect(esquemaSufijo.safeParse('-copia').success).toBe(true);
    expect(esquemaSufijo.safeParse('x'.repeat(LIMITES.sufijoExportacion)).success).toBe(true);
    expect(esquemaSufijo.safeParse('x'.repeat(LIMITES.sufijoExportacion + 1)).success).toBe(false);
  });

  it('rechaza lo que Windows no acepta en un nombre', () => {
    for (const malo of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000', 'a\u001f', 'termina.', 'termina ']) {
      expect(esquemaSufijo.safeParse(malo).success, malo).toBe(false);
    }
  });

  it('las preferencias se validan completas', () => {
    expect(esquemaPreferenciasCopia.parse(PREFERENCIAS_COPIA_INICIALES)).toEqual(PREFERENCIAS_COPIA_INICIALES);
    expect(esquemaPreferenciasCopia.safeParse({ ...PREFERENCIAS_COPIA_INICIALES, destino: 'nube' }).success).toBe(false);
    expect(esquemaPreferenciasCopia.safeParse({ ...PREFERENCIAS_COPIA_INICIALES, formato: 'gif' }).success).toBe(false);
    expect(esquemaPreferenciasCopia.safeParse({ ...PREFERENCIAS_COPIA_INICIALES, extra: 1 }).success).toBe(false);
    expect(esquemaPreferenciasCopia.safeParse({ destino: 'carpeta', formato: 'png' }).success).toBe(false);
  });
});

describe('intensidad de los objetos del video', () => {
  const pista = { pista_id: 'p', efecto: 'difuminado' as const };
  it('acepta del 1 al 100 y rechaza lo demás', () => {
    expect(esquemaListaPistas.safeParse([{ ...pista, intensidad: 1 }]).success).toBe(true);
    expect(esquemaListaPistas.safeParse([{ ...pista, intensidad: 100 }]).success).toBe(true);
    for (const mala of [0, 101, 50.5, '50']) expect(esquemaListaPistas.safeParse([{ ...pista, intensidad: mala }]).success).toBe(false);
    expect(esquemaListaPistas.safeParse([pista]).success).toBe(false);
  });
});
