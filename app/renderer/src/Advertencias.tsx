import { AlertCircle, AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Baby, Bath, Car, ChevronDown, CircleHelp, CreditCard, Crosshair, EraserIcon, Eye, EyeOff, Flag, Gem, IdCard, Info, MapPin, Monitor, Move, Phone, Plane, QrCode, RotateCcw, Shirt, SlidersHorizontal, Stethoscope, Users } from 'lucide-react';
import { Fragment, useId, useState } from 'react';
import { reglaDe, type Regla } from '../../shared/catalogo';
import { esquemaEfecto, LIMITES, type Analisis, type Efecto, type Hallazgo } from '../../shared/contrato';
import {
  agruparHallazgos,
  ajustarSticker,
  ajustaSticker,
  contarRevision,
  decidirVarias,
  descartarZona,
  describirHallazgo,
  describirZona,
  efectoDe,
  elegirEfectoVarias,
  elegirIntensidadGlobal,
  elegirIntensidadVarias,
  enElTope,
  escalaDe,
  estiramientoDe,
  limitarEstiramiento,
  limitarRotacion,
  rotacionDe,
  escalaMinimaSticker,
  estadoDeZonas,
  etiquetaNivelMostrado,
  intensidadDe,
  limitarIntensidad,
  limitarMargen,
  margenPctDe,
  elegirMargenVarias,
  posicionDe,
  responderMenores,
  restablecerSticker,
  restaurarZona,
  soloAvisaSinZona,
  stickerAjustado,
  textoMotivo,
  tituloGrupo,
  tituloVeredicto,
  usaIntensidad,
  valorComun,
  veredicto,
  type CambioSticker,
  type EstadoGrupo,
  type Grupo,
  type NivelMostrado,
  type Estiramiento,
  type Posicion,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import { DialogoPorQue } from './Dialogos';
import { OpcionesEmoji } from './OpcionesEmoji';
import { eventosResaltar } from './resaltar';

export function IconoNivel({ nivel }: { nivel: NivelMostrado }): React.JSX.Element {
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

export function IconoCategoria({ regla }: { regla: Regla }): React.JSX.Element | null {
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

/** Nivel con ícono y texto: el color nunca va solo. */
export function PildoraNivel({ nivel }: { nivel: NivelMostrado }): React.JSX.Element {
  return (
    <span className={`pildora-nivel nivel ${nivel === 'pregunta' ? 'nivel-pregunta' : nivel}`}>
      <IconoNivel nivel={nivel} /> {etiquetaNivelMostrado(nivel)}
    </span>
  );
}

// --- Controles reutilizables ---------------------------------------------------------------------

interface PropsDecision {
  estado: EstadoGrupo;
  /** Qué se oculta, para el lector de pantalla: "zona 1 de Caras", "todas las Caras". */
  que: string;
  alDecidir: (decision: 'ocultar' | 'ignorar') => void;
  compacto?: boolean;
  /** Varias zonas a la vez: "Ocultar todas" y "Todas visibles". */
  varias?: boolean;
}

/** Un solo control de dos posiciones. "Mixto" y "sin decidir" no marcan ninguna. */
export function ControlDecision({ estado, que, alDecidir, compacto = false, varias = false }: PropsDecision): React.JSX.Element {
  return (
    <div className={`segmentado${compacto ? ' compacto' : ''}`} role="group" aria-label={`¿Ocultar ${que}?`}>
      <button type="button" aria-pressed={estado === 'ocultar'} onClick={() => { alDecidir('ocultar'); }}>
        <EyeOff aria-hidden="true" /> {varias ? 'Ocultar todas' : 'Ocultar'}<span className="solo-lector"> {que}</span>
      </button>
      {/* El nombre contiene el texto visible ("Visible"), como pide WCAG 2.5.3. */}
      <button type="button" aria-label={`Dejar visible ${que}`} aria-pressed={estado === 'ignorar'} onClick={() => { alDecidir('ignorar'); }}>
        <Eye aria-hidden="true" /> {varias ? 'Todas visibles' : 'Visible'}
      </button>
    </div>
  );
}

interface PropsEfecto {
  /** Null si las zonas tienen efectos distintos. */
  valor: Efecto | null;
  etiqueta: string;
  alCambiar: (efecto: Efecto) => void;
}

export function SelectorEfecto({ valor, etiqueta, alCambiar }: PropsEfecto): React.JSX.Element {
  return (
    <label className="campo-efecto">
      <span>{etiqueta}</span>
      <select value={valor ?? ''} onChange={(e) => { alCambiar(esquemaEfecto.parse(e.target.value)); }}>
        {valor === null && <option value="" disabled>Varios</option>}
        <option value="solido">Bloque sólido</option>
        <option value="difuminado">Difuminado</option>
        <option value="pixelado">Pixelado</option>
        <OpcionesEmoji />
      </select>
    </label>
  );
}

interface PropsIntensidad {
  /** Null si las zonas tienen intensidades distintas. */
  valor: number | null;
  etiqueta: string;
  alCambiar: (valor: number) => void;
  /** Para la global: el aviso de que el difuminado se puede revertir va una sola vez. */
  conAviso?: boolean;
}

/**
 * Barra de 1 a 100. Mientras se arrastra solo cambia aquí; al soltar se guarda un paso en el historial,
 * así deshacer no tiene que recorrer cada número.
 */
export function ControlIntensidad({ valor, etiqueta, alCambiar, conAviso = false }: PropsIntensidad): React.JSX.Element {
  const id = useId();
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const actual = moviendo ?? valor ?? LIMITES.intensidad.porDefecto;
  const baja = actual < LIMITES.intensidad.avisoBaja;
  const confirmar = (): void => {
    if (moviendo === null) return;
    setMoviendo(null);
    if (moviendo !== valor) alCambiar(limitarIntensidad(moviendo));
  };
  return (
    <div className="campo-intensidad">
      <label htmlFor={id}>{etiqueta}</label>
      <div className="fila-rango">
        <input
          id={id}
          type="range"
          min={LIMITES.intensidad.min}
          max={LIMITES.intensidad.max}
          value={actual}
          aria-valuetext={valor === null && moviendo === null ? 'Varias' : `${actual} de 100`}
          aria-describedby={`${id}-ayuda`}
          onChange={(e) => { setMoviendo(Number(e.target.value)); }}
          onPointerUp={confirmar}
          onKeyUp={confirmar}
          onBlur={confirmar}
        />
        <output htmlFor={id}>{valor === null && moviendo === null ? 'Varias' : actual}</output>
      </div>
      <p id={`${id}-ayuda`} className="suave ayuda-intensidad" aria-live="polite">
        {baja && 'Con poca intensidad es más fácil reconocer lo que hay debajo. '}
        {conAviso && 'El difuminado y el pixelado conservan los colores de tu foto, y con herramientas especiales alguien podría reconstruir parte. Para la máxima protección, usa Bloque sólido o un emoji.'}
      </p>
    </div>
  );
}

interface PropsMargen {
  /** Null si las zonas tienen márgenes distintos. */
  valor: number | null;
  etiqueta: string;
  alCambiar: (valor: number) => void;
}

/** Margen alrededor de la detección: agranda o achica la censura auto. */
export function ControlMargen({ valor, etiqueta, alCambiar }: PropsMargen): React.JSX.Element {
  const id = useId();
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const actual = moviendo ?? valor ?? LIMITES.dilatacionPct.porDefecto;
  const confirmar = (): void => {
    if (moviendo === null) return;
    setMoviendo(null);
    if (moviendo !== valor) alCambiar(limitarMargen(moviendo));
  };
  return (
    <div className="campo-intensidad">
      <label htmlFor={id}>{etiqueta}</label>
      <div className="fila-rango">
        <input
          id={id}
          type="range"
          min={LIMITES.dilatacionPct.min}
          max={LIMITES.dilatacionPct.max}
          value={actual}
          aria-valuetext={valor === null && moviendo === null ? 'Varias' : `${actual} por ciento de margen`}
          aria-describedby={`${id}-ayuda`}
          onChange={(e) => { setMoviendo(Number(e.target.value)); }}
          onPointerUp={confirmar}
          onKeyUp={confirmar}
          onBlur={confirmar}
        />
        <output htmlFor={id}>{valor === null && moviendo === null ? 'Varias' : actual}</output>
      </div>
      <p id={`${id}-ayuda`} className="suave ayuda-intensidad">
        Más alto cubre con más margen alrededor de lo detectado. Más bajo se acerca al borde de la detección.
      </p>
    </div>
  );
}

// --- Sticker ------------------------------------------------------------------------------------

function textoTamano(valor: number): string {
  if (valor === LIMITES.escalaSticker.porDefecto) return 'Es el tamaño que elegimos: tapa toda la zona.';
  return valor > LIMITES.escalaSticker.porDefecto
    ? 'Más grande que la zona.'
    : 'Más chico que la zona: lo que el emoji no cubra se verá en tu foto.';
}

function textoPosicion(h: Hallazgo, escala: number, p: Posicion): string | null {
  if (p.x === 0 && p.y === 0) return null;
  return enElTope(h, escala, p) ? 'Hasta aquí se puede mover.' : 'Lo moviste del centro: lo que el emoji no cubra se verá en tu foto.';
}

interface PropsAjuste {
  hallazgo: Hallazgo;
  /** Cómo se nombra la zona para el lector de pantalla. */
  nombre: string;
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
export function AjusteSticker({ hallazgo, nombre, revision, abierto, alAbrir, alAjustar, alRestablecer }: PropsAjuste): React.JSX.Element {
  const id = useId();
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const guardada = escalaDe(revision, hallazgo.id);
  const giro = rotacionDe(revision, hallazgo.id);
  const [girando, setGirando] = useState<number | null>(null);
  const giroMostrado = girando ?? giro;
  const confirmarGiro = (): void => {
    if (girando === null) return;
    setGirando(null);
    alAjustar(hallazgo, { rotacion: girando });
  };
  const forma = estiramientoDe(revision, hallazgo.id);
  const [estirando, setEstirando] = useState<Estiramiento | null>(null);
  const formaMostrada = estirando ?? forma;
  const deformado = formaMostrada.x !== LIMITES.estiramientoSticker.porDefecto || formaMostrada.y !== LIMITES.estiramientoSticker.porDefecto;
  const confirmarForma = (): void => {
    if (estirando === null) return;
    setEstirando(null);
    alAjustar(hallazgo, { estiramiento: estirando });
  };
  const posicion = posicionDe(revision, hallazgo.id);
  const minimo = escalaMinimaSticker(hallazgo);
  const valor = Math.max(minimo, moviendo ?? guardada);
  const porcentaje = `${String(Math.round(valor * 100))} %`;
  const ajustado = stickerAjustado(revision, hallazgo.id);
  const zona = <span className="solo-lector"> de {nombre}</span>;
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
      <button type="button" className="boton chico-texto" aria-expanded={abierto} aria-controls={`${id}-panel`} onClick={() => { alAbrir(!abierto); }}>
        <Move aria-hidden="true" /> Ajustar sticker{zona}
        {ajustado && <span className="marca-ajustado"> · ajustado</span>}
      </button>
      {abierto && (
        <div id={`${id}-panel`} className="tamano-sticker" role="group" aria-label={`Ajustes del sticker de ${nombre}`}>
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
          <label htmlFor={`${id}-giro`}>Giro{zona}</label>
          <input
            id={`${id}-giro`}
            type="range"
            min={-LIMITES.rotacionSticker.max}
            max={LIMITES.rotacionSticker.max}
            step={LIMITES.rotacionSticker.paso}
            value={giroMostrado}
            aria-valuetext={`${giroMostrado} grados`}
            onChange={(e) => { setGirando(limitarRotacion(Number(e.target.value))); }}
            onPointerUp={confirmarGiro}
            onKeyUp={confirmarGiro}
            onBlur={confirmarGiro}
          />
          <output htmlFor={`${id}-giro`}>{giroMostrado}°</output>
          {(['x', 'y'] as const).map((eje) => {
            const valorEje = formaMostrada[eje];
            const texto = `${String(Math.round(valorEje * 100))} %`;
            return (
              <Fragment key={eje}>
                <label htmlFor={`${id}-estirar-${eje}`}>{eje === 'x' ? 'Ancho' : 'Alto'}{zona}</label>
                <input
                  id={`${id}-estirar-${eje}`}
                  type="range"
                  min={LIMITES.estiramientoSticker.min}
                  max={LIMITES.estiramientoSticker.max}
                  step={LIMITES.estiramientoSticker.paso}
                  value={valorEje}
                  aria-valuetext={texto}
                  aria-describedby={`${id}-ayuda`}
                  onChange={(e) => { setEstirando({ ...formaMostrada, [eje]: limitarEstiramiento(Number(e.target.value)) }); }}
                  onPointerUp={confirmarForma}
                  onKeyUp={confirmarForma}
                  onBlur={confirmarForma}
                />
                <output htmlFor={`${id}-estirar-${eje}`}>{texto}</output>
              </Fragment>
            );
          })}
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
            {textoTamano(valor)}
            {enPosicion !== null && <> {enPosicion}</>}
            {deformado && ' Deformado: lo que el emoji no cubra se verá en tu foto.'}
          </p>
          {ajustado && moviendo === null && estirando === null && (
            <button type="button" className="enlace" onClick={() => { alRestablecer(hallazgo.id); }}>
              Restablecer{zona}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Resumen ------------------------------------------------------------------------------------

interface PropsResumen {
  analisis: Analisis;
  revision: Revision;
  /** El mismo resumen en una sola frase, para quien no ve la imagen. */
  texto: string;
}

/** Lo primero del panel: qué tan delicada es la foto, cuánto falta por decidir y, si aplica, qué no se revisó. */
export function Resumen({ analisis, revision, texto }: PropsResumen): React.JSX.Element {
  const v = veredicto(analisis);
  const c = contarRevision(analisis, revision);
  const decididas = c.zonas - c.sinDecidir;
  const avance = c.zonas === 0 ? 100 : Math.round((Math.max(0, decididas) / c.zonas) * 100);
  const chips: { clase: string; nivel: NivelMostrado; n: number; texto: string }[] = [
    { clase: 'alto', nivel: 'alto', n: c.alto, texto: 'de riesgo alto' },
    { clase: 'medio', nivel: 'medio', n: c.medio, texto: 'de riesgo medio' },
    { clase: 'bajo', nivel: 'bajo', n: c.bajo, texto: 'de riesgo bajo' },
    { clase: 'nivel-pregunta', nivel: 'pregunta', n: c.preguntas, texto: c.preguntas === 1 ? 'pregunta' : 'preguntas' },
  ];
  return (
    <section aria-labelledby="titulo-veredicto" className={`resumen-foto veredicto-${v}`}>
      <h2 id="titulo-veredicto" data-testid="veredicto">{tituloVeredicto(v)}</h2>
      {chips.some((ch) => ch.n > 0) && (
        <ul className="chips-resumen" aria-label="Lo que encontramos">
          {chips.filter((ch) => ch.n > 0).map((ch) => (
            <li key={ch.clase} className={`chip-resumen ${ch.clase}`}>
              <IconoNivel nivel={ch.nivel} /> <strong>{ch.n}</strong> {ch.texto}
            </li>
          ))}
        </ul>
      )}
      {c.zonas > 0 && (
        <div className="avance">
          <div className="avance-texto">
            <span><strong>{c.ocultas}</strong> {c.ocultas === 1 ? 'zona se oculta' : 'zonas se ocultan'} · {c.visibles} {c.visibles === 1 ? 'visible' : 'visibles'}</span>
            {c.sinDecidir > 0 ? <span className="pendiente">{c.sinDecidir} sin decidir</span> : <span>Todo decidido</span>}
          </div>
          <div className="barra-avance" role="progressbar" aria-label="Decisiones tomadas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance}>
            <span style={{ width: `${avance}%` }} />
          </div>
        </div>
      )}
      {analisis.cobertura.motivos.length > 0 && (
        <div className="caja-parcial motivos">
          {analisis.cobertura.motivos.map((m) => <p key={m}>{textoMotivo(m)}</p>)}
        </div>
      )}
      <p className="solo-lector" data-testid="resumen">{texto}</p>
    </section>
  );
}

// --- Estilo para todo -----------------------------------------------------------------------------

interface PropsGlobal {
  hallazgos: readonly Hallazgo[];
  revision: Revision;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  alOcultarTodo: () => void;
  alOcultarAlto: () => void;
}

/** Atajos y un solo estilo para todas las zonas: efecto e intensidad de toda la foto. */
export function EstiloGlobal({ hallazgos, revision, alCambiar, alOcultarTodo, alOcultarAlto }: PropsGlobal): React.JSX.Element | null {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const zonas = [...hallazgos.filter((h) => h.caja !== null).map((h) => h.id), ...revision.manuales.map((z) => z.id)];
  if (zonas.length === 0) return null;
  const efectos = [...hallazgos.filter((h) => h.caja !== null).map((h) => efectoDe(revision, h)), ...revision.manuales.map((z) => z.efecto)];
  const comun = valorComun(efectos);
  const intensidades = zonas.map((z) => intensidadDe(revision, z));
  // Bloque sólido y emoji no usan intensidad: no mostrarla en el estilo general.
  const muestraIntensidad = comun !== null ? usaIntensidad(comun) : efectos.some(usaIntensidad);
  return (
    <section className="estilo-global" aria-label="Para todas las zonas">
      <div className="atajos">
        <button type="button" className="boton" onClick={alOcultarAlto}>Ocultar todo lo de riesgo alto</button>
        <button type="button" className="boton" onClick={alOcultarTodo}>Ocultar todo lo detectado</button>
      </div>
      <button type="button" className="desplegar" aria-expanded={abierto} aria-controls={`${id}-panel`} onClick={() => { setAbierto(!abierto); }}>
        <SlidersHorizontal aria-hidden="true" /> Estilo para todas las zonas
        <ChevronDown aria-hidden="true" className="flecha" />
      </button>
      {abierto && (
        <div id={`${id}-panel`} className="panel-estilo">
          <SelectorEfecto valor={comun} etiqueta="Efecto para todo" alCambiar={(efecto) => { alCambiar((r) => elegirEfectoVarias(r, zonas, efecto)); }} />
          {muestraIntensidad && (
            <ControlIntensidad
              valor={valorComun(intensidades)}
              etiqueta="Intensidad del efecto"
              conAviso
              alCambiar={(valor) => { alCambiar((r) => elegirIntensidadGlobal(r, valor)); }}
            />
          )}
        </div>
      )}
    </section>
  );
}

// --- Grupos por tipo de riesgo ------------------------------------------------------------------

interface PropsGrupo {
  grupo: Grupo;
  hallazgos: readonly Hallazgo[];
  revision: Revision;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  abierto: boolean;
  alAbrir: (abierto: boolean) => void;
  resaltado: Resaltado | null;
  alResaltar?: ((r: Resaltado | null) => void) | undefined;
  seleccionSticker: string | null;
  alSeleccionarSticker?: ((id: string | null) => void) | undefined;
  alPorQue: (regla: Regla) => void;
}

function GrupoRiesgo({ grupo, hallazgos, revision, alCambiar, abierto, alAbrir, resaltado, alResaltar, seleccionSticker, alSeleccionarSticker, alPorQue }: PropsGrupo): React.JSX.Element {
  const id = useId();
  const regla = reglaDe(grupo.reglaId);
  const conZona = grupo.hallazgos.filter((h) => h.caja !== null);
  const ids = conZona.map((h) => h.id);
  const efectos = conZona.map((h) => efectoDe(revision, h));
  const efecto = valorComun(efectos);
  const intensidades = ids.map((z) => intensidadDe(revision, z));
  const margenes = ids.map((z) => margenPctDe(revision, z));
  const conIntensidad = efectos.some(usaIntensidad);
  const primero = grupo.hallazgos[0];
  const resaltadoAqui = resaltado !== null && ids.includes(resaltado.id);
  // Con una sola zona, el grupo es la zona: pasar el mouse o el foco la resalta en la foto.
  const unica = conZona.length === 1 ? conZona[0] : undefined;

  return (
    <li
      className={`grupo-riesgo ${grupo.nivel === 'pregunta' ? 'nivel-pregunta' : grupo.nivel}${resaltadoAqui ? ' resaltada' : ''}`}
      data-regla={grupo.reglaId}
      data-zona={unica?.id}
      {...(unica === undefined ? {} : eventosResaltar(unica.id, resaltado, alResaltar))}
    >
      <div className="grupo-cabecera">
        <span className="grupo-icono" aria-hidden="true"><IconoCategoria regla={regla} /></span>
        <div className="grupo-titulo">
          <h3>{grupo.titulo}</h3>
          <div className="grupo-meta">
            <PildoraNivel nivel={grupo.nivel} />
            {conZona.length > 0 && <span className="suave">{conZona.length} {conZona.length === 1 ? 'zona' : 'zonas'}</span>}
          </div>
        </div>
        <button type="button" className="enlace por-que" onClick={() => { alPorQue(regla); }}>
          ¿Por qué?<span className="solo-lector"> {grupo.titulo}</span>
        </button>
      </div>

      {/* Lo que no se puede tapar por zona se explica en una línea. */}
      {conZona.length === 0 && primero !== undefined && <p className="grupo-texto">{describirHallazgo(primero)}</p>}

      {regla.requiere_confirmacion === true && (
        <fieldset className="pregunta">
          <legend>¿Hay menores en esta foto?</legend>
          <button type="button" className="boton" aria-pressed={revision.hayMenores === true} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, true)); }}>Sí, ocultar las caras</button>
          <button type="button" className="boton" aria-pressed={revision.hayMenores === false} onClick={() => { alCambiar((r) => responderMenores(r, hallazgos, false)); }}>No</button>
        </fieldset>
      )}
      {grupo.reglaId === 'UBI-01' && <p className="suave">Se borra al exportar, sin que hagas nada.</p>}
      {grupo.reglaId === 'INT-01' && <p className="suave">Es un aviso sobre toda la foto: revísala completa antes de publicarla.</p>}
      {primero !== undefined && soloAvisaSinZona(primero) && <p className="suave">Todavía no podemos taparlo por zona. Si no quieres mostrarlo, recorta la foto o no la publiques.</p>}
      {grupo.reglaId === 'DES-01' && conZona.length > 0 && <p className="suave">La marcamos para ocultarla. Instagram podría limitar la foto aunque esté tapada.</p>}

      {conZona.length > 0 && (
        <>
          <div className="grupo-control">
            <ControlDecision
              varias={conZona.length > 1}
              estado={estadoDeZonas(revision, ids)}
              que={conZona.length === 1 ? `zona de ${grupo.titulo}` : `zonas de ${grupo.titulo}`}
              alDecidir={(d) => { alCambiar((r) => decidirVarias(r, ids, d)); }}
            />
            <button type="button" className="desplegar chico" aria-expanded={abierto} aria-controls={`${id}-detalle`} onClick={() => { alAbrir(!abierto); }}>
              Personalizar<span className="solo-lector"> {grupo.titulo}</span>
              <ChevronDown aria-hidden="true" className="flecha" />
            </button>
          </div>
          {estadoDeZonas(revision, ids) === 'mixto' && <p className="suave">Algunas zonas se ocultan y otras quedan visibles.</p>}

          {abierto && (
            <div id={`${id}-detalle`} className="grupo-detalle">
              <div className="estilo-grupo">
                <SelectorEfecto valor={efecto} etiqueta={`Efecto para ${conZona.length === 1 ? 'esta zona' : 'todas'}`} alCambiar={(e) => { alCambiar((r) => elegirEfectoVarias(r, ids, e)); }} />
                {conIntensidad && (
                  <ControlIntensidad
                    valor={valorComun(intensidades)}
                    etiqueta={`Intensidad para ${conZona.length === 1 ? 'esta zona' : 'todas'}`}
                    alCambiar={(v) => { alCambiar((r) => elegirIntensidadVarias(r, ids, v)); }}
                  />
                )}
                <ControlMargen
                  valor={valorComun(margenes)}
                  etiqueta={`Tamaño de ${conZona.length === 1 ? 'la zona' : 'las zonas'}`}
                  alCambiar={(v) => { alCambiar((r) => elegirMargenVarias(r, ids, v)); }}
                />
              </div>
              {conZona.length > 1 && (
                <ul className="zonas">
                  {conZona.map((h, i) => (
                    <FilaZona
                      key={h.id}
                      hallazgo={h}
                      nombre={`zona ${i + 1} de ${grupo.titulo}`}
                      titulo={`Zona ${i + 1}`}
                      revision={revision}
                      alCambiar={alCambiar}
                      resaltado={resaltado}
                      alResaltar={alResaltar}
                      seleccionSticker={seleccionSticker}
                      alSeleccionarSticker={alSeleccionarSticker}
                    />
                  ))}
                </ul>
              )}
              {conZona.length === 1 && conZona[0] !== undefined && (
                <ExtrasZona hallazgo={conZona[0]} nombre={grupo.titulo} revision={revision} alCambiar={alCambiar} seleccionSticker={seleccionSticker} alSeleccionarSticker={alSeleccionarSticker} />
              )}
              <button
                type="button"
                className="boton chico-texto quitar-foto"
                title="La zona queda visible y sin marca. Puedes volver a ponerla abajo, en Quitadas de la foto."
                onClick={() => { alCambiar((r) => ids.reduce(descartarZona, r)); }}
              >
                <EraserIcon aria-hidden="true" /> {conZona.length === 1 ? 'Quitar de la foto' : 'Quitar todas de la foto'}<span className="solo-lector">: {grupo.titulo}</span>
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

interface PropsExtras {
  hallazgo: Hallazgo;
  nombre: string;
  revision: Revision;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  seleccionSticker: string | null;
  alSeleccionarSticker?: ((id: string | null) => void) | undefined;
}

/** El ajuste del sticker, solo cuando la zona se oculta con un emoji. */
function ExtrasZona({ hallazgo, nombre, revision, alCambiar, seleccionSticker, alSeleccionarSticker }: PropsExtras): React.JSX.Element | null {
  if (revision.decisiones[hallazgo.id] !== 'ocultar' || !ajustaSticker(revision, hallazgo)) return null;
  return (
    <AjusteSticker
      hallazgo={hallazgo}
      nombre={nombre}
      revision={revision}
      abierto={seleccionSticker === hallazgo.id}
      alAbrir={(abrir) => { alSeleccionarSticker?.(abrir ? hallazgo.id : null); }}
      alAjustar={(hz, cambio) => { alCambiar((r) => ajustarSticker(r, hz, cambio)); }}
      alRestablecer={(sid) => { alCambiar((r) => restablecerSticker(r, sid)); }}
    />
  );
}

interface PropsFila extends PropsExtras {
  titulo: string;
  resaltado: Resaltado | null;
  alResaltar?: ((r: Resaltado | null) => void) | undefined;
}

function FilaZona({ hallazgo, nombre, titulo, revision, alCambiar, resaltado, alResaltar, seleccionSticker, alSeleccionarSticker }: PropsFila): React.JSX.Element {
  const efecto = efectoDe(revision, hallazgo);
  return (
    <li className={`fila-zona${resaltado?.id === hallazgo.id ? ' resaltada' : ''}`} data-zona={hallazgo.id} {...eventosResaltar(hallazgo.id, resaltado, alResaltar)}>
      <div className="fila-zona-cabecera">
        <p className="fila-zona-titulo"><strong>{titulo}</strong> <span className="suave">{describirZona(hallazgo)}</span></p>
        <button type="button" className="boton fantasma chico" aria-label={`Quitar de la foto ${nombre}`} title="Quitar de la foto: queda visible" onClick={() => { alCambiar((r) => descartarZona(r, hallazgo.id)); }}>
          <EraserIcon aria-hidden="true" />
        </button>
      </div>
      <ControlDecision compacto estado={estadoDeZonas(revision, [hallazgo.id])} que={nombre} alDecidir={(d) => { alCambiar((r) => decidirVarias(r, [hallazgo.id], d)); }} />
      <SelectorEfecto valor={efecto} etiqueta="Efecto" alCambiar={(e) => { alCambiar((r) => elegirEfectoVarias(r, [hallazgo.id], e)); }} />
      {usaIntensidad(efecto) && (
        <ControlIntensidad valor={intensidadDe(revision, hallazgo.id)} etiqueta="Intensidad" alCambiar={(v) => { alCambiar((r) => elegirIntensidadVarias(r, [hallazgo.id], v)); }} />
      )}
      <ControlMargen valor={margenPctDe(revision, hallazgo.id)} etiqueta="Tamaño de la zona" alCambiar={(v) => { alCambiar((r) => elegirMargenVarias(r, [hallazgo.id], v)); }} />
      <ExtrasZona hallazgo={hallazgo} nombre={nombre} revision={revision} alCambiar={alCambiar} seleccionSticker={seleccionSticker} alSeleccionarSticker={alSeleccionarSticker} />
    </li>
  );
}

// --- Lista ---------------------------------------------------------------------------------------

interface Props {
  hallazgos: readonly Hallazgo[];
  revision: Revision;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  /** Zona resaltada a la vez aquí y en la imagen. Su grupo se abre solo. */
  resaltado?: Resaltado | null;
  alResaltar?: (r: Resaltado | null) => void;
  /** Sticker elegido, el mismo en la foto y aquí: su fila abre los ajustes. */
  seleccionSticker?: string | null;
  alSeleccionarSticker?: (id: string | null) => void;
}

export function Advertencias({ hallazgos, revision, alCambiar, resaltado = null, alResaltar, seleccionSticker = null, alSeleccionarSticker }: Props): React.JSX.Element | null {
  const [porQue, setPorQue] = useState<Regla | null>(null);
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  if (hallazgos.length === 0) return null;
  const quitadas = hallazgos.filter((h) => revision.descartadas.includes(h.id));
  const grupos = agruparHallazgos(hallazgos.filter((h) => !revision.descartadas.includes(h.id)), revision);
  // Elegir un sticker en la foto abre su grupo, para que sus ajustes queden a la vista.
  const conSticker = seleccionSticker === null ? undefined : grupos.find((g) => g.hallazgos.some((h) => h.id === seleccionSticker))?.reglaId;

  return (
    <section aria-label="Lista de advertencias">
      <ul className="grupos-riesgo">
        {grupos.map((g) => (
          <GrupoRiesgo
            key={g.reglaId}
            grupo={g}
            hallazgos={hallazgos}
            revision={revision}
            alCambiar={alCambiar}
            abierto={abiertos.has(g.reglaId) || conSticker === g.reglaId}
            alAbrir={(abrir) => {
              setAbiertos((s) => {
                const nuevo = new Set(s);
                if (abrir) nuevo.add(g.reglaId);
                else nuevo.delete(g.reglaId);
                return nuevo;
              });
              if (!abrir && conSticker === g.reglaId) alSeleccionarSticker?.(null);
            }}
            resaltado={resaltado}
            alResaltar={alResaltar}
            seleccionSticker={seleccionSticker}
            alSeleccionarSticker={alSeleccionarSticker}
            alPorQue={setPorQue}
          />
        ))}
      </ul>
      {quitadas.length > 0 && (
        <details className="quitadas">
          <summary>Quitadas de la foto ({quitadas.length})</summary>
          <p className="suave">Quedan visibles y sin marca. Si te equivocaste, vuelve a ponerlas.</p>
          <ul className="zonas">
            {quitadas.map((h) => (
              <li key={h.id} className="fila-zona fila-quitada">
                <p className="fila-zona-titulo"><strong>{tituloGrupo(h.regla_id)}</strong> <span className="suave">{describirZona(h)}</span></p>
                <button type="button" className="boton chico-texto" onClick={() => { alCambiar((r) => restaurarZona(r, h.id)); }}>
                  <RotateCcw aria-hidden="true" /> Volver a poner<span className="solo-lector">: {tituloGrupo(h.regla_id)}, {describirZona(h)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {porQue !== null && <DialogoPorQue regla={porQue} alCerrar={() => { setPorQue(null); }} />}
    </section>
  );
}

/** Para la tarjeta de la foto: decisión y estilo de una sola zona, con las mismas piezas que el panel. */
export function ControlesZona({ hallazgo, nombre, revision, alCambiar }: { hallazgo: Hallazgo; nombre: string; revision: Revision; alCambiar: (cambio: (r: Revision) => Revision) => void }): React.JSX.Element {
  const efecto = efectoDe(revision, hallazgo);
  return (
    <div className="controles-zona">
      <ControlDecision estado={estadoDeZonas(revision, [hallazgo.id])} que={nombre} alDecidir={(d) => { alCambiar((r) => decidirVarias(r, [hallazgo.id], d)); }} />
      <SelectorEfecto valor={efecto} etiqueta="Efecto" alCambiar={(e) => { alCambiar((r) => elegirEfectoVarias(r, [hallazgo.id], e)); }} />
      {usaIntensidad(efecto) && (
        <ControlIntensidad valor={intensidadDe(revision, hallazgo.id)} etiqueta="Intensidad" alCambiar={(v) => { alCambiar((r) => elegirIntensidadVarias(r, [hallazgo.id], v)); }} />
      )}
      <ControlMargen valor={margenPctDe(revision, hallazgo.id)} etiqueta="Tamaño de la zona" alCambiar={(v) => { alCambiar((r) => elegirMargenVarias(r, [hallazgo.id], v)); }} />
    </div>
  );
}
