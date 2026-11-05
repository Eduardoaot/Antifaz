/** Normaliza lo que se escribe en campos numéricos, según la tabla de qa/RANGOS.md. */

const MAX_CARACTERES = 64;

export type Numero = { ok: true; valor: number } | { ok: false };

export function leerNumero(texto: unknown, tipo: 'entero' | 'decimal'): Numero {
  if (typeof texto !== 'string' || texto.length > MAX_CARACTERES) return { ok: false };
  const limpio = texto.trim();
  // Solo dígitos ASCII: esto descarta notación científica, hexadecimal, NaN, Infinity y emoji.
  const valido = tipo === 'entero' ? /^-?[0-9]+$/.test(limpio) : /^-?[0-9]+([.,][0-9]+)?$/.test(limpio);
  if (!valido) return { ok: false };
  const valor = Number(limpio.replace(',', '.'));
  if (!Number.isFinite(valor) || Math.abs(valor) > Number.MAX_SAFE_INTEGER) return { ok: false };
  return { ok: true, valor: Object.is(valor, -0) ? 0 : valor };
}

export function leerEnRango(texto: unknown, min: number, max: number): Numero {
  const leido = leerNumero(texto, 'entero');
  if (!leido.ok || leido.valor < min || leido.valor > max) return { ok: false };
  return leido;
}
