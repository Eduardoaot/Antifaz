/** Proceso principal. Es el único con acceso al sistema; el renderer solo usa la API de contrato.ts. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, parse, relative, resolve, sep } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, session, shell } from 'electron';
import { z } from 'zod';
import { MARCA, urlsDeFuentes } from '../shared/catalogo';
import { CANALES } from '../shared/canales';
import {
  ERROR_INTERNO,
  ERROR_VALIDACION,
  LIMITES,
  esquemaAnalisis,
  esquemaArchivoId,
  esquemaCoordenadaProxy,
  esquemaEdiciones,
  esquemaExportado,
  esquemaListaOcultamientos,
  esquemaListaPistas,
  esquemaPosicion,
  esquemaPreferenciasCopia,
  esquemaSegmentado,
  esquemaSeguido,
  esquemaVideoExportado,
  esquemaTrazo,
  esquemaTema,
  PREFERENCIAS_COPIA_INICIALES,
  textoCierre,
  TITULO_CIERRE,
  type Ajustes,
  type ArchivoCargado,
  type AvisoCierre,
  type Edicion,
  type Exportado,
  type PreferenciasCopia,
  type Recuperacion,
  type Resultado,
  type Tema,
} from '../shared/contrato';
import { extensionCopia, nombreCopia, nombreLibre } from '../shared/exportacion';
import { Archivos, planearLote } from './archivos';
import { Sidecar } from './sidecar';
import { esVideo, EXTENSIONES_VIDEO, Videos } from './videos';

const ESQUEMA_APP = 'app';
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

protocol.registerSchemesAsPrivileged([
  { scheme: ESQUEMA_APP, privileges: { standard: true, secure: true, supportFetchAPI: false } },
]);

// Permite aislar los datos en pruebas.
const datosPrueba = process.env.REVISOR_DATOS;
if (datosPrueba !== undefined && datosPrueba !== '') app.setPath('userData', datosPrueba);
app.setName(MARCA.nombre);

const raiz = app.getAppPath();
const carpetaLogs = join(app.getPath('userData'), 'logs');

/** Nunca recibe rutas, nombres de archivo ni texto de la imagen. */
function registrar(mensaje: string): void {
  try {
    mkdirSync(carpetaLogs, { recursive: true });
    appendFileSync(join(carpetaLogs, 'app.log'), `${new Date().toISOString()} ${mensaje}\n`);
  } catch (e) {
    // Sin log no hay dónde anotarlo; se avisa por consola sin datos personales.
    console.error('No se pudo escribir el log', e instanceof Error ? e.name : 'desconocido');
  }
}

let ventana: BrowserWindow | null = null;
let hayCambios = false;
let confirmoCierre = false;
/** Main pidió confirmar el cierre y el renderer aún no contesta. Sin esto, nadie puede cerrar desde la UI. */
let cierrePendiente = false;
let rendererResponde = true;

const ejecutablePython = process.platform === 'win32'
  ? join(raiz, 'sidecar', '.venv', 'Scripts', 'python.exe')
  : join(raiz, 'sidecar', '.venv', 'bin', 'python');

const sidecar = new Sidecar({
  ejecutable: ejecutablePython,
  argumentos: ['-m', 'revisor', '--modelos', join(raiz, 'sidecar', 'modelos'), '--logs', carpetaLogs],
  cwd: join(raiz, 'sidecar'),
  registrar,
  alCaer: () => {
    archivos.alReiniciarSidecar();
    videos.alReiniciarSidecar();
  },
});
const archivos = new Archivos((comando) => sidecar.pedir(comando));
const videos = new Videos((comando) => sidecar.pedir(comando));
/** Seguir un objeto tarda unos 2 minutos en el equipo de referencia; exportar, menos. Con holgura. */
const LIMITE_SEGUIR_MS = 15 * 60 * 1000;
const LIMITE_EXPORTAR_VIDEO_MS = 60 * 60 * 1000;

const rutaAjustes = (): string => join(app.getPath('userData'), 'ajustes.json');
const rutaRecuperacion = (): string => join(app.getPath('userData'), 'recuperacion.json');

/** Lo que se guarda en ajustes.json. La carpeta es una ruta: nunca sale de main. */
interface AjustesGuardados {
  tema: Tema;
  copia: PreferenciasCopia;
  carpeta: string | null;
}

const AJUSTES_INICIALES: AjustesGuardados = { tema: 'sistema', copia: PREFERENCIAS_COPIA_INICIALES, carpeta: null };

const esquemaAjustesGuardados = z.object({
  tema: esquemaTema.catch('sistema'),
  copia: esquemaPreferenciasCopia.catch(PREFERENCIAS_COPIA_INICIALES),
  carpeta: z.string().min(1).max(32767).nullable().catch(null),
});

