import {
  BookOpen,
  Car,
  CheckCircle2,
  CreditCard,
  Film,
  FolderOpen,
  IdCard,
  Image as IconoFoto,
  Lock,
  MapPin,
  QrCode,
  Redo2,
  Save,
  Shield,
  ShieldCheck,
  Sparkles,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import logoClaro from '../../../brand/logo/horizontal-claro.svg';
import logoOscuro from '../../../brand/logo/horizontal-oscuro.svg';
import { AVISO_LEGAL, MARCA } from '../../shared/catalogo';
import { esquemaAvisoCierre, esquemaTema, ERROR_INTERNO, LIMITES, textoCierre, TITULO_CIERRE, type AvisoCierre, type Analisis, type ArchivoAbierto, type ArchivoCargado, type ErrorApp, type Origen, type Punto, type Recuperable, type Tema } from '../../shared/contrato';
import {
  aEdicion,
  agregarManual,
  ajustarSticker,
  aplicarCambio,
  aplicarDecisionesIniciales,
  construirOcultamientos,
  contarAdvertencias,
  cubreTodo,
  desdeEdicion,
  deshacer,
  efectoDeManual,
  hayCambios,
  nuevoHistorial,
  ocultarRiesgoAlto,
  ordenarHallazgos,
  ocultarTodo,
  pendientes,
  quitarManual,
  rehacer,
  resumenTexto,
  textoConfirmacion,
  trazoLleno,
  type Caja,
  type Herramienta,
  type Historial,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import { Advertencias, Cobertura } from './Advertencias';
import { AnimacionInicio } from './AnimacionInicio';
import { Confirmacion } from './Dialogos';
import { Guia } from './Guia';
import { Manual } from './Manual';
import { ModoVideo } from './ModoVideo';
import { irAFila } from './resaltar';
import { Visor } from './Visor';

export type EstadoAnalisis =
  | { tipo: 'en_cola' }
  | { tipo: 'analizando' }
  | { tipo: 'error'; error: ErrorApp }
  | { tipo: 'listo'; analisis: Analisis };

export interface Archivo {
  info: ArchivoAbierto;
  estado: EstadoAnalisis;
  historial: Historial;
  exportado: boolean;
}

interface Fallo {
  clave: string;
  nombre: string;
  mensaje: string;
}

/** Zona que la persona pidió agregar y que puede requerir confirmación si tapa todo. */
interface ZonaNueva {
  archivoId: string;
  caja: Caja;
  mascaraId: string | null;
  origen: Origen;
  anuncio: string;
}

const api = (): typeof window.revisor => window.revisor;

export function App(): React.JSX.Element {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [elegido, setSeleccion] = useState<string | null>(null);
  const [fallos, setFallos] = useState<Fallo[]>([]);
  const [anuncio, setAnuncio] = useState('');
  const [tema, setTema] = useState<Tema>('sistema');
  const [exportando, setExportando] = useState(false);
  const [confirmarExport, setConfirmarExport] = useState<{ faltan: number; parcial: boolean } | null>(null);
  const [recuperables, setRecuperables] = useState<Recuperable[]>([]);
  // Hasta resolverlo no se guarda nada, para no borrar la recuperación que se está ofreciendo.
  const [recuperacionResuelta, setRecuperacionResuelta] = useState(false);
  const exportandoAhora = useRef(false);
  const [vista, setVista] = useState<'revision' | 'guia' | 'video'>('revision');
  const [herramienta, setHerramienta] = useState<Herramienta>('ninguna');
  const [buscando, setBuscando] = useState(false);
  const [tamanoPincel, setTamanoPincel] = useState<number>(LIMITES.pincel.porDefecto);
  const [zonaTotal, setZonaTotal] = useState<ZonaNueva | null>(null);
  const [avisoCierre, setAvisoCierre] = useState<AvisoCierre | null>(null);
  // Zona resaltada a la vez en la imagen y en el panel. Solo es visual: no cambia ninguna decisión.
  // Se guarda con su foto, porque los ids de zona ("cara-0") se repiten entre fotos.
  const [resaltadoDe, setResaltadoDe] = useState<{ archivoId: string | null; resaltado: Resaltado | null }>({ archivoId: null, resaltado: null });
  const colaOcupada = useRef(false);
  const seleccion = elegido ?? archivos[0]?.info.id ?? null;
  const resaltado = resaltadoDe.archivoId === seleccion ? resaltadoDe.resaltado : null;
  const setResaltado = useCallback((r: Resaltado | null): void => { setResaltadoDe({ archivoId: seleccion, resaltado: r }); }, [seleccion]);
  // Sticker de una cara elegido para ajustarlo, el mismo en la foto y en el panel. Con su foto, como el resaltado.
  const [stickerDe, setStickerDe] = useState<{ archivoId: string | null; id: string | null }>({ archivoId: null, id: null });
  const sticker = stickerDe.archivoId === seleccion ? stickerDe.id : null;
  const setSticker = useCallback((id: string | null): void => { setStickerDe({ archivoId: seleccion, id }); }, [seleccion]);

  const actual = useMemo(() => archivos.find((a) => a.info.id === seleccion) ?? null, [archivos, seleccion]);
  const analisis = actual?.estado.tipo === 'listo' ? actual.estado.analisis : null;
  const hallazgos = useMemo(() => ordenarHallazgos(analisis?.hallazgos ?? []), [analisis]);
  const revision = actual?.historial.actual ?? null;
  const ocultamientos = useMemo(
    () => (revision === null ? [] : construirOcultamientos(revision, hallazgos)),
    [revision, hallazgos],
  );

  const actualizar = useCallback((id: string, cambio: (a: Archivo) => Archivo) => {
    setArchivos((lista) => lista.map((a) => (a.info.id === id ? cambio(a) : a)));
  }, []);

  /** Analiza de uno en uno: el sidecar atiende en serie y así no se congela la interfaz. */
  const procesarCola = useCallback(async () => {
    if (colaOcupada.current) return;
    colaOcupada.current = true;
    try {
      for (;;) {
        const siguiente = await new Promise<Archivo | undefined>((resolver) => {
          setArchivos((lista) => {
            resolver(lista.find((a) => a.estado.tipo === 'en_cola'));
            return lista;
          });
        });
        if (siguiente === undefined) return;
        const { id, nombre } = siguiente.info;
        actualizar(id, (a) => ({ ...a, estado: { tipo: 'analizando' } }));
        setAnuncio(`Analizando ${nombre}.`);
        // Una falla aquí no debe dejar la foto en "Revisando…" ni detener a las demás.
        const resultado = await api().analizar(id).catch(() => ({ ok: false, error: ERROR_INTERNO }) as const);
        if (resultado.ok) {
          // No gasta un paso del historial: deshacer no debe destapar lo que la app marcó sola.
          actualizar(id, (a) => ({
            ...a,
            estado: { tipo: 'listo', analisis: resultado.datos },
            historial: { ...a.historial, actual: aplicarDecisionesIniciales(a.historial.actual, resultado.datos.hallazgos) },
          }));
          setAnuncio(resumenTexto(nombre, resultado.datos, siguiente.historial.actual));
        } else {
          actualizar(id, (a) => ({ ...a, estado: { tipo: 'error', error: resultado.error } }));
          setAnuncio(`${nombre}: no se revisó. ${resultado.error.mensaje}`);
        }
      }
    } finally {
      colaOcupada.current = false;
    }
  }, [actualizar]);

  const incorporar = useCallback(
    (resultados: ArchivoCargado[]) => {
      const nuevos: Archivo[] = [];
      const errores: Fallo[] = [];
      const repetidos: string[] = [];
      for (const r of resultados) {
        if (!r.ok) errores.push({ clave: crypto.randomUUID(), nombre: r.nombre, mensaje: r.error.mensaje });
        else if (r.archivo.duplicado) repetidos.push(r.archivo.nombre);
        else nuevos.push({ info: r.archivo, estado: { tipo: 'en_cola' }, historial: nuevoHistorial(), exportado: false });
      }
      if (errores.length > 0) setFallos((f) => [...f, ...errores]);
      if (nuevos.length > 0) {
        setArchivos((lista) => [...lista, ...nuevos]);
        setSeleccion((s) => s ?? nuevos[0]?.info.id ?? null);
        void procesarCola();
      }
      const partes: string[] = [];
      if (nuevos.length > 0) partes.push(`${nuevos.length} ${nuevos.length === 1 ? 'foto cargada' : 'fotos cargadas'}.`);
      if (repetidos.length > 0) partes.push(`Ya tenías abierta: ${repetidos.join(', ')}.`);
      if (errores.length > 0) partes.push(`${errores.length} no se pudo abrir.`);
      if (partes.length > 0) setAnuncio(partes.join(' '));
    },
    [procesarCola],
  );

  const abrir = useCallback(async () => {
    incorporar(await api().seleccionarArchivos());
  }, [incorporar]);

  const cambiarRevision = useCallback(
    (id: string, cambio: (r: Revision) => Revision) => {
      if (exportandoAhora.current) return;
      actualizar(id, (a) => ({ ...a, exportado: false, historial: aplicarCambio(a.historial, cambio(a.historial.actual)) }));
    },
    [actualizar],
  );

  const moverHistorial = useCallback(
    (paso: (h: Historial) => Historial, texto: string) => {
      if (seleccion === null || exportandoAhora.current) return;
      setArchivos((lista) =>
        lista.map((a) => {
          if (a.info.id !== seleccion) return a;
          const siguiente = paso(a.historial);
          return siguiente === a.historial ? a : { ...a, exportado: false, historial: siguiente };
        }),
      );
      setAnuncio(texto);
    },
    [seleccion],
  );

  const exportarAhora = useCallback(async () => {
    if (actual === null || exportandoAhora.current) return;
    setConfirmarExport(null);
    // Las decisiones quedan fijas: lo que se guarda es exactamente lo que se ve como decidido.
    exportandoAhora.current = true;
    setExportando(true);
    try {
      const resultado = await api().exportar(actual.info.id, ocultamientos);
      if (!resultado.ok) {
        setFallos((f) => [...f, { clave: crypto.randomUUID(), nombre: actual.info.nombre, mensaje: resultado.error.mensaje }]);
        setAnuncio(`No se guardó. ${resultado.error.mensaje}`);
      } else if (resultado.datos !== null) {
        const { nombre, zonasOcultas } = resultado.datos;
        actualizar(actual.info.id, (a) => ({ ...a, exportado: true }));
        setAnuncio(`Guardamos ${nombre} sin metadatos, con ${zonasOcultas} ${zonasOcultas === 1 ? 'zona oculta' : 'zonas ocultas'}.`);
      }
    } catch {
      setFallos((f) => [...f, { clave: crypto.randomUUID(), nombre: actual.info.nombre, mensaje: ERROR_INTERNO.mensaje }]);
      setAnuncio(`No se guardó. ${ERROR_INTERNO.mensaje}`);
    } finally {
      exportandoAhora.current = false;
      setExportando(false);
    }
  }, [actual, actualizar, ocultamientos]);

  const pedirExportar = useCallback(() => {
    if (actual === null || revision === null || analisis === null || exportando) return;
    const faltan = pendientes(revision, hallazgos).length;
    const parcial = !analisis.cobertura.completa;
    if (faltan > 0 || parcial) setConfirmarExport({ faltan, parcial });
    else void exportarAhora();
  }, [actual, analisis, exportando, exportarAhora, hallazgos, revision]);

  const agregarZona = useCallback(
    (z: ZonaNueva) => {
      cambiarRevision(z.archivoId, (r) => agregarManual(r, crypto.randomUUID(), z.caja, z.mascaraId, z.origen));
      setAnuncio(z.anuncio);
    },
    [cambiarRevision],
  );

  /** Una zona que tapa toda la foto se confirma antes, sin importar cómo se hizo. */
  const pedirZona = useCallback(
    (z: ZonaNueva) => {
      const archivo = archivos.find((a) => a.info.id === z.archivoId);
      if (archivo === undefined) return;
      if (cubreTodo(z.caja, archivo.info.ancho, archivo.info.alto)) setZonaTotal(z);
      else agregarZona(z);
    },
    [agregarZona, archivos],
  );

  const pedirCaja = useCallback(
    (caja: Caja) => {
      if (actual === null) return;
      pedirZona({ archivoId: actual.info.id, caja, mascaraId: null, origen: 'rectangulo', anuncio: 'Agregamos tu zona para ocultarla.' });
    },
    [actual, pedirZona],
  );

  const buscarEnPunto = useCallback(
    async (x: number, y: number) => {
      if (actual === null) return;
      if (buscando) {
        setAnuncio('Espera a que terminemos con tu selección anterior.');
        return;
      }
      const { id } = actual.info;
      setBuscando(true);
      setAnuncio('Buscando el objeto en ese punto. La primera vez tarda unos segundos.');
      try {
        const resultado = await api().segmentar(id, x, y);
        if (resultado.ok) {
          const { caja, mascara_id: mascaraId } = resultado.datos;
          pedirZona({ archivoId: id, caja, mascaraId, origen: 'silueta', anuncio: 'Seleccionamos ese objeto para ocultarlo. Revisa la vista previa.' });
        } else {
          setAnuncio(resultado.error.mensaje);
        }
      } catch {
        setAnuncio(ERROR_INTERNO.mensaje);
      } finally {
        setBuscando(false);
      }
    },
    [actual, buscando, pedirZona],
  );

  const pintar = useCallback(
    async (puntos: Punto[]) => {
      if (actual === null) return;
      if (buscando) {
        setAnuncio('Espera a que terminemos con tu selección anterior. Ese trazo no se agregó.');
        return;
      }
      const { id } = actual.info;
      setBuscando(true);
      try {
        const resultado = await api().pintar(id, puntos, tamanoPincel);
        if (resultado.ok) {
          const { caja, mascara_id: mascaraId } = resultado.datos;
          // Nada se recorta en silencio: si el trazo llegó al límite, se dice.
          const anuncio = trazoLleno(puntos)
            ? 'Tu trazo era muy largo, así que solo tomamos la primera parte. Pinta otro trazo para tapar el resto.'
            : 'Agregamos tu trazo para ocultarlo. Revisa la vista previa.';
          pedirZona({ archivoId: id, caja, mascaraId, origen: 'pincel', anuncio });
        } else {
          setAnuncio(resultado.error.mensaje);
        }
      } catch {
        setAnuncio(ERROR_INTERNO.mensaje);
      } finally {
        setBuscando(false);
      }
    },
    [actual, buscando, pedirZona, tamanoPincel],
  );

  const cerrarArchivo = useCallback((id: string) => {
    if (exportandoAhora.current) return;
    void api().cerrar(id);
    setArchivos((lista) => lista.filter((a) => a.info.id !== id));
    setSeleccion((s) => (s === id ? null : s));
    // El botón que tenía el foco ya no existe.
    document.getElementById('principal')?.focus();
  }, []);

  // Guarda solo ediciones, para recuperarlas tras un cierre de golpe.
  useEffect(() => {
    if (!recuperacionResuelta) return undefined;
    const espera = setTimeout(() => {
      void api().guardarEdiciones(
        archivos
          .filter((a) => hayCambios(a.historial.actual) && !a.exportado)
          .map((a) => aEdicion(a.info.id, a.historial.actual)),
      );
    }, 300);
    return () => {
      clearTimeout(espera);
    };
  }, [archivos, recuperacionResuelta]);

  // Main avisa cuando se quiere cerrar con cambios sin exportar; la decisión se toma aquí.
  useEffect(
    () =>
      api().alPedirCierre((aviso) => {
        const valido = esquemaAvisoCierre.safeParse(aviso);
        // Si el aviso no es válido, se dice lo más prudente: que las decisiones podrían perderse.
        setAvisoCierre(valido.success ? valido.data : { recuperacionSegura: false });
      }),
    [],
  );

  useEffect(() => {
    void api().obtenerTema().then(setTema);
    void api().recuperar().then(({ recuperables: lista, descartadas }) => {
      setRecuperables(lista);
      if (lista.length === 0) setRecuperacionResuelta(true);
      if (descartadas.length > 0) {
        setFallos((f) => [
          ...f,
          ...descartadas.map((nombre) => ({
            clave: crypto.randomUUID(),
            nombre,
            mensaje: 'Esta foto cambió o ya no está, así que no aplicamos tus decisiones anteriores.',
          })),
        ]);
      }
    });
  }, []);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return;
      const tecla = e.key.toLowerCase();
      const enCampo = e.target instanceof HTMLInputElement && e.target.type === 'text';
      if (tecla === 'o') {
        e.preventDefault();
        void abrir();
      } else if (tecla === 'e') {
        e.preventDefault();
        pedirExportar();
      } else if (!enCampo && tecla === 'z' && !e.shiftKey) {
        e.preventDefault();
        moverHistorial(deshacer, 'Se deshizo el último cambio.');
      } else if (!enCampo && (tecla === 'y' || (tecla === 'z' && e.shiftKey))) {
        e.preventDefault();
        moverHistorial(rehacer, 'Se rehizo el cambio.');
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => {
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abrir, moverHistorial, pedirExportar]);

  const alSoltar = (e: DragEvent): void => {
    e.preventDefault();
    const soltados = [...e.dataTransfer.files];
    if (soltados.length > 0) void api().soltarArchivos(soltados).then(incorporar);
  };

  const aplicarRecuperacion = (): void => {
    const nuevos: Archivo[] = recuperables.map(({ archivo, edicion }) => ({
      info: archivo,
      estado: { tipo: 'en_cola' },
      historial: nuevoHistorial(desdeEdicion(edicion)),
      exportado: false,
    }));
    setRecuperables([]);
    setRecuperacionResuelta(true);
    setArchivos((lista) => [...lista, ...nuevos]);
    void procesarCola();
    setAnuncio('Recuperamos tus decisiones. Volvemos a revisar cada foto.');
  };

  const descartarRecuperacion = (): void => {
    for (const { archivo } of recuperables) void api().cerrar(archivo.id);
    setRecuperables([]);
    setRecuperacionResuelta(true);
    void api().descartarRecuperacion();
  };

  const cancelar = (): void => {
    // Nada de la cola se marca como revisado: cada foto pendiente queda con su error.
    setArchivos((lista) =>
      lista.map((a) =>
        a.estado.tipo === 'en_cola'
          ? { ...a, estado: { tipo: 'error', error: { codigo: 'CANCELADO', mensaje: 'Cancelaste la revisión de esta foto, así que no está revisada.' } } }
          : a,
      ),
    );
    void api().cancelar();
  };

  const reintentar = (id: string): void => {
    actualizar(id, (a) => ({ ...a, estado: { tipo: 'en_cola' } }));
    void procesarCola();
  };

  const analizando = archivos.some((a) => a.estado.tipo === 'analizando' || a.estado.tipo === 'en_cola');
  const fallar = useCallback((nombre: string, mensaje: string) => {
    setFallos((f) => [...f, { clave: crypto.randomUUID(), nombre, mensaje }]);
  }, []);
  const enFotos = vista === 'revision';

  return (
    <div className="app" onDragOver={(e) => { e.preventDefault(); }} onDrop={alSoltar}>
      <AnimacionInicio />
      <a className="saltar" href="#principal">Saltar al contenido</a>
      <header className="cabecera">
        <div className="identidad">
          <picture>
            <source srcSet={logoOscuro} media="(prefers-color-scheme: dark)" />
            <img className="logo" src={logoClaro} alt={MARCA.nombre} />
          </picture>
          <p className="eslogan">{MARCA.eslogan}</p>
        </div>
        {/* Una sola acción principal a la vista: Exportar. Abrir es secundaria; la pantalla vacía tiene la suya. */}
        <div className="acciones">
          {enFotos ? (
            <button type="button" className="boton" onClick={() => { void abrir(); }}>
              <FolderOpen aria-hidden="true" /> Abrir fotos
            </button>
          ) : (
            <button type="button" className="boton" onClick={() => { setVista('revision'); }}>
              <IconoFoto aria-hidden="true" /> Fotos
            </button>
          )}
          <button type="button" className="boton fantasma" aria-pressed={vista === 'video'} onClick={() => { setVista((v) => (v === 'video' ? 'revision' : 'video')); }}>
            <Film aria-hidden="true" /> Video
          </button>
          <button type="button" className="boton fantasma" aria-pressed={vista === 'guia'} onClick={() => { setVista((v) => (v === 'guia' ? 'revision' : 'guia')); }}>
            <BookOpen aria-hidden="true" /> Guía de privacidad
          </button>
          {enFotos && (<>
          <span className="separador" aria-hidden="true" />
          <button type="button" className="boton fantasma" disabled={!actual || exportando || actual.historial.pasado.length === 0} onClick={() => { moverHistorial(deshacer, 'Se deshizo el último cambio.'); }}>
            <Undo2 aria-hidden="true" /> Deshacer
          </button>
          <button type="button" className="boton fantasma" disabled={!actual || exportando || actual.historial.futuro.length === 0} onClick={() => { moverHistorial(rehacer, 'Se rehizo el cambio.'); }}>
            <Redo2 aria-hidden="true" /> Rehacer
          </button>
          <button type="button" className="boton primario" disabled={analisis === null || exportando} onClick={pedirExportar}>
            <Save aria-hidden="true" /> {exportando ? 'Guardando…' : 'Exportar copia'}
          </button>
          </>)}
          <span className="separador" aria-hidden="true" />
          <label className="campo-tema">
            Tema
            <select
              value={tema}
              onChange={(e) => {
                const valor = esquemaTema.parse(e.target.value);
                setTema(valor);
                void api().definirTema(valor);
              }}
            >
              <option value="sistema">Como el sistema</option>
              <option value="claro">Claro</option>
              <option value="oscuro">Oscuro</option>
            </select>
          </label>
        </div>
      </header>

      <div role="status" aria-live="polite" className="anuncio" data-testid="anuncio">{anuncio}</div>

      {fallos.length > 0 && (
        <ul className="fallos" aria-label="Archivos con problemas">
          {fallos.map((f) => (
            <li key={f.clave}>
              <span role="alert"><strong>{f.nombre}:</strong> {f.mensaje}</span>
              <button type="button" className="boton chico" aria-label={`Cerrar el aviso de ${f.nombre}`} onClick={() => { setFallos((l) => l.filter((x) => x.clave !== f.clave)); }}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* El modo de video queda montado mientras se usan fotos: así no se pierde lo que se siguió. */}
      <div hidden={vista !== 'video'}>
        <ModoVideo activo={vista === 'video'} alAnunciar={setAnuncio} alFallar={fallar} />
      </div>
      {vista === 'video' ? null : vista === 'guia' ? <Guia /> : (
      <div className="cuerpo">
        <nav className="lista-archivos" aria-label="Fotos abiertas">
          <div className="cabecera-seccion">
            <h2>Fotos</h2>
            {archivos.length > 0 && <span className="chip-conteo">{archivos.length}</span>}
          </div>
          {archivos.length === 0 ? (
            <div className="tarjeta-vacia-lateral">
              <IconoFoto className="icono-lateral-vacio" aria-hidden="true" />
              <p className="suave">Abre una foto o arrástrala aquí.</p>
            </div>
          ) : (
            <ul>
              {archivos.map((a) => (
                <li key={a.info.id} className={a.info.id === seleccion ? 'activo' : ''}>
                  <button type="button" className="archivo" aria-current={a.info.id === seleccion ? 'true' : undefined} onClick={() => { setSeleccion(a.info.id); }}>
                    <span className="nombre">{a.info.nombre}</span>
                    <span className="suave estado">{textoEstado(a)}</span>
                  </button>
                  <button type="button" className="boton chico" aria-label={`Cerrar ${a.info.nombre}`} onClick={() => { cerrarArchivo(a.info.id); }}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {analizando && <button type="button" className="boton" onClick={cancelar}>Cancelar revisión</button>}
        </nav>

        <main id="principal" tabIndex={-1} className="principal">
          {actual === null ? (
            <div className="vacio">
              <div className="vacio-tarjeta">
                <div className="vacio-icono-aura" aria-hidden="true">
                  <div className="aura-brillo" />
                  <div className="icono-escudo-wrapper">
                    <ShieldCheck className="icono-escudo-svg" />
                  </div>
                </div>
                <h1 className="vacio-titulo">Revisa tus fotos antes de publicarlas</h1>
                <p className="vacio-subtitulo">Todo se analiza en tu computadora. Ninguna foto sale de aquí.</p>

                <div className="vacio-acciones">
                  <button type="button" className="boton primario boton-destacado" onClick={() => { void abrir(); }}>
                    <FolderOpen aria-hidden="true" /> Abrir fotos
                  </button>
                  <span className="suave vacio-arrastrar">o arrastra tus fotos a esta ventana</span>
                </div>

                <div className="caracteristicas-grid" aria-label="Garantías de privacidad">
                  <div className="caracteristica-tarjeta">
                    <div className="caracteristica-icono-caja">
                      <Lock aria-hidden="true" />
                    </div>
                    <div>
                      <strong>100% Local</strong>
                      <p className="suave">Sin nubes ni rastreo externo</p>
                    </div>
                  </div>
                  <div className="caracteristica-tarjeta">
                    <div className="caracteristica-icono-caja">
                      <Sparkles aria-hidden="true" />
                    </div>
                    <div>
                      <strong>Detección local</strong>
                      <p className="suave">Caras, identificaciones y texto</p>
                    </div>
                  </div>
                  <div className="caracteristica-tarjeta">
                    <div className="caracteristica-icono-caja">
                      <CheckCircle2 aria-hidden="true" />
                    </div>
                    <div>
                      <strong>Copia limpia</strong>
                      <p className="suave">Sin metadatos EXIF ni GPS</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <h1 className="titulo-foto">{actual.info.nombre}</h1>
              <Visor
                key={actual.info.id}
                archivo={actual}
                hallazgos={hallazgos}
                ocultamientos={ocultamientos}
                revision={revision}
                herramienta={analisis === null || exportando ? 'ninguna' : herramienta}
                tamanoPincel={tamanoPincel}
                alClic={(x, y) => { void buscarEnPunto(x, y); }}
                alDibujar={pedirCaja}
                alPintar={(puntos) => { void pintar(puntos); }}
                alFuera={() => { setAnuncio('Ese punto queda fuera de la imagen.'); }}
                resaltado={resaltado}
                alResaltar={setResaltado}
                alElegirZona={irAFila}
                seleccionSticker={sticker}
                alSeleccionarSticker={setSticker}
                alAjustarSticker={(h, cambio) => { cambiarRevision(actual.info.id, (r) => ajustarSticker(r, h, cambio)); }}
              />
            </>
          )}
        </main>

        <aside className="panel" aria-label="Advertencias">
          {actual === null && (
            <div className="panel-vacio-card">
              <div className="cabecera-seccion">
                <h2>Advertencias</h2>
              </div>
              <div className="panel-vacio-contenido">
                <div className="panel-vacio-icono-caja" aria-hidden="true">
                  <Shield />
                </div>
                <p className="suave">
                  Abre o selecciona una foto para ver las advertencias detectadas y decidir qué zonas ocultar antes de publicar.
                </p>
                <div className="pilas-categorias-info" aria-hidden="true">
                  <span className="pildora-cat"><Users /> Caras y menores</span>
                  <span className="pildora-cat"><MapPin /> Ubicación GPS</span>
                  <span className="pildora-cat"><IdCard /> Documentos</span>
                  <span className="pildora-cat"><CreditCard /> Tarjetas</span>
                  <span className="pildora-cat"><Car /> Matrículas</span>
                  <span className="pildora-cat"><QrCode /> Códigos QR</span>
                </div>
              </div>
            </div>
          )}
          {actual?.estado.tipo === 'en_cola' && <p>Esta foto está en espera de revisión.</p>}
          {actual?.estado.tipo === 'analizando' && <p>Revisando esta foto…</p>}
          {actual?.estado.tipo === 'error' && (
            <div className="caja-parcial">
              <h2>Esta foto no está revisada</h2>
              <p>{actual.estado.error.mensaje}</p>
              <p className="suave">Para exportar una copia, primero hay que revisar la foto.</p>
              <button type="button" className="boton" onClick={() => { reintentar(actual.info.id); }}>Revisar de nuevo</button>
            </div>
          )}
          {actual !== null && analisis !== null && revision !== null && (
            <>
              <Cobertura analisis={analisis} />
              <fieldset className="sin-marco" disabled={exportando} aria-label="Decisiones sobre esta foto">
              <Advertencias
                key={actual.info.id}
                hallazgos={hallazgos}
                revision={revision}
                alCambiar={(cambio) => { cambiarRevision(actual.info.id, cambio); }}
                alOcultarTodo={() => { cambiarRevision(actual.info.id, (r) => ocultarTodo(r, hallazgos)); setAnuncio('Marcamos para ocultar todo lo detectado.'); }}
                alOcultarAlto={() => { cambiarRevision(actual.info.id, (r) => ocultarRiesgoAlto(r, hallazgos)); setAnuncio('Marcamos para ocultar lo de riesgo alto.'); }}
                resaltado={resaltado}
                alResaltar={setResaltado}
                seleccionSticker={sticker}
                alSeleccionarSticker={setSticker}
              />
              <Manual
                key={`manual-${actual.info.id}`}
                ancho={actual.info.ancho}
                alto={actual.info.alto}
                herramienta={herramienta}
                tamanoPincel={tamanoPincel}
                revision={revision}
                ocupado={buscando}
                alElegirHerramienta={setHerramienta}
                alCambiarTamano={setTamanoPincel}
                alAgregarCaja={pedirCaja}
                alBuscarEnPunto={(x, y) => { void buscarEnPunto(x, y); }}
                alQuitar={(id) => { cambiarRevision(actual.info.id, (r) => quitarManual(r, id)); setAnuncio('Quitamos tu zona.'); }}
                alCambiarEfecto={(id, efecto) => { cambiarRevision(actual.info.id, (r) => efectoDeManual(r, id, efecto)); }}
                resaltado={resaltado}
                alResaltar={setResaltado}
              />
              </fieldset>
              <section aria-labelledby="titulo-resumen" className="resumen">
                <h2 id="titulo-resumen">Resumen en texto</h2>
                <p data-testid="resumen">{resumenTexto(actual.info.nombre, analisis, revision)}</p>
              </section>
            </>
          )}
        </aside>
      </div>
      )}

      <footer className="pie"><p>{AVISO_LEGAL}</p></footer>

      {confirmarExport !== null && (
        <Confirmacion
          titulo="Antes de exportar"
          texto={textoConfirmacion(confirmarExport.faltan, confirmarExport.parcial)}
          aceptar="Exportar de todos modos"
          cancelar="Volver a revisar"
          alAceptar={() => { void exportarAhora(); }}
          alCancelar={() => { setConfirmarExport(null); }}
        />
      )}
      {zonaTotal !== null && (
        <Confirmacion
          titulo="Esta zona cubre toda la imagen"
          texto="Si la agregas, no se verá nada de la foto. ¿Quieres hacerlo?"
          aceptar="Agregar de todos modos"
          cancelar="Volver"
          alAceptar={() => { agregarZona(zonaTotal); setZonaTotal(null); }}
          alCancelar={() => { setZonaTotal(null); setAnuncio('No agregamos esa zona.'); }}
        />
      )}
      {avisoCierre !== null && (
        <Confirmacion
          titulo={TITULO_CIERRE}
          texto={textoCierre(avisoCierre.recuperacionSegura)}
          aceptar="Cerrar de todos modos"
          cancelar="Seguir revisando"
          alAceptar={() => { setAvisoCierre(null); void api().confirmarCierre(); }}
          alCancelar={() => { setAvisoCierre(null); }}
        />
      )}
      {recuperables.length > 0 && (
        <Confirmacion
          titulo="Tienes una revisión sin terminar"
          texto={`La app se cerró antes de exportar ${recuperables.length} ${recuperables.length === 1 ? 'foto' : 'fotos'}. ¿Quieres recuperar tus decisiones?`}
          aceptar="Recuperar"
          cancelar="Descartar"
          alAceptar={aplicarRecuperacion}
          alCancelar={descartarRecuperacion}
        />
      )}
    </div>
  );
}

function textoEstado(a: Archivo): string {
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
