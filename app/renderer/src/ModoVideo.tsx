import { ChevronDown, Crosshair, Film, FolderOpen, Hand, Pause, Play, Save, SkipBack, SkipForward, SquareSplitHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react';
import { ERROR_INTERNO, LIMITES, type Efecto, type PistaElegida, type VideoInfo } from '../../shared/contrato';
import { aPuntoDeImagen, limitarIntensidad, usaIntensidad, valorComun } from '../../shared/logica';
import { leerEnRango } from '../../shared/numeros';
import { ControlDecision, ControlIntensidad, SelectorEfecto } from './Advertencias';
import { Confirmacion } from './Dialogos';

interface Pista {
  id: string;
  efecto: Efecto;
  intensidad: number;
  /** Falso si decidiste dejarlo visible: sigue rastreado, pero no se oculta. */
  oculta: boolean;
  framesRevisar: number;
  posicionesRevisar: number[];
}

type Ocupado = 'abriendo' | 'siguiendo' | 'exportando' | null;
type HerramientaVideo = 'ver' | 'seguir';

interface Props {
  /** Visible ahora: solo entonces lleva el id al que salta "Saltar al contenido". */
  activo: boolean;
  alAnunciar: (texto: string) => void;
  alFallar: (nombre: string, mensaje: string) => void;
  /** Abrir un video: el que se soltó en la ventana o, sin archivo, con el selector. */
  pedido: { archivo: File | null; vez: number } | null;
}

const api = (): typeof window.revisor => window.revisor;
const MAX_IR_A = 20;
/** Al reproducir no se pasa de esto: cada frame lo dibuja el sidecar. */
const FPS_REPRODUCCION = 12;

function segundos(info: VideoInfo, posicion: number): string {
  const s = info.posiciones <= 1 ? 0 : (posicion / (info.posiciones - 1)) * info.duracion;
  return s.toFixed(1);
}

/**
 * Video en la beta: hasta 15 s. No hay detección automática: la persona hace clic sobre lo que quiere
 * ocultar y lo seguimos en todo el video. La vista previa la dibuja el sidecar con los mismos efectos
 * que la exportación.
 */
export function ModoVideo({ activo, alAnunciar, alFallar, pedido }: Props): React.JSX.Element {
  const idPrincipal = activo ? 'principal' : undefined;
  const id = useId();
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [posicion, setPosicion] = useState(0);
  const [pistas, setPistas] = useState<Pista[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [urlOriginal, setUrlOriginal] = useState<string | null>(null);
  const [revisarFrame, setRevisarFrame] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [coordenadas, setCoordenadas] = useState({ x: '', y: '' });
  const [errorCoordenadas, setErrorCoordenadas] = useState<string | null>(null);
  const [herramienta, setHerramienta] = useState<HerramientaVideo>('seguir');
  const [comparando, setComparando] = useState(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const [estiloAbierto, setEstiloAbierto] = useState(false);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const elegidas: PistaElegida[] = pistas.filter((p) => p.oculta).map((p) => ({ pista_id: p.id, efecto: p.efecto, intensidad: p.intensidad }));
  const claveVista = JSON.stringify(elegidas);

  const perderVideo = useCallback((mensaje: string) => {
    setInfo(null);
    setPistas([]);
    setUrl(null);
    setReproduciendo(false);
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
          setReproduciendo(false);
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

  // Comparar: el mismo frame sin ocultar nada, solo mientras se compara.
  useEffect(() => {
    if (info === null || !comparando || ocupado === 'siguiendo' || ocupado === 'abriendo') return undefined;
    let vigente = true;
    let creada: string | null = null;
    void api()
      .vistaVideo(info.id, posicion, [])
      .then((resultado) => {
        if (!vigente || !resultado.ok) return;
        creada = URL.createObjectURL(new Blob([new Uint8Array(resultado.datos.datos)], { type: resultado.datos.mime }));
        setUrlOriginal(creada);
      })
      .catch(() => {
        if (vigente) setUrlOriginal(null);
      });
    return () => {
      vigente = false;
      if (creada !== null) URL.revokeObjectURL(creada);
    };
  }, [info, posicion, comparando, ocupado]);

  // Reproducir: avanza un frame cuando el anterior ya se dibujó. Nunca más rápido que FPS_REPRODUCCION.
  useEffect(() => {
    if (!reproduciendo || info === null || ocupado !== null) return undefined;
    const fin = posicion >= info.posiciones - 1;
    const espera = setTimeout(() => {
      if (fin) setReproduciendo(false);
      else setPosicion((p) => Math.min(info.posiciones - 1, p + 1));
    }, 1000 / FPS_REPRODUCCION);
    return () => { clearTimeout(espera); };
  }, [reproduciendo, info, ocupado, posicion, url]);

  const abrirCon = useCallback(async (pedir: () => Promise<{ ok: true; datos: VideoInfo | null } | { ok: false; error: { codigo: string; mensaje: string } }>) => {
    if (ocupado !== null) return;
    setOcupado('abriendo');
    setReproduciendo(false);
    alAnunciar('Abriendo el video. Puede tardar unos segundos.');
    try {
      const resultado = await pedir();
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
      setComparando(false);
      setHerramienta('seguir');
      alAnunciar(`Abrimos ${resultado.datos.nombre}. Haz clic sobre lo que quieras ocultar.`);
    } catch {
      alFallar('Video', ERROR_INTERNO.mensaje);
    } finally {
      setOcupado(null);
    }
  }, [alAnunciar, alFallar, info, ocupado]);

  const abrir = useCallback(() => abrirCon(() => api().abrirVideo()), [abrirCon]);

  // Un pedido nuevo desde afuera (menú o soltar): se atiende una vez.
  const atendido = useRef<number | null>(null);
  useEffect(() => {
    if (pedido === null || atendido.current === pedido.vez) return undefined;
    const { archivo, vez } = pedido;
    // Fuera del efecto: abrir cambia el estado, y así no se encadenan renders.
    const espera = setTimeout(() => {
      atendido.current = vez;
      void (archivo === null ? abrir() : abrirCon(() => api().soltarVideo(archivo)));
    }, 0);
    return () => { clearTimeout(espera); };
  }, [pedido, abrir, abrirCon]);

  const seguir = useCallback(
    async (x: number, y: number) => {
      if (info === null || ocupado !== null) return;
      setReproduciendo(false);
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
        setPistas((lista) => [...lista, { id: pistaId, efecto: 'solido', intensidad: LIMITES.intensidad.porDefecto, oculta: true, framesRevisar, posicionesRevisar }]);
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
    setReproduciendo(false);
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
    const revisar = pistas.filter((p) => p.oculta).reduce((n, p) => n + p.framesRevisar, 0);
    const visibles = pistas.filter((p) => !p.oculta).length;
    if (elegidas.length === 0) {
      setConfirmar('No elegiste nada para ocultar. La copia saldrá igual, solo sin metadatos. ¿Quieres guardarla así?');
    } else if (revisar > 0 || visibles > 0) {
      const partes = [
        ...(revisar > 0 ? [`En ${revisar} ${revisar === 1 ? 'frame' : 'frames'} perdimos un objeto. ¿Ya revisaste esos frames?`] : []),
        ...(visibles > 0 ? [`${visibles} ${visibles === 1 ? 'objeto quedará visible' : 'objetos quedarán visibles'}, como lo decidiste.`] : []),
      ];
      setConfirmar(partes.join(' '));
    } else {
      void exportarAhora();
    }
  };

  const quitar = (pistaId: string): void => {
    if (info === null || ocupado !== null) return;
    void api().quitarPista(info.id, pistaId);
    setPistas((lista) => lista.filter((p) => p.id !== pistaId));
    alAnunciar('Quitamos ese objeto: ya no se sigue ni se oculta.');
  };

  const cambiarPistas = (ids: readonly string[], cambio: Partial<Pick<Pista, 'efecto' | 'intensidad' | 'oculta'>>): void => {
    setPistas((lista) => lista.map((p) => (ids.includes(p.id) ? { ...p, ...cambio } : p)));
  };

  const alSoltar = (e: PointerEvent): void => {
    if (info === null || ocupado !== null || herramienta !== 'seguir' || comparando || e.button !== 0) return;
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

  // Atajos del video, solo con el modo a la vista: Espacio reproduce, las flechas cambian de frame y
  // Ctrl E exporta. Nunca mientras se escribe ni con un diálogo abierto.
  const alTecla = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    alTecla.current = (e: KeyboardEvent): void => {
      if (!activo || info === null || document.querySelector('dialog[open]') !== null) return;
      const objetivo = e.target;
      const enCampo = objetivo instanceof HTMLInputElement || objetivo instanceof HTMLSelectElement || objetivo instanceof HTMLTextAreaElement || objetivo instanceof HTMLButtonElement;
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        pedirExportar();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey || enCampo || ocupado !== null) return;
      const ultimoFrame = info.posiciones - 1;
      if (e.key === ' ') {
        if (!reproduciendo && posicion >= ultimoFrame) setPosicion(0);
        setReproduciendo((r) => !r);
      } else if (e.key === 'ArrowLeft') {
        setReproduciendo(false);
        setPosicion((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        setReproduciendo(false);
        setPosicion((p) => Math.min(ultimoFrame, p + 1));
      } else {
        return;
      }
      e.preventDefault();
    };
  });
  useEffect(() => {
    const oyente = (e: KeyboardEvent): void => { alTecla.current(e); };
    window.addEventListener('keydown', oyente);
    return () => { window.removeEventListener('keydown', oyente); };
  }, []);

  if (info === null) {
    return (
      <main id={idPrincipal} tabIndex={-1} className="principal inicio modo-video">
        <div className="vacio">
          <div className="vacio-tarjeta">
            <div className="vacio-icono-aura" aria-hidden="true">
              <div className="aura-brillo" />
              <div className="icono-escudo-wrapper">
                <Film className="icono-escudo-svg" />
              </div>
            </div>
            <h1 className="vacio-titulo">Revisa un video antes de publicarlo</h1>
            <p className="vacio-subtitulo">En esta versión beta revisamos videos de hasta 15 segundos. Todo se procesa en tu computadora.</p>
            <p className="suave">Todavía no detectamos nada solos en video: tú eliges qué ocultar con un clic y lo seguimos en todo el video.</p>
            <div className="vacio-acciones">
              <button type="button" className="boton primario boton-destacado" disabled={ocupado !== null} onClick={() => { void abrir(); }}>
                <FolderOpen aria-hidden="true" /> {ocupado === 'abriendo' ? 'Abriendo…' : 'Abrir video'}
              </button>
              <span className="suave vacio-arrastrar">o arrastra un video a cualquier parte de la ventana</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const ocultas = pistas.filter((p) => p.oculta);
  const revisarTotal = ocultas.reduce((n, p) => n + p.framesRevisar, 0);
  const irA = [...new Set(ocultas.flatMap((p) => p.posicionesRevisar))].sort((a, b) => a - b);
  const todas = pistas.map((p) => p.id);
  const efectoComun = valorComun(pistas.map((p) => p.efecto));
  const intensidadComun = valorComun(pistas.map((p) => p.intensidad));
  const ultimo = info.posiciones - 1;
  const libre = ocupado === null;

  return (
    <div className="cuerpo cuerpo-video">
      <section className="lista-archivos ficha-video" aria-label="Video abierto">
        <div className="cabecera-seccion">
          <h2>Video</h2>
        </div>
        <div className="ficha">
          <span className="ficha-icono" aria-hidden="true"><Film /></span>
          <p className="nombre" title={info.nombre}>{info.nombre}</p>
          <dl className="datos-video">
            <div><dt>Tamaño</dt><dd>{info.ancho} × {info.alto} px</dd></div>
            <div><dt>Duración</dt><dd>{info.duracion.toFixed(2)} s</dd></div>
            <div><dt>Cuadros por segundo</dt><dd>{Math.round(info.fps)}</dd></div>
            <div><dt>Audio</dt><dd>{info.tieneAudio ? 'Sí, se conserva' : 'No tiene'}</dd></div>
          </dl>
        </div>
        {info.pistasSinRevisar > 0 && (
          <p className="suave">
            Este video trae {info.pistasSinRevisar} {info.pistasSinRevisar === 1 ? 'pista extra' : 'pistas extra'}, como subtítulos o datos de ubicación. No las revisamos y no se copian a la copia.
          </p>
        )}
        <p className="nota-beta"><strong>Beta:</strong> no detectamos nada solos. Haz clic sobre una persona u objeto y lo seguimos en todo el video.</p>
        <div className="pie-lista">
          <button type="button" className="boton" disabled={!libre} onClick={() => { void abrir(); }}>
            <FolderOpen aria-hidden="true" /> Abrir otro video
          </button>
        </div>
      </section>

      <main id={idPrincipal} tabIndex={-1} className="principal">
        <h1 className="titulo-foto">{info.nombre}</h1>
        {errorVista !== null && <p role="alert">No pudimos mostrar este frame. {errorVista}</p>}
        <figure className="visor visor-video">
          <div className="marco-visor">
            <div className="cinta" role="toolbar" aria-label="Herramientas del video">
              <div className="cinta-grupo" role="group" aria-label="Herramienta sobre el video">
                <button type="button" className="boton-cinta solo-icono" aria-label="Solo ver" title="Solo ver" aria-pressed={herramienta === 'ver'} disabled={comparando} onClick={() => { setHerramienta('ver'); }}>
                  <Hand aria-hidden="true" />
                </button>
                <button type="button" className="boton-cinta" aria-pressed={herramienta === 'seguir'} title="Haz clic en el video sobre lo que quieras ocultar" disabled={comparando} onClick={() => { setHerramienta('seguir'); }}>
                  <Crosshair aria-hidden="true" /><span className="texto-cinta">Seguir objeto</span>
                </button>
              </div>
              <span className="separador" aria-hidden="true" />
              <button type="button" className="boton-cinta solo-icono" aria-label="Comparar antes y después" title="Comparar antes y después" aria-pressed={comparando} onClick={() => { setComparando((c) => !c); }}>
                <SquareSplitHorizontal aria-hidden="true" />
              </button>
              <button type="button" className="boton-cinta primario" disabled={!libre} onClick={pedirExportar}>
                <Save aria-hidden="true" /><span className="texto-cinta">{ocupado === 'exportando' ? 'Guardando…' : 'Exportar copia'}</span>
              </button>
            </div>
            <div className="ventana-lienzo">
              {url === null ? (
                <p className="suave preparando">{ocupado === 'siguiendo' ? 'Siguiendo el objeto…' : 'Preparando la vista previa…'}</p>
              ) : (
                <div
                  ref={lienzo}
                  className={`lienzo${comparando ? ' comparando-video' : ''}${libre && herramienta === 'seguir' && !comparando ? ' herramienta-clic' : ''}`}
                  style={{ aspectRatio: `${info.proxyAncho} / ${info.proxyAlto}` }}
                  data-testid="lienzo-video"
                  onPointerUp={alSoltar}
                >
                  {comparando && urlOriginal !== null ? (
                    <div className="dos-lados">
                      <figure><img src={urlOriginal} draggable={false} alt={`Frame original en el segundo ${segundos(info, posicion)}, sin ocultar nada.`} /><figcaption className="rotulo antes">Original</figcaption></figure>
                      <figure><img src={url} draggable={false} alt={`Tu copia en el segundo ${segundos(info, posicion)}, con las zonas ocultas.`} /><figcaption className="rotulo despues">Tu copia</figcaption></figure>
                    </div>
                  ) : (
                    <img src={url} draggable={false} alt={`Frame en el segundo ${segundos(info, posicion)} de ${info.nombre}, con las zonas ocultas.`} />
                  )}
                  <p className={`aviso-frame-perdido${revisarFrame ? ' visible' : ''}`} role="status" aria-hidden={!revisarFrame}>
                    En este frame perdimos el objeto. Revisa que no aparezca, o que la zona oculta se vea bien.
                  </p>
                  {ocupado === 'siguiendo' && (
                    <div className="velo-ocupado" role="status">
                      <span className="girador" aria-hidden="true" />
                      <p><strong>Siguiendo el objeto…</strong> Tarda unos 2 minutos.</p>
                      <button type="button" className="boton" onClick={cancelarSeguimiento}>Cancelar</button>
                      <p className="suave">Si cancelas, el video se cerrará y tendrás que abrirlo de nuevo.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <figcaption className="suave">{info.ancho} × {info.alto} px · {info.duracion.toFixed(2)} s · {Math.round(info.fps)} fps{info.tieneAudio ? ' · con audio' : ' · sin audio'}</figcaption>
        </figure>

        <div className="transporte" role="group" aria-label="Recorrer el video">
          <button type="button" className="boton fantasma chico" aria-label="Frame anterior" title="Frame anterior" disabled={!libre || posicion === 0} onClick={() => { setReproduciendo(false); setPosicion((p) => Math.max(0, p - 1)); }}>
            <SkipBack aria-hidden="true" />
          </button>
          <button type="button" className="boton chico reproducir" aria-label={reproduciendo ? 'Pausar' : 'Reproducir'} disabled={!libre} onClick={() => {
            if (!reproduciendo && posicion >= ultimo) setPosicion(0);
            setReproduciendo((r) => !r);
          }}
          >
            {reproduciendo ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button type="button" className="boton fantasma chico" aria-label="Frame siguiente" title="Frame siguiente" disabled={!libre || posicion >= ultimo} onClick={() => { setReproduciendo(false); setPosicion((p) => Math.min(ultimo, p + 1)); }}>
            <SkipForward aria-hidden="true" />
          </button>
          <div className="campo-frame">
            <label htmlFor={`${id}-frame`}>
              Frame {posicion + 1} de {info.posiciones} (segundo {segundos(info, posicion)})
            </label>
            <div className="linea-tiempo">
              <input
                id={`${id}-frame`}
                type="range"
                min={0}
                max={ultimo}
                value={posicion}
                disabled={!libre}
                onChange={(e) => { setReproduciendo(false); setPosicion(Number(e.target.value)); }}
              />
              {/* Marcas de los frames para revisar, sobre la línea de tiempo. */}
              <div className="marcas-tiempo" aria-hidden="true">
                {irA.map((p) => <span key={p} style={{ left: `${ultimo === 0 ? 0 : (p / ultimo) * 100}%` }} />)}
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside className="panel" aria-label="Objetos a ocultar en el video">
        <section className={`resumen-foto ${revisarTotal > 0 ? 'veredicto-con_advertencias' : 'veredicto-leve'}`} aria-labelledby={`${id}-resumen`}>
          <h2 id={`${id}-resumen`}>{pistas.length === 0 ? 'Todavía no ocultas nada' : `${ocultas.length} de ${pistas.length} ${pistas.length === 1 ? 'objeto se oculta' : 'objetos se ocultan'}`}</h2>
          {pistas.length === 0 && <p className="suave">Haz clic sobre la imagen en lo que quieras ocultar. Lo seguimos en todo el video.</p>}
          {revisarTotal > 0 && <p className="pendiente">{revisarTotal} {revisarTotal === 1 ? 'frame para revisar' : 'frames para revisar'}: están marcados en la línea de tiempo.</p>}
        </section>

        {pistas.length > 1 && (
          <section className="estilo-global" aria-label="Para todos los objetos">
            <button type="button" className="desplegar" aria-expanded={estiloAbierto} aria-controls={`${id}-estilo`} onClick={() => { setEstiloAbierto(!estiloAbierto); }}>
              Estilo para todos los objetos
              <ChevronDown aria-hidden="true" className="flecha" />
            </button>
            {estiloAbierto && (
              <div id={`${id}-estilo`} className="panel-estilo">
                <SelectorEfecto valor={efectoComun} etiqueta="Efecto para todo" alCambiar={(efecto) => { cambiarPistas(todas, { efecto }); }} />
                <ControlIntensidad valor={intensidadComun} etiqueta="Intensidad del efecto" conAviso alCambiar={(v) => { cambiarPistas(todas, { intensidad: limitarIntensidad(v) }); }} />
              </div>
            )}
          </section>
        )}

        {pistas.length > 0 && (
          <ul className="grupos-riesgo">
            {pistas.map((p, i) => {
              const abierta = abiertas.has(p.id);
              const nombre = `el objeto ${i + 1}`;
              return (
                <li key={p.id} className="grupo-riesgo bajo">
                  <div className="grupo-cabecera">
                    <span className="grupo-icono" aria-hidden="true"><Crosshair /></span>
                    <div className="grupo-titulo">
                      <h3>Objeto {i + 1}</h3>
                      <div className="grupo-meta">
                        {p.framesRevisar > 0 ? <span className="pendiente">Revisa {p.framesRevisar} {p.framesRevisar === 1 ? 'frame' : 'frames'}</span> : <span className="suave">Seguido en todo el video</span>}
                      </div>
                    </div>
                    <button type="button" className="boton fantasma chico" aria-label={`Quitar ${nombre}`} title="Quitar este objeto" disabled={!libre} onClick={() => { quitar(p.id); }}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grupo-control">
                    <ControlDecision estado={p.oculta ? 'ocultar' : 'ignorar'} que={nombre} alDecidir={(d) => { cambiarPistas([p.id], { oculta: d === 'ocultar' }); }} />
                    <button type="button" className="desplegar chico" aria-expanded={abierta} onClick={() => {
                      setAbiertas((s) => {
                        const nuevo = new Set(s);
                        if (abierta) nuevo.delete(p.id);
                        else nuevo.add(p.id);
                        return nuevo;
                      });
                    }}
                    >
                      Personalizar<span className="solo-lector"> {nombre}</span>
                      <ChevronDown aria-hidden="true" className="flecha" />
                    </button>
                  </div>
                  {abierta && (
                    <div className="grupo-detalle">
                      <SelectorEfecto valor={p.efecto} etiqueta="Efecto" alCambiar={(efecto) => { cambiarPistas([p.id], { efecto }); }} />
                      {usaIntensidad(p.efecto) && (
                        <ControlIntensidad valor={p.intensidad} etiqueta="Intensidad" alCambiar={(v) => { cambiarPistas([p.id], { intensidad: limitarIntensidad(v) }); }} />
                      )}
                      {p.posicionesRevisar.length > 0 && (
                        <div className="grupo-acciones">
                          {p.posicionesRevisar.slice(0, MAX_IR_A).map((f) => (
                            <button key={f} type="button" className="boton chico-texto" disabled={!libre} onClick={() => { setReproduciendo(false); setPosicion(f); }}>
                              Frame {f + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {irA.length > 0 && (
          <section aria-labelledby={`${id}-revisar`} className="frames-revisar">
            <h2 id={`${id}-revisar`}>Frames para revisar</h2>
            <div className="grupo-acciones">
              {irA.slice(0, MAX_IR_A).map((p) => (
                <button key={p} type="button" className="boton chico-texto" aria-current={p === posicion ? 'true' : undefined} disabled={!libre} onClick={() => { setReproduciendo(false); setPosicion(p); }}>
                  Frame {p + 1}
                </button>
              ))}
            </div>
            {irA.length > MAX_IR_A && <p className="suave">Y {irA.length - MAX_IR_A} más: recórrelos con la línea de tiempo.</p>}
          </section>
        )}

        <details>
          <summary>Elegir con coordenadas (sin mouse)</summary>
          <form className="coordenadas" onSubmit={seguirEnCoordenadas}>
            <p className="suave">La vista mide {info.proxyAncho} × {info.proxyAlto} píxeles. El punto 0, 0 es la esquina superior izquierda. Se usa el frame que estás viendo.</p>
            <label>X<input type="text" inputMode="numeric" value={coordenadas.x} onChange={(e) => { setCoordenadas((c) => ({ ...c, x: e.target.value })); }} /></label>
            <label>Y<input type="text" inputMode="numeric" value={coordenadas.y} onChange={(e) => { setCoordenadas((c) => ({ ...c, y: e.target.value })); }} /></label>
            <button type="submit" className="boton" disabled={!libre}>
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
