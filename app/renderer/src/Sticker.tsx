import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import gato from '../../../sidecar/recursos/emojis/emoji_u1f431.png';
import sonrisa from '../../../sidecar/recursos/emojis/emoji_u1f600.png';
import lentes from '../../../sidecar/recursos/emojis/emoji_u1f60e.png';
import mono from '../../../sidecar/recursos/emojis/emoji_u1f648.png';
import estrella from '../../../sidecar/recursos/emojis/emoji_u2b50.png';
import { LIMITES, type Emoji, type Hallazgo } from '../../shared/contrato';
import {
  escalaDe,
  escalaMinimaSticker,
  geometriaSticker,
  limitarEscala,
  limitarPosicion,
  limitarRotacion,
  posicionDe,
  rotacionDe,
  semiejesZona,
  type CambioSticker,
  type Posicion,
  type Revision,
} from '../../shared/logica';

/** Más de esto, en píxeles de pantalla, ya es arrastrar y no un clic. */
const UMBRAL = 3;

// Los mismos PNG que pega el sidecar: la copia que se arrastra se ve igual que el resultado.
const IMAGEN: Readonly<Record<Emoji, string>> = {
  emoji_sonrisa: sonrisa,
  emoji_lentes: lentes,
  emoji_gato: gato,
  emoji_estrella: estrella,
  emoji_mono: mono,
};

type Esquina = 'no' | 'ne' | 'so' | 'se';
const ESQUINAS: readonly Esquina[] = ['no', 'ne', 'so', 'se'];

interface Arrastre {
  tipo: 'mover' | 'escala' | 'girar';
  rotacion: number;
  /** Ángulo inicial del puntero alrededor del centro, en grados. Solo al girar. */
  angulo: number;
  x: number;
  y: number;
  escala: number;
  posicion: Posicion;
  /** Distancia inicial del puntero al centro del sticker, en pantalla. Solo al cambiar el tamaño. */
  distancia: number;
  movido: boolean;
}

interface Props {
  hallazgo: Hallazgo;
  emoji: Emoji;
  revision: Revision;
  ancho: number;
  alto: number;
  lienzo: RefObject<HTMLDivElement | null>;
  seleccionado: boolean;
  alSeleccionar: (id: string) => void;
  alAjustar: (h: Hallazgo, cambio: CambioSticker) => void;
  /** Con el id mientras se arrastra: la vista previa se pide sin este sticker. */
  alArrastrar: (id: string | null) => void;
  /** Falso mientras la vista previa no corresponde a lo que se pidió. */
  vistaAlDia: boolean;
}

type Ajuste = { escala: number; posicion: Posicion; rotacion: number };

const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

/**
 * Marco para mover el sticker de cualquier zona y cambiar su tamaño desde la foto. Mientras se arrastra, la
 * vista previa va sin el sticker y se mueve una copia del emoji; al soltar, la copia se queda hasta que el
 * sidecar dibuja la vista previa real. Así cada arrastre es un paso de deshacer.
 */
