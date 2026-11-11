import { FolderOpen } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { esquemaFormatoCopia, esquemaSufijo, esquemaTema, LIMITES, type Ajustes, type PreferenciasCopia, type Tema } from '../../shared/contrato';

interface Props {
  ajustes: Ajustes;
  alCambiarTema: (tema: Tema) => void;
  alCambiarCopia: (preferencias: PreferenciasCopia) => void;
  alElegirCarpeta: () => void;
  alCerrar: () => void;
}

/** Apariencia y cómo se guardan las copias. Cada cambio se guarda al momento. */
export function Configuracion({ ajustes, alCambiarTema, alCambiarCopia, alElegirCarpeta, alCerrar }: Props): React.JSX.Element {
  const referencia = useRef<HTMLDialogElement | null>(null);
  const id = useId();
  const [sufijo, setSufijo] = useState(ajustes.copia.sufijo);
  const leido = esquemaSufijo.safeParse(sufijo);
  const ultimo = useRef(alCerrar);
  useEffect(() => {
    ultimo.current = alCerrar;
  });
  useEffect(() => {
    const dialogo = referencia.current;
    if (dialogo !== null && !dialogo.open) dialogo.showModal();
    const cancelar = (e: Event): void => {
      e.preventDefault();
      ultimo.current();
    };
    dialogo?.addEventListener('cancel', cancelar);
    return () => {
      dialogo?.removeEventListener('cancel', cancelar);
      dialogo?.close();
    };
  }, []);

  const copia = ajustes.copia;
  const enCarpeta = copia.destino === 'carpeta';
  const ejemplo = `foto${leido.success ? leido.data : copia.sufijo}.${copia.formato === 'png' ? 'png' : 'jpg'}`;

  return (
    <dialog ref={referencia} className="dialogo ancho configuracion" aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>Configuración</h2>

      <section className="config-seccion" aria-labelledby={`${id}-apariencia`}>
        <h3 id={`${id}-apariencia`}>Apariencia</h3>
        <label className="config-campo">
          Tema
          <select value={ajustes.tema} onChange={(e) => { alCambiarTema(esquemaTema.parse(e.target.value)); }}>
            <option value="sistema">Como el sistema</option>
            <option value="claro">Claro</option>
            <option value="oscuro">Oscuro</option>
          </select>
        </label>
      </section>

      <section className="config-seccion" aria-labelledby={`${id}-copias`}>
        <h3 id={`${id}-copias`}>Copias exportadas</h3>
        <fieldset className="config-opciones">
          <legend>Dónde guardarlas</legend>
          <label className="config-radio">
            <input type="radio" name={`${id}-destino`} checked={!enCarpeta} onChange={() => { alCambiarCopia({ ...copia, destino: 'preguntar' }); }} />
            <span>Preguntar cada vez</span>
          </label>
          <label className="config-radio">
            <input type="radio" name={`${id}-destino`} checked={enCarpeta} onChange={() => { alCambiarCopia({ ...copia, destino: 'carpeta' }); }} />
            <span>Guardar directo en una carpeta, sin preguntar</span>
          </label>
          <div className="config-carpeta">
            <span className={ajustes.carpeta === null ? 'suave' : ''}>
              {ajustes.carpeta === null ? 'Todavía no eliges una carpeta.' : <>Carpeta: <strong>{ajustes.carpeta}</strong></>}
            </span>
            <button type="button" className="boton" onClick={alElegirCarpeta}>
              <FolderOpen aria-hidden="true" /> {ajustes.carpeta === null ? 'Elegir carpeta' : 'Cambiar carpeta'}
            </button>
          </div>
          {enCarpeta && ajustes.carpeta === null && (
            <p className="suave">Hasta que elijas una, te preguntaremos dónde guardar.</p>
          )}
          <p className="suave">Si ya hay un archivo con el mismo nombre, no lo reemplazamos: la copia nueva lleva un número.</p>
        </fieldset>

        <label className="config-campo">
          Formato
          <select value={copia.formato} onChange={(e) => { alCambiarCopia({ ...copia, formato: esquemaFormatoCopia.parse(e.target.value) }); }}>
            <option value="automatico">Automático (PNG si la foto era PNG; si no, JPG)</option>
            <option value="jpg">Siempre JPG</option>
            <option value="png">Siempre PNG</option>
          </select>
        </label>

        <div className="config-campo">
          <label htmlFor={`${id}-sufijo`}>Texto al final del nombre</label>
          <input
            id={`${id}-sufijo`}
            type="text"
            value={sufijo}
            maxLength={LIMITES.sufijoExportacion}
            aria-invalid={!leido.success}
            aria-describedby={`${id}-ayuda-sufijo`}
            onChange={(e) => {
              setSufijo(e.target.value);
              const nuevo = esquemaSufijo.safeParse(e.target.value);
              if (nuevo.success) alCambiarCopia({ ...copia, sufijo: nuevo.data });
            }}
          />
          <p id={`${id}-ayuda-sufijo`} className={leido.success ? 'suave' : 'error-campo'} role={leido.success ? undefined : 'alert'}>
            {leido.success
              ? <>Así se llamará: <strong>{ejemplo}</strong></>
              : `No uses < > : " / \\ | ? *, ni termines en punto o espacio. Conservamos "${copia.sufijo}".`}
          </p>
        </div>
      </section>

      <div className="fila-botones">
        <button type="button" className="boton primario" autoFocus onClick={alCerrar}>Listo</button>
      </div>
    </dialog>
  );
}
