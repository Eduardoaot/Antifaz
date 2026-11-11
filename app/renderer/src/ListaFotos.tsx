import { AlertTriangle, CheckCircle2, Clock, ImageOff, LayoutGrid, List, Loader2, Plus, Save, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { contarAdvertencias } from '../../shared/logica';
import type { Archivo } from './App';

const api = (): typeof window.revisor => window.revisor;

/** Con más fotos que esto aparece el buscador. */
const BUSCAR_DESDE = 6;
/** Miniaturas que se piden a la vez: el sidecar atiende en fila y el análisis va primero. */
const MINIATURAS_A_LA_VEZ = 2;

type Modo = 'lista' | 'cuadricula';

/** Recuerda una preferencia de la vista en este equipo. Devuelve false si el almacenamiento no está. */
export function guardarLocal(clave: string, valor: string): boolean {
  try {
    localStorage.setItem(clave, valor);
    return true;
  } catch {
    return false;
  }
}

export function textoEstado(a: Archivo): string {
  switch (a.estado.tipo) {
    case 'en_cola':
      return 'En espera';
    case 'analizando':
      return 'Revisando…';
    case 'error':
      return 'No revisada';
    case 'listo': {
      if (!a.estado.analisis.cobertura.completa) return a.exportado ? 'Exportada, con revisión parcial' : 'Revisión parcial';
      if (a.exportado) return 'Exportada';
      const n = contarAdvertencias(a.estado.analisis.hallazgos);
      const preguntas = a.estado.analisis.hallazgos.length - n;
      if (n === 0) return preguntas === 0 ? 'Sin hallazgos' : 'Una pregunta para ti';
      return `${n} ${n === 1 ? 'advertencia' : 'advertencias'}`;
    }
    default: {
      const inalcanzable: never = a.estado;
      throw new Error(`Estado desconocido: ${String(inalcanzable)}`);
    }
  }
}

function IconoEstado({ a }: { a: Archivo }): React.JSX.Element {
  switch (a.estado.tipo) {
    case 'en_cola':
      return <Clock aria-hidden="true" />;
    case 'analizando':
      return <Loader2 aria-hidden="true" className="girando" />;
    case 'error':
      return <AlertTriangle aria-hidden="true" />;
    case 'listo':
      return a.exportado ? <CheckCircle2 aria-hidden="true" /> : contarAdvertencias(a.estado.analisis.hallazgos) > 0 ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />;
    default: {
      const inalcanzable: never = a.estado;
      throw new Error(`Estado desconocido: ${String(inalcanzable)}`);
    }
  }
}

/**
 * Miniaturas de la foto original, solo en memoria. Se piden cuando la foto aparece en la lista, de pocas
 * en pocas, y se liberan al cerrar la foto.
 */
function useMiniaturas(ids: readonly string[]): { url: (id: string) => string | null | undefined; observar: (id: string, elemento: Element | null) => void } {
  const [urls, setUrls] = useState<ReadonlyMap<string, string | null>>(new Map());
  const pedidas = useRef(new Set<string>());
  const fila = useRef<string[]>([]);
  const enCurso = useRef(0);
  const observador = useRef<IntersectionObserver | null>(null);
  const elementos = useRef(new Map<Element, string>());
  const creadas = useRef(new Map<string, string>());

  const atender = useRef<() => void>(() => undefined);
  useEffect(() => {
    atender.current = (): void => {
    while (enCurso.current < MINIATURAS_A_LA_VEZ && fila.current.length > 0) {
      const id = fila.current.shift();
      if (id === undefined) return;
      enCurso.current += 1;
      void api()
        .miniatura(id)
        .then(
          (r) => (r.ok ? URL.createObjectURL(new Blob([new Uint8Array(r.datos.datos)], { type: r.datos.mime })) : null),
          () => null,
        )
        .then((url) => {
          if (url !== null) creadas.current.set(id, url);
          setUrls((m) => new Map(m).set(id, url));
        })
        .finally(() => {
          enCurso.current -= 1;
          atender.current();
        });
    }
    };
  });

  useEffect(() => {
    observador.current = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        const id = elementos.current.get(entrada.target);
        if (!entrada.isIntersecting || id === undefined || pedidas.current.has(id)) continue;
        pedidas.current.add(id);
        fila.current.push(id);
      }
      atender.current();
    }, { rootMargin: '200px' });
    for (const elemento of elementos.current.keys()) observador.current.observe(elemento);
    const creadasAhora = creadas.current;
    return () => {
      observador.current?.disconnect();
      for (const url of creadasAhora.values()) URL.revokeObjectURL(url);
    };
  }, []);

  // Al cerrar una foto se libera su miniatura.
  const clave = ids.join('|');
  useEffect(() => {
    const vigentes = new Set(clave.split('|'));
    for (const [id, url] of creadas.current) {
      if (vigentes.has(id)) continue;
      URL.revokeObjectURL(url);
      creadas.current.delete(id);
      pedidas.current.delete(id);
    }
    fila.current = fila.current.filter((id) => vigentes.has(id));
    // Los elementos de fotos cerradas ya no se observan.
    for (const [elemento, id] of elementos.current) {
      if (vigentes.has(id) && elemento.isConnected) continue;
      observador.current?.unobserve(elemento);
      elementos.current.delete(elemento);
    }
  }, [clave]);

  return {
    url: (id) => (urls.has(id) ? urls.get(id) : undefined),
    observar: (id, elemento) => {
      if (elemento === null) return;
      elementos.current.set(elemento, id);
      observador.current?.observe(elemento);
    },
  };
}

