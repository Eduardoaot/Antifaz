import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { catalogo, etiquetaNivel, reglaDe, urlsDeFuentes, type Nivel } from '../../app/shared/catalogo';
import { EMOJIS, ETIQUETA_EMOJI, esEmoji, esquemaAvisoCierre, esquemaEdicion, esquemaEfecto, esquemaOcultamiento, esquemaTrazo, LIMITES, textoCierre, type Analisis, type Hallazgo, type Motivo, type Punto } from '../../app/shared/contrato';
import {
  HISTORIAL_PASOS,
  REVISION_INICIAL,
  aEdicion,
  aPuntoDeImagen,
  ajustarSticker,
  ajustaSticker,
  enElTope,
  geometriaSticker,
  limitarPosicion,
  posicionDe,
  restablecerSticker,
  semiejesZona,
  stickerAjustado,
  escalaDe,
  escalaMinimaSticker,
  limitarEscala,
  agregarManual,
  agregarPuntoTrazo,
  textoOrigen,
  trazoLleno,
  agruparReglas,
  aplicarCambio,
  aplicarDecisionesIniciales,
  cajaEntre,
  construirOcultamientos,
  cubreTodo,
  decidir,
  desdeEdicion,
  describirHallazgo,
  deshacer,
  efectoDeManual,
  efectoManual,
  efectoDe,
  elegirEfecto,
  hayCambios,
  leerCaja,
  leerPunto,
  nuevoHistorial,
  ocultarRiesgoAlto,
  ocultarTodo,
  ordenarHallazgos,
  contarAdvertencias,
  etiquetaNivelMostrado,
  nivelMostrado,
  pendientes,
  quitarManual,
  rehacer,
  reglasNoRevisadas,
  soloAvisaSinZona,
  textoRevisado,
  responderMenores,
  resumenTexto,
  textoConfirmacion,
  textoMotivo,
  tituloVeredicto,
  veredicto,
  type Revision,
  type Veredicto,
  NIVELES_ZOOM,
  anchoAjustado,
  desplazamientoAnclado,
  ladoEtiqueta,
  limitarCorte,
  limitarZoom,
  opacidadRotulo,
  pasoZoom,
  textoZoom,
  zonaEnPunto,
  zonasConSticker,
  hallazgoDeManual,
} from '../../app/shared/logica';

const cara = (id: string, x = 10): Hallazgo => ({
  id, regla_id: 'CAR-01', caja: { x, y: 10, ancho: 20, alto: 20 }, confianza: 0.9, requiere_revision: false, posicion: 'al centro',
});
const menores: Hallazgo = { id: 'menores', regla_id: 'MEN-01', caja: null, confianza: 1, requiere_revision: true, posicion: null };
const gps: Hallazgo = { id: 'gps', regla_id: 'UBI-01', caja: null, confianza: 1, requiere_revision: false, posicion: null };
const analisis = (hallazgos: Hallazgo[], motivos: Motivo[] = []): Analisis => ({
  hallazgos,
  cobertura: { completa: motivos.length === 0, motivos, reglas_revisadas: ['CAR-01', 'MEN-01', 'UBI-01'] },
});

describe('historial', () => {
  it('deshacer y rehacer sin historial no hacen nada', () => {
    const h = nuevoHistorial();
    expect(deshacer(h)).toBe(h);
    expect(rehacer(h)).toBe(h);
  });

  it('ida y vuelta conserva el estado', () => {
    const r1 = decidir(REVISION_INICIAL, 'a', 'ocultar');
    const h = aplicarCambio(nuevoHistorial(), r1);
    expect(deshacer(h).actual).toBe(REVISION_INICIAL);
    expect(rehacer(deshacer(h)).actual).toBe(r1);
  });

  it('un cambio nuevo borra lo que se podía rehacer', () => {
    const h = deshacer(aplicarCambio(nuevoHistorial(), decidir(REVISION_INICIAL, 'a', 'ocultar')));
    expect(aplicarCambio(h, decidir(REVISION_INICIAL, 'b', 'ignorar')).futuro).toHaveLength(0);
  });

  it('un cambio idéntico no gasta un paso', () => {
    const h = nuevoHistorial();
    expect(aplicarCambio(h, h.actual)).toBe(h);
  });

  it('respeta el máximo de pasos', () => {
    let h = nuevoHistorial();
    for (let i = 0; i < HISTORIAL_PASOS + 20; i++) h = aplicarCambio(h, decidir(h.actual, String(i), 'ocultar'));
    expect(h.pasado).toHaveLength(HISTORIAL_PASOS);
  });

  it('propiedad: cualquier secuencia de deshacer y rehacer termina en un estado conocido', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('c', 'd', 'r'), { maxLength: 80 }), (pasos) => {
        let h = nuevoHistorial();
        const vistos = new Set([h.actual]);
        pasos.forEach((p, i) => {
          if (p === 'c') {
            h = aplicarCambio(h, decidir(h.actual, String(i), 'ocultar'));
            vistos.add(h.actual);
          } else {
            h = p === 'd' ? deshacer(h) : rehacer(h);
          }
        });
        return vistos.has(h.actual);
      }),
      { numRuns: 500 },
    );
  });
});

describe('ocultamientos', () => {
  it('solo salen las zonas marcadas para ocultar', () => {
    const lista = [cara('a'), cara('b', 40), gps, menores];
    let r = decidir(REVISION_INICIAL, 'a', 'ocultar');
    r = decidir(r, 'b', 'ignorar');
    expect(construirOcultamientos(r, lista).map((o) => o.x)).toEqual([10]);
  });

  it('una decisión sobre algo sin zona no genera ocultamiento', () => {
    expect(construirOcultamientos(decidir(REVISION_INICIAL, 'gps', 'ocultar'), [gps])).toEqual([]);
  });

  it('las caras se difuminan por defecto y lo demás lleva bloque sólido', () => {
    const otro: Hallazgo = { ...cara('m'), regla_id: 'MAT-01' };
    expect(efectoDe(REVISION_INICIAL, cara('a'))).toBe('difuminado');
    expect(efectoDe(REVISION_INICIAL, otro)).toBe('solido');
    expect(efectoDe(elegirEfecto(REVISION_INICIAL, 'a', 'pixelado'), cara('a'))).toBe('pixelado');
  });

  it('todo ocultamiento cumple el contrato con el sidecar', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.constantFrom(...esquemaEfecto.options), (intensidad, efecto) => {
        const r = elegirEfecto({ ...decidir(REVISION_INICIAL, 'a', 'ocultar'), intensidad }, 'a', efecto);
        return construirOcultamientos(r, [cara('a')]).every((o) => esquemaOcultamiento.safeParse(o).success);
      }),
    );
  });
});

