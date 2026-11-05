import { useState, type SyntheticEvent } from 'react';
import { esquemaEfecto } from '../../shared/contrato';
import { efectoManual, leerCaja, leerPunto, type Herramienta, type Caja, type Revision, type ZonaManual } from '../../shared/logica';

interface Props {
  ancho: number;
  alto: number;
  herramienta: Herramienta;
  revision: Revision;
  ocupado: boolean;
  alElegirHerramienta: (h: Herramienta) => void;
  alAgregarCaja: (caja: Caja) => void;
  alBuscarEnPunto: (x: number, y: number) => void;
  alQuitar: (id: string) => void;
  alCambiarEfecto: (id: string, efecto: ZonaManual['efecto']) => void;
}

const HERRAMIENTAS: readonly { valor: Herramienta; texto: string }[] = [
  { valor: 'ninguna', texto: 'Solo ver' },
  { valor: 'clic', texto: 'Clic en un objeto' },
  { valor: 'rectangulo', texto: 'Dibujar rectángulo' },
];

export function Manual({ ancho, alto, herramienta, revision, ocupado, alElegirHerramienta, alAgregarCaja, alBuscarEnPunto, alQuitar, alCambiarEfecto }: Props): React.JSX.Element {
  const [valores, setValores] = useState({ x: '', y: '', ancho: '', alto: '' });
  const [error, setError] = useState<string | null>(null);

  const cambiar = (campo: keyof typeof valores, valor: string): void => {
    setValores((v) => ({ ...v, [campo]: valor }));
  };

  const agregar = (e: SyntheticEvent): void => {
    e.preventDefault();
    const leida = leerCaja(valores, ancho, alto);
    if (!leida.ok) {
      setError(leida.mensaje);
      return;
    }
    setError(null);
    alAgregarCaja(leida.caja);
  };

  const buscar = (): void => {
    const leido = leerPunto(valores.x, valores.y, ancho, alto);
    if (!leido.ok) {
      setError(leido.mensaje);
      return;
    }
    setError(null);
    alBuscarEnPunto(leido.x, leido.y);
  };

  return (
    <section aria-labelledby="titulo-manual" className="caja-veredicto manual">
      <h2 id="titulo-manual">Tapar algo más</h2>
      <p className="suave">Elige una herramienta y usa la imagen, o escribe las coordenadas abajo.</p>
      <div className="grupo-acciones" role="group" aria-label="Herramienta sobre la imagen">
        {HERRAMIENTAS.map((h) => (
          <button key={h.valor} type="button" className="boton" aria-pressed={herramienta === h.valor} onClick={() => { alElegirHerramienta(h.valor); }}>
            {h.texto}
          </button>
        ))}
      </div>
      <details>
        <summary>Escribir coordenadas (sin mouse)</summary>
        <form className="coordenadas" onSubmit={agregar}>
          <p className="suave">La imagen mide {ancho} × {alto} píxeles. El punto 0, 0 es la esquina superior izquierda.</p>
          <label>X<input type="text" inputMode="numeric" value={valores.x} onChange={(e) => { cambiar('x', e.target.value); }} /></label>
          <label>Y<input type="text" inputMode="numeric" value={valores.y} onChange={(e) => { cambiar('y', e.target.value); }} /></label>
          <label>Ancho<input type="text" inputMode="numeric" value={valores.ancho} onChange={(e) => { cambiar('ancho', e.target.value); }} /></label>
          <label>Alto<input type="text" inputMode="numeric" value={valores.alto} onChange={(e) => { cambiar('alto', e.target.value); }} /></label>
          <button type="submit" className="boton">Agregar rectángulo</button>
          <button type="button" className="boton" disabled={ocupado} onClick={buscar}>Buscar objeto en X, Y</button>
          {error !== null && <p role="alert" className="error-campo">{error}</p>}
        </form>
      </details>
      {revision.manuales.length > 0 && (
        <ul className="advertencias">
          {revision.manuales.map((z, i) => (
            <li key={z.id} className="advertencia bajo" data-manual={z.id}>
              <p>
                <strong>Tu zona {i + 1}</strong>
                {z.mascara_id === null ? ' (rectángulo)' : ' (silueta)'}
              </p>
              <div className="controles">
                <label>
                  Efecto<span className="solo-lector"> de tu zona {i + 1}</span>
                  <select value={efectoManual(z)} onChange={(e) => { alCambiarEfecto(z.id, esquemaEfecto.parse(e.target.value)); }}>
                    <option value="solido">Bloque sólido</option>
                    <option value="difuminado">Difuminado</option>
                    <option value="pixelado">Pixelado</option>
                  </select>
                </label>
                <button type="button" className="boton" onClick={() => { alQuitar(z.id); }}>Quitar<span className="solo-lector"> tu zona {i + 1}</span></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
