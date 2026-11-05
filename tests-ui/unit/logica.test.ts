import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { catalogo, etiquetaNivel, reglaDe, urlsDeFuentes, type Nivel } from '../../app/shared/catalogo';
import { esquemaEdicion, esquemaOcultamiento, type Analisis, type Hallazgo, type Motivo } from '../../app/shared/contrato';
import {
  HISTORIAL_PASOS,
  REVISION_INICIAL,
  aEdicion,
  aplicarCambio,
  aplicarDecisionesIniciales,
  construirOcultamientos,
  decidir,
  desdeEdicion,
  describirHallazgo,
  deshacer,
  efectoDe,
  elegirEfecto,
  hayCambios,
  nuevoHistorial,
  ocultarRiesgoAlto,
  ocultarTodo,
  ordenarHallazgos,
  pendientes,
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

  it.each(['metadatos', 'demasiado_pequena', 'modelo_no_disponible', 'deteccion_fallo', 'contenido_no_disponible', 'contenido_fallo', 'texto_fallo', 'codigos_fallo'] as Motivo[])('motivo %s tiene texto', (m) => {
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
    expect(describirHallazgo({ ...cara('a'), regla_id: 'MAT-01' })).toContain('Placas');
    expect(describirHallazgo({ ...cara('a'), regla_id: 'MAT-01', posicion: null })).toBe('Placas de autos y motos.');
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