describe('emoji', () => {
  it('cada emoji es un efecto válido con su nombre para lectores de pantalla', () => {
    for (const e of EMOJIS) {
      expect(esquemaEfecto.safeParse(e).success).toBe(true);
      expect(esEmoji(e)).toBe(true);
      expect(ETIQUETA_EMOJI[e].length).toBeGreaterThan(2);
    }
    for (const otro of ['solido', 'difuminado', 'pixelado'] as const) expect(esEmoji(otro)).toBe(false);
  });

  it.each(['emoji', 'emoji_perro', 'EMOJI_GATO', '😀', ''])('rechaza el efecto %j', (malo) => {
    expect(esquemaEfecto.safeParse(malo).success).toBe(false);
  });

  it('una cara con emoji sale tal cual hacia el sidecar, con forma de óvalo para ajustarse', () => {
    const r = elegirEfecto(decidir(REVISION_INICIAL, 'a', 'ocultar'), 'a', 'emoji_gato');
    expect(efectoDe(r, cara('a'))).toBe('emoji_gato');
    expect(construirOcultamientos(r, [cara('a')])[0]).toMatchObject({ efecto: 'emoji_gato', forma: 'elipse' });
  });

  it('solo las caras van con óvalo: lo demás y lo manual se tapa completo', () => {
    const placa: Hallazgo = { ...cara('p'), regla_id: 'MAT-01' };
    let r = ocultarTodo(REVISION_INICIAL, [placa]);
    r = agregarManual(r, 'm', { x: 1, y: 1, ancho: 10, alto: 10 }, null, 'rectangulo');
    expect(construirOcultamientos(r, [placa]).map((o) => o.forma)).toEqual(['caja', 'caja']);
  });

  it.each([undefined, 'circulo', 'ELIPSE', null])('rechaza la forma %j', (mala) => {
    const base = construirOcultamientos(decidir(REVISION_INICIAL, 'a', 'ocultar'), [cara('a')])[0];
    expect(esquemaOcultamiento.safeParse({ ...base, forma: mala }).success).toBe(false);
  });

  it('una zona manual también acepta emoji', () => {
    const r = agregarManual(REVISION_INICIAL, 'm', { x: 1, y: 1, ancho: 10, alto: 10 }, null, 'rectangulo');
    const conEmoji = efectoDeManual(r, 'm', 'emoji_estrella');
    expect(conEmoji.manuales[0]?.efecto).toBe('emoji_estrella');
    expect(construirOcultamientos(conEmoji, []).every((o) => esquemaOcultamiento.safeParse(o).success)).toBe(true);
  });

  it('la recuperación tras un cierre conserva el emoji elegido', () => {
    const r = elegirEfecto(decidir(REVISION_INICIAL, 'a', 'ocultar'), 'a', 'emoji_lentes');
    const guardada = esquemaEdicion.parse(JSON.parse(JSON.stringify(aEdicion('3f2b6c1e-8a4d-4b7e-9c2a-1d5e6f7a8b9c', r))));
    expect(desdeEdicion(guardada).efectos.a).toBe('emoji_lentes');
  });
});

