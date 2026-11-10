import { Crosshair, FolderOpen, Save, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react';
import { ERROR_INTERNO, esquemaEfecto, type Efecto, type PistaElegida, type VideoInfo } from '../../shared/contrato';
import { aPuntoDeImagen } from '../../shared/logica';
import { leerEnRango } from '../../shared/numeros';
import { Confirmacion } from './Dialogos';

interface Pista {
  id: string;
  efecto: Efecto;
  framesRevisar: number;
  posicionesRevisar: number[];
}

type Ocupado = 'abriendo' | 'siguiendo' | 'exportando' | null;

interface Props {
  /** Visible ahora: solo entonces lleva el id al que salta "Saltar al contenido". */
  activo: boolean;
  alAnunciar: (texto: string) => void;
  alFallar: (nombre: string, mensaje: string) => void;
}

const api = (): typeof window.revisor => window.revisor;
const MAX_IR_A = 20;

function segundos(info: VideoInfo, posicion: number): string {
  const s = info.posiciones <= 1 ? 0 : (posicion / (info.posiciones - 1)) * info.duracion;
  return s.toFixed(1);
}

/**
 * Video en la beta: hasta 15 s. No hay detección automática: la persona hace clic sobre lo que quiere
 * ocultar y EdgeTAM lo sigue en todo el video. La vista previa la dibuja el sidecar con los mismos
 * efectos que la exportación.
 */
export function ModoVideo({ activo, alAnunciar, alFallar }: Props): React.JSX.Element {
  const idPrincipal = activo ? 'principal' : undefined;
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [posicion, setPosicion] = useState(0);
  const [pistas, setPistas] = useState<Pista[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [revisarFrame, setRevisarFrame] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [coordenadas, setCoordenadas] = useState({ x: '', y: '' });
  const [errorCoordenadas, setErrorCoordenadas] = useState<string | null>(null);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const elegidas: PistaElegida[] = pistas.map((p) => ({ pista_id: p.id, efecto: p.efecto }));
  const claveVista = JSON.stringify(elegidas);

  const perderVideo = useCallback((mensaje: string) => {
    setInfo(null);
    setPistas([]);
    setUrl(null);
    alAnunciar(mensaje);
  }, [alAnunciar]);

  // La vista previa se pide de nuevo al cambiar de frame o de efectos. Mientras se sigue un objeto,
  // el sidecar está ocupado: se espera a que termine.
  useEffect(() => {
    if (info === null || ocupado === 'siguiendo' || ocupado === 'abriendo') return undefined;
    let vigente = true;
    let creada: string | null = null;
    void api()
      .vistaVideo(info.id, posicion, JSON.parse(claveVista) as PistaElegida[])
      .then((resultado) => {
        if (!vigente) return;
        if (resultado.ok) {
          creada = URL.createObjectURL(new Blob([new Uint8Array(resultado.datos.datos)], { type: resultado.datos.mime }));
          setUrl(creada);
          setRevisarFrame(resultado.datos.revisar);
          setErrorVista(null);
        } else if (resultado.error.codigo === 'VIDEO_NO_ABIERTO') {
          perderVideo(resultado.error.mensaje);
        } else {
          setErrorVista(resultado.error.mensaje);
        }
      })
      .catch(() => {
        if (vigente) setErrorVista(ERROR_INTERNO.mensaje);
      });
    return () => {
      vigente = false;
      if (creada !== null) URL.revokeObjectURL(creada);
    };
  }, [info, posicion, claveVista, ocupado, perderVideo]);

  const abrir = useCallback(async () => {
    if (ocupado !== null) return;
    setOcupado('abriendo');
    alAnunciar('Abriendo el video. Puede tardar unos segundos.');
    try {
      const resultado = await api().abrirVideo();
      if (!resultado.ok) {
        alFallar('Video', resultado.error.mensaje);
        alAnunciar(`No se abrió el video. ${resultado.error.mensaje}`);
        return;
      }
      if (resultado.datos === null) {
        alAnunciar('');
        return;
      }
      if (info !== null) void api().cerrarVideo(info.id);
      setInfo(resultado.datos);
      setPistas([]);
      setPosicion(0);
      setUrl(null);
      alAnunciar(`Abrimos ${resultado.datos.nombre}. Haz clic sobre lo que quieras ocultar.`);
    } catch {
      alFallar('Video', ERROR_INTERNO.mensaje);
    } finally {
      setOcupado(null);
    }
  }, [alAnunciar, alFallar, info, ocupado]);

  const seguir = useCallback(
    async (x: number, y: number) => {
      if (info === null || ocupado !== null) return;
      setOcupado('siguiendo');
      alAnunciar('Siguiendo el objeto en todo el video. En una computadora como la de referencia tarda unos 2 minutos.');
      try {
        const resultado = await api().seguirVideo(info.id, posicion, x, y);
        if (!resultado.ok) {
          if (resultado.error.codigo === 'VIDEO_NO_ABIERTO' || resultado.error.codigo === 'SIDECAR_CAIDO') {
            perderVideo(`El seguimiento se detuvo y el video se cerró. ${resultado.error.mensaje}`);
          } else {
            alAnunciar(resultado.error.mensaje);
          }
          return;
        }
        const { pistaId, framesRevisar, posicionesRevisar } = resultado.datos;
        setPistas((lista) => [...lista, { id: pistaId, efecto: 'solido', framesRevisar, posicionesRevisar }]);
        alAnunciar(
          framesRevisar === 0
            ? 'Listo: seguimos el objeto en todo el video y lo ocultamos con bloque sólido. Revisa la vista previa.'
            : `Seguimos el objeto, pero en ${framesRevisar} ${framesRevisar === 1 ? 'frame' : 'frames'} lo perdimos. Revísalos: a veces ocultamos de más y a veces, si salió del encuadre, no pintamos cuadro.`,
        );
      } catch {
        alAnunciar(ERROR_INTERNO.mensaje);
      } finally {
        setOcupado(null);
      }
    },
    [alAnunciar, info, ocupado, perderVideo, posicion],
  );

  const cancelarSeguimiento = (): void => {
    // Cancelar reinicia el análisis: el video y lo elegido se pierden, y se dice.
    void api().cancelar();
  };

  const exportarAhora = useCallback(async () => {
    setConfirmar(null);
    if (info === null || ocupado !== null) return;
    setOcupado('exportando');
    alAnunciar('Guardando la copia del video. Revisamos que salga sin metadatos antes de guardarla.');
    try {
      const resultado = await api().exportarVideo(info.id, elegidas);
      if (!resultado.ok) {
        if (resultado.error.codigo === 'VIDEO_NO_ABIERTO') perderVideo(resultado.error.mensaje);
        alFallar(info.nombre, resultado.error.mensaje);
        alAnunciar(`No se guardó. ${resultado.error.mensaje}`);
      } else if (resultado.datos !== null) {
        const { nombre, pistasOcultas } = resultado.datos;
        alAnunciar(`Guardamos ${nombre} sin metadatos, con ${pistasOcultas} ${pistasOcultas === 1 ? 'objeto oculto' : 'objetos ocultos'}.`);
      } else {
        alAnunciar('');
      }
    } catch {
      alFallar(info.nombre, ERROR_INTERNO.mensaje);
    } finally {
      setOcupado(null);
    }
  }, [alAnunciar, alFallar, elegidas, info, ocupado, perderVideo]);

  const pedirExportar = (): void => {
    if (info === null || ocupado !== null) return;
    const revisar = pistas.reduce((n, p) => n + p.framesRevisar, 0);
    if (pistas.length === 0) {
      setConfirmar('No elegiste nada para ocultar. La copia saldrá igual, solo sin metadatos. ¿Quieres guardarla así?');
    } else if (revisar > 0) {
      setConfirmar(`En ${revisar} ${revisar === 1 ? 'frame' : 'frames'} perdimos un objeto. ¿Ya revisaste esos frames?`);
    } else {
      void exportarAhora();
    }
  };

  const quitar = (id: string): void => {
    if (info === null || ocupado !== null) return;
    void api().quitarPista(info.id, id);
    setPistas((lista) => lista.filter((p) => p.id !== id));
    alAnunciar('Quitamos ese objeto: ya no se oculta.');
  };

  const cambiarEfecto = (id: string, efecto: Efecto): void => {
    setPistas((lista) => lista.map((p) => (p.id === id ? { ...p, efecto } : p)));
  };

  const alSoltar = (e: PointerEvent): void => {
    if (info === null || ocupado !== null) return;
    const rect = lienzo.current?.getBoundingClientRect();
    const p = rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, info.proxyAncho, info.proxyAlto);
    if (p === null) {
      alAnunciar('Ese punto queda fuera del video.');
      return;
    }
    void seguir(p.x, p.y);
  };

  const seguirEnCoordenadas = (e: SyntheticEvent): void => {
    e.preventDefault();
    if (info === null) return;
    const x = leerEnRango(coordenadas.x, 0, info.proxyAncho - 1);
    const y = leerEnRango(coordenadas.y, 0, info.proxyAlto - 1);
    if (!x.ok || !y.ok) {
      setErrorCoordenadas(`Escribe números enteros: X de 0 a ${info.proxyAncho - 1} y Y de 0 a ${info.proxyAlto - 1}.`);
      return;
    }
    setErrorCoordenadas(null);
    void seguir(x.valor, y.valor);
  };

  if (info === null) {
    return (
      <div className="cuerpo cuerpo-solo">
      <main id={idPrincipal} tabIndex={-1} className="principal modo-video">
        <div className="vacio">
          <h1>Revisa un video antes de publicarlo</h1>
          <p>En esta versión beta revisamos videos de hasta 15 segundos. Todo se procesa en tu computadora.</p>
          <p className="suave">Todavía no detectamos nada solos en video: tú eliges qué ocultar con un clic y lo seguimos en todo el video.</p>
          <button type="button" className="boton primario" disabled={ocupado !== null} onClick={() => { void abrir(); }}>
            <FolderOpen aria-hidden="true" /> {ocupado === 'abriendo' ? 'Abriendo…' : 'Abrir video'}
          </button>
        </div>
      </main>
      </div>
    );
  }

  const revisarTotal = pistas.reduce((n, p) => n + p.framesRevisar, 0);
  const irA = [...new Set(pistas.flatMap((p) => p.posicionesRevisar))].sort((a, b) => a - b).slice(0, MAX_IR_A);

  return (
    <div className="cuerpo cuerpo-video">
      <main id={idPrincipal} tabIndex={-1} className="principal">
        <h1 className="titulo-foto">{info.nombre}</h1>
        <div className="caja-parcial aviso-video" role="note">
          <p><strong>Beta de video:</strong> no detectamos nada automáticamente. Haz clic sobre una persona u objeto y lo seguimos en todo el video.</p>
        </div>
        {errorVista !== null && <p role="alert">No pudimos mostrar este frame. {errorVista}</p>}
        <figure className="visor">
          {url === null ? (
            <p className="suave">{ocupado === 'siguiendo' ? 'Siguiendo el objeto…' : 'Preparando la vista previa…'}</p>
          ) : (
            <div
              ref={lienzo}
              className={`lienzo ${ocupado === null ? 'herramienta-clic' : ''}`}
              style={{ aspectRatio: `${info.proxyAncho} / ${info.proxyAlto}` }}
              data-testid="lienzo-video"
              onPointerUp={alSoltar}
            >
              <img src={url} draggable={false} alt={`Frame en el segundo ${segundos(info, posicion)} de ${info.nombre}, con las zonas ocultas.`} />
            </div>
          )}
          <figcaption className="suave">
            {info.ancho} × {info.alto} px · {info.duracion.toFixed(2)} s · {Math.round(info.fps)} fps{info.tieneAudio ? ' · con audio' : ' · sin audio'}
          </figcaption>
        </figure>
        {revisarFrame && (
          <p className="caja-parcial" role="status">En este frame perdimos el objeto. Revisa que no aparezca, o que la zona oculta se vea bien.</p>
        )}
        <div className="campo-frame">
          <label htmlFor="frame-video">
            Frame {posicion + 1} de {info.posiciones} (segundo {segundos(info, posicion)})
          </label>
          <input
            id="frame-video"
            type="range"
            min={0}
            max={info.posiciones - 1}
            value={posicion}
            disabled={ocupado !== null}
            onChange={(e) => { setPosicion(Number(e.target.value)); }}
          />
        </div>
      </main>

      <aside className="panel" aria-label="Objetos a ocultar en el video">
        <div className="acciones-video">
          <button type="button" className="boton" disabled={ocupado !== null} onClick={() => { void abrir(); }}>
            <FolderOpen aria-hidden="true" /> Abrir otro video
          </button>
          <button type="button" className="boton primario" disabled={ocupado !== null} onClick={pedirExportar}>
            <Save aria-hidden="true" /> {ocupado === 'exportando' ? 'Guardando…' : 'Exportar copia'}
          </button>
        </div>

        {ocupado === 'siguiendo' && (
          <div className="caja-parcial" role="status">
            <p><strong>Siguiendo el objeto…</strong> Tarda unos 2 minutos. Puedes cancelar, pero el video se cerrará y tendrás que abrirlo de nuevo.</p>
            <button type="button" className="boton" onClick={cancelarSeguimiento}>Cancelar</button>
          </div>
        )}

        {info.pistasSinRevisar > 0 && (
          <p className="suave">
            Este video trae {info.pistasSinRevisar} {info.pistasSinRevisar === 1 ? 'pista extra' : 'pistas extra'}, como subtítulos o datos de ubicación. No las revisamos y no se copian a la copia.
          </p>
        )}

        <h2>Qué se oculta</h2>
        {pistas.length === 0 ? (
          <p className="suave">Todavía nada. Haz clic sobre la imagen en lo que quieras ocultar.</p>
        ) : (
          <ul className="advertencias">
            {pistas.map((p, i) => (
              <li key={p.id} className="advertencia bajo">
                <p>
                  <strong>Objeto {i + 1}</strong>
                  {p.framesRevisar > 0 && ` · revisa ${p.framesRevisar} ${p.framesRevisar === 1 ? 'frame' : 'frames'}`}
                </p>
                <div className="controles">
                  <label>
                    Efecto<span className="solo-lector"> del objeto {i + 1}</span>
                    <select value={p.efecto} disabled={ocupado !== null} onChange={(e) => { cambiarEfecto(p.id, esquemaEfecto.parse(e.target.value)); }}>
                      <option value="solido">Bloque sólido</option>
                      <option value="difuminado">Difuminado</option>
                      <option value="pixelado">Pixelado</option>
                    </select>
                  </label>
                  <button type="button" className="boton" disabled={ocupado !== null} onClick={() => { quitar(p.id); }}>
                    <X aria-hidden="true" /> Quitar<span className="solo-lector"> el objeto {i + 1}</span>
                  </button>
                </div>
                {p.efecto !== 'solido' && (
                  <p className="suave">El difuminado y el pixelado conservan los colores del video, y con herramientas especiales alguien podría reconstruir parte. Para la máxima protección, usa Bloque sólido.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {revisarTotal > 0 && irA.length > 0 && (
          <section aria-labelledby="titulo-revisar">
            <h2 id="titulo-revisar">Frames para revisar</h2>
            <div className="grupo-acciones">
              {irA.map((p) => (
                <button key={p} type="button" className="boton chico" disabled={ocupado !== null} onClick={() => { setPosicion(p); }}>
                  Frame {p + 1}
                </button>
              ))}
            </div>
          </section>
        )}

        <details>
          <summary>Elegir con coordenadas (sin mouse)</summary>
          <form className="coordenadas" onSubmit={seguirEnCoordenadas}>
            <p className="suave">La vista mide {info.proxyAncho} × {info.proxyAlto} píxeles. El punto 0, 0 es la esquina superior izquierda. Se usa el frame que estás viendo.</p>
            <label>X<input type="text" inputMode="numeric" value={coordenadas.x} onChange={(e) => { setCoordenadas((c) => ({ ...c, x: e.target.value })); }} /></label>
            <label>Y<input type="text" inputMode="numeric" value={coordenadas.y} onChange={(e) => { setCoordenadas((c) => ({ ...c, y: e.target.value })); }} /></label>
            <button type="submit" className="boton" disabled={ocupado !== null}>
              <Crosshair aria-hidden="true" /> Seguir objeto en X, Y
            </button>
            {errorCoordenadas !== null && <p role="alert" className="error-campo">{errorCoordenadas}</p>}
          </form>
        </details>
      </aside>

      {confirmar !== null && (
        <Confirmacion
          titulo="Antes de exportar"
          texto={confirmar}
          aceptar="Exportar de todos modos"
          cancelar="Volver a revisar"
          alAceptar={() => { void exportarAhora(); }}
          alCancelar={() => { setConfirmar(null); }}
        />
      )}
    </div>
  );
}
