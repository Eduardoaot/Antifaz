import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import tokens from '../../brand/tokens.json';
import { Archivos, ERROR_ARCHIVO_CAMBIO, ERROR_NO_ABIERTA, planearLote } from '../../app/main/archivos';
import { ERROR_SIDECAR, LectorMarcos, MAX_BYTES_MARCO, Sidecar, type RespuestaSidecar } from '../../app/main/sidecar';

const marco = (contenido: Buffer): Buffer => {
  const cabecera = Buffer.alloc(4);
  cabecera.writeUInt32BE(contenido.length, 0);
  return Buffer.concat([cabecera, contenido]);
};

describe('LectorMarcos', () => {
  it('propiedad: los marcos salen iguales sin importar cómo se parta el flujo', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ maxLength: 300 }), { maxLength: 10 }),
        fc.array(fc.integer({ min: 1, max: 64 }), { minLength: 1, maxLength: 20 }),
        (contenidos, cortes) => {
          const flujo = Buffer.concat(contenidos.map((c) => marco(Buffer.from(c))));
          const lector = new LectorMarcos();
          const salida: Buffer[] = [];
          let i = 0;
          let c = 0;
          while (i < flujo.length) {
            const n = cortes[c++ % cortes.length] ?? 1;
            salida.push(...lector.agregar(flujo.subarray(i, i + n)));
            i += n;
          }
          return salida.length === contenidos.length && salida.every((s, k) => Buffer.from(contenidos[k] ?? []).equals(s));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('un marco incompleto espera', () => {
    const lector = new LectorMarcos();
    const m = marco(Buffer.from('hola'));
    expect(lector.agregar(m.subarray(0, 3))).toEqual([]);
    expect(lector.agregar(m.subarray(3, 6))).toEqual([]);
    expect(lector.agregar(m.subarray(6)).map(String)).toEqual(['hola']);
  });

  it('una longitud absurda se rechaza en vez de esperar para siempre', () => {
    const cabecera = Buffer.alloc(4);
    cabecera.writeUInt32BE(MAX_BYTES_MARCO + 1, 0);
    expect(() => new LectorMarcos().agregar(cabecera)).toThrow();
  });

  it('acepta un marco vacío', () => {
    expect(new LectorMarcos().agregar(marco(Buffer.alloc(0)))[0]?.length).toBe(0);
  });
});

function falso(respuestas: RespuestaSidecar['resultado'][]) {
  const pedir = vi.fn((_comando: Record<string, unknown>) => {
    const resultado = respuestas.shift();
    if (resultado === undefined) throw new Error('petición inesperada');
    return Promise.resolve({ resultado, binario: null });
  });
  return { pedir, archivos: new Archivos(pedir) };
}

const abierta = (id: string, huella = 'a'.repeat(64)): RespuestaSidecar['resultado'] => ({
  ok: true,
  datos: { imagen_id: id, ancho: 10, alto: 20, formato: 'JPEG', tiene_alfa: false, huella },
});
const RUTA = 'C:\\Users\\persona\\fotos\\playa.jpg';