describe('tamaño del sticker sobre una cara', () => {
  // Caja con el margen de caras (x1.3) alrededor de lo que vio el detector.
  const conNucleo = (id = 'a'): Hallazgo => ({
    ...cara(id), caja: { x: 100, y: 100, ancho: 130, alto: 130 }, nucleo: { x: 115, y: 115, ancho: 100, alto: 100 },
  });
  const conEmoji = (efecto: 'emoji_sonrisa' | 'difuminado' = 'emoji_sonrisa'): Revision =>
    elegirEfecto(decidir(REVISION_INICIAL, 'a', 'ocultar'), 'a', efecto);

  it('cualquier zona con emoji cambia de tamaño y se mueve; sin emoji o sin zona, no', () => {
    expect(ajustaSticker(conEmoji(), conNucleo())).toBe(true);
    expect(ajustaSticker(conEmoji('difuminado'), conNucleo())).toBe(false);
    expect(ajustaSticker(conEmoji(), cara('a'))).toBe(true);
    expect(ajustaSticker(conEmoji(), { ...conNucleo(), nucleo: null })).toBe(true);
    expect(ajustaSticker(conEmoji(), { ...conNucleo(), regla_id: 'MAT-01' })).toBe(true);
    expect(ajustaSticker(conEmoji(), { ...conNucleo(), caja: null })).toBe(false);
  });

  it('sin cara del detector, el sticker se encoge y se mueve libre: debajo queda el relleno', () => {
    const placa: Hallazgo = { ...conNucleo(), regla_id: 'MAT-01', nucleo: null };
    expect(escalaMinimaSticker(placa)).toBe(LIMITES.escalaSticker.min);
    expect(posicionDe(ajustarSticker(conEmoji(), placa, { posicion: { x: 0.3, y: 0 } }), 'a')).toEqual({ x: 0.3, y: 0 });
    const chica = ajustarSticker(conEmoji(), placa, { escala: 0.3 });
    expect(escalaDe(chica, 'a')).toBe(0.3);
    const [o] = construirOcultamientos(ajustarSticker(chica, placa, { posicion: { x: 0.3, y: 0 } }), [placa]);
    expect(o).toMatchObject({ forma: 'caja', nucleo: null, escala: 0.3, desplazamiento_x: 0.3, desplazamiento_y: 0 });
    expect(esquemaOcultamiento.safeParse(o).success).toBe(true);
  });

  it('tus zonas con emoji también tienen sticker, con su tamaño y posición', () => {
    let r = agregarManual(REVISION_INICIAL, 'm', { x: 100, y: 100, ancho: 80, alto: 60 }, null, 'rectangulo');
    expect(zonasConSticker(r, [])).toEqual([]);
    r = efectoDeManual(r, 'm', 'emoji_mono');
    const [zona] = zonasConSticker(r, []);
    expect(zona).toEqual(hallazgoDeManual(r.manuales[0]!));
    expect(efectoDe(r, zona!)).toBe('emoji_mono');
    r = ajustarSticker(ajustarSticker(r, zona!, { escala: 1.6 }), zona!, { posicion: { x: -0.4, y: 0.2 } });
    const [o] = construirOcultamientos(r, []);
    expect(o).toMatchObject({ efecto: 'emoji_mono', forma: 'caja', nucleo: null, escala: 1.6, desplazamiento_x: -0.4, desplazamiento_y: 0.2 });
    // Con otro efecto, el ajuste guardado no se envía.
    expect(construirOcultamientos(efectoDeManual(r, 'm', 'solido'), [])[0]).toMatchObject({ escala: 1, desplazamiento_x: 0, desplazamiento_y: 0 });
    // Al quitar la zona, su sticker se va con ella.
    expect(stickerAjustado(quitarManual(r, 'm'), 'm')).toBe(false);
  });

  it('solo cuentan las zonas detectadas que decidiste ocultar', () => {
    const placa: Hallazgo = { ...conNucleo('p'), regla_id: 'MAT-01', nucleo: null };
    const r = elegirEfecto(REVISION_INICIAL, 'p', 'emoji_estrella');
    expect(zonasConSticker(r, [placa])).toEqual([]);
    expect(zonasConSticker(decidir(r, 'p', 'ocultar'), [placa])).toEqual([placa]);
  });

  it('no hay un mínimo propio: se puede achicar hasta el límite general', () => {
    expect(escalaMinimaSticker(conNucleo())).toBe(LIMITES.escalaSticker.min);
    expect(escalaMinimaSticker(cara('a'))).toBe(LIMITES.escalaSticker.min);
  });

  it.each([
    [0.05, 0.1], [0.1, 0.1], [0.25, 0.25], [0.5, 0.5], [1.03, 1.05], [2, 2], [2.5, 2], [-1, 0.1],
    [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1], [Number.NEGATIVE_INFINITY, 1],
  ])('limitarEscala(%s) = %s', (entrada, esperado) => {
    expect(limitarEscala(entrada)).toBe(esperado);
  });

  it('propiedad: la escala limitada siempre queda en rango', () => {
    fc.assert(fc.property(fc.double(), (v) => {
      const e = limitarEscala(v);
      return e >= LIMITES.escalaSticker.min && e <= LIMITES.escalaSticker.max;
    }));
  });

  it('cambiar el tamaño se guarda, volver a 1 lo quita, y repetirlo no gasta un paso', () => {
    const r = ajustarSticker(conEmoji(), conNucleo(), { escala: 0.8 });
    expect(escalaDe(r, 'a')).toBe(0.8);
    expect(hayCambios({ ...REVISION_INICIAL, escalas: r.escalas })).toBe(true);
    expect(ajustarSticker(r, conNucleo(), { escala: 0.8 })).toBe(r);
    expect(ajustarSticker(r, conNucleo(), { escala: 1 }).escalas).toEqual({});
  });

  it('va al sidecar con la caja del detector solo si es un emoji', () => {
    const r = ajustarSticker(conEmoji(), conNucleo(), { escala: 0.8 });
    const [o] = construirOcultamientos(r, [conNucleo()]);
    expect(o).toMatchObject({ forma: 'elipse', escala: 0.8, nucleo: { x: 115, y: 115, ancho: 100, alto: 100 } });
    expect(esquemaOcultamiento.safeParse(o).success).toBe(true);
    const [d] = construirOcultamientos(elegirEfecto(r, 'a', 'difuminado'), [conNucleo()]);
    expect(d).toMatchObject({ escala: 1, nucleo: null });
  });

  it('el esquema rechaza una escala fuera de rango y una cara fuera de su zona', () => {
    const [o] = construirOcultamientos(conEmoji(), [conNucleo()]);
    expect(o).toBeDefined();
    for (const escala of [0.05, 2.01, Number.NaN, '1', null, undefined]) {
      expect(esquemaOcultamiento.safeParse({ ...o, escala }).success).toBe(false);
    }
    for (const nucleo of [{ x: 99, y: 115, ancho: 100, alto: 100 }, { x: 115, y: 115, ancho: 116, alto: 100 }, { x: 115, y: 115, ancho: 0, alto: 100 }, undefined]) {
      expect(esquemaOcultamiento.safeParse({ ...o, nucleo }).success).toBe(false);
    }
    expect(esquemaOcultamiento.safeParse({ ...o, nucleo: { x: 100, y: 100, ancho: 130, alto: 130 } }).success).toBe(true);
  });

  it('la recuperación conserva el tamaño, y las guardadas antes no lo traen', () => {
    const r = ajustarSticker(conEmoji(), conNucleo(), { escala: 1.5 });
    const e = esquemaEdicion.parse(JSON.parse(JSON.stringify(aEdicion('3f2b6c1e-8a4d-4b7e-9c2a-1d5e6f7a8b9c', r))));
    expect(desdeEdicion(e).escalas).toEqual({ a: 1.5 });
    const { escalas: _, ...vieja } = e;
    expect(esquemaEdicion.parse(vieja).escalas).toEqual({});
    expect(esquemaEdicion.safeParse({ ...e, escalas: { a: 3 } }).success).toBe(false);
  });

  it('moverlo se guarda dentro del rango; más lejos se queda en el borde', () => {
    const h = conNucleo();
    const r = ajustarSticker(conEmoji(), h, { posicion: { x: 0.6, y: -0.4 } });
    expect(posicionDe(r, 'a')).toEqual({ x: 0.6, y: -0.4 });
    expect(enElTope(h, 1, posicionDe(r, 'a'))).toBe(false);
    const lejos = ajustarSticker(conEmoji(), h, { posicion: { x: 9, y: 0 } });
    expect(posicionDe(lejos, 'a')).toEqual({ x: LIMITES.posicionSticker.max, y: 0 });
    expect(enElTope(h, 1, posicionDe(lejos, 'a'))).toBe(true);
    expect(stickerAjustado(lejos, 'a')).toBe(true);
    expect(hayCambios({ ...REVISION_INICIAL, posiciones: lejos.posiciones })).toBe(true);
  });

  it('achicarlo no lo mueve, y en cualquier tamaño se puede mover', () => {
    const h = conNucleo();
    const chico = ajustarSticker(conEmoji(), h, { escala: 0.1 });
    expect(escalaDe(chico, 'a')).toBe(0.1);
    expect(posicionDe(ajustarSticker(chico, h, { posicion: { x: 0.5, y: 0 } }), 'a')).toEqual({ x: 0.5, y: 0 });
    const movido = ajustarSticker(conEmoji(), h, { posicion: { x: 0.25, y: 0 } });
    expect(posicionDe(ajustarSticker(movido, h, { escala: 0.85 }), 'a')).toEqual({ x: 0.25, y: 0 });
  });

  it('restablecer quita tamaño y posición; sin ajustes no gasta un paso', () => {
    const h = conNucleo();
    const r = ajustarSticker(ajustarSticker(conEmoji(), h, { escala: 1.5 }), h, { posicion: { x: 0.2, y: 0.3 } });
    const limpio = restablecerSticker(r, 'a');
    expect(limpio.escalas).toEqual({});
    expect(limpio.posiciones).toEqual({});
    expect(stickerAjustado(limpio, 'a')).toBe(false);
    expect(restablecerSticker(limpio, 'a')).toBe(limpio);
  });

  it.each([
    [{ x: Number.NaN, y: 0 }, { x: 0, y: 0 }],
    [{ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 0, y: 0 }],
    [{ x: 0, y: -9 }, { x: 0, y: -2 }],
    [{ x: 0.123, y: 0 }, { x: 0.12, y: 0 }],
  ])('limitarPosicion(%j) con escala 1 = %j', (entrada, esperado) => {
    expect(limitarPosicion(conNucleo(), 1, entrada)).toEqual(esperado);
  });

  it('propiedad: la posición limitada siempre queda en el rango y es finita', () => {
    const h = conNucleo();
    const { max } = LIMITES.posicionSticker;
    fc.assert(fc.property(fc.double(), fc.double(), fc.double({ min: 0, max: 3, noNaN: true }), (x, y, escala) => {
      const p = limitarPosicion(h, escala, { x, y });
      return Math.abs(p.x) <= max && Math.abs(p.y) <= max && Number.isFinite(p.x) && Number.isFinite(p.y);
    }));
  });

  it('el marco: centro y lado aproximados en píxeles de la imagen', () => {
    // Zona de 130 px: margen 13, semiejes 78, base 156.
    const caja = { x: 100, y: 100, ancho: 130, alto: 130 };
    const sonrisa = geometriaSticker(caja, 'emoji_sonrisa', 1, { x: 0, y: 0 });
    expect(sonrisa.cx).toBe(165);
    expect(sonrisa.cy).toBe(165);
    expect(sonrisa.lado).toBeCloseTo(156 / 0.87, 6);
    // La estrella llega al tope: el doble de la base.
    expect(geometriaSticker(caja, 'emoji_estrella', 1, { x: 0, y: 0 }).lado).toBe(312);
    expect(geometriaSticker(caja, 'emoji_sonrisa', 0.5, { x: 0.25, y: -0.5 })).toMatchObject({ cx: 165 + 19.5, cy: 165 - 39 });
    expect(semiejesZona(caja)).toEqual({ x: 78, y: 78 });
  });

  it('va al sidecar con su desplazamiento, y otros efectos van centrados', () => {
    const h = conNucleo();
    const r = ajustarSticker(conEmoji(), h, { posicion: { x: 0.2, y: -0.1 } });
    const [o] = construirOcultamientos(r, [h]);
    expect(o).toMatchObject({ desplazamiento_x: 0.2, desplazamiento_y: -0.1 });
    expect(esquemaOcultamiento.safeParse(o).success).toBe(true);
    const [d] = construirOcultamientos(elegirEfecto(r, 'a', 'difuminado'), [h]);
    expect(d).toMatchObject({ desplazamiento_x: 0, desplazamiento_y: 0 });
    for (const malo of [2.01, -2.01, Number.NaN, '0', null, undefined]) {
      expect(esquemaOcultamiento.safeParse({ ...o, desplazamiento_x: malo }).success).toBe(false);
      expect(esquemaOcultamiento.safeParse({ ...o, desplazamiento_y: malo }).success).toBe(false);
    }
  });

  it('la recuperación conserva la posición, y las guardadas antes no la traen', () => {
    const r = ajustarSticker(conEmoji(), conNucleo(), { posicion: { x: -0.2, y: 0.1 } });
    const e = esquemaEdicion.parse(JSON.parse(JSON.stringify(aEdicion('3f2b6c1e-8a4d-4b7e-9c2a-1d5e6f7a8b9c', r))));
    expect(desdeEdicion(e).posiciones).toEqual({ a: { x: -0.2, y: 0.1 } });
    const { posiciones: _, ...vieja } = e;
    expect(esquemaEdicion.parse(vieja).posiciones).toEqual({});
    expect(esquemaEdicion.safeParse({ ...e, posiciones: { a: { x: 3, y: 0 } } }).success).toBe(false);
    expect(esquemaEdicion.safeParse({ ...e, posiciones: { a: { x: 0 } } }).success).toBe(false);
  });
});

