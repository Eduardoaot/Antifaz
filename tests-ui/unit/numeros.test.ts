import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { leerEnRango, leerNumero } from '../../app/shared/numeros';

describe('leerNumero, tabla de qa/RANGOS.md', () => {
  it.each([
    ['', 'entero'], ['   ', 'entero'], ['abc', 'entero'], ['😀', 'entero'], ['5 5', 'entero'],
    ['2.5', 'entero'], ['2.0', 'entero'], ['0,5', 'entero'], ['1,000', 'entero'], ['1e10', 'entero'],
    ['NaN', 'entero'], ['Infinity', 'entero'], ['-Infinity', 'entero'], ['0x10', 'entero'], ['٣', 'entero'], ['５', 'entero'],
    ['1e10', 'decimal'], ['1,000,5', 'decimal'], ['.5', 'decimal'], ['5.', 'decimal'], ['NaN', 'decimal'],
    ['9007199254740993', 'entero'], ['-9007199254740993', 'entero'], ['1'.repeat(65), 'entero'],
  ] as const)('rechaza %s como %s', (texto, tipo) => {
    expect(leerNumero(texto, tipo).ok).toBe(false);
  });

  it.each([null, undefined, 5, true, [], {}, Number.NaN])('rechaza lo que no es texto: %s', (valor) => {
    expect(leerNumero(valor, 'entero').ok).toBe(false);
  });

  it.each([
    [' 5 ', 'entero', 5], ['-5', 'entero', -5], ['-0', 'entero', 0], ['0', 'entero', 0],
    ['2.5', 'decimal', 2.5], ['0,5', 'decimal', 0.5], ['2.0', 'decimal', 2],
    ['9007199254740991', 'entero', Number.MAX_SAFE_INTEGER],
  ] as const)('acepta %s como %s', (texto, tipo, valor) => {
    const r = leerNumero(texto, tipo);
    expect(r.ok && Object.is(r.valor, valor)).toBe(true);
  });

  it('nunca devuelve un número no finito, con cualquier texto', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('entero' as const, 'decimal' as const), (texto, tipo) => {
        const r = leerNumero(texto, tipo);
        return !r.ok || Number.isFinite(r.valor);
      }),
      { numRuns: 3000 },
    );
  });
});

describe('leerEnRango', () => {
  it.each([['0', false], ['1', true], ['2', true], ['99', true], ['100', true], ['101', false], ['-5', false], ['abc', false], ['999999', false], ['', false], ['1e10', false], ['0,5', false]] as const)(
    '%s en 1..100 → %s',
    (texto, ok) => {
      expect(leerEnRango(texto, 1, 100).ok).toBe(ok);
    },
  );

  it('todo entero del rango entra y todo lo de afuera no', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 100000 }), (n) => leerEnRango(String(n), 1, 100).ok === (n >= 1 && n <= 100)),
      { numRuns: 2000 },
    );
  });
});
