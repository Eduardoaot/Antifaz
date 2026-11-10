import type { Resaltado } from '../../shared/logica';

/**
 * Lo que necesita una fila del panel para resaltar su marca en la imagen: con el mouse o con el foco del
 * teclado. Solo el foco mueve la imagen ampliada hasta la zona; con el mouse sería brusco.
 */
export function eventosResaltar(
  id: string,
  resaltado: Resaltado | null,
  alResaltar: ((r: Resaltado | null) => void) | undefined,
): React.HTMLAttributes<HTMLLIElement> {
  if (alResaltar === undefined) return {};
  return {
    onMouseEnter: () => { alResaltar({ id, origen: 'mouse' }); },
    onMouseLeave: () => { if (resaltado?.id === id && resaltado.origen === 'mouse') alResaltar(null); },
    onFocus: () => { if (resaltado?.id !== id || resaltado.origen !== 'foco') alResaltar({ id, origen: 'foco' }); },
    onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) alResaltar(null); },
  };
}

/** Lleva el foco a la fila de una zona, por ejemplo al hacer clic en su marca. */
export function irAFila(id: string): void {
  const fila = document.querySelector<HTMLElement>(`[data-zona="${CSS.escape(id)}"]`);
  if (fila === null) return;
  fila.scrollIntoView({ block: 'nearest' });
  fila.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true });
}