interface Props {
  archivos: readonly Archivo[];
  seleccion: string | null;
  analizando: boolean;
  listasParaExportar: number;
  exportando: boolean;
  alElegir: (id: string) => void;
  alCerrar: (id: string) => void;
  alAbrir: () => void;
  alCancelar: () => void;
  alExportarTodas: () => void;
}

export function ListaFotos({ archivos, seleccion, analizando, listasParaExportar, exportando, alElegir, alCerrar, alAbrir, alCancelar, alExportarTodas }: Props): React.JSX.Element {
  const [modo, setModo] = useState<Modo>(() => {
    try {
      return localStorage.getItem('lista-fotos') === 'cuadricula' ? 'cuadricula' : 'lista';
    } catch {
      return 'lista';
    }
  });
  const [filtro, setFiltro] = useState('');
  const miniaturas = useMiniaturas(useMemo(() => archivos.map((a) => a.info.id), [archivos]));
  const buscar = filtro.trim().toLocaleLowerCase('es-MX');
  const visibles = buscar === '' ? archivos : archivos.filter((a) => a.info.nombre.toLocaleLowerCase('es-MX').includes(buscar));

  const cambiarModo = (nuevo: Modo): void => {
    setModo(nuevo);
    // Sin almacenamiento, el modo solo dura esta sesión.
    guardarLocal('lista-fotos', nuevo);
  };

  return (
    <nav className="lista-archivos" aria-label="Fotos abiertas">
      <div className="cabecera-seccion">
        <h2>Fotos <span className="chip-conteo">{archivos.length}</span></h2>
        <div className="acciones-lista">
          <button type="button" className="boton fantasma chico" aria-label="Ver como lista" title="Ver como lista" aria-pressed={modo === 'lista'} onClick={() => { cambiarModo('lista'); }}>
            <List aria-hidden="true" />
          </button>
          <button type="button" className="boton fantasma chico" aria-label="Ver como cuadrícula" title="Ver como cuadrícula" aria-pressed={modo === 'cuadricula'} onClick={() => { cambiarModo('cuadricula'); }}>
            <LayoutGrid aria-hidden="true" />
          </button>
          <button type="button" className="boton fantasma chico" aria-label="Abrir más fotos" title="Abrir más fotos (Ctrl O)" onClick={alAbrir}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>

      {archivos.length > BUSCAR_DESDE && (
        <label className="buscar-foto">
          <Search aria-hidden="true" />
          <span className="solo-lector">Buscar foto por nombre</span>
          <input type="search" placeholder="Buscar por nombre" value={filtro} onChange={(e) => { setFiltro(e.target.value); }} />
        </label>
      )}

      {visibles.length === 0 ? (
        <p className="suave">Ninguna foto se llama así.</p>
      ) : (
        <ul className={`fotos fotos-${modo}`}>
          {visibles.map((a) => {
            const url = miniaturas.url(a.info.id);
            const activa = a.info.id === seleccion;
            return (
              <li key={a.info.id} className={`foto${activa ? ' activo' : ''} estado-${a.estado.tipo}`} ref={(el) => { miniaturas.observar(a.info.id, el); }}>
                <button type="button" className="archivo" aria-current={activa ? 'true' : undefined} onClick={() => { alElegir(a.info.id); }}>
                  <span className="miniatura" aria-hidden="true">
                    {url === undefined ? <span className="miniatura-cargando" /> : url === null ? <ImageOff /> : <img src={url} alt="" draggable={false} />}
                  </span>
                  <span className="texto-foto">
                    <span className="nombre" title={a.info.nombre}>{a.info.nombre}</span>
                    <span className="suave estado"><IconoEstado a={a} /> {textoEstado(a)}</span>
                  </span>
                </button>
                <button type="button" className="cerrar-foto" aria-label={`Cerrar ${a.info.nombre}`} title="Cerrar esta foto" onClick={() => { alCerrar(a.info.id); }}>
                  <X aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pie-lista">
        {analizando && <button type="button" className="boton" onClick={alCancelar}>Cancelar revisión</button>}
        {listasParaExportar > 1 && (
          <button type="button" className="boton" disabled={exportando} onClick={alExportarTodas}>
            <Save aria-hidden="true" /> Exportar todas ({listasParaExportar})
          </button>
        )}
      </div>
    </nav>
  );
}
