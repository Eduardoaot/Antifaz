import { useEffect, useState } from 'react';
import type { Hallazgo, Ocultamiento } from '../../shared/contrato';
import type { Revision } from '../../shared/logica';
import type { Archivo } from './App';

interface Props {
  archivo: Archivo;
  hallazgos: readonly Hallazgo[];
  ocultamientos: readonly Ocultamiento[];
  revision: Revision | null;
}

/** La imagen la dibuja el sidecar con los mismos efectos que la exportación: lo que ves es lo que sale. */
export function Visor({ archivo, hallazgos, ocultamientos, revision }: Props): React.JSX.Element {
  const { id, ancho, alto, nombre } = archivo.info;
  const clave = JSON.stringify(ocultamientos);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error !== null) return <p role="alert">No pudimos mostrar la vista previa. {error}</p>;
  if (url === null) return <p className="suave">Preparando la vista previa…</p>;
  return (
    <figure className="visor">
      <div className="lienzo" style={{ aspectRatio: `${ancho} / ${alto}` }}>
        <img src={url} alt={`Vista previa de ${nombre}. El detalle está en el panel de advertencias.`} />
        {conCaja.map((h, i) => {
          const caja = h.caja;
          if (caja === null) return null;
          const decision = revision?.decisiones[h.id];
          return (
            <div
              key={h.id}
              aria-hidden="true"
              className={`marca ${decision ?? 'sin-decidir'}`}
              style={{
                left: `${(caja.x / ancho) * 100}%`,
                top: `${(caja.y / alto) * 100}%`,
                width: `${(caja.ancho / ancho) * 100}%`,
                height: `${(caja.alto / alto) * 100}%`,
              }}
            >
              <span>{i + 1}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="suave">{ancho} × {alto} px · {archivo.info.formato}</figcaption>
    </figure>
  );
}