describe('acciones masivas', () => {
  const lista = [cara('a'), cara('b'), menores, gps];

  it('ocultar todo marca solo lo que tiene zona', () => {
    const r = ocultarTodo(REVISION_INICIAL, lista);
    expect(Object.keys(r.decisiones).sort()).toEqual(['a', 'b']);
  });

  it('ocultar riesgo alto incluye las caras solo si dijiste que hay menores', () => {
    // Sin respuesta, una cara es riesgo bajo: el botón oculta lo que la pantalla marca como alto.
    expect(ocultarRiesgoAlto(REVISION_INICIAL, lista).decisiones).toEqual({});
    const conSi = responderMenores(REVISION_INICIAL, lista, true);
    expect(Object.keys(ocultarRiesgoAlto(conSi, lista).decisiones).sort()).toEqual(['a', 'b']);
  });

  it('si dijiste que no hay menores, las caras no cuentan como riesgo alto', () => {
    const r = responderMenores(REVISION_INICIAL, lista, false);
    expect(ocultarRiesgoAlto(r, lista).decisiones).toEqual({});
  });

  it('ocultar riesgo alto incluye zonas de reglas de nivel alto', () => {
    const doc: Hallazgo = { ...cara('d'), regla_id: 'DOC-01' };
    expect(ocultarRiesgoAlto(REVISION_INICIAL, [doc]).decisiones).toEqual({ d: 'ocultar' });
  });

  it('responder que sí oculta caras; responder que no, no destapa lo ya oculto', () => {
    const si = responderMenores(REVISION_INICIAL, lista, true);
    expect(si.decisiones).toEqual({ a: 'ocultar', b: 'ocultar' });
    expect(responderMenores(si, lista, false).decisiones).toEqual({ a: 'ocultar', b: 'ocultar' });
  });
});

describe('pendientes', () => {
  it('cuenta zonas sin decidir y la pregunta de menores, no el GPS', () => {
    expect(pendientes(REVISION_INICIAL, [cara('a'), menores, gps]).map((h) => h.id)).toEqual(['a', 'menores']);
    const r = responderMenores(decidir(REVISION_INICIAL, 'a', 'ignorar'), [], false);
    expect(pendientes(r, [cara('a'), menores, gps])).toEqual([]);
  });
});

describe('veredicto: una falla nunca parece limpia', () => {
  it.each([
    [analisis([]), 'sin_hallazgos'],
    [analisis([gps]), 'con_advertencias'],
    [analisis([cara('a'), menores]), 'leve'],
    [analisis([cara('a'), menores, gps]), 'con_advertencias'],
    [analisis([], ['modelo_no_disponible']), 'parcial'],
    [analisis([gps], ['deteccion_fallo']), 'parcial'],
  ] as const)('%#', (a, esperado) => {
    expect(veredicto(a)).toBe(esperado);
  });

  it.each(['parcial', 'con_advertencias', 'leve', 'sin_hallazgos'] as Veredicto[])('%s tiene título', (v) => {
    expect(tituloVeredicto(v).length).toBeGreaterThan(0);
  });

  it('propiedad: si la cobertura está incompleta jamás dice que no encontró nada', () => {
    fc.assert(
      fc.property(fc.constantFrom<Motivo>('metadatos', 'demasiado_pequena', 'modelo_no_disponible', 'deteccion_fallo'), fc.boolean(), (m, conGps) => {
        const texto = resumenTexto('x.jpg', analisis(conGps ? [gps] : [], [m]), REVISION_INICIAL);
        return !texto.includes('No encontramos nada riesgoso');
      }),
    );
  });

  it.each(['metadatos', 'demasiado_pequena', 'modelo_no_disponible', 'deteccion_fallo', 'contenido_no_disponible', 'contenido_fallo', 'texto_fallo', 'codigos_fallo', 'objetos_no_disponible', 'objetos_fallo'] as Motivo[])('motivo %s tiene texto', (m) => {
    expect(textoMotivo(m).length).toBeGreaterThan(0);
  });

  it('un valor inesperado falla en voz alta en vez de ignorarse', () => {
    expect(() => textoMotivo('otro' as Motivo)).toThrow();
    expect(() => tituloVeredicto('otro' as Veredicto)).toThrow();
    expect(() => etiquetaNivel('otro' as Nivel)).toThrow();
    expect(() => reglaDe('NO-00')).toThrow();
  });
});

