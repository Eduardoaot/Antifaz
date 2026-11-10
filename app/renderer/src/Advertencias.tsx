import { AlertCircle, AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Baby, Bath, Car, CircleHelp, CreditCard, Crosshair, Eye, EyeOff, Flag, Gem, IdCard, Info, MapPin, Monitor, Move, Phone, Plane, QrCode, Shirt, Stethoscope, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { reglaDe, type Regla } from '../../shared/catalogo';
import { esquemaEfecto, LIMITES, type Analisis, type Hallazgo } from '../../shared/contrato';
import {
  ajustarSticker,
  ajustaSticker,
  decidir,
  describirHallazgo,
  efectoDe,
  elegirEfecto,
  escalaDe,
  enElTope,
  escalaMinimaSticker,
  posicionDe,
  restablecerSticker,
  stickerAjustado,
  type CambioSticker,
  type Posicion,
  etiquetaNivelMostrado,
  nivelMostrado,
  reglasNoRevisadas,
  responderMenores,
  soloAvisaSinZona,
  textoMotivo,
  textoRevisado,
  tituloVeredicto,
  veredicto,
  type NivelMostrado,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import { leerEnRango } from '../../shared/numeros';
import { DialogoPorQue } from './Dialogos';
import { eventosResaltar } from './resaltar';
import { OpcionesEmoji } from './OpcionesEmoji';

function IconoNivel({ nivel }: { nivel: NivelMostrado }): React.JSX.Element {
  switch (nivel) {
    case 'pregunta':
      return <CircleHelp aria-hidden="true" />;
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
    case 'desnudez':
    case 'contenido_sugerente':
      return <Shirt aria-hidden="true" />;
    case 'contacto_personal':
      return <Phone aria-hidden="true" />;
    case 'documentos_identidad':
      return <IdCard aria-hidden="true" />;
    case 'informacion_financiera':
      return <CreditCard aria-hidden="true" />;
    case 'informacion_medica':
      return <Stethoscope aria-hidden="true" />;
    case 'boletos_viajes':
      return <Plane aria-hidden="true" />;
    case 'codigos':
      return <QrCode aria-hidden="true" />;
    case 'matriculas':
      return <Car aria-hidden="true" />;
    case 'pantallas':
      return <Monitor aria-hidden="true" />;
    case 'objetos_valor':
      return <Gem aria-hidden="true" />;
    case 'armas':
      return <Crosshair aria-hidden="true" />;
    case 'extremismo':
      return <Flag aria-hidden="true" />;
    case 'espacios_intimos':
      return <Bath aria-hidden="true" />;
    default:
      return null;
  }
}

function textoTamano(valor: number, minimo: number): string {
  if (valor <= minimo) return 'Es lo más chico: tapa justo la cara.';
  if (valor < LIMITES.escalaSticker.porDefecto) return 'Más chico tapa la cara, pero podría dejar ver cabello u orejas.';
  if (valor > LIMITES.escalaSticker.porDefecto) return 'Más grande tapa más de lo necesario.';
  return 'Es el tamaño que elegimos: tapa la cara con un margen.';
}

function textoPosicion(h: Hallazgo, escala: number, p: Posicion): string | null {
  if (escala <= escalaMinimaSticker(h)) return 'Para moverlo, primero hazlo más grande.';
  if (p.x === 0 && p.y === 0) return null;
  return enElTope(h, escala, p) ? 'Hasta aquí: más lejos dejaría ver la cara.' : 'Lo moviste del centro.';
}

interface PropsAjuste {
  hallazgo: Hallazgo;
  numero: number | undefined;
  revision: Revision;
  abierto: boolean;
  alAbrir: (abierto: boolean) => void;
  alAjustar: (h: Hallazgo, cambio: CambioSticker) => void;
  alRestablecer: (id: string) => void;
}

/**
 * Un solo botón en la fila: abre el tamaño, la cruceta para moverlo y "Restablecer". Es la ruta con
 * teclado de lo mismo que se hace arrastrando en la foto, y se abre también al elegir el sticker ahí.
 */
function AjusteSticker({ hallazgo, numero, revision, abierto, alAbrir, alAjustar, alRestablecer }: PropsAjuste): React.JSX.Element {
  const id = useId();
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const guardada = escalaDe(revision, hallazgo.id);
  const posicion = posicionDe(revision, hallazgo.id);
  const minimo = escalaMinimaSticker(hallazgo);
  const valor = Math.max(minimo, moviendo ?? guardada);
  const porcentaje = `${String(Math.round(valor * 100))} %`;
  const ajustado = stickerAjustado(revision, hallazgo.id);
  const zona = <span className="solo-lector"> de la zona {numero}</span>;
  const confirmar = (): void => {
    if (moviendo === null) return;
    setMoviendo(null);
    alAjustar(hallazgo, { escala: moviendo });
  };
  const { paso } = LIMITES.posicionSticker;
  const mover = (dx: number, dy: number): void => {
    alAjustar(hallazgo, { posicion: { x: posicion.x + dx, y: posicion.y + dy } });
  };
  const enPosicion = textoPosicion(hallazgo, valor, posicion);
  return (
    <div className="ajuste-sticker">
      <button type="button" className="boton" aria-expanded={abierto} aria-controls={`${id}-panel`} onClick={() => { alAbrir(!abierto); }}>
        <Move aria-hidden="true" /> Ajustar sticker{zona}
        {ajustado && <span className="marca-ajustado"> · ajustado</span>}
      </button>
      {abierto && (
        <div id={`${id}-panel`} className="tamano-sticker" role="group" aria-label={`Ajustes del sticker de la zona ${String(numero)}`}>
          <label htmlFor={`${id}-control`}>Tamaño{zona}</label>
          <input
            id={`${id}-control`}
            type="range"
            min={minimo}
            max={LIMITES.escalaSticker.max}
            step={LIMITES.escalaSticker.paso}
            value={valor}
            aria-valuetext={porcentaje}
            aria-describedby={`${id}-ayuda`}
            onChange={(e) => { setMoviendo(Number(e.target.value)); }}
            onPointerUp={confirmar}
            onKeyUp={confirmar}
            onBlur={confirmar}
          />
          <output htmlFor={`${id}-control`}>{porcentaje}</output>
          <div className="cruceta" role="group" aria-label="Mover el sticker">
            <button type="button" className="boton chico arriba" aria-label="Mover arriba" title="Mover arriba (↑)" onClick={() => { mover(0, -paso); }}>
              <ArrowUp aria-hidden="true" />
            </button>
            <button type="button" className="boton chico izquierda" aria-label="Mover a la izquierda" title="Mover a la izquierda (←)" onClick={() => { mover(-paso, 0); }}>
              <ArrowLeft aria-hidden="true" />
            </button>
            <button type="button" className="boton chico derecha" aria-label="Mover a la derecha" title="Mover a la derecha (→)" onClick={() => { mover(paso, 0); }}>
              <ArrowRight aria-hidden="true" />
            </button>
            <button type="button" className="boton chico abajo" aria-label="Mover abajo" title="Mover abajo (↓)" onClick={() => { mover(0, paso); }}>
              <ArrowDown aria-hidden="true" />
            </button>
          </div>
          <p id={`${id}-ayuda`} className="suave" aria-live="polite">
            {textoTamano(valor, minimo)}
            {enPosicion !== null && <> {enPosicion}</>}
          </p>
          {ajustado && moviendo === null && (
            <button type="button" className="enlace" onClick={() => { alRestablecer(hallazgo.id); }}>
              Restablecer{zona}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Cobertura({ analisis }: { analisis: Analisis }): React.JSX.Element {
  const v = veredicto(analisis);
  const noRevisadas = reglasNoRevisadas(analisis);
  return (
    <section aria-labelledby="titulo-veredicto" className={v === 'parcial' ? 'caja-parcial' : 'caja-veredicto'}>
      <h2 id="titulo-veredicto" data-testid="veredicto">{tituloVeredicto(v)}</h2>
      {analisis.cobertura.motivos.map((m) => <p key={m}>{textoMotivo(m)}</p>)}
      <p className="suave">{textoRevisado(analisis)}</p>
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
  /** Zona resaltada a la vez aquí y en la imagen. */
  resaltado?: Resaltado | null;
  alResaltar?: (r: Resaltado | null) => void;
  /** Sticker elegido, el mismo en la foto y aquí: su fila abre los ajustes. */
  seleccionSticker?: string | null;
  alSeleccionarSticker?: (id: string | null) => void;
}

export function Advertencias({ hallazgos, revision, alCambiar, alOcultarTodo, alOcultarAlto, resaltado = null, alResaltar, seleccionSticker = null, alSeleccionarSticker }: Props): React.JSX.Element | null {
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
        <div className="grupo-acciones acciones-masivas">
          <button type="button" className="boton" onClick={alOcultarAlto}>Ocultar todo lo de riesgo alto</button>
          <button type="button" className="boton" onClick={alOcultarTodo}>Ocultar todo lo detectado</button>
        </div>
      )}
      <ul className="advertencias">
        {hallazgos.map((h) => {
          const regla = reglaDe(h.regla_id);
          const numero = numeros.get(h.id);
          const decision = revision.decisiones[h.id];
          const nivel = nivelMostrado(h, revision);
          return (
            <li
              key={h.id}
              className={`advertencia ${nivel === 'pregunta' ? 'nivel-pregunta' : nivel}${h.caja !== null && resaltado?.id === h.id ? ' resaltada' : ''}`}
              data-regla={h.regla_id}
              data-zona={h.caja !== null ? h.id : undefined}
              {...(h.caja !== null ? eventosResaltar(h.id, resaltado, alResaltar) : {})}
            >
              <p className="nivel">
                <IconoNivel nivel={nivel} /> {etiquetaNivelMostrado(nivel)}
                <IconoCategoria regla={regla} />
                {h.caja !== null && <span className="numero">Zona {numero}</span>}
              </p>
              <p>{describirHallazgo(h)}</p>

              {regla.requiere_confirmacion === true && (
                <fieldset className="pregunta">
                  <legend>¿Hay menores en esta foto?</legend>
                  <button type="button" className="boton" aria-pressed={revision.hayMenores === true} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, true)); }}>Sí, ocultar las caras</button>
                  <button type="button" className="boton" aria-pressed={revision.hayMenores === false} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, false)); }}>No</button>
                </fieldset>
              )}

              {h.regla_id === 'UBI-01' && <p className="suave">Se borra al exportar, sin que hagas nada.</p>}
              {h.regla_id === 'INT-01' && <p className="suave">Es un aviso sobre toda la foto: revísala completa antes de publicarla.</p>}
              {soloAvisaSinZona(h) && <p className="suave">Todavía no podemos taparlo por zona. Si no quieres mostrarlo, recorta la foto o no la publiques.</p>}
              {h.regla_id === 'DES-01' && h.caja !== null && <p className="suave">La marcamos para ocultarla. Instagram podría limitar la foto aunque esté tapada.</p>}

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
                      <OpcionesEmoji />
                    </select>
                  </label>
                  {decision === 'ocultar' && ajustaSticker(revision, h) && (
                    <AjusteSticker
                      hallazgo={h}
                      numero={numero}
                      revision={revision}
                      abierto={seleccionSticker === h.id}
                      alAbrir={(abrir) => { alSeleccionarSticker?.(abrir ? h.id : null); }}
                      alAjustar={(hz, cambio) => { alCambiar((r) => ajustarSticker(r, hz, cambio)); }}
                      alRestablecer={(sid) => { alCambiar((r) => restablecerSticker(r, sid)); }}
                    />
                  )}
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
            {baja && 'Con poca intensidad es más fácil reconocer lo que hay debajo. '}
            {leida.ok && 'El difuminado y el pixelado conservan los colores de tu foto, y con herramientas especiales alguien podría reconstruir parte. Para la máxima protección, usa Bloque sólido o un emoji.'}
          </p>
        </div>
      )}

      {porQue !== null && <DialogoPorQue regla={porQue} alCerrar={() => { setPorQue(null); }} />}
    </section>
  );
}
