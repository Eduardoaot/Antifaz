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
  estiramientoDe,
  geometriaSticker,
  limitarEscala,
  limitarEstiramiento,
  limitarPosicion,
  limitarRotacion,
  posicionDe,
  rotacionDe,
  semiejesZona,
  type CambioSticker,
  type Estiramiento,
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
// Las esquinas cambian el tamaño sin deformar; los lados estiran solo a lo ancho o a lo alto.
const LADOS: readonly { lado: 'n' | 's' | 'e' | 'o'; tipo: 'ancho' | 'alto'; titulo: string }[] = [
  { lado: 'n', tipo: 'alto', titulo: 'Arrastra para estirar a lo alto' },
  { lado: 's', tipo: 'alto', titulo: 'Arrastra para estirar a lo alto' },
  { lado: 'e', tipo: 'ancho', titulo: 'Arrastra para estirar a lo ancho' },
  { lado: 'o', tipo: 'ancho', titulo: 'Arrastra para estirar a lo ancho' },
];

type Ajuste = { escala: number; posicion: Posicion; rotacion: number; estiramiento: Estiramiento };

interface Arrastre {
  tipo: 'mover' | 'escala' | 'girar' | 'ancho' | 'alto';
  /** Cómo estaba el sticker al empezar. */
  base: Ajuste;
  /** Ángulo inicial del puntero alrededor del centro, en grados. Solo al girar. */
  angulo: number;
  x: number;
  y: number;
  /** Distancia inicial del puntero al centro, en pantalla: total al cambiar el tamaño, sobre su eje al estirar. */
  distancia: number;
  movido: boolean;
}

/** Un vector de pantalla en los ejes del sticker girado. */
function enEjes(vx: number, vy: number, grados: number): { x: number; y: number } {
  const t = (grados * Math.PI) / 180;
  return { x: vx * Math.cos(t) + vy * Math.sin(t), y: -vx * Math.sin(t) + vy * Math.cos(t) };
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
  const estiramiento = copia?.estiramiento ?? estiramientoDe(revision, hallazgo.id);
  const { cx, cy, lado } = geometriaSticker(caja, emoji, escala, posicion);
  const anchoMarco = lado * estiramiento.x;
  const altoMarco = lado * estiramiento.y;

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
    const vx = e.clientX - centroPantalla.x;
    const vy = e.clientY - centroPantalla.y;
    const local = enEjes(vx, vy, rotacion);
    const distancia = tipo === 'ancho' ? Math.abs(local.x) : tipo === 'alto' ? Math.abs(local.y) : Math.hypot(vx, vy);
    arrastre.current = {
      tipo,
      base: { escala, posicion, rotacion, estiramiento },
      angulo: (Math.atan2(vy, vx) * 180) / Math.PI,
      x: e.clientX,
      y: e.clientY,
      distancia: Math.max(1, distancia),
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
    const { base } = a;
    switch (a.tipo) {
      case 'mover': {
        const semi = semiejesZona(caja);
        const pedida = {
          x: base.posicion.x + (dx * (ancho / rect.width)) / semi.x,
          y: base.posicion.y + (dy * (alto / rect.height)) / semi.y,
        };
        setProvisional({ ...base, posicion: limitarPosicion(hallazgo, base.escala, pedida) });
        break;
      }
      case 'girar': {
        const angulo = (Math.atan2(e.clientY - centro.y, e.clientX - centro.x) * 180) / Math.PI;
        // Con Mayús, de 15 en 15 grados.
        const libre = base.rotacion + angulo - a.angulo;
        const paso = LIMITES.rotacionSticker.paso;
        setProvisional({ ...base, rotacion: limitarRotacion(e.shiftKey ? Math.round(libre / paso) * paso : libre) });
        break;
      }
      case 'escala': {
        const factor = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) / a.distancia;
        const nueva = Math.max(escalaMinimaSticker(hallazgo), limitarEscala(base.escala * factor));
        setProvisional({ ...base, escala: nueva, posicion: limitarPosicion(hallazgo, nueva, base.posicion) });
        break;
      }
      case 'ancho':
      case 'alto': {
        // Se mide sobre el eje del sticker girado: así un lado estira hacia donde apunta.
        const local = enEjes(e.clientX - centro.x, e.clientY - centro.y, base.rotacion);
        const sobreEje = a.tipo === 'ancho' ? Math.abs(local.x) : Math.abs(local.y);
        const factor = sobreEje / a.distancia;
        const estirado = a.tipo === 'ancho'
          ? { ...base.estiramiento, x: limitarEstiramiento(base.estiramiento.x * factor) }
          : { ...base.estiramiento, y: limitarEstiramiento(base.estiramiento.y * factor) };
        setProvisional({ ...base, estiramiento: estirado });
        break;
      }
      default: {
        const inalcanzable: never = a.tipo;
        throw new Error(`Arrastre desconocido: ${String(inalcanzable)}`);
      }
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
        left: pct(cx - anchoMarco / 2, ancho),
        top: pct(cy - altoMarco / 2, alto),
        width: pct(anchoMarco, ancho),
        height: pct(altoMarco, alto),
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
      {seleccionado && LADOS.map(({ lado: l, tipo, titulo }) => (
        <span
          key={l}
          className={`manija lado ${l}`}
          data-manija={l}
          title={titulo}
          onPointerDown={(e) => { empezar(e, tipo); }}
          {...eventos}
        />
      ))}
    </div>
  );
}