describe('texto para lector de pantalla', () => {
  it('describe caras con posición, GPS y menores, sin afirmar edad', () => {
    const texto = resumenTexto('foto.jpg', analisis([cara('a'), menores, gps]), decidir(REVISION_INICIAL, 'a', 'ocultar'));
    expect(texto).toContain('foto.jpg');
    expect(texto).toContain('1 cara detectada, 1 para ocultar');
    expect(texto).toContain('Se detectó una cara al centro.');
    expect(texto).toContain('Podría haber menores en la foto');
    expect(texto).toContain('Riesgo alto');
    expect(texto).not.toMatch(/\d+\s*años/);
  });

  it('una posible cara se dice con duda y se cuenta aparte', () => {
    const dudosa: Hallazgo = { ...cara('d', 50), requiere_revision: true, confianza: 0.3 };
    expect(describirHallazgo(dudosa)).toBe('Podría ser una cara, al centro. No estamos seguros: revísala.');
    expect(describirHallazgo({ ...dudosa, posicion: null })).toContain('en la imagen');
    expect(resumenTexto('f', analisis([dudosa]), REVISION_INICIAL)).toContain('1 posible cara, 0 para ocultar');
    expect(resumenTexto('f', analisis([cara('a'), dudosa, { ...dudosa, id: 'e' }]), REVISION_INICIAL)).toContain('1 cara detectada y 2 posibles caras, 0 para ocultar');
  });

  it('usa plural y describe sin posición', () => {
    expect(resumenTexto('f', analisis([cara('a'), cara('b')]), REVISION_INICIAL)).toContain('2 caras detectadas, 0 para ocultar');
    expect(describirHallazgo({ ...cara('a'), posicion: null })).toBe('Se detectó una cara en la imagen.');
  });

  it('otras reglas usan el texto del catálogo', () => {
    expect(describirHallazgo({ ...cara('a'), regla_id: 'MAT-01' })).toBe('Podría ser una matrícula al centro.');
    expect(describirHallazgo({ ...cara('a'), regla_id: 'MAT-01', posicion: null })).toBe('Podría ser una matrícula.');
    expect(describirHallazgo({ ...cara('a'), regla_id: 'UBI-02', posicion: null })).toBe('Fachadas de casas y números de domicilio.');
  });
});

describe('revisión de contenido', () => {
  const desnudez: Hallazgo = { ...cara('z'), regla_id: 'DES-01' };
  const sugerente: Hallazgo = { ...cara('s'), regla_id: 'SUG-01' };
  const arma: Hallazgo = { id: 'a', regla_id: 'ARM-01', caja: null, confianza: 0.8, requiere_revision: true, posicion: null };

  it('la desnudez se marca sola, con bloque sólido, y lo demás espera tu decisión', () => {
    const r = aplicarDecisionesIniciales(REVISION_INICIAL, [desnudez, sugerente, arma, cara('c')]);
    expect(r.decisiones).toEqual({ z: 'ocultar' });
    expect(efectoDe(r, desnudez)).toBe('solido');
    expect(construirOcultamientos(r, [desnudez])).toHaveLength(1);
  });

  it('no pisa lo que ya decidiste y no crea cambios si no hay nada', () => {
    const r = decidir(REVISION_INICIAL, 'z', 'ignorar');
    expect(aplicarDecisionesIniciales(r, [desnudez])).toBe(r);
    expect(aplicarDecisionesIniciales(REVISION_INICIAL, [cara('c')])).toBe(REVISION_INICIAL);
    expect(aplicarDecisionesIniciales(REVISION_INICIAL, [{ ...desnudez, caja: null }])).toBe(REVISION_INICIAL);
  });

  it('los avisos dicen podría, nunca afirman', () => {
    expect(describirHallazgo(arma)).toBe('Podría mostrar armas o personas armadas.');
    expect(describirHallazgo({ ...desnudez, posicion: 'al centro' })).toBe('Podría verse desnudez al centro.');
    expect(describirHallazgo({ ...arma, regla_id: 'EXT-01' })).toMatch(/^Podría mostrar símbolos/);
  });

  it('lo más grave va primero y lo dudoso después de lo seguro', () => {
    const dudosa: Hallazgo = { ...cara('d'), confianza: 0.3, requiere_revision: true };
    const orden = ordenarHallazgos([dudosa, cara('c'), { ...arma, regla_id: 'EXT-01' }, sugerente]).map((h) => h.id);
    expect(orden[0]).toBe('a');
    expect(orden.indexOf('c')).toBeLessThan(orden.indexOf('d'));
    const entrada = [cara('c')];
    expect(ordenarHallazgos(entrada)).not.toBe(entrada);
  });

  it('dice qué se puede tapar y qué no', () => {
    expect(soloAvisaSinZona(arma)).toBe(true);
    expect(soloAvisaSinZona(desnudez)).toBe(false);
    expect(soloAvisaSinZona(gps)).toBe(false);
    expect(soloAvisaSinZona(menores)).toBe(false);
  });

  it('avisa que un documento sin texto legible podría pasar', () => {
    const a: Analisis = { hallazgos: [], cobertura: { completa: true, motivos: [], reglas_revisadas: ['CON-01', 'COD-01'] } };
    expect(textoRevisado(a)).toContain('sin texto legible podría pasar');
    expect(textoRevisado(a)).toContain('códigos QR');
  });

  it('nombra solo lo que sí se revisó', () => {
    expect(textoRevisado(analisis([]))).toContain('caras, ubicación guardada en el archivo');
    const parcial: Analisis = { hallazgos: [], cobertura: { completa: false, motivos: ['contenido_fallo'], reglas_revisadas: ['UBI-01'] } };
    expect(textoRevisado(parcial)).toContain('En esta foto revisamos: ubicación guardada en el archivo.');
    expect(textoRevisado({ ...parcial, cobertura: { ...parcial.cobertura, reglas_revisadas: [] } })).toContain('no pudimos revisar nada');
  });
});

describe('zonas manuales', () => {
  const caja = { x: 10, y: 20, ancho: 30, alto: 40 };

  it('se agrega, cambia y quita, con bloque sólido por defecto', () => {
    const r = agregarManual(REVISION_INICIAL, 'm', caja, null);
    expect(efectoManual(r.manuales[0]!)).toBe('solido');
    expect(efectoDeManual(r, 'm', 'pixelado').manuales[0]?.efecto).toBe('pixelado');
    expect(efectoDeManual(r, 'otra', 'pixelado').manuales[0]?.efecto).toBe('solido');
    expect(quitarManual(r, 'm').manuales).toEqual([]);
    expect(hayCambios(r)).toBe(true);
  });

  it('llega al sidecar y cumple el contrato', () => {
    const r = agregarManual(agregarManual(REVISION_INICIAL, 'a', caja, null), 'b', caja, 'mascara');
    const lista = construirOcultamientos(r, []);
    expect(lista.map((o) => o.mascara_id)).toEqual([null, 'mascara']);
    expect(lista[0]?.dilatacion_pct).toBe(0);
    expect(lista[1]?.dilatacion_pct).toBe(10);
    expect(lista.every((o) => esquemaOcultamiento.safeParse(o).success)).toBe(true);
  });

  it('sobrevive a la recuperación', () => {
    const r = agregarManual(REVISION_INICIAL, 'm', caja, 'x');
    const e = aEdicion('6f9619ff-8b86-4011-b42d-00c04fc964ff', r);
    expect(esquemaEdicion.parse(e).manuales).toHaveLength(1);
    expect(desdeEdicion(e).manuales[0]?.mascara_id).toBe('x');
    const { manuales: _m, ...vieja } = e;
    expect(esquemaEdicion.parse(vieja).manuales).toEqual([]);
  });

  it('el origen sale de la máscara si no se dice, y se nombra en pantalla', () => {
    expect(agregarManual(REVISION_INICIAL, 'a', caja, null).manuales[0]?.origen).toBe('rectangulo');
    expect(agregarManual(REVISION_INICIAL, 'a', caja, 'm').manuales[0]?.origen).toBe('silueta');
    expect(agregarManual(REVISION_INICIAL, 'a', caja, 'm', 'pincel').manuales[0]?.origen).toBe('pincel');
    expect(['rectangulo', 'silueta', 'pincel'].map((o) => textoOrigen(o as 'pincel'))).toEqual(['rectángulo', 'silueta', 'trazo a mano']);
    expect(() => textoOrigen('otro' as 'pincel')).toThrow();
  });

  it('un trazo lleva su silueta y solo el margen mínimo: es lo que se pintó', () => {
    const r = agregarManual(REVISION_INICIAL, 'p', caja, 'trazo', 'pincel');
    const [o] = construirOcultamientos(r, []);
    expect(o?.mascara_id).toBe('trazo');
    expect(o?.dilatacion_pct).toBe(0);
    expect(o?.dilatacion_px).toBe(LIMITES.dilatacionPx.porDefecto);
  });

  it('el origen sobrevive a la recuperación, y una recuperación vieja sin origen lo deduce', () => {
    const r = agregarManual(agregarManual(REVISION_INICIAL, 'p', caja, 'trazo', 'pincel'), 'q', caja, 'sam');
    const e = esquemaEdicion.parse(aEdicion('6f9619ff-8b86-4011-b42d-00c04fc964ff', r));
    expect(desdeEdicion(e)).toEqual(r);
    const vieja = { ...e, manuales: e.manuales.map(({ origen: _o, ...resto }) => resto) };
    expect(desdeEdicion(esquemaEdicion.parse(vieja)).manuales.map((z) => z.origen)).toEqual(['silueta', 'silueta']);
    expect(esquemaEdicion.safeParse({ ...e, manuales: [{ ...e.manuales[0], origen: 'otro' }] }).success).toBe(false);
  });

  it('detecta una zona que cubre todo', () => {
    expect(cubreTodo({ x: 0, y: 0, ancho: 100, alto: 50 }, 100, 50)).toBe(true);
    expect(cubreTodo({ x: 1, y: 0, ancho: 99, alto: 50 }, 100, 50)).toBe(false);
    expect(cubreTodo({ x: 0, y: 0, ancho: 99, alto: 50 }, 100, 50)).toBe(false);
  });
});

