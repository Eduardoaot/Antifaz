import { EMOJIS, ETIQUETA_EMOJI } from '../../shared/contrato';

/** Va dentro de cada <select> de efecto. Bajo el emoji va un relleno sólido, así que donde está es irreversible. */
export function OpcionesEmoji(): React.JSX.Element {
  return (
    <optgroup label="Emoji (no deja nada de la foto bajo el emoji)">
      {EMOJIS.map((e) => (
        <option key={e} value={e}>{ETIQUETA_EMOJI[e]}</option>
      ))}
    </optgroup>
  );
}
