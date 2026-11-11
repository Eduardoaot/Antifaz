import { Brush, Hand, MousePointerClick, Redo2, Save, SquareDashed, SquareSplitHorizontal, Undo2 } from 'lucide-react';
import { LIMITES } from '../../shared/contrato';
import type { Herramienta } from '../../shared/logica';

const HERRAMIENTAS: readonly { valor: Herramienta; texto: string; Icono: typeof Hand; atajo: string }[] = [
  { valor: 'ninguna', texto: 'Solo ver', Icono: Hand, atajo: 'V' },
  { valor: 'clic', texto: 'Clic en un objeto', Icono: MousePointerClick, atajo: 'C' },
  { valor: 'rectangulo', texto: 'Dibujar rectángulo', Icono: SquareDashed, atajo: 'R' },
  { valor: 'pincel', texto: 'Pintar con pincel', Icono: Brush, atajo: 'P' },
];

export const herramientaDeTecla = (tecla: string): Herramienta | null =>
  HERRAMIENTAS.find((h) => h.atajo.toLowerCase() === tecla.toLowerCase())?.valor ?? null;

interface Props {
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  alDeshacer: () => void;
  alRehacer: () => void;
  herramienta: Herramienta;
  /** Sin análisis o exportando, las herramientas no actúan. */
  herramientasActivas: boolean;
  alElegirHerramienta: (h: Herramienta) => void;
  tamanoPincel: number;
  alCambiarTamano: (tamano: number) => void;
  comparando: boolean;
  alComparar: () => void;
  exportando: boolean;
  puedeExportar: boolean;
  alExportar: () => void;
  /** Mientras se dibuja, la barra se aparta para no estorbar. */
  atenuada: boolean;
}

/** Todo lo que se hace sobre la foto, en una cinta dentro de la propia imagen. */
export function BarraHerramientas(p: Props): React.JSX.Element {
  return (
    <div className={`cinta${p.atenuada ? ' atenuada' : ''}`} role="toolbar" aria-label="Herramientas de la foto">
      <div className="cinta-grupo">
        <button type="button" className="boton-cinta" disabled={!p.puedeDeshacer || p.exportando} title="Deshacer (Ctrl Z)" onClick={p.alDeshacer}>
          <Undo2 aria-hidden="true" /><span className="texto-cinta">Deshacer</span>
        </button>
        <button type="button" className="boton-cinta" disabled={!p.puedeRehacer || p.exportando} title="Rehacer (Ctrl Y)" onClick={p.alRehacer}>
          <Redo2 aria-hidden="true" /><span className="texto-cinta">Rehacer</span>
        </button>
      </div>
      <span className="separador" aria-hidden="true" />
      <div className="cinta-grupo" role="group" aria-label="Herramienta sobre la imagen">
        {HERRAMIENTAS.map(({ valor, texto, Icono, atajo }) => (
          <button
            key={valor}
            type="button"
            className="boton-cinta solo-icono"
            aria-label={texto}
            title={`${texto} (${atajo})`}
            aria-pressed={p.herramienta === valor}
            disabled={!p.herramientasActivas || p.comparando}
            onClick={() => { p.alElegirHerramienta(valor); }}
          >
            <Icono aria-hidden="true" />
          </button>
        ))}
      </div>
      {p.herramienta === 'pincel' && p.herramientasActivas && !p.comparando && (
        <div className="cinta-pincel">
          <label htmlFor="tamano-pincel">Tamaño del pincel: {p.tamanoPincel} px de la foto</label>
          <input
            id="tamano-pincel"
            type="range"
            min={LIMITES.pincel.min}
            max={LIMITES.pincel.max}
            value={p.tamanoPincel}
            onChange={(e) => { p.alCambiarTamano(Number(e.target.value)); }}
          />
        </div>
      )}
      <span className="separador" aria-hidden="true" />
      <button type="button" className="boton-cinta solo-icono" aria-label="Comparar antes y después" title="Comparar antes y después" aria-pressed={p.comparando} onClick={p.alComparar}>
        <SquareSplitHorizontal aria-hidden="true" />
      </button>
      <button type="button" className="boton-cinta primario" disabled={!p.puedeExportar || p.exportando} title="Exportar copia (Ctrl E)" onClick={p.alExportar}>
        <Save aria-hidden="true" /><span className="texto-cinta">{p.exportando ? 'Guardando…' : 'Exportar copia'}</span>
      </button>
    </div>
  );
}