describe('coordenadas', () => {
  const marco = { left: 100, top: 50, width: 200, height: 100 };

  it('convierte de pantalla a imagen', () => {
    expect(aPuntoDeImagen(100, 50, marco, 1000, 500)).toEqual({ x: 0, y: 0 });
    expect(aPuntoDeImagen(299, 149, marco, 1000, 500)).toEqual({ x: 995, y: 495 });
  });

  it.each([[99, 60], [100, 49], [300, 60], [150, 150]])('fuera de la imagen: %i, %i', (x, y) => {
    expect(aPuntoDeImagen(x, y, marco, 1000, 500)).toBeNull();
  });

  it('al arrastrar afuera se ajusta al borde', () => {
    expect(aPuntoDeImagen(9999, 9999, marco, 1000, 500, true)).toEqual({ x: 999, y: 499 });
    expect(aPuntoDeImagen(-9999, -9999, marco, 1000, 500, true)).toEqual({ x: 0, y: 0 });
  });

  it('un marco sin tamaño no divide entre cero', () => {
    expect(aPuntoDeImagen(1, 1, { left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
  });

  it('propiedad: todo punto ajustado cae dentro de la imagen', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: 1, max: 30000 }), fc.integer({ min: 1, max: 30000 }), (x, y, w, h) => {
        const p = aPuntoDeImagen(x, y, marco, w, h, true);
        return p !== null && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
      }),
    );
  });

  it('el rectángulo no depende de la dirección del arrastre', () => {
    const c = { x: 10, y: 10, ancho: 11, alto: 21 };
    expect(cajaEntre({ x: 10, y: 10 }, { x: 20, y: 30 })).toEqual(c);
    expect(cajaEntre({ x: 20, y: 30 }, { x: 10, y: 10 })).toEqual(c);
    expect(cajaEntre({ x: 20, y: 10 }, { x: 10, y: 30 })).toEqual(c);
  });

  it('un clic sin arrastrar no crea una zona', () => {
    expect(cajaEntre({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(cajaEntre({ x: 5, y: 5 }, { x: 5, y: 50 })).toBeNull();
  });
});

describe('pincel', () => {
  const p = (x: number, y: number): Punto => ({ x, y });

  it('omite los puntos que casi no se movieron', () => {
    const t = agregarPuntoTrazo([p(0, 0)], p(3, 0), 32);
    expect(t).toEqual([p(0, 0)]);
    expect(agregarPuntoTrazo(t, p(8, 0), 32)).toEqual([p(0, 0), p(8, 0)]);
    // Con tamaño 1 basta moverse un píxel.
    expect(agregarPuntoTrazo([p(0, 0)], p(1, 0), 1)).toHaveLength(2);
    expect(agregarPuntoTrazo([p(0, 0)], p(0, 0), 1)).toHaveLength(1);
    expect(agregarPuntoTrazo([], p(5, 5), 32)).toEqual([p(5, 5)]);
  });

  it('no pasa del límite de puntos y lo avisa', () => {
    const lleno = Array.from({ length: LIMITES.puntosTrazo }, (_, i) => p(i, 0));
    expect(trazoLleno(lleno)).toBe(true);
    expect(trazoLleno(lleno.slice(1))).toBe(false);
    expect(agregarPuntoTrazo(lleno, p(99999, 0), 1)).toBe(lleno);
  });

  it('propiedad: el trazo siempre cumple el contrato con el sidecar', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 29999 }), y: fc.integer({ min: 0, max: 29999 }) }), { minLength: 1, maxLength: 300 }),
        fc.integer({ min: LIMITES.pincel.min, max: LIMITES.pincel.max }),
        (puntos, tamano) => {
          const trazo = puntos.reduce<readonly Punto[]>((t, q) => agregarPuntoTrazo(t, q, tamano), []);
          return esquemaTrazo.safeParse({ puntos: trazo, tamano }).success;
        },
      ),
    );
  });

  it.each([
    [{ puntos: [], tamano: 32 }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: 0 }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: 513 }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: 1.5 }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: Number.NaN }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: Number.POSITIVE_INFINITY }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: null }],
    [{ puntos: [{ x: 0, y: 0 }] }],
    [{ puntos: null, tamano: 32 }],
    [{ puntos: [{ x: 0, y: 0 }], tamano: '32' }],
    [{ puntos: [{ x: -1, y: 0 }], tamano: 32 }],
    [{ puntos: [{ x: 30000, y: 0 }], tamano: 32 }],
    [{ puntos: [{ x: 0 }], tamano: 32 }],
    [{ puntos: [{ x: 0, y: 0, z: 0 }], tamano: 32 }],
    [{ puntos: Array.from({ length: LIMITES.puntosTrazo + 1 }, () => ({ x: 0, y: 0 })), tamano: 32 }],
  ])('el contrato rechaza un trazo inválido: %#', (trazo) => {
    expect(esquemaTrazo.safeParse(trazo).success).toBe(false);
  });

  it('el contrato acepta los límites exactos', () => {
    expect(esquemaTrazo.safeParse({ puntos: [{ x: 0, y: 0 }], tamano: 1 }).success).toBe(true);
    expect(esquemaTrazo.safeParse({ puntos: [{ x: 29999, y: 29999 }], tamano: 512 }).success).toBe(true);
  });
});

