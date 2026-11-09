import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LIMITES, type Hallazgo, type Ocultamiento, type Punto } from '../../shared/contrato';
import {
  agregarPuntoTrazo,
  anchoAjustado,
  aPuntoDeImagen,
  cajaEntre,
  desplazamientoAnclado,
  limitarZoom,
  pasoZoom,
  textoZoom,
  zonaEnPunto,
  type Caja,
  type Herramienta,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import type { Archivo } from './App';

interface Props {
  archivo: Archivo;
  hallazgos: readonly Hallazgo[];
  ocultamientos: readonly Ocultamiento[];
  revision: Revision | null;
  herramienta: Herramienta;
  tamanoPincel: number;
  alClic: (x: number, y: number) => void;
  alDibujar: (caja: Caja) => void;
  alPintar: (puntos: Punto[]) => void;
  alFuera: () => void;
  /** Zona resaltada a la vez aquí y en el panel. */
  resaltado?: Resaltado | null;
  alResaltar?: (r: Resaltado | null) => void;
  /** Con "Solo ver", un clic en una marca lleva a su fila del panel. */
  alElegirZona?: (id: string) => void;
}

const porcentajes = (c: Caja, ancho: number, alto: number): React.CSSProperties => ({
  left: `${(c.x / ancho) * 100}%`,
  top: `${(c.y / alto) * 100}%`,
  width: `${(c.ancho / ancho) * 100}%`,
  height: `${(c.alto / alto) * 100}%`,
});

/** Más de esto, en píxeles de pantalla, ya es arrastrar y no un clic. */
const UMBRAL_ARRASTRE = 4;
/** En ventanas angostas la imagen usa todo el ancho; al acercarla, la ventana de la imagen se limita. */
const CONSULTA_ANGOSTA = '(max-width: 1000px)';

interface Arrastre {
  x: number;
  y: number;
  izquierda: number;
  arriba: number;
  movido: boolean;
  boton: number;
}

/** La imagen la dibuja el sidecar con los mismos efectos que la exportación: lo que ves es lo que sale. */
export function Visor({ archivo, hallazgos, ocultamientos, revision, herramienta, tamanoPincel, alClic, alDibujar, alPintar, alFuera, resaltado = null, alResaltar, alElegirZona }: Props): React.JSX.Element {
  const { id, ancho, alto, nombre } = archivo.info;
  const clave = JSON.stringify(ocultamientos);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [actual, setActual] = useState<{ x: number; y: number } | null>(null);
  const [trazo, setTrazo] = useState<readonly Punto[] | null>(null);
  const [zoom, setZoom] = useState<number>(LIMITES.zoom.porDefecto);
  const [ajuste, setAjuste] = useState<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const ventana = useRef<HTMLDivElement | null>(null);
  const ancla = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const listo = url !== null;
  const ampliada = zoom > LIMITES.zoom.min;

  useEffect(() => {
    let vigente = true;
    let creada: string | null = null;
    void window.revisor.vista(id, JSON.parse(clave) as Ocultamiento[]).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) {
        creada = URL.createObjectURL(new Blob([new Uint8Array(resultado.datos.datos)], { type: resultado.datos.mime }));
        setUrl(creada);
        setError(null);
      } else {
        setUrl(null);
        setError(resultado.error.mensaje);
      }
    });
    return () => {
      vigente = false;
      if (creada !== null) URL.revokeObjectURL(creada);
    };
  }, [id, clave]);

  // Tamaño al 100 %: lo más grande que cabe en la ventana. Se vuelve a medir si la ventana cambia.
  useEffect(() => {
    const v = ventana.current;
    if (v === null) return undefined;
    const medir = (): void => {
      const angosta = window.matchMedia(CONSULTA_ANGOSTA).matches;
      const maximo = angosta ? Number.NaN : Number.parseFloat(getComputedStyle(v).maxHeight);
      setAjuste(anchoAjustado(v.clientWidth, Number.isFinite(maximo) ? maximo : null, ancho, alto));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(v);
    window.addEventListener('resize', medir);
    return () => {
      observador.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, [ancho, alto, listo]);

  // Tras el zoom, el punto que estaba bajo el cursor (o el centro) sigue en el mismo lugar.
  useLayoutEffect(() => {
    const a = ancla.current;
    const v = ventana.current;
    const l = lienzo.current;
    if (a === null || v === null || l === null) return;
    ancla.current = null;
    v.scrollLeft = desplazamientoAnclado(a.fx, a.vx, l.offsetWidth, v.clientWidth);
    v.scrollTop = desplazamientoAnclado(a.fy, a.vy, l.offsetHeight, v.clientHeight);
  }, [zoom]);

  const cambiarZoom = (nuevo: number, cliente?: { x: number; y: number }): void => {
    const z = limitarZoom(nuevo);
    const v = ventana.current;
    const l = lienzo.current;
    if (z === zoom || v === null || l === null) return;
    const rv = v.getBoundingClientRect();
    const rl = l.getBoundingClientRect();
    const cx = cliente?.x ?? rv.left + v.clientWidth / 2;
    const cy = cliente?.y ?? rv.top + v.clientHeight / 2;
    ancla.current = { fx: (cx - rl.left) / rl.width, fy: (cy - rl.top) / rl.height, vx: cx - rv.left, vy: cy - rv.top };
    setZoom(z);
  };

  // Ctrl + rueda acerca o aleja. Necesita un oyente no pasivo para que la página no haga su propio zoom.
  const alRuedaActual = useRef<(e: WheelEvent) => void>(() => undefined);
  useEffect(() => {
    alRuedaActual.current = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      cambiarZoom(pasoZoom(zoom, e.deltaY < 0 ? 1 : -1), { x: e.clientX, y: e.clientY });
    };
  });
  useEffect(() => {
    const v = ventana.current;
    if (v === null) return undefined;
    const alRueda = (e: WheelEvent): void => { alRuedaActual.current(e); };
    v.addEventListener('wheel', alRueda, { passive: false });
    return () => { v.removeEventListener('wheel', alRueda); };
  }, [listo]);

  const conCaja = hallazgos.filter((h) => h.caja !== null);
  const zonas = [
    ...conCaja.flatMap((h) => (h.caja === null ? [] : [{ id: h.id, caja: h.caja }])),
    ...(revision?.manuales ?? []).map((z) => ({ id: z.id, caja: { x: z.x, y: z.y, ancho: z.ancho, alto: z.alto } })),
  ];

  // Con el teclado en el panel, la imagen ampliada se mueve para mostrar la zona.
  useEffect(() => {
    if (resaltado?.origen !== 'foco' || !ampliada) return;
    const marca = lienzo.current?.querySelector<HTMLElement>(`[data-marca="${CSS.escape(resaltado.id)}"]`);
    marca?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [resaltado, ampliada]);

  const punto = (e: PointerEvent): { x: number; y: number } | null => {
    const rect = lienzo.current?.getBoundingClientRect();
    return rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto);
  };

  const resaltarEn = (e: PointerEvent): void => {
    if (alResaltar === undefined) return;
    const p = punto(e);
    const zona = p === null ? null : zonaEnPunto(p.x, p.y, zonas);
    if (zona === null) {
      if (resaltado?.origen === 'imagen') alResaltar(null);
    } else if (resaltado?.id !== zona) {
      alResaltar({ id: zona, origen: 'imagen' });
    }
  };

  const alBajar = (e: PointerEvent): void => {
    // Botón central siempre, o "Solo ver" con el principal: mover la imagen.
    if (e.button === 1 || (herramienta === 'ninguna' && e.button === 0)) {
      const v = ventana.current;
      if (v === null) return;
      if (e.button === 1) e.preventDefault();
      arrastre.current = { x: e.clientX, y: e.clientY, izquierda: v.scrollLeft, arriba: v.scrollTop, movido: false, boton: e.button };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (herramienta === 'rectangulo') {
      const p = punto(e);
      setInicio(p);
      setActual(p);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (herramienta === 'pincel') {
      const p = punto(e);
      if (p === null) return;
      setTrazo([p]);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const alMover = (e: PointerEvent): void => {
    const a = arrastre.current;
    if (a !== null) {
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      if (!a.movido && Math.abs(dx) + Math.abs(dy) > UMBRAL_ARRASTRE) {
        a.movido = true;
        setArrastrando(true);
      }
      if (a.movido && ventana.current !== null) {
        ventana.current.scrollLeft = a.izquierda - dx;
        ventana.current.scrollTop = a.arriba - dy;
      }
      return;
    }
    if (trazo !== null) {
      const rect = lienzo.current?.getBoundingClientRect();
      // Al salirse con el pincel, el trazo sigue por el borde: no se pinta fuera de la imagen.
      const p = rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true);
      if (p !== null) setTrazo((t) => (t === null ? t : agregarPuntoTrazo(t, p, tamanoPincel)));
      return;
    }
    if (inicio === null) {
      resaltarEn(e);
      return;
    }
    const rect = lienzo.current?.getBoundingClientRect();
    if (rect !== undefined) setActual(aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true));
  };

  const alSoltar = (e: PointerEvent): void => {
    const a = arrastre.current;
    if (a !== null) {
      arrastre.current = null;
      setArrastrando(false);
      if (!a.movido && a.boton === 0 && herramienta === 'ninguna' && alElegirZona !== undefined) {
        const p = punto(e);
        const zona = p === null ? null : zonaEnPunto(p.x, p.y, zonas);
        if (zona !== null) alElegirZona(zona);
      }
      return;
    }
    if (herramienta === 'clic') {
      if (e.button !== 0) return;
      const p = punto(e);
      if (p === null) alFuera();
      else alClic(p.x, p.y);
      return;
    }
    if (trazo !== null) {
      alPintar([...trazo]);
      setTrazo(null);
      return;
    }
    if (inicio !== null && actual !== null) {
      const caja = cajaEntre(inicio, actual);
      if (caja !== null) alDibujar(caja);
    }
    setInicio(null);
    setActual(null);
  };

  const alTecla = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '+' || e.key === '=') cambiarZoom(pasoZoom(zoom, 1));
    else if (e.key === '-') cambiarZoom(pasoZoom(zoom, -1));
    else if (e.key === '0') cambiarZoom(LIMITES.zoom.min);
    else return;
    e.preventDefault();
  };

  const dibujo = inicio !== null && actual !== null ? cajaEntre(inicio, actual) : null;
  const claseMarca = (zona: string): string => (resaltado?.id === zona ? ' resaltada' : '');
  const sobreZona = herramienta === 'ninguna' && resaltado?.origen === 'imagen';

  if (error !== null) return <p role="alert">No pudimos mostrar la vista previa. {error}</p>;
  if (url === null) return <p className="suave">Preparando la vista previa…</p>;
  return (
    <figure className="visor">
      <div className="barra-visor" role="group" aria-label="Zoom de la imagen">
        <button type="button" className="boton chico" aria-label="Alejar" disabled={zoom <= LIMITES.zoom.min} onClick={() => { cambiarZoom(pasoZoom(zoom, -1)); }}>
          <ZoomOut aria-hidden="true" />
        </button>
        <output className="nivel-zoom" aria-live="polite" aria-label={`Zoom al ${textoZoom(zoom)}`}>{textoZoom(zoom)}</output>
        <button type="button" className="boton chico" aria-label="Acercar" disabled={zoom >= LIMITES.zoom.max} onClick={() => { cambiarZoom(pasoZoom(zoom, 1)); }}>
          <ZoomIn aria-hidden="true" />
        </button>
        <button type="button" className="boton compacto" disabled={!ampliada} onClick={() => { cambiarZoom(LIMITES.zoom.min); }}>
          <Maximize aria-hidden="true" /> Ajustar
        </button>
        <span className="suave pista-zoom" id="pista-zoom">
          {ampliada
            ? herramienta === 'ninguna' ? 'Arrastra la imagen para moverte.' : 'Muévete con la rueda, las barras o el botón central del mouse.'
            : 'Ctrl + rueda o las teclas + y − para acercar.'}
        </span>
      </div>
      <div
        ref={ventana}
        className={`ventana-lienzo${ampliada ? ' ampliada' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="Imagen"
        aria-describedby="pista-zoom"
        onKeyDown={alTecla}
      >
        <div
          ref={lienzo}
          className={`lienzo herramienta-${herramienta}${arrastrando ? ' arrastrando' : ''}${sobreZona ? ' sobre-zona' : ''}`}
          style={{ aspectRatio: `${ancho} / ${alto}`, width: ajuste === null ? '100%' : `${Math.round(ajuste * zoom)}px` }}
          data-testid="lienzo"
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerLeave={() => { if (resaltado?.origen === 'imagen') alResaltar?.(null); }}
          onPointerCancel={() => { arrastre.current = null; setArrastrando(false); setTrazo(null); setInicio(null); setActual(null); }}
        >
          <img src={url} draggable={false} alt={`Vista previa de ${nombre}. El detalle está en el panel de advertencias.`} />
          {conCaja.map((h, i) => {
            const caja = h.caja;
            if (caja === null) return null;
            return (
              <div key={h.id} aria-hidden="true" data-marca={h.id} className={`marca ${revision?.decisiones[h.id] ?? 'sin-decidir'}${claseMarca(h.id)}`} style={porcentajes(caja, ancho, alto)}>
                <span>{i + 1}</span>
              </div>
            );
          })}
          {revision?.manuales.map((z, i) => (
            <div key={z.id} aria-hidden="true" data-marca={z.id} className={`marca ocultar manual${claseMarca(z.id)}`} style={porcentajes(z, ancho, alto)}>
              <span>T{i + 1}</span>
            </div>
          ))}
          {dibujo !== null && <div aria-hidden="true" className="marca sin-decidir" style={porcentajes(dibujo, ancho, alto)} />}
          {trazo !== null && (
            <svg aria-hidden="true" className="trazo" viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none">
              <polyline
                points={trazo.map((p) => `${p.x + 0.5},${p.y + 0.5}`).join(' ')}
                strokeWidth={tamanoPincel}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>
      <figcaption className="suave">{ancho} × {alto} px · {archivo.info.formato}</figcaption>
    </figure>
  );
}
