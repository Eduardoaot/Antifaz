import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { ETIQUETA_EMOJI, LIMITES, type Emoji, type Hallazgo } from '../../shared/contrato';
import {
  escalaDe,
  escalaMinimaSticker,
  geometriaSticker,
  limitarEscala,
  limitarPosicion,
  posicionDe,
  semiejesZona,
  type CambioSticker,
  type Posicion,
  type Revision,
} from '../../shared/logica';

/** Más de esto, en píxeles de pantalla, ya es arrastrar y no un clic. */
const UMBRAL = 3;

type Esquina = 'no' | 'ne' | 'so' | 'se';
const ESQUINAS: readonly Esquina[] = ['no', 'ne', 'so', 'se'];

interface Arrastre {
  tipo: 'mover' | 'escala';
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
}

const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

/**
 * Marco para mover el sticker de cualquier zona y cambiar su tamaño desde la foto. Mientras se arrastra solo
 * se mueve el marco con una copia del emoji; al soltar, el sidecar dibuja la vista previa real. Así cada
 * arrastre es un paso de deshacer y una sola vista previa.
 */
export function MarcoSticker({ hallazgo, emoji, revision, ancho, alto, lienzo, seleccionado, alSeleccionar, alAjustar }: Props): React.JSX.Element | null {
  const [provisional, setProvisional] = useState<{ escala: number; posicion: Posicion } | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const caja = hallazgo.caja;
  if (caja === null) return null;
  // Lo que nunca puede quedar al descubierto: la cara del detector, o la zona completa si no es cara.
  const cara = hallazgo.nucleo ?? null;
  const fija = cara ?? caja;

  const escala = provisional?.escala ?? escalaDe(revision, hallazgo.id);
  const posicion = provisional?.posicion ?? posicionDe(revision, hallazgo.id);
  const { cx, cy, lado } = geometriaSticker(caja, emoji, escala, posicion);
  const margenCara = LIMITES.dilatacionPx.porDefecto;

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
    a.movido = true;
    if (a.tipo === 'mover') {
      const semi = semiejesZona(caja);
      const pedida = {
        x: a.posicion.x + (dx * (ancho / rect.width)) / semi.x,
        y: a.posicion.y + (dy * (alto / rect.height)) / semi.y,
      };
      setProvisional({ escala: a.escala, posicion: limitarPosicion(hallazgo, a.escala, pedida) });
    } else {
      const centro = { x: rect.left + (cx / ancho) * rect.width, y: rect.top + (cy / alto) * rect.height };
      const factor = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) / a.distancia;
      const nueva = Math.max(escalaMinimaSticker(hallazgo), limitarEscala(a.escala * factor));
      setProvisional({ escala: nueva, posicion: limitarPosicion(hallazgo, nueva, a.posicion) });
    }
  };

  const soltar = (e: PointerEvent<HTMLElement>): void => {
    const a = arrastre.current;
    if (a === null) return;
    e.stopPropagation();
    arrastre.current = null;
    if (a.movido && provisional !== null) alAjustar(hallazgo, provisional);
    setProvisional(null);
  };

  const cancelar = (): void => {
    arrastre.current = null;
    setProvisional(null);
  };

  const eventos = { onPointerMove: mover, onPointerUp: soltar, onPointerCancel: cancelar };

  return (
    <>
      {provisional !== null && (
        // Lo que no puede quedar al descubierto, con su margen mínimo: óvalo en una cara, caja en lo demás.
        <div
          aria-hidden="true"
          className={cara === null ? 'ovalo-cara zona-fija' : 'ovalo-cara'}
          style={{
            left: pct(fija.x - margenCara, ancho),
            top: pct(fija.y - margenCara, alto),
            width: pct(fija.ancho + 2 * margenCara, ancho),
            height: pct(fija.alto + 2 * margenCara, alto),
          }}
        />
      )}
      <div
        aria-hidden="true"
        data-sticker={hallazgo.id}
        className={`sticker${seleccionado ? ' seleccionado' : ''}${provisional !== null ? ' moviendo' : ''}`}
        style={{ left: pct(cx - lado / 2, ancho), top: pct(cy - lado / 2, alto), width: pct(lado, ancho), height: pct(lado, alto) }}
        onPointerDown={(e) => { empezar(e, 'mover'); }}
        {...eventos}
      >
        {provisional !== null && (
          <svg className="fantasma" viewBox="0 0 100 100" aria-hidden="true">
            <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="82">{ETIQUETA_EMOJI[emoji].split(' ')[0]}</text>
          </svg>
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
    </>
  );
}