/** Cada parte inválida vuelve a su valor inicial sin borrar las demás. */
function leerAjustes(): AjustesGuardados {
  if (!existsSync(rutaAjustes())) return AJUSTES_INICIALES;
  try {
    const crudo: unknown = JSON.parse(readFileSync(rutaAjustes(), 'utf-8'));
    const leido = esquemaAjustesGuardados.parse(typeof crudo === 'object' && crudo !== null ? crudo : {});
    return { tema: leido.tema, copia: leido.copia, carpeta: leido.carpeta };
  } catch (e) {
    registrar(`Ajustes inválidos: ${e instanceof Error ? e.name : 'desconocido'}`);
    return AJUSTES_INICIALES;
  }
}

function guardarAjustes(cambio: Partial<AjustesGuardados>): AjustesGuardados {
  const nuevos = { ...leerAjustes(), ...cambio };
  writeFileSync(rutaAjustes(), JSON.stringify(nuevos));
  return nuevos;
}

const leerTema = (): Tema => leerAjustes().tema;

/** La carpeta de los ajustes, solo si todavía existe. */
function carpetaVigente(ajustes: AjustesGuardados): string | null {
  const { carpeta } = ajustes;
  if (carpeta === null) return null;
  try {
    return statSync(carpeta).isDirectory() ? carpeta : null;
  } catch (e) {
    registrar(`La carpeta de copias ya no está: ${e instanceof Error ? e.name : 'desconocido'}`);
    return null;
  }
}

const nombreCarpeta = (carpeta: string): string => basename(carpeta) || carpeta;

/** Lo que ve el renderer: el nombre de la carpeta, nunca su ruta. */
function ajustesVisibles(ajustes: AjustesGuardados): Ajustes {
  const carpeta = carpetaVigente(ajustes);
  return { tema: ajustes.tema, copia: ajustes.copia, carpeta: carpeta === null ? null : nombreCarpeta(carpeta) };
}

/** Carpetas de los lotes en curso, por id opaco. Se olvidan al cerrar la app. */
const lotes = new Map<string, string>();

/**
 * Diálogos de abrir sin ventana dueña. Si se pasan con `ventana`, Windows los hace
 * modales y desactiva la app: una extensión del Explorador colgada (miniaturas de
 * video, OneDrive, segundo monitor en una presentación) termina en AppHangXProc y
 * Windows cierra Electron. Sin dueña la ventana sigue respondiendo.
 */
async function elegirConDialogo(opciones: Electron.OpenDialogOptions): Promise<string[]> {
  const elegido = await dialog.showOpenDialog(opciones);
  ventana?.focus();
  return elegido.canceled ? [] : elegido.filePaths;
}

/**
 * Carpeta local para el selector de video. El picker moderno de Windows suele ignorar
 * defaultPath y reabrir Descargas (OneDrive/miniaturas → «Trabajando en ello…»).
 */
function carpetaInicialVideo(): string {
  const carpeta = join(app.getPath('userData'), 'elegir-video');
  try {
    mkdirSync(carpeta, { recursive: true });
    return carpeta;
  } catch {
    return app.getPath('videos');
  }
}

/**
 * Selector clásico de WinForms (AutoUpgradeEnabled=$false): no usa el picker moderno
 * que se cuelga listando Descargas. Corre en PowerShell -STA, aparte de Electron.
 */
function elegirVideoWindows(): Promise<string | null> {
  const carpeta = carpetaInicialVideo().replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.OpenFileDialog",
    "$d.Title = 'Elige el video que quieres revisar'",
    `$d.InitialDirectory = '${carpeta}'`,
    "$d.RestoreDirectory = $false",
    "$d.AutoUpgradeEnabled = $false",
    "$d.Filter = 'Videos|*.mp4;*.mov;*.m4v;*.webm;*.mkv'",
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
  ].join('; ');
  return new Promise((resolver) => {
    const proceso = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: false },
    );
    let salida = '';
    const limite = setTimeout(() => {
      registrar('El selector de video superó el tiempo y se cerró');
      proceso.kill();
    }, 3 * 60 * 1000);
    proceso.stdout.on('data', (bloque: Buffer) => {
      salida += bloque.toString('utf8');
    });
    proceso.on('error', () => {
      clearTimeout(limite);
      resolver(null);
    });
    proceso.on('exit', () => {
      clearTimeout(limite);
      const ruta = salida.trim();
      resolver(ruta === '' ? null : ruta);
      ventana?.focus();
    });
  });
}

async function pedirCarpeta(titulo: string): Promise<string | null> {
  if (ventana === null) return null;
  const rutas = await elegirConDialogo({ title: titulo, properties: ['openDirectory', 'createDirectory'] });
  return rutas[0] ?? null;
}

const SIN_NOMBRE_LIBRE = {
  ok: false,
  error: {
    codigo: 'SIN_NOMBRE_LIBRE',
    mensaje: 'Ya hay demasiadas copias con ese nombre en la carpeta. Elige otra carpeta o cambia el nombre de las copias.',
  },
} as const;

