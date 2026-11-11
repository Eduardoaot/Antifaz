import { BookOpen, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { reglaDe, type Regla } from '../../shared/catalogo';
import type { Hallazgo } from '../../shared/contrato';
import {
  describirHallazgo,
  elegirEfectoVarias,
  elegirIntensidadVarias,
  intensidadDe,
  nivelMostrado,
  textoOrigen,
  tituloGrupo,
  usaIntensidad,
  type Revision,
  type ZonaManual,
} from '../../shared/logica';
import { ControlesZona, ControlIntensidad, IconoCategoria, PildoraNivel, SelectorEfecto } from './Advertencias';

export type ZonaElegida = { tipo: 'hallazgo'; hallazgo: Hallazgo } | { tipo: 'manual'; zona: ZonaManual; numero: number };

interface Props {
  elegida: ZonaElegida;
  revision: Revision;
  /** La imagen: ahí está la marca de la zona, y la tarjeta se coloca junto a ella. */
  lienzo: RefObject<HTMLDivElement | null>;
  /** El área donde debe quedar la tarjeta completa. */
  marco: RefObject<HTMLDivElement | null>;
  /** Cambia al desplazar o acercar la imagen: la tarjeta se vuelve a colocar. */
  posicionClave: string;
  alCambiar: (cambio: (r: Revision) => Revision) => void;
  alQuitarManual: (id: string) => void;
  alPorQue: (regla: Regla) => void;
  alCerrar: () => void;
}

const SEPARACION = 10;

/**
 * Al hacer clic en una zona de la foto, aquí mismo se explica por qué es un riesgo y se decide qué
 * hacer con ella. No tapa la zona: se coloca a un lado, o abajo si no cabe.
 */
export function TarjetaZona({ elegida, revision, lienzo, marco, posicionClave, alCambiar, alQuitarManual, alPorQue, alCerrar }: Props): React.JSX.Element {
  const tarjeta = useRef<HTMLDivElement | null>(null);
  const [lugar, setLugar] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const t = tarjeta.current;
    const caja = marco.current;
    const zonaId = elegida.tipo === 'hallazgo' ? elegida.hallazgo.id : elegida.zona.id;
    const ancla = lienzo.current?.querySelector<HTMLElement>(`[data-marca="${CSS.escape(zonaId)}"]`) ?? null;
    if (t === null || ancla === null || caja === null) return;
    const rm = caja.getBoundingClientRect();
    const rz = ancla.getBoundingClientRect();
    const ancho = t.offsetWidth;
    const alto = t.offsetHeight;
    const zona = { left: rz.left - rm.left, top: rz.top - rm.top, right: rz.right - rm.left, bottom: rz.bottom - rm.top };
    let left: number;
    let top: number;
    if (zona.right + SEPARACION + ancho <= rm.width) {
      left = zona.right + SEPARACION;
      top = zona.top;
    } else if (zona.left - SEPARACION - ancho >= 0) {
      left = zona.left - SEPARACION - ancho;
      top = zona.top;
    } else {
      left = zona.left;
      top = zona.bottom + SEPARACION <= rm.height - alto ? zona.bottom + SEPARACION : zona.top - SEPARACION - alto;
    }
    setLugar({
      left: Math.max(8, Math.min(left, rm.width - ancho - 8)),
      top: Math.max(8, Math.min(top, rm.height - alto - 8)),
    });
  }, [lienzo, marco, posicionClave, elegida]);

  // Al abrirse, el foco entra a la tarjeta; Esc la cierra.
  useEffect(() => {
    tarjeta.current?.querySelector<HTMLElement>('button, select')?.focus({ preventScroll: true });
  }, [elegida]);

  const alTecla = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    alCerrar();
  };

  const cerrar = (
    <button type="button" className="boton fantasma chico" aria-label="Cerrar la explicación" onClick={alCerrar}>
      <X aria-hidden="true" />
    </button>
  );

  return (
    <div
      ref={tarjeta}
      className="tarjeta-zona"
      role="dialog"
      aria-label={elegida.tipo === 'hallazgo' ? `Por qué es un riesgo: ${tituloGrupo(elegida.hallazgo.regla_id)}` : `Tu zona ${elegida.numero}`}
      style={lugar === null ? { visibility: 'hidden' } : { left: lugar.left, top: lugar.top }}
      onKeyDown={alTecla}
    >
      {elegida.tipo === 'hallazgo' ? (
        <ContenidoHallazgo h={elegida.hallazgo} revision={revision} alCambiar={alCambiar} alPorQue={alPorQue} cerrar={cerrar} />
      ) : (
        <>
          <div className="tarjeta-cabecera">
            <h3>Tu zona {elegida.numero}</h3>
            {cerrar}
          </div>
          <p className="suave">La agregaste tú ({textoOrigen(elegida.zona.origen)}). Siempre se oculta.</p>
          <SelectorEfecto valor={elegida.zona.efecto} etiqueta="Efecto" alCambiar={(e) => { alCambiar((r) => elegirEfectoVarias(r, [elegida.zona.id], e)); }} />
          {usaIntensidad(elegida.zona.efecto) && (
            <ControlIntensidad valor={intensidadDe(revision, elegida.zona.id)} etiqueta="Intensidad" alCambiar={(v) => { alCambiar((r) => elegirIntensidadVarias(r, [elegida.zona.id], v)); }} />
          )}
          <button type="button" className="boton" onClick={() => { alQuitarManual(elegida.zona.id); }}>
            <Trash2 aria-hidden="true" /> Quitar tu zona {elegida.numero}
          </button>
        </>
      )}
    </div>
  );
}

function ContenidoHallazgo({ h, revision, alCambiar, alPorQue, cerrar }: { h: Hallazgo; revision: Revision; alCambiar: Props['alCambiar']; alPorQue: Props['alPorQue']; cerrar: React.ReactNode }): React.JSX.Element {
  const regla = reglaDe(h.regla_id);
  const titulo = tituloGrupo(h.regla_id);
  return (
    <>
      <div className="tarjeta-cabecera">
        <span className="grupo-icono" aria-hidden="true"><IconoCategoria regla={regla} /></span>
        <h3>{titulo}</h3>
        {cerrar}
      </div>
      <PildoraNivel nivel={nivelMostrado(h, revision)} />
      <p className="tarjeta-que">{describirHallazgo(h)}</p>
      <p className="tarjeta-por-que">{regla.por_que}</p>
      <ControlesZona hallazgo={h} nombre={`esta zona de ${titulo}`} revision={revision} alCambiar={alCambiar} />
      <button type="button" className="enlace" onClick={() => { alPorQue(regla); }}>
        <BookOpen aria-hidden="true" /> Ver fuentes<span className="solo-lector">: {titulo}</span>
      </button>
    </>
  );
}
