/** Nombres de las copias. Lógica pura: main la usa con el disco real y las pruebas, con uno simulado. */
import type { FormatoCopia } from './contrato';

export type ExtensionCopia = 'jpg' | 'png';

/** Con "automatico", una foto PNG sigue en PNG (conserva la transparencia); lo demás sale en JPG. */
export function extensionCopia(formato: FormatoCopia, formatoOriginal: string): ExtensionCopia {
  switch (formato) {
    case 'jpg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'automatico':
      return formatoOriginal.trim().toUpperCase() === 'PNG' ? 'png' : 'jpg';
    default: {
      const inalcanzable: never = formato;
      throw new Error(`Formato desconocido: ${String(inalcanzable)}`);
    }
  }
}

/** "playa" + "-copia" + "jpg" → "playa-copia.jpg". La base ya viene sin extensión. */
export function nombreCopia(base: string, sufijo: string, extension: ExtensionCopia): string {
  return `${base}${sufijo}.${extension}`;
}

/** Cuántas variantes "(2)", "(3)"… se prueban antes de rendirse. */
export const VARIANTES_MAX = 999;

/**
 * Un nombre que no exista todavía: nunca se sobrescribe nada en una carpeta sin preguntar.
 * Devuelve null si todas las variantes existen.
 */
export function nombreLibre(nombre: string, existe: (candidato: string) => boolean): string | null {
  if (!existe(nombre)) return nombre;
  const punto = nombre.lastIndexOf('.');
  const base = punto > 0 ? nombre.slice(0, punto) : nombre;
  const extension = punto > 0 ? nombre.slice(punto) : '';
  for (let n = 2; n <= VARIANTES_MAX; n += 1) {
    const candidato = `${base} (${n})${extension}`;
    if (!existe(candidato)) return candidato;
  }
  return null;
}