describe('campos de coordenadas', () => {
  const v = (x: string, y: string, ancho: string, alto: string) => ({ x, y, ancho, alto });

  it('acepta los extremos', () => {
    expect(leerCaja(v('0', '0', '100', '50'), 100, 50).ok).toBe(true);
    expect(leerCaja(v('99', '49', '1', '1'), 100, 50).ok).toBe(true);
    expect(leerPunto('99', '49', 100, 50)).toEqual({ ok: true, x: 99, y: 49 });
  });

  it.each([
    ['-1', '0', '1', '1'], ['100', '0', '1', '1'], ['0', '50', '1', '1'], ['abc', '0', '1', '1'], ['', '0', '1', '1'], ['1e3', '0', '1', '1'], ['0,5', '0', '1', '1'],
    ['0', '0', '0', '1'], ['0', '0', '1', '0'], ['0', '0', '101', '1'], ['0', '0', '1', '51'], ['99', '0', '2', '1'], ['0', '49', '1', '2'], ['0', '0', '999999', '1'],
  ])('rechaza %s, %s, %s, %s sin recortar', (x, y, a, b) => {
    expect(leerCaja(v(x, y, a, b), 100, 50).ok).toBe(false);
  });

  it('rechaza un punto inválido', () => {
    expect(leerPunto('100', '0', 100, 50).ok).toBe(false);
    expect(leerPunto('0', 'x', 100, 50).ok).toBe(false);
  });
});