export function MarcoSticker({ hallazgo, emoji, revision, ancho, alto, lienzo, seleccionado, alSeleccionar, alAjustar, alArrastrar, vistaAlDia }: Props): React.JSX.Element | null {
  const [provisional, setProvisional] = useState<Ajuste | null>(null);
  const [soltado, setSoltado] = useState<Ajuste | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  if (vistaAlDia && soltado !== null) setSoltado(null);
  const caja = hallazgo.caja;
  if (caja === null) return null;

  const copia = provisional ?? soltado;
  const escala = copia?.escala ?? escalaDe(revision, hallazgo.id);
  const posicion = copia?.posicion ?? posicionDe(revision, hallazgo.id);
  const rotacion = copia?.rotacion ?? rotacionDe(revision, hallazgo.id);
  const { cx, cy, lado } = geometriaSticker(caja, emoji, escala, posicion);

  const empezar = (e: PointerEvent<HTMLElement>, tipo: Arrastre['tipo']): void => {
    if (e.button !== 0) return;
    // El lienzo no debe recibirlo: si no, además movería la imagen ampliada.
    e.stopPropagation();
    e.preventDefault();
    alSeleccionar(hallazgo.id);
    const rect = lienzo.current?.getBoundingClientRect();
    const centroPantalla = rect === undefined ? { x: e.clientX, y: e.clientY } : {
      x: rect.left + (cx / ancho) * rect.width,
      y: rect.top + (cy / alto) * rect.height,
    };
    arrastre.current = {
      tipo,
      rotacion,
      angulo: (Math.atan2(e.clientY - centroPantalla.y, e.clientX - centroPantalla.x) * 180) / Math.PI,
      x: e.clientX,
      y: e.clientY,
      escala,
      posicion,
      distancia: Math.max(1, Math.hypot(e.clientX - centroPantalla.x, e.clientY - centroPantalla.y)),
      movido: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const mover = (e: PointerEvent<HTMLElement>): void => {
    const a = arrastre.current;
    const rect = lienzo.current?.getBoundingClientRect();
    if (a === null || rect === undefined || rect.width <= 0 || rect.height <= 0) return;
    e.stopPropagation();
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (!a.movido && Math.abs(dx) + Math.abs(dy) <= UMBRAL) return;
    if (!a.movido) alArrastrar(hallazgo.id);
    a.movido = true;
    const centro = { x: rect.left + (cx / ancho) * rect.width, y: rect.top + (cy / alto) * rect.height };
    if (a.tipo === 'mover') {
      const semi = semiejesZona(caja);
      const pedida = {
        x: a.posicion.x + (dx * (ancho / rect.width)) / semi.x,
        y: a.posicion.y + (dy * (alto / rect.height)) / semi.y,
      };
      setProvisional({ escala: a.escala, posicion: limitarPosicion(hallazgo, a.escala, pedida), rotacion: a.rotacion });
    } else if (a.tipo === 'girar') {
      const angulo = (Math.atan2(e.clientY - centro.y, e.clientX - centro.x) * 180) / Math.PI;
      // Con Mayús, de 15 en 15 grados.
      const libre = a.rotacion + angulo - a.angulo;
      const paso = LIMITES.rotacionSticker.paso;
      setProvisional({ escala: a.escala, posicion: a.posicion, rotacion: limitarRotacion(e.shiftKey ? Math.round(libre / paso) * paso : libre) });
    } else {
      const factor = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) / a.distancia;
      const nueva = Math.max(escalaMinimaSticker(hallazgo), limitarEscala(a.escala * factor));
      setProvisional({ escala: nueva, posicion: limitarPosicion(hallazgo, nueva, a.posicion), rotacion: a.rotacion });
    }
  };

  const soltar = (e: PointerEvent<HTMLElement>): void => {
    const a = arrastre.current;
    if (a === null) return;
    e.stopPropagation();
    arrastre.current = null;
    if (a.movido) {
      if (provisional !== null) alAjustar(hallazgo, provisional);
      setSoltado(provisional);
      alArrastrar(null);
    }
    setProvisional(null);
  };

  const cancelar = (): void => {
    if (arrastre.current?.movido === true) alArrastrar(null);
    arrastre.current = null;
    setProvisional(null);
  };

  const eventos = { onPointerMove: mover, onPointerUp: soltar, onPointerCancel: cancelar };

  return (
    <div
      aria-hidden="true"
      data-sticker={hallazgo.id}
      className={`sticker${seleccionado ? ' seleccionado' : ''}${provisional !== null ? ' moviendo' : ''}`}
      style={{
        left: pct(cx - lado / 2, ancho),
        top: pct(cy - lado / 2, alto),
        width: pct(lado, ancho),
        height: pct(lado, alto),
        transform: rotacion === 0 ? undefined : `rotate(${rotacion}deg)`,
      }}
      onPointerDown={(e) => { empezar(e, 'mover'); }}
      {...eventos}
    >
      {copia !== null && <img className="fantasma" src={IMAGEN[emoji]} alt="" draggable={false} />}
      {seleccionado && (
        <span
          className="manija girar"
          data-manija="girar"
          title="Arrastra para girar (Mayús: de 15 en 15)"
          onPointerDown={(e) => { empezar(e, 'girar'); }}
          {...eventos}
        />
      )}
      {seleccionado && ESQUINAS.map((esquina) => (
        <span
          key={esquina}
          className={`manija ${esquina}`}
          data-manija={esquina}
          onPointerDown={(e) => { empezar(e, 'escala'); }}
          {...eventos}
        />
      ))}
    </div>
  );
}
