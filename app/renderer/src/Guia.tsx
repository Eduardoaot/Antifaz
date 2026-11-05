import { useState } from 'react';
import { AVISO_LEGAL, catalogo, etiquetaNivel, type Regla } from '../../shared/catalogo';
import { agruparReglas } from '../../shared/logica';
import { DialogoPorQue } from './Dialogos';

/** Se puede consultar sin cargar ninguna foto y sin internet: el catálogo viaja dentro de la app. */
export function Guia(): React.JSX.Element {
  const [abierta, setAbierta] = useState<Regla | null>(null);
  return (
    <main id="principal" tabIndex={-1} className="guia">
      <h1>Guía de privacidad</h1>
      <p>
        Esto es lo que conviene revisar antes de publicar, por qué, y de dónde sale cada recomendación.
        Cuando no encontramos una fuente oficial directa, lo decimos.
      </p>
      <p className="suave">{AVISO_LEGAL} Versión del catálogo: {catalogo.version}.</p>
      {agruparReglas().map(({ titulo, reglas }) => (
        <section key={titulo} aria-labelledby={`guia-${titulo}`}>
          <h2 id={`guia-${titulo}`}>{titulo}</h2>
          <ul className="advertencias">
            {reglas.map((r) => (
              <li key={r.id} className={`advertencia ${r.nivel_riesgo}`}>
                <p className="nivel">{etiquetaNivel(r.nivel_riesgo)}</p>
                <p><strong>{r.que_detecta}</strong></p>
                <p>{r.por_que}</p>
                {r.estado === 'pendiente_de_verificar' && <p className="suave">Aún no tenemos una fuente oficial directa.</p>}
                <button type="button" className="enlace" onClick={() => { setAbierta(r); }}>
                  Ver fuentes<span className="solo-lector">: {r.que_detecta}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {abierta !== null && <DialogoPorQue regla={abierta} alCerrar={() => { setAbierta(null); }} />}
    </main>
  );
}