function aplicarTema(tema: Tema): void {
  switch (tema) {
    case 'sistema':
      nativeTheme.themeSource = 'system';
      return;
    case 'claro':
      nativeTheme.themeSource = 'light';
      return;
    case 'oscuro':
      nativeTheme.themeSource = 'dark';
      return;
    default: {
      const inalcanzable: never = tema;
      throw new Error(`Tema desconocido: ${String(inalcanzable)}`);
    }
  }
}

const esquemaGuardado = z.array(
  z.strictObject({ ruta: z.string().min(1), huella: z.string().min(1), edicion: z.unknown() }),
);
const SIN_RECUPERACION: Recuperacion = { recuperables: [], descartadas: [] };
/** Falso si el último guardado falló: al cerrar no se puede prometer que se recuperará. */
let recuperacionSegura = true;
let colaGuardado: Promise<void> = Promise.resolve();

async function recuperar(): Promise<Recuperacion> {
  if (!existsSync(rutaRecuperacion())) return SIN_RECUPERACION;
  try {
    // Va cifrado con la cuenta de Windows, porque guarda rutas y nombres de archivo.
    const { result } = await safeStorage.decryptStringAsync(readFileSync(rutaRecuperacion()));
    const guardado = esquemaGuardado.parse(JSON.parse(result));
    const salida: Recuperacion = { recuperables: [], descartadas: [] };
    for (const { ruta, huella, edicion } of guardado) {
      const cargado = await archivos.abrir(ruta);
      if (!cargado.ok) {
        salida.descartadas.push(cargado.nombre);
        continue;
      }
      const validada = esquemaEdiciones.element.safeParse({ ...(edicion as object), archivoId: cargado.archivo.id });
      // Las decisiones solo valen para los mismos bytes: en otra foto dejarían caras visibles.
      if (validada.success && archivos.huella(cargado.archivo.id) === huella) {
        salida.recuperables.push({ archivo: cargado.archivo, edicion: validada.data });
      } else {
        await archivos.cerrar(cargado.archivo.id);
        salida.descartadas.push(cargado.archivo.nombre);
      }
    }
    return salida;
  } catch (e) {
    registrar(`Recuperación ilegible: ${e instanceof Error ? e.name : 'desconocido'}`);
    return SIN_RECUPERACION;
  }
}

async function guardarEdiciones(ediciones: Edicion[]): Promise<void> {
  const conRuta = ediciones.flatMap((edicion) => {
    const ruta = archivos.ruta(edicion.archivoId);
    const huella = archivos.huella(edicion.archivoId);
    return ruta === undefined || huella === undefined ? [] : [{ ruta, huella, edicion }];
  });
  hayCambios = conRuta.length > 0;
  try {
    if (conRuta.length === 0) {
      rmSync(rutaRecuperacion(), { force: true });
    } else {
      // Con renombrado atómico, un cierre a la mitad nunca deja una recuperación dañada.
      const temporal = `${rutaRecuperacion()}.tmp`;
      writeFileSync(temporal, await safeStorage.encryptStringAsync(JSON.stringify(conRuta)));
      renameSync(temporal, rutaRecuperacion());
    }
    recuperacionSegura = true;
  } catch (e) {
    recuperacionSegura = false;
    registrar(`No se pudo guardar la recuperación: ${e instanceof Error ? e.name : 'desconocido'}`);
  }
}

const NOMBRES_IMAGEN = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'gif', 'tif', 'tiff', 'bmp', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw'];