describe('Guía de privacidad', () => {
  it('incluye todas las reglas del catálogo, una sola vez', () => {
    const ids = agruparReglas().flatMap((g) => g.reglas.map((r) => r.id));
    expect([...ids].sort()).toEqual(catalogo.reglas.map((r) => r.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('confirmar la exportación', () => {
  it('dice lo que falta y deja decidir', () => {
    expect(textoConfirmacion(1, false)).toContain('Hay 1 advertencia sin decidir');
    expect(textoConfirmacion(2, false)).toContain('Hay 2 advertencias sin decidir');
    expect(textoConfirmacion(0, true)).toContain('no se revisó por completo');
    expect(textoConfirmacion(0, true)).not.toContain('sin decidir');
    expect(textoConfirmacion(3, true)).toContain('Tú decides.');
  });
});

describe('recuperación', () => {
  it('ida y vuelta conserva decisiones y cumple el esquema', () => {
    const r = { ...responderMenores(decidir(REVISION_INICIAL, 'a', 'ignorar'), [], true), intensidad: 50 };
    const e = aEdicion('6f9619ff-8b86-4011-b42d-00c04fc964ff', r);
    expect(esquemaEdicion.safeParse(e).success).toBe(true);
    expect(desdeEdicion(e)).toEqual(r);
  });

  it('una revisión intacta no cuenta como cambio', () => {
    expect(hayCambios(REVISION_INICIAL)).toBe(false);
    expect(hayCambios(decidir(REVISION_INICIAL, 'a', 'ocultar'))).toBe(true);
    expect(hayCambios(elegirEfecto(REVISION_INICIAL, 'a', 'solido'))).toBe(true);
    expect(hayCambios({ ...REVISION_INICIAL, hayMenores: false })).toBe(true);
    expect(hayCambios({ ...REVISION_INICIAL, intensidad: 10 })).toBe(true);
  });
});

describe('catálogo', () => {
  it('las reglas no revisadas excluyen lo que sí se revisó', () => {
    const ids = reglasNoRevisadas(analisis([])).map((r) => r.id);
    expect(ids).not.toContain('CAR-01');
    expect(ids).toContain('DOC-01');
    expect(ids.length).toBe(catalogo.reglas.length - 3);
  });

  it('toda regla verificada tiene fuente y toda URL es https', () => {
    for (const r of catalogo.reglas) if (r.estado === 'verificada') expect(r.fuentes.length).toBeGreaterThan(0);
    for (const u of urlsDeFuentes()) expect(u.startsWith('https://')).toBe(true);
  });

  it.each(['alto', 'medio', 'bajo'] as Nivel[])('el nivel %s siempre se dice con palabras', (n) => {
    expect(etiquetaNivel(n)).toMatch(/^Riesgo /);
  });
});

describe('aviso de cierre con cambios sin exportar', () => {
  it('solo promete recuperar cuando el guardado funcionó', () => {
    expect(textoCierre(true)).toContain('podrás recuperarlas');
    expect(textoCierre(false)).toContain('se perderán');
    expect(textoCierre(false)).not.toContain('recuperar');
  });

  it.each([undefined, null, {}, { recuperacionSegura: 'si' }, { recuperacionSegura: true, extra: 1 }])(
    'rechaza un aviso inválido de main: %#',
    (aviso) => {
      expect(esquemaAvisoCierre.safeParse(aviso).success).toBe(false);
    },
  );

  it('acepta ambos valores válidos', () => {
    expect(esquemaAvisoCierre.parse({ recuperacionSegura: true })).toEqual({ recuperacionSegura: true });
    expect(esquemaAvisoCierre.parse({ recuperacionSegura: false })).toEqual({ recuperacionSegura: false });
  });
});

describe('visor: zoom', () => {
  it('los niveles van de 1 a 8 en orden y coinciden con los límites', () => {
    expect(NIVELES_ZOOM[0]).toBe(LIMITES.zoom.min);
    expect(NIVELES_ZOOM.at(-1)).toBe(LIMITES.zoom.max);
    expect([...NIVELES_ZOOM].sort((a, b) => a - b)).toEqual([...NIVELES_ZOOM]);
  });

  it.each([
    [0, 1], [0.99, 1], [1, 1], [8, 8], [8.01, 8], [100, 8], [-1, 1],
    [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1], [Number.NEGATIVE_INFINITY, 1],
  ])('limitarZoom(%s) = %s', (entrada, esperado) => {
    expect(limitarZoom(entrada)).toBe(esperado);
  });

  it('acerca y aleja por niveles, y en los extremos se queda', () => {
    expect(pasoZoom(1, 1)).toBe(1.5);
    expect(pasoZoom(1.5, -1)).toBe(1);
    expect(pasoZoom(1, -1)).toBe(1);
    expect(pasoZoom(8, 1)).toBe(8);
    expect(pasoZoom(2.5, 1)).toBe(3);
    expect(pasoZoom(2.5, -1)).toBe(2);
    expect(pasoZoom(Number.NaN, 1)).toBe(1.5);
  });

  it('propiedad: cualquier serie de pasos queda dentro de los límites', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(1 as const, -1 as const), { maxLength: 40 }), (pasos) => {
        let z: number = LIMITES.zoom.porDefecto;
        for (const p of pasos) z = pasoZoom(z, p);
        return z >= LIMITES.zoom.min && z <= LIMITES.zoom.max && (NIVELES_ZOOM as readonly number[]).includes(z);
      }),
    );
  });

  it.each([
    [-1, 0], [0, 0], [0.4, 0], [50, 50], [99.6, 100], [100, 100], [101, 100],
    [Number.NaN, 50], [Number.POSITIVE_INFINITY, 50], [Number.NEGATIVE_INFINITY, 50],
  ])('limitarCorte(%s) = %s', (entrada, esperado) => {
    expect(limitarCorte(entrada)).toBe(esperado);
  });

  it.each([
    [0, 0], [10, 0], [18, 0.5], [26, 1], [100, 1], [-5, 0], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0],
  ])('opacidadRotulo(%s) = %s', (espacio, esperado) => {
    expect(opacidadRotulo(espacio)).toBe(esperado);
  });

  it('el número de una zona va arriba, abajo si toca el borde superior, y dentro si no cabe fuera', () => {
    // Imagen de 1000 px de alto: el margen es 80 px.
    expect(ladoEtiqueta({ x: 0, y: 80, ancho: 10, alto: 10 }, 1000)).toBe('arriba');
    expect(ladoEtiqueta({ x: 0, y: 79, ancho: 10, alto: 10 }, 1000)).toBe('abajo');
    expect(ladoEtiqueta({ x: 0, y: 0, ancho: 10, alto: 920 }, 1000)).toBe('abajo');
    expect(ladoEtiqueta({ x: 0, y: 0, ancho: 10, alto: 921 }, 1000)).toBe('dentro');
    expect(ladoEtiqueta({ x: 0, y: 0, ancho: 10, alto: 10 }, 0)).toBe('dentro');
    expect(ladoEtiqueta({ x: 0, y: 0, ancho: 10, alto: 10 }, Number.NaN)).toBe('dentro');
  });

  it('muestra el nivel en porcentaje', () => {
    expect(textoZoom(1)).toBe('100 %');
    expect(textoZoom(1.5)).toBe('150 %');
    expect(textoZoom(99)).toBe('800 %');
  });

  it('ajusta la imagen a lo que cabe, por ancho o por alto', () => {
    expect(anchoAjustado(800, 600, 4000, 3000)).toBe(800);
    expect(anchoAjustado(800, 300, 4000, 3000)).toBe(400);
    expect(anchoAjustado(800, null, 1000, 4000)).toBe(800);
    expect(anchoAjustado(800.9, null, 1000, 1000)).toBe(800);
    expect(anchoAjustado(0, 600, 10, 10)).toBeNull();
    expect(anchoAjustado(800, 600, 0, 10)).toBeNull();
    expect(anchoAjustado(Number.NaN, 600, 10, 10)).toBeNull();
    expect(anchoAjustado(0.2, null, 10, 10)).toBe(1);
  });

  it('una foto chica no se estira más del 200 % al ajustar', () => {
    // La playa: 470 px de ancho en una columna de 980 px se queda en 940, no en 980.
    expect(anchoAjustado(980, 600, 470, 210)).toBe(940);
    expect(anchoAjustado(980, 600, 470, 210, 1)).toBe(470);
    expect(anchoAjustado(800, 600, 10, 10)).toBe(20);
    // Si el tope no es válido, no limita.
    expect(anchoAjustado(980, 600, 470, 210, Number.NaN)).toBe(980);
    expect(anchoAjustado(980, 600, 470, 210, 0)).toBe(980);
    expect(LIMITES.ajusteMaxEscala).toBe(2);
  });

  it('el punto bajo el cursor se queda bajo el cursor, sin pasarse de los bordes', () => {
    expect(desplazamientoAnclado(0.5, 200, 1600, 400)).toBe(600);
    expect(desplazamientoAnclado(0, 200, 1600, 400)).toBe(0);
    expect(desplazamientoAnclado(1, 0, 1600, 400)).toBe(1200);
    expect(desplazamientoAnclado(0.5, 200, 300, 400)).toBe(0);
    expect(desplazamientoAnclado(Number.NaN, 200, 1600, 400)).toBe(0);
  });
});

describe('visor: zona bajo el puntero', () => {
  const zonas = [
    { id: 'grande', caja: { x: 0, y: 0, ancho: 100, alto: 100 } },
    { id: 'chica', caja: { x: 40, y: 40, ancho: 10, alto: 10 } },
  ];

  it('elige la zona que contiene el punto y, si hay varias, la más chica', () => {
    expect(zonaEnPunto(5, 5, zonas)).toBe('grande');
    expect(zonaEnPunto(45, 45, zonas)).toBe('chica');
  });

  it('los bordes: incluye el primer píxel y excluye el que sigue al último', () => {
    expect(zonaEnPunto(40, 40, zonas)).toBe('chica');
    expect(zonaEnPunto(49, 49, zonas)).toBe('chica');
    expect(zonaEnPunto(50, 50, zonas)).toBe('grande');
    expect(zonaEnPunto(100, 0, zonas)).toBeNull();
    expect(zonaEnPunto(-1, 0, zonas)).toBeNull();
  });

  it('sin zonas no elige nada', () => {
    expect(zonaEnPunto(1, 1, [])).toBeNull();
  });
});

describe('nivel mostrado: menos alarma con lo cotidiano, nunca menos con lo grave', () => {
  const placa = (requiere: boolean): Hallazgo => ({ id: 'p', regla_id: 'MAT-01', caja: { x: 0, y: 0, ancho: 9, alto: 9 }, confianza: requiere ? 0.2 : 0.9, requiere_revision: requiere, posicion: 'al centro' });
  const documento = (requiere: boolean): Hallazgo => ({ ...placa(requiere), id: 'd', regla_id: 'DOC-01' });
  const bano: Hallazgo = { id: 'b', regla_id: 'INT-01', caja: null, confianza: 0.8, requiere_revision: true, posicion: null };

  it('una cara con tu amigo es riesgo bajo y la pregunta de menores es neutral', () => {
    expect(nivelMostrado(cara('a'), REVISION_INICIAL)).toBe('bajo');
    expect(nivelMostrado(menores, REVISION_INICIAL)).toBe('pregunta');
    expect(etiquetaNivelMostrado('pregunta')).toBe('Pregunta');
    expect(contarAdvertencias([cara('a'), menores])).toBe(1);
  });

  it('si dices que hay menores, la pregunta, las caras y el baño suben a riesgo alto', () => {
    const r = responderMenores(REVISION_INICIAL, [cara('a')], true);
    expect(nivelMostrado(menores, r)).toBe('alto');
    expect(nivelMostrado(cara('a'), r)).toBe('alto');
    expect(nivelMostrado(bano, r)).toBe('alto');
    expect(nivelMostrado(placa(false), r)).toBe('medio');
  });

  it('si dices que no, nada sube', () => {
    const r = responderMenores(REVISION_INICIAL, [], false);
    expect(nivelMostrado(cara('a'), r)).toBe('bajo');
    expect(nivelMostrado(bano, r)).toBe('bajo');
    expect(nivelMostrado(menores, r)).toBe('pregunta');
  });

  it('con poca confianza lo medio baja a bajo, pero lo alto nunca baja', () => {
    expect(nivelMostrado(placa(false), REVISION_INICIAL)).toBe('medio');
    expect(nivelMostrado(placa(true), REVISION_INICIAL)).toBe('bajo');
    expect(nivelMostrado(documento(true), REVISION_INICIAL)).toBe('alto');
    expect(nivelMostrado(gps, REVISION_INICIAL)).toBe('alto');
  });

  it('propiedad: el nivel mostrado de algo de riesgo alto siempre es alto', () => {
    const altas = catalogo.reglas.filter((r) => r.nivel_riesgo === 'alto' && r.requiere_confirmacion !== true);
    fc.assert(
      fc.property(fc.constantFrom(...altas), fc.boolean(), fc.constantFrom(null, true, false), (regla, requiere, hay) => {
        const h: Hallazgo = { ...placa(requiere), regla_id: regla.id };
        return nivelMostrado(h, { ...REVISION_INICIAL, hayMenores: hay }) === 'alto';
      }),
    );
  });
});
