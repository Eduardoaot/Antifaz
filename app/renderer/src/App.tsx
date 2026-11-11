import { Download, FolderOpen, Keyboard, Menu, PanelLeftOpen, PanelRightClose, PanelRightOpen, ScanEye, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoClaro from '../../../brand/logo/horizontal-claro.svg';
import logoOscuro from '../../../brand/logo/horizontal-oscuro.svg';
import { AVISO_LEGAL, MARCA, type Regla } from '../../shared/catalogo';
import {
  esquemaAvisoCierre,
  ERROR_INTERNO,
  LIMITES,
  PREFERENCIAS_COPIA_INICIALES,
  textoCierre,
  TITULO_CIERRE,
  type Ajustes,
  type Analisis,
  type ArchivoAbierto,
  type ArchivoCargado,
  type AvisoCierre,
  type ErrorApp,
  type Origen,
  type Punto,
  type Recuperable,
} from '../../shared/contrato';
import {
  aEdicion,
  agregarManual,
  ajustarSticker,
  aplicarCambio,
  aplicarDecisionesIniciales,
  construirOcultamientos,
  cubreTodo,
  desdeEdicion,
  deshacer,
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
import { Advertencias, EstiloGlobal, Resumen } from './Advertencias';
import { AnimacionInicio } from './AnimacionInicio';
import { DialogoAtajos } from './Atajos';
import { herramientaDeTecla } from './BarraHerramientas';
import { Cajon, type Vista } from './Cajon';
import { Configuracion } from './Configuracion';
import { Confirmacion, DialogoPorQue } from './Dialogos';
import { Guia } from './Guia';
import { guardarLocal, ListaFotos } from './ListaFotos';
import { Manual } from './Manual';
import { ModoVideo } from './ModoVideo';
import { esNombreDeVideo, SoltarAqui } from './SoltarAqui';
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

/** Lo que dice el aviso antes de exportar varias fotos. */
interface ResumenLote {
  listas: number;
  conPendientes: number;
  parciales: number;
  sinRevisar: number;
}

const api = (): typeof window.revisor => window.revisor;

const AJUSTES_INICIALES: Ajustes = { tema: 'sistema', copia: PREFERENCIAS_COPIA_INICIALES, carpeta: null };

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** Los ocultamientos de una foto revisada, con sus hallazgos en el mismo orden que ve la persona. */
function ocultamientosDe(a: Archivo): ReturnType<typeof construirOcultamientos> | null {
  if (a.estado.tipo !== 'listo') return null;
  return construirOcultamientos(a.historial.actual, ordenarHallazgos(a.estado.analisis.hallazgos));
}

function textoLote(r: ResumenLote): string {
  const partes = [`Vamos a guardar ${plural(r.listas, 'copia', 'copias')}.`];
  if (r.sinRevisar > 0) partes.push(`${plural(r.sinRevisar, 'foto no está revisada', 'fotos no están revisadas')}, así que no se exporta${r.sinRevisar === 1 ? '' : 'n'}.`);
  if (r.parciales > 0) partes.push(`${plural(r.parciales, 'foto no se revisó', 'fotos no se revisaron')} por completo y podría${r.parciales === 1 ? '' : 'n'} tener algo que no vimos.`);
  if (r.conPendientes > 0) partes.push(`${plural(r.conPendientes, 'foto tiene', 'fotos tienen')} advertencias sin decidir: lo que no marques para ocultar saldrá visible.`);
  partes.push('Tú decides.');
  return partes.join(' ');
}

export function App(): React.JSX.Element {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [elegido, setSeleccion] = useState<string | null>(null);
  const [fallos, setFallos] = useState<Fallo[]>([]);
  const [anuncio, setAnuncio] = useState('');
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_INICIALES);
  const [configurando, setConfigurando] = useState(false);
  const [viendoAtajos, setViendoAtajos] = useState(false);
  // Paneles laterales plegados, para dejarle todo el espacio a la imagen. Se recuerdan en este equipo.
  const [plegados, setPlegados] = useState<{ fotos: boolean; panel: boolean }>(() => {
    try {
      return { fotos: localStorage.getItem('plegar-fotos') === '1', panel: localStorage.getItem('plegar-panel') === '1' };
    } catch {
      return { fotos: false, panel: false };
    }
  });
  const plegar = (cual: 'fotos' | 'panel', valor: boolean): void => {
    setPlegados((p) => ({ ...p, [cual]: valor }));
    guardarLocal(`plegar-${cual}`, valor ? '1' : '0');
  };
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [progresoLote, setProgresoLote] = useState<{ hechas: number; total: number; carpeta: string } | null>(null);
  const [confirmarExport, setConfirmarExport] = useState<{ faltan: number; parcial: boolean } | null>(null);
  const [confirmarLote, setConfirmarLote] = useState<ResumenLote | null>(null);
  const [recuperables, setRecuperables] = useState<Recuperable[]>([]);
  // Hasta resolverlo no se guarda nada, para no borrar la recuperación que se está ofreciendo.
  const [recuperacionResuelta, setRecuperacionResuelta] = useState(false);
  const exportandoAhora = useRef(false);
  const [vista, setVista] = useState<Vista>('revision');
  const [herramienta, setHerramienta] = useState<Herramienta>('ninguna');
  const [buscando, setBuscando] = useState(false);
  const [tamanoPincel, setTamanoPincel] = useState<number>(LIMITES.pincel.porDefecto);
  const [zonaTotal, setZonaTotal] = useState<ZonaNueva | null>(null);
  const [avisoCierre, setAvisoCierre] = useState<AvisoCierre | null>(null);
  const [porQue, setPorQue] = useState<Regla | null>(null);
  // Un video soltado, o pedir el selector desde el menú (archivo null).
  const [pedidoVideo, setPedidoVideo] = useState<{ archivo: File | null; vez: number } | null>(null);
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
  const listasParaExportar = archivos.filter((a) => a.estado.tipo === 'listo').length;

  const actualizar = useCallback((id: string, cambio: (a: Archivo) => Archivo) => {
    setArchivos((lista) => lista.map((a) => (a.info.id === id ? cambio(a) : a)));
  }, []);

  const fallar = useCallback((nombre: string, mensaje: string) => {
    setFallos((f) => [...f, { clave: crypto.randomUUID(), nombre, mensaje }]);
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
    setVista('revision');
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
        fallar(actual.info.nombre, resultado.error.mensaje);
        setAnuncio(`No se guardó. ${resultado.error.mensaje}`);
      } else if (resultado.datos !== null) {
        const { nombre, zonasOcultas, carpeta } = resultado.datos;
        actualizar(actual.info.id, (a) => ({ ...a, exportado: true }));
        const donde = carpeta === null ? '' : ` en la carpeta ${carpeta}`;
        setAnuncio(`Guardamos ${nombre}${donde} sin metadatos, con ${zonasOcultas} ${zonasOcultas === 1 ? 'zona oculta' : 'zonas ocultas'}.`);
      }
    } catch {
      fallar(actual.info.nombre, ERROR_INTERNO.mensaje);
      setAnuncio(`No se guardó. ${ERROR_INTERNO.mensaje}`);
    } finally {
      exportandoAhora.current = false;
      setExportando(false);
    }
  }, [actual, actualizar, fallar, ocultamientos]);

  const pedirExportar = useCallback(() => {
    if (actual === null || revision === null || analisis === null || exportando) return;
    const faltan = pendientes(revision, hallazgos).length;
    const parcial = !analisis.cobertura.completa;
    if (faltan > 0 || parcial) setConfirmarExport({ faltan, parcial });
    else void exportarAhora();
  }, [actual, analisis, exportando, exportarAhora, hallazgos, revision]);

  /** Exporta todas las fotos revisadas a una sola carpeta, de una en una, diciendo cuántas van. */
  const exportarLoteAhora = useCallback(async () => {
    setConfirmarLote(null);
    if (exportandoAhora.current) return;
    // Lo que se exporta es lo decidido en este momento: mientras tanto no se puede cambiar nada.
    const fotos = archivos.filter((a) => a.estado.tipo === 'listo');
    if (fotos.length === 0) return;
    exportandoAhora.current = true;
    setExportando(true);
    try {
      const lote = await api().prepararLote();
      if (!lote.ok) {
        fallar('Exportar todas', lote.error.mensaje);
        return;
      }
      if (lote.datos === null) return;
      const { loteId, carpeta } = lote.datos;
      let guardadas = 0;
      let hechas = 0;
      setProgresoLote({ hechas, total: fotos.length, carpeta });
      for (const foto of fotos) {
        const lista = ocultamientosDe(foto);
        if (lista !== null) {
          const resultado = await api().exportarEnLote(loteId, foto.info.id, lista).catch(() => ({ ok: false, error: ERROR_INTERNO }) as const);
          if (resultado.ok) {
            guardadas += 1;
            actualizar(foto.info.id, (a) => ({ ...a, exportado: true }));
          } else {
            fallar(foto.info.nombre, resultado.error.mensaje);
          }
        }
        hechas += 1;
        setProgresoLote({ hechas, total: fotos.length, carpeta });
      }
      const fallidas = fotos.length - guardadas;
      setAnuncio(
        `Guardamos ${plural(guardadas, 'copia', 'copias')} sin metadatos en la carpeta ${carpeta}.${fallidas > 0 ? ` ${plural(fallidas, 'no se guardó', 'no se guardaron')}: revisa los avisos.` : ''}`,
      );
    } finally {
      exportandoAhora.current = false;
      setExportando(false);
      setProgresoLote(null);
    }
  }, [actualizar, archivos, fallar]);

  const pedirExportarTodas = useCallback(() => {
    if (exportando) return;
    const listas = archivos.filter((a) => a.estado.tipo === 'listo');
    if (listas.length === 0) {
      setAnuncio('Todavía no hay fotos revisadas para exportar.');
      return;
    }
    const resumen: ResumenLote = {
      listas: listas.length,
      sinRevisar: archivos.length - listas.length,
      parciales: listas.filter((a) => a.estado.tipo === 'listo' && !a.estado.analisis.cobertura.completa).length,
      conPendientes: listas.filter((a) => a.estado.tipo === 'listo' && pendientes(a.historial.actual, a.estado.analisis.hallazgos).length > 0).length,
    };
    // Siempre se confirma: son varias fotos y se dice cuántas y a dónde van.
    setConfirmarLote(resumen);
  }, [archivos, exportando]);

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
          const texto = trazoLleno(puntos)
            ? 'Tu trazo era muy largo, así que solo tomamos la primera parte. Pinta otro trazo para tapar el resto.'
            : 'Agregamos tu trazo para ocultarlo. Revisa la vista previa.';
          pedirZona({ archivoId: id, caja, mascaraId, origen: 'pincel', anuncio: texto });
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
    void api().obtenerAjustes().then(setAjustes);
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

  const abrirVideo = useCallback(() => {
    setVista('video');
    setPedidoVideo({ archivo: null, vez: Date.now() });
  }, []);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent): void => {
      const objetivo = e.target;
      const hayDialogo = document.querySelector('dialog[open]') !== null;
      if (e.key === 'F1' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        if (!hayDialogo) setViendoAtajos(true);
        return;
      }
      const enCampo = objetivo instanceof HTMLInputElement || objetivo instanceof HTMLSelectElement || objetivo instanceof HTMLTextAreaElement;
      // Las herramientas con una letra, como en un editor de fotos. Nunca mientras se escribe.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !enCampo && vista === 'revision' && analisis !== null && !exportando) {
        const h = herramientaDeTecla(e.key);
        if (h !== null && document.querySelector('dialog[open]') === null) {
          e.preventDefault();
          setHerramienta(h);
          return;
        }
      }
      if (!e.ctrlKey || e.altKey) return;
      const tecla = e.key.toLowerCase();
      const enTexto = objetivo instanceof HTMLInputElement && (objetivo.type === 'text' || objetivo.type === 'search');
      // Con un diálogo abierto, los atajos no deben abrir otro encima.
      if (hayDialogo && tecla !== 'z' && tecla !== 'y') return;
      if (tecla === 'o') {
        e.preventDefault();
        if (e.shiftKey) abrirVideo();
        else void abrir();
      } else if (tecla === '1' || tecla === '2' || tecla === '3') {
        e.preventDefault();
        setVista(tecla === '1' ? 'revision' : tecla === '2' ? 'video' : 'guia');
      } else if (tecla === ',') {
        e.preventDefault();
        setConfigurando(true);
      } else if (tecla === 'e' && vista === 'revision') {
        // En video, Ctrl E lo atiende el modo de video.
        e.preventDefault();
        if (e.shiftKey) pedirExportarTodas();
        else pedirExportar();
      } else if (vista !== 'revision') {
        return;
      } else if (!enTexto && tecla === 'z' && !e.shiftKey) {
        e.preventDefault();
        moverHistorial(deshacer, 'Se deshizo el último cambio.');
      } else if (!enTexto && (tecla === 'y' || (tecla === 'z' && e.shiftKey))) {
        e.preventDefault();
        moverHistorial(rehacer, 'Se rehizo el cambio.');
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => {
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abrir, abrirVideo, analisis, exportando, moverHistorial, pedirExportar, pedirExportarTodas, vista]);

  /** Se puede soltar en cualquier parte: las fotos van a revisión y un video, al modo de video. */
  const alSoltarArchivos = (soltados: File[]): void => {
    const videos = soltados.filter((f) => esNombreDeVideo(f.name));
    const fotos = soltados.filter((f) => !esNombreDeVideo(f.name));
    const [video] = videos;
    if (video !== undefined) {
      setPedidoVideo({ archivo: video, vez: Date.now() });
      if (videos.length > 1) setAnuncio('Abrimos solo el primer video: en esta versión se revisa uno a la vez.');
    }
    if (fotos.length > 0) {
      setVista('revision');
      void api().soltarArchivos(fotos).then(incorporar);
      if (video !== undefined) setAnuncio('Abrimos tus fotos. El video está en Video, en el menú.');
    } else if (video !== undefined) {
      setVista('video');
    }
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
  const conFotos = archivos.length > 0;
  const titulos: Record<Vista, string> = { revision: 'Fotos', video: 'Video', guia: 'Guía de privacidad' };

  return (
    <div className="app">
      <AnimacionInicio />
      <SoltarAqui alSoltar={alSoltarArchivos} />
      <a className="saltar" href="#principal">Saltar al contenido</a>
      <header className="cabecera">
        <div className="identidad">
          <button
            type="button"
            className="boton fantasma boton-menu"
            aria-label="Menú"
            aria-expanded={menuAbierto}
            aria-haspopup="dialog"
            onClick={() => { setMenuAbierto(true); }}
          >
            <Menu aria-hidden="true" />
          </button>
          <picture>
            <source srcSet={logoOscuro} media="(prefers-color-scheme: dark)" />
            <img className="logo" src={logoClaro} alt={MARCA.nombre} />
          </picture>
          <p className="eslogan">{MARCA.eslogan}</p>
        </div>
        <p className="seccion-actual" aria-hidden="true">{titulos[vista]}</p>
      </header>

      <Cajon
        abierto={menuAbierto}
        vista={vista}
        listasParaExportar={listasParaExportar}
        alCerrar={() => { setMenuAbierto(false); }}
        alElegirVista={setVista}
        alAbrirFotos={() => { void abrir(); }}
        alAbrirVideo={abrirVideo}
        alExportarTodas={pedirExportarTodas}
        alConfigurar={() => { setConfigurando(true); }}
        alVerAtajos={() => { setViendoAtajos(true); }}
      />

      <div role="status" aria-live="polite" className="anuncio" data-testid="anuncio">{anuncio}</div>

      {fallos.length > 0 && (
        <ul className="fallos" aria-label="Archivos con problemas">
          {fallos.map((f) => (
            <li key={f.clave}>
              <span role="alert"><strong>{f.nombre}:</strong> {f.mensaje}</span>
              <button type="button" className="boton fantasma chico" aria-label={`Cerrar el aviso de ${f.nombre}`} onClick={() => { setFallos((l) => l.filter((x) => x.clave !== f.clave)); }}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {progresoLote !== null && (
        <div className="progreso-lote" role="status">
          <p>Guardando en <strong>{progresoLote.carpeta}</strong>: {progresoLote.hechas} de {progresoLote.total}</p>
          <div className="barra-avance" aria-hidden="true"><span style={{ width: `${(progresoLote.hechas / progresoLote.total) * 100}%` }} /></div>
        </div>
      )}

      {/* El modo de video queda montado mientras se usan fotos: así no se pierde lo que se siguió. */}
      <div hidden={vista !== 'video'} className="contenedor-video">
        <ModoVideo activo={vista === 'video'} alAnunciar={setAnuncio} alFallar={fallar} pedido={pedidoVideo} />
      </div>
      {vista === 'video' ? null : vista === 'guia' ? <Guia /> : !conFotos ? (
        <main id="principal" tabIndex={-1} className="principal inicio">
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
                <span className="suave vacio-arrastrar">o arrastra fotos o un video a cualquier parte de la ventana</span>
              </div>

              <ol className="pasos-inicio" aria-label="Así funciona">
                <li>
                  <span className="paso-icono" aria-hidden="true"><FolderOpen /></span>
                  <strong>Abre</strong>
                  <span className="suave">fotos o un video</span>
                </li>
                <li>
                  <span className="paso-icono" aria-hidden="true"><ScanEye /></span>
                  <strong>Revisa</strong>
                  <span className="suave">tú decides qué tapar</span>
                </li>
                <li>
                  <span className="paso-icono" aria-hidden="true"><Download /></span>
                  <strong>Exporta</strong>
                  <span className="suave">una copia limpia</span>
                </li>
              </ol>
              <p className="pista-atajos suave">
                <Keyboard aria-hidden="true" /> Pulsa <kbd>F1</kbd> para ver los atajos de teclado.
              </p>
            </div>
          </div>
        </main>
      ) : (
        <div className={`cuerpo${plegados.fotos ? ' fotos-plegadas' : ''}${plegados.panel ? ' panel-plegado' : ''}`}>
          {plegados.fotos ? (
            <button type="button" className="riel" aria-label={`Mostrar la lista de fotos (${archivos.length})`} title="Mostrar la lista de fotos" onClick={() => { plegar('fotos', false); }}>
              <PanelLeftOpen aria-hidden="true" />
              <span className="chip-conteo">{archivos.length}</span>
            </button>
          ) : (
          <ListaFotos
            alPlegar={() => { plegar('fotos', true); }}
            archivos={archivos}
            seleccion={seleccion}
            analizando={analizando}
            listasParaExportar={listasParaExportar}
            exportando={exportando}
            alElegir={setSeleccion}
            alCerrar={cerrarArchivo}
            alAbrir={() => { void abrir(); }}
            alCancelar={cancelar}
            alExportarTodas={pedirExportarTodas}
          />
          )}

          <main id="principal" tabIndex={-1} className="principal">
            {actual === null ? (
              <p className="suave">Elige una foto de la lista.</p>
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
                  alCambiar={(cambio) => { cambiarRevision(actual.info.id, cambio); }}
                  alQuitarManual={(id) => { cambiarRevision(actual.info.id, (r) => quitarManual(r, id)); setAnuncio('Quitamos tu zona.'); }}
                  alPorQue={setPorQue}
                  barra={{
                    puedeDeshacer: actual.historial.pasado.length > 0,
                    puedeRehacer: actual.historial.futuro.length > 0,
                    alDeshacer: () => { moverHistorial(deshacer, 'Se deshizo el último cambio.'); },
                    alRehacer: () => { moverHistorial(rehacer, 'Se rehizo el cambio.'); },
                    herramienta,
                    herramientasActivas: analisis !== null && !exportando,
                    alElegirHerramienta: setHerramienta,
                    tamanoPincel,
                    alCambiarTamano: setTamanoPincel,
                    exportando,
                    puedeExportar: analisis !== null,
                    alExportar: pedirExportar,
                  }}
                  seleccionSticker={sticker}
                  alSeleccionarSticker={setSticker}
                  alAjustarSticker={(h, cambio) => { cambiarRevision(actual.info.id, (r) => ajustarSticker(r, h, cambio)); }}
                />
              </>
            )}
          </main>

          {plegados.panel ? (
            <button type="button" className="riel" aria-label="Mostrar el panel de advertencias" title="Mostrar el panel de advertencias" onClick={() => { plegar('panel', false); }}>
              <PanelRightOpen aria-hidden="true" />
            </button>
          ) : (
          <aside className="panel" aria-label="Advertencias">
            <div className="panel-barra">
              <span className="panel-titulo">Revisión</span>
              <button type="button" className="boton fantasma chico" aria-label="Ocultar el panel de advertencias" title="Ocultar el panel" onClick={() => { plegar('panel', true); }}>
                <PanelRightClose aria-hidden="true" />
              </button>
            </div>
            {actual?.estado.tipo === 'en_cola' && <p className="estado-panel">Esta foto está en espera de revisión.</p>}
            {actual?.estado.tipo === 'analizando' && <p className="estado-panel"><span className="girador" aria-hidden="true" /> Revisando esta foto…</p>}
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
                <Resumen analisis={analisis} revision={revision} texto={resumenTexto(actual.info.nombre, analisis, revision)} />
                <fieldset className="sin-marco" disabled={exportando} aria-label="Decisiones sobre esta foto">
                  <EstiloGlobal
                    hallazgos={hallazgos}
                    revision={revision}
                    alCambiar={(cambio) => { cambiarRevision(actual.info.id, cambio); }}
                    alOcultarTodo={() => { cambiarRevision(actual.info.id, (r) => ocultarTodo(r, hallazgos)); setAnuncio('Marcamos para ocultar todo lo detectado.'); }}
                    alOcultarAlto={() => { cambiarRevision(actual.info.id, (r) => ocultarRiesgoAlto(r, hallazgos)); setAnuncio('Marcamos para ocultar lo de riesgo alto.'); }}
                  />
                  <Advertencias
                    key={actual.info.id}
                    hallazgos={hallazgos}
                    revision={revision}
                    alCambiar={(cambio) => { cambiarRevision(actual.info.id, cambio); }}
                    resaltado={resaltado}
                    alResaltar={setResaltado}
                    seleccionSticker={sticker}
                    alSeleccionarSticker={setSticker}
                  />
                  <Manual
                    key={`manual-${actual.info.id}`}
                    ancho={actual.info.ancho}
                    alto={actual.info.alto}
                    revision={revision}
                    ocupado={buscando}
                    alAgregarCaja={pedirCaja}
                    alBuscarEnPunto={(x, y) => { void buscarEnPunto(x, y); }}
                    alQuitar={(id) => { cambiarRevision(actual.info.id, (r) => quitarManual(r, id)); setAnuncio('Quitamos tu zona.'); }}
                    resaltado={resaltado}
                    alResaltar={setResaltado}
                    seleccionSticker={sticker}
                    alSeleccionarSticker={setSticker}
                    alCambiarRevision={(cambio) => { cambiarRevision(actual.info.id, cambio); }}
                  />
                </fieldset>
              </>
            )}
          </aside>
          )}
        </div>
      )}

      <footer className="pie"><p>{AVISO_LEGAL}</p></footer>

      {configurando && (
        <Configuracion
          ajustes={ajustes}
          alCambiarTema={(tema) => {
            setAjustes((a) => ({ ...a, tema }));
            void api().definirTema(tema);
          }}
          alCambiarCopia={(copia) => {
            setAjustes((a) => ({ ...a, copia }));
            void api().definirCopia(copia).then(setAjustes);
          }}
          alElegirCarpeta={() => { void api().elegirCarpeta().then(setAjustes); }}
          alCerrar={() => { setConfigurando(false); }}
        />
      )}
      {porQue !== null && <DialogoPorQue regla={porQue} alCerrar={() => { setPorQue(null); }} />}
      {viendoAtajos && <DialogoAtajos alCerrar={() => { setViendoAtajos(false); }} />}
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
      {confirmarLote !== null && (
        <Confirmacion
          titulo="Exportar todas"
          texto={`${textoLote(confirmarLote)} ${ajustes.copia.destino === 'carpeta' && ajustes.carpeta !== null ? `Van a tu carpeta ${ajustes.carpeta}.` : 'Después eliges la carpeta.'}`}
          aceptar={`Exportar ${plural(confirmarLote.listas, 'copia', 'copias')}`}
          cancelar="Volver a revisar"
          alAceptar={() => { void exportarLoteAhora(); }}
          alCancelar={() => { setConfirmarLote(null); }}
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
