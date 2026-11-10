import { EMOJIS, ETIQUETA_EMOJI } from '../../shared/contrato';

/** Va dentro de cada <select> de efecto. El emoji se dibuja sobre bloque sólido, así que es irreversible. */
export function OpcionesEmoji(): React.JSX.Element {
  return (
    <optgroup label="Emoji (no deja nada de la foto debajo)">
      {EMOJIS.map((e) => (
        <option key={e} value={e}>{ETIQUETA_EMOJI[e]}</option>
      ))}
    </optgroup>
  );
}
