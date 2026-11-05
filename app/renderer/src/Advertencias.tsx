import { AlertCircle, AlertTriangle, Baby, Eye, EyeOff, Info, MapPin, Users } from 'lucide-react';
import { useState } from 'react';
import { etiquetaNivel, reglaDe, type Nivel, type Regla } from '../../shared/catalogo';
import { esquemaEfecto, LIMITES, type Analisis, type Hallazgo } from '../../shared/contrato';
import {
  decidir,
  describirHallazgo,
  efectoDe,
  elegirEfecto,
  reglasNoRevisadas,
  responderMenores,
  textoMotivo,
  tituloVeredicto,
  veredicto,
  type Revision,
} from '../../shared/logica';
import { leerEnRango } from '../../shared/numeros';
import { DialogoPorQue } from './Dialogos';

function IconoNivel({ nivel }: { nivel: Nivel }): React.JSX.Element {
  switch (nivel) {
    case 'alto':
      return <AlertTriangle aria-hidden="true" />;
    case 'medio':
      return <AlertCircle aria-hidden="true" />;
    case 'bajo':
      return <Info aria-hidden="true" />;
    default: {
      const inalcanzable: never = nivel;
      throw new Error(`Nivel desconocido: ${String(inalcanzable)}`);
    }
  }
}

function IconoCategoria({ regla }: { regla: Regla }): React.JSX.Element | null {
  switch (regla.categoria) {
    case 'caras_terceros':
      return <Users aria-hidden="true" />;
    case 'posibles_menores':
      return <Baby aria-hidden="true" />;
    case 'ubicacion':
      return <MapPin aria-hidden="true" />;
    default:
      return null;
  }
}

export function Cobertura({ analisis }: { analisis: Analisis }): React.JSX.Element {
  const v = veredicto(analisis);
  const noRevisadas = reglasNoRevisadas(analisis);
  return (
    <section aria-labelledby="titulo-veredicto" className={v === 'parcial' ? 'caja-parcial' : 'caja-veredicto'}>
      <h2 id="titulo-veredicto" data-testid="veredicto">{tituloVeredicto(v)}</h2>
      {analisis.cobertura.motivos.map((m) => <p key={m}>{textoMotivo(m)}</p>)}
      <p className="suave">La revisión es orientativa. Por ahora solo revisamos caras y ubicación guardada en el archivo.</p>
      <details>
        <summary>Lo que todavía no revisamos ({noRevisadas.length})</summary>
        <ul>{noRevisadas.map((r) => <li key={r.id}>{r.que_detecta}</li>)}</ul>
      </details>
    </section>
  );
}

interface Props {
  hallazgos: readonly Hallazgo[];
  revision: Revision;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  alOcultarTodo: () => void;
  alOcultarAlto: () => void;
}

