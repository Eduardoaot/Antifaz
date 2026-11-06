import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { catalogo, etiquetaNivel, reglaDe, urlsDeFuentes, type Nivel } from '../../app/shared/catalogo';
import { esquemaEdicion, esquemaOcultamiento, esquemaTrazo, LIMITES, type Analisis, type Hallazgo, type Motivo, type Punto } from '../../app/shared/contrato';
import {
  HISTORIAL_PASOS,
  REVISION_INICIAL,
  aEdicion,
  aPuntoDeImagen,
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
  type Veredicto,
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
      fc.property(fc.integer({ min: 1, max: 100 }), fc.constantFrom('solido', 'difuminado', 'pixelado') as fc.Arbitrary<'solido'>, (intensidad, efecto) => {
        const r = elegirEfecto({ ...decidir(REVISION_INICIAL, 'a', 'ocultar'), intensidad }, 'a', efecto);
        return construirOcultamientos(r, [cara('a')]).every((o) => esquemaOcultamiento.safeParse(o).success);
      }),
    );
  });
});

describe('acciones masivas', () => {
  const lista = [cara('a'), cara('b'), menores, gps];

  it('ocultar todo marca solo lo que tiene zona', () => {
    const r = ocultarTodo(REVISION_INICIAL, lista);
    expect(Object.keys(r.decisiones).sort()).toEqual(['a', 'b']);
  });

  it('ocultar riesgo alto incluye las caras si podría haber menores', () => {
    expect(Object.keys(ocultarRiesgoAlto(REVISION_INICIAL, lista).decisiones).sort()).toEqual(['a', 'b']);
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
    [analisis([], ['modelo_no_disponible']), 'parcial'],
    [analisis([gps], ['deteccion_fallo']), 'parcial'],
  ] as const)('%#', (a, esperado) => {
    expect(veredicto(a)).toBe(esperado);
  });

  it.each(['parcial', 'con_advertencias', 'sin_hallazgos'] as Veredicto[])('%s tiene título', (v) => {
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