describe('Archivos: las rutas no salen de main', () => {
  it('entrega id opaco y solo el nombre', async () => {
    const { archivos } = falso([abierta('s1')]);
    const r = await archivos.abrir(RUTA);
    expect(r.ok && r.archivo.nombre).toBe('playa.jpg');
    expect(JSON.stringify(r)).not.toContain('persona');
    expect(JSON.stringify(r)).not.toContain('s1');
  });

  it('un error también entrega solo el nombre', async () => {
    const { archivos } = falso([{ ok: false, error: { codigo: 'NO_ES_IMAGEN', mensaje: 'm' } }]);
    const r = await archivos.abrir(RUTA);
    expect(r).toEqual({ ok: false, nombre: 'playa.jpg', error: { codigo: 'NO_ES_IMAGEN', mensaje: 'm' } });
  });

  it('el mismo archivo dos veces no se duplica, aunque cambien las mayúsculas', async () => {
    const { archivos, pedir } = falso([abierta('s1')]);
    const uno = await archivos.abrir(RUTA);
    const dos = await archivos.abrir(RUTA.toUpperCase());
    expect(uno.ok && dos.ok && uno.archivo.id === dos.archivo.id).toBe(true);
    expect(dos.ok && dos.archivo.duplicado).toBe(true);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('tras reiniciarse el sidecar, reabre la imagen sola', async () => {
    const { archivos, pedir } = falso([abierta('s1'), abierta('s2')]);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    expect(await archivos.sidecarId(r.archivo.id)).toEqual({ ok: true, datos: 's1' });
    archivos.alReiniciarSidecar();
    expect(await archivos.sidecarId(r.archivo.id)).toEqual({ ok: true, datos: 's2' });
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('si al reabrir el archivo ya no está, devuelve el error', async () => {
    const error = { codigo: 'ARCHIVO_NO_ENCONTRADO', mensaje: 'm' };
    const { archivos } = falso([abierta('s1'), { ok: false, error }]);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    archivos.alReiniciarSidecar();
    expect(await archivos.sidecarId(r.archivo.id)).toEqual({ ok: false, error });
  });

  it('si el archivo cambió en disco, no reabre con las decisiones viejas', async () => {
    const { archivos, pedir } = falso([abierta('s1'), abierta('s2', 'b'.repeat(64)), { ok: true, datos: {} }]);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    archivos.alReiniciarSidecar();
    expect(await archivos.sidecarId(r.archivo.id)).toEqual({ ok: false, error: ERROR_ARCHIVO_CAMBIO });
    expect(pedir).toHaveBeenLastCalledWith({ tipo: 'cerrar', imagen_id: 's2' });
  });

  it('dos pedidos a la vez reabren una sola vez', async () => {
    const { archivos, pedir } = falso([abierta('s1'), abierta('s2')]);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    archivos.alReiniciarSidecar();
    const [a, b] = await Promise.all([archivos.sidecarId(r.archivo.id), archivos.sidecarId(r.archivo.id)]);
    expect(a).toEqual({ ok: true, datos: 's2' });
    expect(b).toEqual({ ok: true, datos: 's2' });
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(archivos.huella(r.archivo.id)).toBe('a'.repeat(64));
  });

  it('un id desconocido da error tipado', async () => {
    const { archivos } = falso([]);
    expect(await archivos.sidecarId('x')).toEqual({ ok: false, error: ERROR_NO_ABIERTA });
  });

  it('cerrar libera en el sidecar y olvida la ruta', async () => {
    const { archivos, pedir } = falso([abierta('s1'), { ok: true, datos: {} }]);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    expect(archivos.nombre(r.archivo.id)).toBe('playa.jpg');
    await archivos.cerrar(r.archivo.id);
    expect(pedir).toHaveBeenLastCalledWith({ tipo: 'cerrar', imagen_id: 's1' });
    expect(archivos.ruta(r.archivo.id)).toBeUndefined();
    await archivos.cerrar(r.archivo.id);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('cuenta las fotos abiertas y las reconoce sin importar mayúsculas', async () => {
    const { archivos } = falso([abierta('s1'), { ok: true, datos: {} }]);
    expect(archivos.cantidad).toBe(0);
    const r = await archivos.abrir(RUTA);
    if (!r.ok) throw new Error('debió abrir');
    expect(archivos.cantidad).toBe(1);
    expect(archivos.estaAbierta(RUTA.toUpperCase())).toBe(true);
    expect(archivos.estaAbierta('C:\\otra.jpg')).toBe(false);
    await archivos.cerrar(r.archivo.id);
    expect(archivos.cantidad).toBe(0);
  });
});

describe('planearLote: el límite es de fotos abiertas a la vez', () => {
  const rutas = (n: number, prefijo = 'f'): string[] => Array.from({ length: n }, (_, i) => `C:\\${prefijo}${i}.jpg`);
  const ninguna = (): boolean => false;

  it('justo en el límite caben todas', () => {
    expect(planearLote(rutas(500), ninguna, 500)).toEqual({ abrir: rutas(500), nuevas: 500, sobran: 0 });
  });

  it('una de más no se descarta en silencio: se cuenta', () => {
    const plan = planearLote(rutas(501), ninguna, 500);
    expect(plan.abrir).toEqual(rutas(500));
    expect(plan.sobran).toBe(1);
  });

  it('lo ya abierto ocupa lugar: con 300 abiertas solo caben 200 más', () => {
    const plan = planearLote(rutas(300, 'n'), ninguna, 500 - 300);
    expect(plan).toEqual({ abrir: rutas(200, 'n'), nuevas: 200, sobran: 100 });
  });

  it('una foto ya abierta o repetida en la selección no gasta otro lugar', () => {
    const abierta = (r: string): boolean => r === 'C:\\ya.jpg';
    const plan = planearLote(['C:\\ya.jpg', 'C:\\a.jpg', 'c:\\A.JPG', 'C:\\b.jpg'], abierta, 1);
    expect(plan).toEqual({ abrir: ['C:\\ya.jpg', 'C:\\a.jpg', 'c:\\A.JPG'], nuevas: 1, sobran: 1 });
  });

  it('una repetida de una que no cupo tampoco entra', () => {
    expect(planearLote(['C:\\a.jpg', 'C:\\b.jpg', 'C:\\B.jpg'], ninguna, 1)).toEqual({ abrir: ['C:\\a.jpg'], nuevas: 1, sobran: 2 });
  });

  it('sin lugares, ninguna nueva entra, aunque el cálculo dé negativo', () => {
    expect(planearLote(rutas(3), ninguna, 0)).toEqual({ abrir: [], nuevas: 0, sobran: 3 });
    expect(planearLote(rutas(3), ninguna, -5)).toEqual({ abrir: [], nuevas: 0, sobran: 3 });
    expect(planearLote([], ninguna, 10)).toEqual({ abrir: [], nuevas: 0, sobran: 0 });
  });

  it('propiedad: nada se pierde y nunca se pasa del límite', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...rutas(20)), { maxLength: 60 }), fc.integer({ min: -3, max: 25 }), (seleccion, lugares) => {
        const plan = planearLote(seleccion, ninguna, lugares);
        const tope = Math.max(0, lugares);
        const distintasAbiertas = new Set(plan.abrir.map((r) => r.toLowerCase())).size;
        return (
          plan.abrir.length + plan.sobran === seleccion.length && // cada ruta se abre o se cuenta
          plan.nuevas === distintasAbiertas &&
          plan.nuevas <= tope &&
          (plan.sobran === 0 || plan.nuevas === tope) // solo sobra si de verdad se llenó
        );
      }),
    );
  });
});

describe('Sidecar con un proceso que falla', () => {
  const lanzarFalso = (guion: string, limitePedidoMs?: number): Sidecar =>
    new Sidecar({
      ejecutable: process.execPath,
      argumentos: ['-e', guion],
      cwd: process.cwd(),
      alCaer: () => undefined,
      registrar: () => undefined,
      ...(limitePedidoMs === undefined ? {} : { limitePedidoMs }),
    });
  const caido = { resultado: { ok: false, error: ERROR_SIDECAR }, binario: null };
  const marcoNode = (texto: string): string =>
    `const b=Buffer.from(${JSON.stringify(texto)});const c=Buffer.alloc(4);c.writeUInt32BE(b.length);process.stdout.write(Buffer.concat([c,b]));`;

  it('un marco que no es JSON responde error en vez de tumbar main', async () => {
    const s = lanzarFalso(`${marcoNode('esto no es json')}setTimeout(()=>{},5000);`);
    expect(await s.pedir({ tipo: 'ping' })).toEqual(caido);
  });

  it('texto suelto en stdout no deja la promesa colgada', async () => {
    const s = lanzarFalso(`process.stdout.write('Warning: algo de una libreria');setTimeout(()=>{},5000);`);
    expect(await s.pedir({ tipo: 'ping' })).toEqual(caido);
  });

  it('un proceso que no responde se reinicia al rebasar el límite', async () => {
    const s = lanzarFalso('setTimeout(()=>{},60000);', 300);
    expect(await s.pedir({ tipo: 'ping' })).toEqual(caido);
  });

  it('un proceso que muere responde error a todo lo pendiente', async () => {
    const s = lanzarFalso('process.exit(3);');
    expect(await Promise.all([s.pedir({ tipo: 'ping' }), s.pedir({ tipo: 'ping' })])).toEqual([caido, caido]);
  });

  it('un ejecutable que no existe responde error', async () => {
    const s = new Sidecar({ ejecutable: 'no-existe.exe', argumentos: [], cwd: process.cwd(), alCaer: () => undefined, registrar: () => undefined });
    expect(await s.pedir({ tipo: 'ping' })).toEqual(caido);
  });
});

describe('tokens', () => {
  it('tokens.css sigue igual que brand/tokens.json', () => {
    const css = readFileSync('app/renderer/src/tokens.css', 'utf-8');
    for (const tema of Object.values(tokens.color)) {
      for (const [nombre, valor] of Object.entries(tema)) expect(css).toContain(`--${nombre}: ${valor};`);
    }
  });
});