export function Advertencias({ hallazgos, revision, alCambiar, alOcultarTodo, alOcultarAlto }: Props): React.JSX.Element | null {
  const [porQue, setPorQue] = useState<Regla | null>(null);
  const [intensidadTexto, setIntensidadTexto] = useState<string | null>(null);
  if (hallazgos.length === 0) return null;

  const visibles = hallazgos.filter((h) => h.caja !== null);
  const texto = intensidadTexto ?? String(revision.intensidad);
  const leida = leerEnRango(texto, LIMITES.intensidad.min, LIMITES.intensidad.max);
  const baja = leida.ok && leida.valor < LIMITES.intensidad.avisoBaja;
  const numeros = new Map(visibles.map((h, i) => [h.id, i + 1]));

  return (
    <section aria-label="Lista de advertencias">
      {visibles.length > 0 && (
        <div className="grupo-acciones">
          <button type="button" className="boton" onClick={alOcultarAlto}>Ocultar todo lo de riesgo alto</button>
          <button type="button" className="boton" onClick={alOcultarTodo}>Ocultar todo lo detectado</button>
        </div>
      )}
      <ul className="advertencias">
        {hallazgos.map((h) => {
          const regla = reglaDe(h.regla_id);
          const numero = numeros.get(h.id);
          const decision = revision.decisiones[h.id];
          return (
            <li key={h.id} className={`advertencia ${regla.nivel_riesgo}`} data-regla={h.regla_id}>
              <p className="nivel">
                <IconoNivel nivel={regla.nivel_riesgo} /> {etiquetaNivel(regla.nivel_riesgo)}
                <IconoCategoria regla={regla} />
                {h.caja !== null && <span className="numero">Zona {numero}</span>}
              </p>
              <p>{describirHallazgo(h)}</p>
              {h.requiere_revision && h.caja !== null && <p className="suave">Tenemos dudas con esta. Revísala con cuidado.</p>}

              {regla.requiere_confirmacion === true && (
                <fieldset className="pregunta">
                  <legend>¿Hay menores en esta foto?</legend>
                  <button type="button" className="boton" aria-pressed={revision.hayMenores === true} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, true)); }}>Sí, ocultar las caras</button>
                  <button type="button" className="boton" aria-pressed={revision.hayMenores === false} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, false)); }}>No</button>
                </fieldset>
              )}

              {h.regla_id === 'UBI-01' && <p className="suave">Se borra al exportar, sin que hagas nada.</p>}

              {h.caja !== null && (
                <div className="controles">
                  <button type="button" className="boton" aria-pressed={decision === 'ocultar'} onClick={() => { alCambiar((r) => decidir(r, h.id, 'ocultar')); }}>
                    <EyeOff aria-hidden="true" /> Ocultar<span className="solo-lector"> zona {numero}</span>
                  </button>
                  <button type="button" className="boton" aria-pressed={decision === 'ignorar'} onClick={() => { alCambiar((r) => decidir(r, h.id, 'ignorar')); }}>
                    <Eye aria-hidden="true" /> Dejar visible<span className="solo-lector"> zona {numero}</span>
                  </button>
                  <label>
                    Efecto<span className="solo-lector"> de la zona {numero}</span>
                    <select
                      value={efectoDe(revision, h)}
                      onChange={(e) => {
                        const efecto = esquemaEfecto.parse(e.target.value);
                        alCambiar((r) => elegirEfecto(r, h.id, efecto));
                      }}
                    >
                      <option value="difuminado">Difuminado</option>
                      <option value="pixelado">Pixelado</option>
                      <option value="solido">Bloque sólido</option>
                    </select>
                  </label>
                </div>
              )}
              <button type="button" className="enlace" onClick={() => { setPorQue(regla); }}>
                ¿Por qué?<span className="solo-lector"> {describirHallazgo(h)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {visibles.length > 0 && (
        <div className="intensidad">
          <label htmlFor="intensidad">Intensidad del efecto (1 a 100)</label>
          <input
            id="intensidad"
            type="text"
            inputMode="numeric"
            value={texto}
            aria-invalid={!leida.ok}
            aria-describedby="ayuda-intensidad"
            onChange={(e) => {
              const valor = e.target.value;
              setIntensidadTexto(valor);
              const nuevo = leerEnRango(valor, LIMITES.intensidad.min, LIMITES.intensidad.max);
              if (nuevo.ok) alCambiar((r) => ({ ...r, intensidad: nuevo.valor }));
            }}
            onBlur={() => { setIntensidadTexto(null); }}
          />
          <p id="ayuda-intensidad" className={leida.ok ? 'suave' : 'error-campo'} role={leida.ok ? undefined : 'alert'}>
            {!leida.ok && 'Escribe un número entero del 1 al 100. Se conserva el último valor válido.'}
            {baja && 'Se verá más nítido, pero lo original ya se sobrescribió.'}
            {leida.ok && !baja && 'Solo cambia cómo se ve. Lo original se sobrescribe siempre.'}
          </p>
        </div>
      )}

      {porQue !== null && <DialogoPorQue regla={porQue} alCerrar={() => { setPorQue(null); }} />}
    </section>
  );
}
