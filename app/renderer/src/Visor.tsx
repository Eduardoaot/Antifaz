import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Hallazgo, Ocultamiento, Punto } from '../../shared/contrato';
import { agregarPuntoTrazo, aPuntoDeImagen, cajaEntre, type Caja, type Herramienta, type Revision } from '../../shared/logica';
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
}

const porcentajes = (c: Caja, ancho: number, alto: number): React.CSSProperties => ({
  left: `${(c.x / ancho) * 100}%`,
  top: `${(c.y / alto) * 100}%`,
  width: `${(c.ancho / ancho) * 100}%`,
  height: `${(c.alto / alto) * 100}%`,
});

/** La imagen la dibuja el sidecar con los mismos efectos que la exportación: lo que ves es lo que sale. */
export function Visor({ archivo, hallazgos, ocultamientos, revision, herramienta, tamanoPincel, alClic, alDibujar, alPintar, alFuera }: Props): React.JSX.Element {
  const { id, ancho, alto, nombre } = archivo.info;
  const clave = JSON.stringify(ocultamientos);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [actual, setActual] = useState<{ x: number; y: number } | null>(null);
  const [trazo, setTrazo] = useState<readonly Punto[] | null>(null);
  const lienzo = useRef<HTMLDivElement | null>(null);

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

  const conCaja = hallazgos.filter((h) => h.caja !== null);

  const punto = (e: PointerEvent): { x: number; y: number } | null => {
    const rect = lienzo.current?.getBoundingClientRect();
    return rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto);
  };

  const alBajar = (e: PointerEvent): void => {
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
    if (trazo !== null) {
      const rect = lienzo.current?.getBoundingClientRect();
      // Al salirse con el pincel, el trazo sigue por el borde: no se pinta fuera de la imagen.
      const p = rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true);
      if (p !== null) setTrazo((t) => (t === null ? t : agregarPuntoTrazo(t, p, tamanoPincel)));
      return;
    }
    if (inicio === null) return;
    const rect = lienzo.current?.getBoundingClientRect();
    if (rect !== undefined) setActual(aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true));
  };

  const alSoltar = (e: PointerEvent): void => {
    if (herramienta === 'clic') {
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

  const dibujo = inicio !== null && actual !== null ? cajaEntre(inicio, actual) : null;

  if (error !== null) return <p role="alert">No pudimos mostrar la vista previa. {error}</p>;
  if (url === null) return <p className="suave">Preparando la vista previa…</p>;
  return (
    <figure className="visor">
      <div
        ref={lienzo}
        className={`lienzo herramienta-${herramienta}`}
        style={{ aspectRatio: `${ancho} / ${alto}` }}
        data-testid="lienzo"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={() => { setTrazo(null); setInicio(null); setActual(null); }}
      >
        <img src={url} draggable={false} alt={`Vista previa de ${nombre}. El detalle está en el panel de advertencias.`} />
        {conCaja.map((h, i) => {
          const caja = h.caja;
          if (caja === null) return null;
          return (
            <div key={h.id} aria-hidden="true" className={`marca ${revision?.decisiones[h.id] ?? 'sin-decidir'}`} style={porcentajes(caja, ancho, alto)}>
              <span>{i + 1}</span>
            </div>
          );
        })}
        {revision?.manuales.map((z, i) => (
          <div key={z.id} aria-hidden="true" className="marca ocultar manual" style={porcentajes(z, ancho, alto)}>
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
      <figcaption className="suave">{ancho} × {alto} px · {archivo.info.formato}</figcaption>
    </figure>
  );
}
