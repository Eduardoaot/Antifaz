import { Trash2 } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { esEmoji } from '../../shared/contrato';
import {
  ajustarSticker,
  efectoManual,
  elegirEfectoVarias,
  elegirIntensidadVarias,
  hallazgoDeManual,
  intensidadDe,
  leerCaja,
  leerPunto,
  restablecerSticker,
  textoOrigen,
  usaIntensidad,
  type Caja,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import { AjusteSticker, ControlIntensidad, SelectorEfecto } from './Advertencias';
import { eventosResaltar } from './resaltar';

interface Props {
  ancho: number;
  alto: number;
  revision: Revision;
  ocupado: boolean;
  alAgregarCaja: (caja: Caja) => void;
  alBuscarEnPunto: (x: number, y: number) => void;
  alQuitar: (id: string) => void;
  /** Zona resaltada a la vez aquí y en la imagen. */
  resaltado?: Resaltado | null;
  alResaltar?: (r: Resaltado | null) => void;
  /** Sticker elegido en la foto o en un panel: sus ajustes quedan abiertos. */
  seleccionSticker?: string | null;
  alSeleccionarSticker?: (id: string | null) => void;
  alCambiarRevision: (cambio: (r: Revision) => Revision) => void;
}

/**
 * Las zonas que agregaste tú. Las herramientas están en la barra de la imagen; aquí quedan tus zonas y
 * la ruta sin mouse: escribir las coordenadas.
 */
export function Manual({ ancho, alto, revision, ocupado, alAgregarCaja, alBuscarEnPunto, alQuitar, resaltado = null, alResaltar, seleccionSticker = null, alSeleccionarSticker, alCambiarRevision }: Props): React.JSX.Element {
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
    <section aria-labelledby="titulo-manual" className="manual">
      <div className="cabecera-seccion">
        <h2 id="titulo-manual">Tus zonas</h2>
        {revision.manuales.length > 0 && <span className="chip-conteo">{revision.manuales.length}</span>}
      </div>
      {revision.manuales.length === 0 && (
        <p className="suave">¿Algo más que tapar? Usa las herramientas de la barra sobre la imagen.</p>
      )}
      {revision.manuales.length > 0 && (
        <ul className="zonas">
          {revision.manuales.map((z, i) => {
            const nombre = `tu zona ${i + 1}`;
            const efecto = efectoManual(z);
            return (
              <li
                key={z.id}
                className={`fila-zona${resaltado?.id === z.id ? ' resaltada' : ''}`}
                data-manual={z.id}
                data-zona={z.id}
                {...eventosResaltar(z.id, resaltado, alResaltar)}
              >
                <div className="fila-zona-cabecera">
                  <p className="fila-zona-titulo">
                    <strong>Tu zona {i + 1}</strong>
                    <span className="suave">{` (${textoOrigen(z.origen)})`}</span>
                  </p>
                  <button type="button" className="boton fantasma chico" aria-label={`Quitar ${nombre}`} title="Quitar esta zona" onClick={() => { alQuitar(z.id); }}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
                <SelectorEfecto valor={efecto} etiqueta="Efecto" alCambiar={(e) => { alCambiarRevision((r) => elegirEfectoVarias(r, [z.id], e)); }} />
                {usaIntensidad(efecto) && (
                  <ControlIntensidad valor={intensidadDe(revision, z.id)} etiqueta="Intensidad" alCambiar={(v) => { alCambiarRevision((r) => elegirIntensidadVarias(r, [z.id], v)); }} />
                )}
                {esEmoji(z.efecto) && (
                  <AjusteSticker
                    hallazgo={hallazgoDeManual(z)}
                    nombre={nombre}
                    revision={revision}
                    abierto={seleccionSticker === z.id}
                    alAbrir={(abrir) => { alSeleccionarSticker?.(abrir ? z.id : null); }}
                    alAjustar={(hz, cambio) => { alCambiarRevision((r) => ajustarSticker(r, hz, cambio)); }}
                    alRestablecer={(sid) => { alCambiarRevision((r) => restablecerSticker(r, sid)); }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
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
    </section>
  );
}