/** Si no caben todas, tú decides: se abren las primeras o ninguna. Las que no entran se dicen. */
async function abrirRutas(rutas: string[]): Promise<ArchivoCargado[]> {
  const lugares = LIMITES.loteArchivos - archivos.cantidad;
  const plan = planearLote(rutas, (r) => archivos.estaAbierta(r), lugares);
  if (plan.sobran > 0 && plan.nuevas > 0 && ventana !== null) {
    const { response } = await dialog.showMessageBox(ventana, {
      type: 'question',
      title: 'No caben todas las fotos',
      message: `Elegiste ${plan.nuevas + plan.sobran} fotos, pero solo caben ${plan.nuevas} más.`,
      detail: `Puedes tener hasta ${LIMITES.loteArchivos} fotos abiertas a la vez. Si sigues, abrimos las primeras ${plan.nuevas} y te decimos cuántas quedaron fuera.`,
      buttons: [`Abrir las primeras ${plan.nuevas}`, 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return [];
  }
  const salida: ArchivoCargado[] = [];
  for (const ruta of plan.abrir) {
    if (existsSync(ruta) && statSync(ruta).isDirectory()) {
      salida.push({
        ok: false,
        nombre: basename(ruta),
        error: { codigo: 'ES_CARPETA', mensaje: 'Esto es una carpeta. Abre las fotos que quieres revisar.' },
      });
      continue;
    }
    if (esVideo(ruta)) {
      salida.push({
        ok: false,
        nombre: basename(ruta),
        error: { codigo: 'ES_VIDEO', mensaje: 'Esto es un video. Arrástralo solo o ábrelo desde el menú, en Video.' },
      });
      continue;
    }
    salida.push(await archivos.abrir(ruta));
  }
  if (plan.sobran > 0) {
    // Un solo aviso para todas: cientos de avisos iguales no ayudan a nadie.
    salida.push({
      ok: false,
      nombre: `${plan.sobran} ${plan.sobran === 1 ? 'foto más' : 'fotos más'}`,
      error: {
        codigo: 'LOTE_LLENO',
        mensaje: `No se abrieron: puedes tener hasta ${LIMITES.loteArchivos} fotos abiertas a la vez. Cierra algunas y vuelve a abrirlas.`,
      },
    });
  }
  return salida;
}

function validar<T>(esquema: z.ZodType<T>, valor: unknown): T | null {
  const r = esquema.safeParse(valor);
  if (!r.success) registrar('Se rechazó una solicitud inválida del renderer');
  return r.success ? r.data : null;
}

const invalido = { ok: false, error: ERROR_VALIDACION } as const;
const FALLO = { ok: false, error: ERROR_INTERNO } as const;

/** Escribe la copia en la carpeta con un nombre libre: en una carpeta nunca se sobrescribe sin preguntar. */
async function exportarEnCarpeta(archivoId: string, ocultamientos: unknown[], carpeta: string): Promise<Resultado<Exportado>> {
  const original = archivos.ruta(archivoId);
  const formato = archivos.formato(archivoId);
  if (original === undefined || formato === undefined) return invalido;
  const { copia } = leerAjustes();
  const deseado = nombreCopia(parse(original).name, copia.sufijo, extensionCopia(copia.formato, formato));
  const nombre = nombreLibre(deseado, (n) => existsSync(join(carpeta, n)));
  if (nombre === null) return SIN_NOMBRE_LIBRE;
  const sidecarId = await archivos.sidecarId(archivoId);
  if (!sidecarId.ok) return sidecarId;
  const { resultado } = await sidecar.pedir({
    tipo: 'exportar',
    imagen_id: sidecarId.datos,
    ocultamientos,
    ruta_destino: join(carpeta, nombre),
    sobrescribir: false,
  });
  if (!resultado.ok) return resultado;
  const exportado = esquemaExportado.parse(resultado.datos);
  return { ok: true, datos: { nombre, zonasOcultas: exportado.zonas_ocultas, carpeta: nombreCarpeta(carpeta) } };
}

/**
 * Toda excepción termina aquí. Si llegara al renderer, Electron le mostraría su texto,
 * y este puede incluir rutas. Solo se registra el tipo.
 */
function manejar<T>(canal: string, respaldo: T, atender: (...argumentos: never[]) => Promise<T> | T): void {
  ipcMain.handle(canal, async (_evento, ...argumentos: unknown[]) => {
    try {
      return await atender(...(argumentos as never[]));
    } catch (e) {
      registrar(`Falló ${canal}: ${e instanceof Error ? e.name : 'desconocido'}`);
      return respaldo;
    }
  });
}

function registrarCanales(): void {
  manejar(CANALES.seleccionar, [], async (): Promise<ArchivoCargado[]> => {
    if (ventana === null) return [];
    const rutas = await elegirConDialogo({
      title: 'Elige las fotos que quieres revisar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: NOMBRES_IMAGEN }, { name: 'Todos los archivos', extensions: ['*'] }],
    });
    return rutas.length === 0 ? [] : abrirRutas(rutas);
  });

  manejar(CANALES.soltar, [], async (rutas: unknown): Promise<ArchivoCargado[]> => {
    const validas = validar(z.array(z.string().min(1)).min(1), rutas);
    return validas === null ? [] : abrirRutas(validas);
  });

  manejar(CANALES.analizar, FALLO, async (id: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    if (archivoId === null) return invalido;
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir({ tipo: 'analizar', imagen_id: sidecarId.datos });
    if (!resultado.ok) return resultado;
    return { ok: true, datos: esquemaAnalisis.parse(resultado.datos) };
  });

  manejar(CANALES.vista, FALLO, async (id: unknown, ocultamientos: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    const lista = validar(esquemaListaOcultamientos, ocultamientos);
    if (archivoId === null || lista === null) return invalido;
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado, binario } = await sidecar.pedir({
      tipo: 'previsualizar',
      imagen_id: sidecarId.datos,
      ocultamientos: lista,
      lado_max: LIMITES.ladoVista,
    });
    if (!resultado.ok) return resultado;
    if (binario === null) return { ok: false, error: ERROR_VALIDACION };
    return { ok: true, datos: { mime: resultado.datos.mime, datos: new Uint8Array(binario) } };
  });

  manejar(CANALES.exportar, FALLO, async (id: unknown, ocultamientos: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    const lista = validar(esquemaListaOcultamientos, ocultamientos);
    if (archivoId === null || lista === null || ventana === null) return invalido;
    const original = archivos.ruta(archivoId);
    const formato = archivos.formato(archivoId);
    if (original === undefined || formato === undefined) return invalido;
    const ajustes = leerAjustes();
    const carpeta = carpetaVigente(ajustes);
    // Con una carpeta en tus ajustes, la copia va directo ahí. Si la carpeta ya no está, se pregunta.
    if (ajustes.copia.destino === 'carpeta' && carpeta !== null) return exportarEnCarpeta(archivoId, lista, carpeta);
    const extension = extensionCopia(ajustes.copia.formato, formato);
    const filtros = [{ name: 'JPG', extensions: ['jpg'] }, { name: 'PNG', extensions: ['png'] }];
    const elegido = await dialog.showSaveDialog(ventana, {
      title: 'Guardar copia sin metadatos',
      defaultPath: join(carpeta ?? dirname(original), nombreCopia(parse(original).name, ajustes.copia.sufijo, extension)),
      filters: extension === 'png' ? filtros.reverse() : filtros,
    });
    if (elegido.canceled || elegido.filePath === '') return { ok: true, datos: null };
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir({
      tipo: 'exportar',
      imagen_id: sidecarId.datos,
      ocultamientos: lista,
      ruta_destino: elegido.filePath,
      // El diálogo de Windows ya pidió confirmar si el archivo existe.
      sobrescribir: existsSync(elegido.filePath),
    });
    if (!resultado.ok) return resultado;
    const exportado = esquemaExportado.parse(resultado.datos);
    return { ok: true, datos: { nombre: basename(elegido.filePath), zonasOcultas: exportado.zonas_ocultas, carpeta: null } };
  });

  manejar(CANALES.prepararLote, FALLO, async (): Promise<Resultado<unknown>> => {
    const ajustes = leerAjustes();
    const guardada = ajustes.copia.destino === 'carpeta' ? carpetaVigente(ajustes) : null;
    const carpeta = guardada ?? (await pedirCarpeta('Elige la carpeta para tus copias'));
    if (carpeta === null) return { ok: true, datos: null };
    const loteId = randomUUID();
    lotes.set(loteId, carpeta);
    return { ok: true, datos: { loteId, carpeta: nombreCarpeta(carpeta) } };
  });

  manejar(CANALES.exportarEnLote, FALLO, async (lote: unknown, id: unknown, ocultamientos: unknown): Promise<Resultado<unknown>> => {
    const loteId = validar(z.uuid(), lote);
    const archivoId = validar(esquemaArchivoId, id);
    const lista = validar(esquemaListaOcultamientos, ocultamientos);
    if (loteId === null || archivoId === null || lista === null) return invalido;
    const carpeta = lotes.get(loteId);
    if (carpeta === undefined) return invalido;
    return exportarEnCarpeta(archivoId, lista, carpeta);
  });

  manejar(CANALES.miniatura, FALLO, async (id: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    if (archivoId === null) return invalido;
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado, binario } = await sidecar.pedir({
      tipo: 'previsualizar',
      imagen_id: sidecarId.datos,
      ocultamientos: [],
      lado_max: LIMITES.ladoMiniatura,
    });
    if (!resultado.ok) return resultado;
    if (binario === null) return invalido;
    return { ok: true, datos: { mime: resultado.datos.mime, datos: new Uint8Array(binario) } };
  });

  manejar(CANALES.segmentar, FALLO, async (id: unknown, x: unknown, y: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    const punto = validar(z.strictObject({ x: z.number().int().min(0).max(LIMITES.ladoMax - 1), y: z.number().int().min(0).max(LIMITES.ladoMax - 1) }), { x, y });
    if (archivoId === null || punto === null) return invalido;
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir({ tipo: 'segmentar', imagen_id: sidecarId.datos, ...punto });
    if (!resultado.ok) return resultado;
    return { ok: true, datos: esquemaSegmentado.parse(resultado.datos) };
  });

  manejar(CANALES.pintar, FALLO, async (id: unknown, puntos: unknown, tamano: unknown): Promise<Resultado<unknown>> => {
    const archivoId = validar(esquemaArchivoId, id);
    const trazo = validar(esquemaTrazo, { puntos, tamano });
    if (archivoId === null || trazo === null) return invalido;
    const sidecarId = await archivos.sidecarId(archivoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir({ tipo: 'pintar', imagen_id: sidecarId.datos, ...trazo });
    if (!resultado.ok) return resultado;
    return { ok: true, datos: esquemaSegmentado.parse(resultado.datos) };
  });

  manejar(CANALES.cerrar, undefined, async (id: unknown): Promise<void> => {
    const archivoId = validar(esquemaArchivoId, id);
    if (archivoId !== null) await archivos.cerrar(archivoId);
  });

  manejar(CANALES.cancelar, undefined, (): void => {
    sidecar.reiniciar();
  });

  manejar(CANALES.abrirFuente, undefined, async (url: unknown): Promise<void> => {
    // Solo direcciones citadas en el catálogo, y siempre en el navegador, nunca en la app.
    if (typeof url === 'string' && urlsDeFuentes().has(url)) await shell.openExternal(url);
    else registrar('Se rechazó abrir una dirección fuera del catálogo');
  });

  manejar(CANALES.obtenerTema, 'sistema', (): Tema => leerTema());

  manejar(CANALES.definirTema, undefined, (tema: unknown): void => {
    const valido = validar(esquemaTema, tema);
    if (valido === null) return;
    aplicarTema(valido);
    guardarAjustes({ tema: valido });
  });

  manejar(CANALES.obtenerAjustes, ajustesVisibles(AJUSTES_INICIALES), (): Ajustes => ajustesVisibles(leerAjustes()));

  manejar(CANALES.definirCopia, ajustesVisibles(AJUSTES_INICIALES), (preferencias: unknown): Ajustes => {
    const validas = validar(esquemaPreferenciasCopia, preferencias);
    // Si no son válidas, se conservan las anteriores: nada cambia en silencio a algo distinto.
    return ajustesVisibles(validas === null ? leerAjustes() : guardarAjustes({ copia: validas }));
  });

  manejar(CANALES.elegirCarpeta, ajustesVisibles(AJUSTES_INICIALES), async (): Promise<Ajustes> => {
    const carpeta = await pedirCarpeta('Elige dónde guardar tus copias');
    return ajustesVisibles(carpeta === null ? leerAjustes() : guardarAjustes({ carpeta }));
  });

  manejar(CANALES.guardarEdiciones, undefined, (ediciones: unknown): Promise<void> => {
    const validas = validar(esquemaEdiciones, ediciones);
    // En fila: dos guardados a la vez competirían por el mismo archivo temporal.
    if (validas !== null) colaGuardado = colaGuardado.then(() => guardarEdiciones(validas));
    return colaGuardado;
  });

  manejar(CANALES.recuperar, SIN_RECUPERACION, (): Promise<Recuperacion> => recuperar());

  registrarCanalesVideo();

  manejar(CANALES.descartarRecuperacion, undefined, (): void => {
    rmSync(rutaRecuperacion(), { force: true });
    hayCambios = false;
  });

  manejar(CANALES.confirmarCierre, undefined, (): void => {
    // Solo vale como respuesta a un aviso de main: el renderer no puede cerrar la app por su cuenta.
    if (!cierrePendiente || ventana === null) {
      registrar('Se rechazó un cierre que no se había pedido');
      return;
    }
    cierrePendiente = false;
    confirmoCierre = true;
    ventana.close();
  });
}

const esquemaVideoId = esquemaArchivoId;
const esquemaPistaId = z.string().min(1).max(64);

function registrarCanalesVideo(): void {
  manejar(CANALES.abrirVideo, FALLO, async (): Promise<Resultado<unknown>> => {
    if (ventana === null) return invalido;
    // En Windows el diálogo de Electron/IFileDialog se cuelga en Descargas; usamos el clásico.
    if (process.platform === 'win32') {
      const ruta = await elegirVideoWindows();
      if (ruta === null) return { ok: true, datos: null };
      if (!esVideo(ruta)) {
        return {
          ok: false,
          error: {
            codigo: 'NO_ES_VIDEO',
            mensaje: 'Ese archivo no es un video que podamos abrir. Usa MP4, MOV, M4V, WebM o MKV.',
          },
        };
      }
      return videos.abrir(ruta);
    }
    const rutas = await elegirConDialogo({
      title: 'Elige el video que quieres revisar',
      defaultPath: carpetaInicialVideo(),
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Videos', extensions: [...EXTENSIONES_VIDEO] }],
    });
    const ruta = rutas[0];
    if (ruta === undefined) return { ok: true, datos: null };
    return videos.abrir(ruta);
  });

  manejar(CANALES.soltarVideo, FALLO, async (ruta: unknown): Promise<Resultado<unknown>> => {
    const valida = validar(z.string().min(1).max(32767), ruta);
    if (valida === null || !esVideo(valida)) {
      return { ok: false, error: { codigo: 'NO_ES_VIDEO', mensaje: 'Ese archivo no es un video que podamos abrir. Usa MP4, MOV, M4V, WebM o MKV.' } };
    }
    return videos.abrir(valida);
  });

  manejar(CANALES.vistaVideo, FALLO, async (id: unknown, posicion: unknown, pistas: unknown): Promise<Resultado<unknown>> => {
    const videoId = validar(esquemaVideoId, id);
    const pos = validar(esquemaPosicion, posicion);
    const lista = validar(esquemaListaPistas, pistas);
    if (videoId === null || pos === null || lista === null) return invalido;
    const sidecarId = videos.sidecarId(videoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado, binario } = await sidecar.pedir({ tipo: 'vista_video', video_id: sidecarId.datos, posicion: pos, pistas: lista });
    if (!resultado.ok) return resultado;
    if (binario === null) return invalido;
    return { ok: true, datos: { mime: 'image/jpeg', datos: new Uint8Array(binario), revisar: resultado.datos.revisar === true } };
  });

  manejar(CANALES.seguirVideo, FALLO, async (id: unknown, posicion: unknown, x: unknown, y: unknown): Promise<Resultado<unknown>> => {
    const videoId = validar(esquemaVideoId, id);
    const pos = validar(esquemaPosicion, posicion);
    const punto = validar(z.strictObject({ x: esquemaCoordenadaProxy, y: esquemaCoordenadaProxy }), { x, y });
    if (videoId === null || pos === null || punto === null) return invalido;
    const sidecarId = videos.sidecarId(videoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir(
      { tipo: 'seguir_video', video_id: sidecarId.datos, posicion: pos, ...punto },
      LIMITE_SEGUIR_MS,
    );
    if (!resultado.ok) return resultado;
    const seguido = esquemaSeguido.parse(resultado.datos);
    return {
      ok: true,
      datos: {
        pistaId: seguido.pista_id,
        framesRevisar: seguido.frames_revisar,
        posicionesRevisar: seguido.posiciones_revisar,
        framesConObjeto: seguido.frames_con_objeto,
        framesRastreados: seguido.frames_rastreados,
      },
    };
  });

  manejar(CANALES.zonaVideo, FALLO, async (id: unknown, forma: unknown, puntos: unknown, tamano: unknown): Promise<Resultado<unknown>> => {
    const videoId = validar(esquemaVideoId, id);
    const zona = validar(
      z.strictObject({
        forma: z.enum(['rectangulo', 'pincel']),
        puntos: z.array(z.strictObject({ x: esquemaCoordenadaProxy, y: esquemaCoordenadaProxy })).min(1).max(LIMITES.puntosTrazo),
        tamano: z.number().int().min(LIMITES.pincel.min).max(LIMITES.pincel.max),
      }).refine((v) => v.forma !== 'rectangulo' || v.puntos.length === 2, 'el rectángulo lleva dos esquinas'),
      { forma, puntos, tamano },
    );
    if (videoId === null || zona === null) return invalido;
    const sidecarId = videos.sidecarId(videoId);
    if (!sidecarId.ok) return sidecarId;
    const { resultado } = await sidecar.pedir({ tipo: 'zona_video', video_id: sidecarId.datos, ...zona });
    if (!resultado.ok) return resultado;
    const seguido = esquemaSeguido.parse(resultado.datos);
    return {
      ok: true,
      datos: {
        pistaId: seguido.pista_id,
        framesRevisar: seguido.frames_revisar,
        posicionesRevisar: seguido.posiciones_revisar,
        framesConObjeto: seguido.frames_con_objeto,
        framesRastreados: seguido.frames_rastreados,
      },
    };
  });

  manejar(CANALES.quitarPista, undefined, async (id: unknown, pistaId: unknown): Promise<void> => {
    const videoId = validar(esquemaVideoId, id);
    const pista = validar(esquemaPistaId, pistaId);
    if (videoId === null || pista === null) return;
    const sidecarId = videos.sidecarId(videoId);
    if (sidecarId.ok) await sidecar.pedir({ tipo: 'quitar_pista', video_id: sidecarId.datos, pista_id: pista });
  });

  manejar(CANALES.exportarVideo, FALLO, async (id: unknown, pistas: unknown): Promise<Resultado<unknown>> => {
    const videoId = validar(esquemaVideoId, id);
    const lista = validar(esquemaListaPistas, pistas);
    if (videoId === null || lista === null || ventana === null) return invalido;
    const original = videos.ruta(videoId);
    if (original === undefined) return invalido;
    const sidecarId = videos.sidecarId(videoId);
    if (!sidecarId.ok) return sidecarId;
    const { name } = parse(original);
    const elegido = await dialog.showSaveDialog(ventana, {
      title: 'Guardar copia del video sin metadatos',
      defaultPath: join(dirname(original), `${name}-copia.mp4`),
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (elegido.canceled || elegido.filePath === '') return { ok: true, datos: null };
    const { resultado } = await sidecar.pedir(
      {
        tipo: 'exportar_video',
        video_id: sidecarId.datos,
        pistas: lista,
        ruta_destino: elegido.filePath,
        // El diálogo de Windows ya pidió confirmar si el archivo existe.
        sobrescribir: existsSync(elegido.filePath),
      },
      LIMITE_EXPORTAR_VIDEO_MS,
    );
    if (!resultado.ok) return resultado;
    const exportado = esquemaVideoExportado.parse(resultado.datos);
    return {
      ok: true,
      datos: { nombre: basename(elegido.filePath), pistasOcultas: exportado.pistas_ocultas, framesRevisar: exportado.frames_revisar },
    };
  });

  manejar(CANALES.cerrarVideo, undefined, async (id: unknown): Promise<void> => {
    const videoId = validar(esquemaVideoId, id);
    if (videoId !== null) await videos.cerrar(videoId);
  });
}

/**
 * Crea la llave de safeStorage al arrancar. Chromium la guarda en disco unos segundos después de
 * crearla: si se creara al guardar la primera decisión y la app se cerrara de golpe en ese momento,
 * la recuperación quedaría cifrada con una llave perdida y no se podría leer.
 */
function prepararCifrado(): void {
  void safeStorage.encryptStringAsync('preparar').catch((e: unknown) => {
    recuperacionSegura = false;
    registrar(`No se pudo preparar el cifrado: ${e instanceof Error ? e.name : 'desconocido'}`);
  });
}

function endurecerSesion(): void {
  // Segunda capa además de la CSP: solo sale lo empaquetado con la app.
  session.defaultSession.webRequest.onBeforeRequest((detalles, responder) => {
    const permitido = detalles.url.startsWith(`${ESQUEMA_APP}://`) || detalles.url.startsWith('blob:') || detalles.url.startsWith('data:');
    if (!permitido) registrar('Se bloqueó una solicitud de red');
    responder({ cancel: !permitido });
  });
  session.defaultSession.setPermissionRequestHandler((_c, _p, responder) => {
    responder(false);
  });
  session.defaultSession.protocol.handle(ESQUEMA_APP, (solicitud) => {
    const carpeta = join(raiz, 'out', 'renderer');
    const pedida = decodeURIComponent(new URL(solicitud.url).pathname);
    const ruta = resolve(carpeta, `.${pedida === '/' ? '/index.html' : pedida}`);
    const dentro = relative(carpeta, ruta);
    if (dentro.startsWith(`..${sep}`) || dentro === '..' || !existsSync(ruta)) return new Response('', { status: 404 });
    return new Response(readFileSync(ruta), {
      headers: {
        'Content-Type': MIME[extname(ruta).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP,
      },
    });
  });
}

function crearMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ver',
        submenu: [
          // Ctrl + y Ctrl − sin Mayús acercan la foto: la interfaz usa Ctrl Mayús.
          { role: 'zoomIn', label: 'Agrandar la interfaz', accelerator: 'CommandOrControl+Shift+=' },
          { role: 'zoomOut', label: 'Achicar la interfaz', accelerator: 'CommandOrControl+Shift+-' },
          { role: 'resetZoom', label: 'Tamaño normal', accelerator: 'CommandOrControl+Shift+0' },
          { role: 'togglefullscreen', label: 'Pantalla completa' },
        ],
      },
    ]),
  );
}

function crearVentana(): void {
  const nueva = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: MARCA.nombre,
    icon: join(raiz, 'brand', 'icon', 'icono.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#13122A' : '#F7F7FB',
    webPreferences: {
      preload: join(raiz, 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  ventana = nueva;
  nueva.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  nueva.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  nueva.webContents.on('unresponsive', () => {
    rendererResponde = false;
  });
  nueva.webContents.on('responsive', () => {
    rendererResponde = true;
  });
  nueva.on('close', (e) => {
    if (!hayCambios || confirmoCierre) return;
    e.preventDefault();
    // El aviso es de la app, no de Windows: se ve con su marca y las pruebas lo pueden contestar.
    // Si la interfaz se cayó o no responde, no hay dónde mostrarlo y se usa el de Windows para no
    // dejar una ventana imposible de cerrar.
    const interfazLista = rendererResponde && !nueva.webContents.isCrashed() && !nueva.webContents.isLoading();
    if (interfazLista) {
      cierrePendiente = true;
      nueva.webContents.send(CANALES.pedirCierre, { recuperacionSegura } satisfies AvisoCierre);
      return;
    }
    const eleccion = dialog.showMessageBoxSync(nueva, {
      type: 'question',
      buttons: ['Cerrar de todos modos', 'Seguir revisando'],
      defaultId: 1,
      cancelId: 1,
      title: TITULO_CIERRE,
      message: textoCierre(recuperacionSegura),
    });
    if (eleccion === 0) {
      confirmoCierre = true;
      nueva.close();
    }
  });
  nueva.on('closed', () => {
    ventana = null;
  });
  void nueva.loadURL(`${ESQUEMA_APP}://revisor/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  // Dos instancias competirían por los mismos datos de recuperación.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventana === null) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });
  app.on('window-all-closed', () => {
    sidecar.apagar();
    app.quit();
  });
  void app.whenReady().then(() => {
    prepararCifrado();
    aplicarTema(leerTema());
    endurecerSesion();
    registrarCanales();
    crearMenu();
    crearVentana();
  });
}
