import { useEffect, useId, useRef } from 'react';
import { MARCA, type Fuente, type Regla } from '../../shared/catalogo';

/**
 * Un clic fuera del recuadro del diálogo (en el fondo atenuado) lo cierra. Se mide con el recuadro y no
 * con el elemento, porque el relleno del <dialog> también es el propio <dialog>.
 */
export function clicFuera(e: React.MouseEvent<HTMLDialogElement>): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
}

function useModal(alCerrar: () => void): React.RefObject<HTMLDialogElement | null> {
  const referencia = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialogo = referencia.current;
    // Un <dialog> modal atrapa el foco y lo devuelve al cerrar; Escape dispara 'close'.
    if (dialogo !== null && !dialogo.open) dialogo.showModal();
    return () => {
      dialogo?.close();
    };
  }, []);
  const ultimo = useRef(alCerrar);
  useEffect(() => {
    ultimo.current = alCerrar;
  });
  useEffect(() => {
    const dialogo = referencia.current;
    const manejar = (e: Event): void => {
      e.preventDefault();
      ultimo.current();
    };
    dialogo?.addEventListener('cancel', manejar);
    return () => {
      dialogo?.removeEventListener('cancel', manejar);
    };
  }, []);
  return referencia;
}

interface ConfirmacionProps {
  titulo: string;
  texto: string;
  aceptar: string;
  cancelar: string;
  alAceptar: () => void;
  alCancelar: () => void;
}

export function Confirmacion({ titulo, texto, aceptar, cancelar, alAceptar, alCancelar }: ConfirmacionProps): React.JSX.Element {
  const referencia = useModal(alCancelar);
  // Puede haber dos a la vez (por ejemplo, exportar y cerrar): cada título necesita su propio id.
  const idTitulo = useId();
  return (
    <dialog ref={referencia} aria-labelledby={idTitulo} className="dialogo">
      <h2 id={idTitulo}>{titulo}</h2>
      <p>{texto}</p>
      <div className="fila-botones">
        <button type="button" className="boton" autoFocus onClick={alCancelar}>{cancelar}</button>
        <button type="button" className="boton primario" onClick={alAceptar}>{aceptar}</button>
      </div>
    </dialog>
  );
}

function textoVigencia(f: Fuente): string {
  if (f.vigente === null) return 'Vigencia sin confirmar';
  return f.vigente ? 'Vigente' : 'Ya no vigente: se usa solo como referencia';
}

function textoAlcance(f: Fuente): string {
  switch (f.alcance) {
    case 'mexico_federal':
      return 'México';
    case 'mexico_local':
      return 'México (local)';
    case 'internacional':
      return 'Otro país';
    case 'plataforma':
      return 'Política de plataforma';
    default: {
      const inalcanzable: never = f.alcance;
      throw new Error(`Alcance desconocido: ${String(inalcanzable)}`);
    }
  }
}

export function DialogoPorQue({ regla, alCerrar }: { regla: Regla; alCerrar: () => void }): React.JSX.Element {
  const referencia = useModal(alCerrar);
  return (
    <dialog ref={referencia} aria-labelledby="titulo-porque" className="dialogo ancho dialogo-porque" onClick={(e) => { if (clicFuera(e)) alCerrar(); }}>
      <h2 id="titulo-porque">¿Por qué {MARCA.nombre} te avisa de esto?</h2>
      <p className="porque-texto">{regla.por_que}</p>
      {regla.estado === 'pendiente_de_verificar' && (
        <p className="nota"><strong>Aún no tenemos una fuente oficial directa.</strong> {regla.nota}</p>
      )}
      {regla.estado === 'verificada' && regla.nota !== undefined && <p className="nota">{regla.nota}</p>}
      {regla.fuentes.length > 0 && (
      <details className="fuentes-plegables">
      <summary>Ver fuentes ({regla.fuentes.length})</summary>
      <ul className="fuentes">
        {regla.fuentes.map((f) => (
          <li key={`${f.url}-${f.resumen}`}>
            <strong>{f.institucion}.</strong> {f.documento}{f.referencia === undefined ? '' : ` (${f.referencia})`}.
            <br />
            {f.resumen}
            <br />
            <span className="suave">{textoAlcance(f)} · {textoVigencia(f)} · Consultada el {f.fecha_consulta}</span>
            <br />
            <button type="button" className="enlace" onClick={() => { void window.revisor.abrirFuente(f.url); }}>
              Abrir en el navegador<span className="solo-lector">: {f.documento}</span>
            </button>
          </li>
        ))}
      </ul>
      </details>
      )}
      <div className="fila-botones">
        <button type="button" className="boton primario" autoFocus onClick={alCerrar}>Entendido</button>
      </div>
    </dialog>
  );
}
