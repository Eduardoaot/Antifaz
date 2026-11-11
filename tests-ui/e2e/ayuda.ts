import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';

export const RAIZ = resolve(__dirname, '..', '..');
export const PYTHON = process.platform === 'win32'
  ? join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe')
  : join(RAIZ, 'sidecar', '.venv', 'bin', 'python');

const GENERADOR = `
import sys, shutil
from pathlib import Path
from PIL import Image
d = Path(sys.argv[1])
exif = Image.Exif(); exif[0x0110] = "Telefono secreto"; exif[0x8825] = {1: "N", 2: (19.0, 25.0, 42.0)}
cara = Image.open(sys.argv[2]).convert("RGB")
cara.save(d / "cara con ñ.jpg", exif=exif, quality=90, comment=b"Comentario secreto")
Image.new("RGB", (640, 480), (0, 0, 0)).save(d / "negra.png")
Image.new("RGB", (640, 480), (40, 90, 200)).save(d / "gps.jpg", exif=exif)
Image.new("RGB", (5, 5), (1, 2, 3)).save(d / "diminuta.png")
import numpy as np, zxingcpp
from PIL import ImageDraw, ImageFont
lienzo = Image.new("RGB", (1200, 700), (255, 255, 255))
fuente = ImageFont.truetype(sys.argv[3], 44)
ImageDraw.Draw(lienzo).text((40, 40), "Tel: 81 8123 4567", fill=(10, 10, 10), font=fuente)
ImageDraw.Draw(lienzo).text((40, 130), "persona@ejemplo.com", fill=(10, 10, 10), font=fuente)
m = np.array(zxingcpp.create_barcode("https://ejemplo.com/f", zxingcpp.BarcodeFormat.QRCode).to_image(scale=8, add_quiet_zones=True))
lienzo.paste(Image.fromarray((m if m.ndim == 2 else m[:, :, 0]).astype("uint8")).convert("RGB"), (800, 300))
lienzo.save(d / "datos.png")
Image.new("RGB", (6000, 4500), (200, 210, 220)).save(d / "grande.png")
(d / "vacio.jpg").write_bytes(b"")
(d / "falsa.jpg").write_bytes(b"MZ esto no es una imagen")
`;

export function crearMuestras(): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-muestras-'));
  execFileSync(PYTHON, ['-c', GENERADOR, carpeta, join(RAIZ, 'sidecar', 'tests', 'datos', 'astronauta.jpg'), join(RAIZ, 'brand', 'fonts', 'AtkinsonHyperlegibleNext-Variable.ttf')]);
  return carpeta;
}

/** La terminal de VS Code define ELECTRON_RUN_AS_NODE, que haría correr Electron como Node. */
export function entorno(datos: string): Record<string, string> {
  const { ELECTRON_RUN_AS_NODE: _ignorada, ...resto } = process.env;
  return { ...(resto as Record<string, string>), REVISOR_DATOS: datos };
}

export interface Sesion {
  app: ElectronApplication;
  pagina: Page;
  datos: string;
}

/** Sin ventana en este tiempo, la app no arrancó (por ejemplo, otra instancia tiene el candado). */
const ESPERA_VENTANA_MS = 20_000;
const ESPERA_CIERRE_MS = 15_000;

export async function lanzar(datos?: string, args: string[] = []): Promise<Sesion> {
  const carpeta = datos ?? mkdtempSync(join(tmpdir(), 'revisor-datos-'));
  mkdirSync(carpeta, { recursive: true });
  // Playwright fuerza el tema claro si no se le dice lo contrario: el modo oscuro no se probaría.
  const app = await _electron.launch({ args: [RAIZ, ...args], env: entorno(carpeta), colorScheme: null });
  try {
    // Con límite: si la app se cierra sin abrir ventana, se lanza un error que `reintentar` atrapa,
    // en vez de esperar hasta que se acabe el tiempo de la prueba.
    const pagina = await app.firstWindow({ timeout: ESPERA_VENTANA_MS });
    await pagina.waitForLoadState('domcontentloaded');
    return { app, pagina, datos: carpeta };
  } catch (e) {
    await cerrar(app);
    throw e;
  }
}

/** PID del proceso principal, o null si ya no existe. */
function pidDe(app: ElectronApplication): number | null {
  const pid = app.process().pid;
  return pid === undefined ? null : pid;
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cierre forzado de verdad: termina la app y todos sus procesos hijos (GPU, renderer y sidecar),
 * y espera a que no quede ninguno. Matar solo el principal deja hijos que retienen el candado de
 * instancia única un rato, y en un equipo lento la siguiente app se cerraba sin abrir ventana.
 */
export async function matarArbol(app: ElectronApplication): Promise<void> {
  const pid = pidDe(app);
  if (pid !== null && vivo(pid)) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (e) {
      // taskkill falla si el proceso terminó justo antes, que es lo que se quería. Si sigue vivo, no.
      if (vivo(pid)) throw e;
    }
  }
  const limite = Date.now() + ESPERA_CIERRE_MS;
  while (pid !== null && vivo(pid) && Date.now() < limite) await new Promise((r) => setTimeout(r, 200));
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
}

/** Cierra la app con límite de tiempo; si no responde, la termina con todos sus procesos. */
export async function cerrar(app: ElectronApplication): Promise<void> {
  const cerro = await Promise.race([
    app.close().then(() => true, () => true),
    new Promise<boolean>((r) => setTimeout(() => { r(false); }, ESPERA_CIERRE_MS)),
  ]);
  if (!cerro) await matarArbol(app);
}

/** Los diálogos nativos no se pueden manejar desde Playwright: se simulan en main. */
export async function simularAbrir(app: ElectronApplication, rutas: string[]): Promise<void> {
  await app.evaluate(({ dialog }, r) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: r }));
  }, rutas);
}

export async function simularGuardar(app: ElectronApplication, ruta: string | null): Promise<void> {
  await app.evaluate(({ dialog }, r) => {
    const g = globalThis as unknown as { llamadasGuardar: number };
    g.llamadasGuardar = 0;
    dialog.showSaveDialog = (() => {
      g.llamadasGuardar += 1;
      return Promise.resolve(r === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: r });
    });
  }, ruta);
}

export async function abrir(sesion: Sesion, rutas: string[]): Promise<void> {
  await simularAbrir(sesion.app, rutas);
  // Sin fotos, el botón está en la pantalla inicial; con fotos abiertas, solo en el menú.
  const directo = sesion.pagina.getByRole('main').getByRole('button', { name: 'Abrir fotos' });
  if ((await directo.count()) > 0) await directo.first().click();
  else await irA(sesion.pagina, 'Abrir fotos');
}

/** Las vistas (fotos, video y guía) se eligen desde el menú de hamburguesa. */
export async function irA(pagina: Page, opcion: string): Promise<void> {
  await pagina.getByRole('button', { name: 'Menú' }).click();
  await pagina.getByRole('dialog', { name: 'Menú' }).getByRole('button', { name: opcion, exact: true }).click();
}

/** El tema está en Configuración, dentro del menú. */
export async function elegirTema(pagina: Page, tema: 'sistema' | 'claro' | 'oscuro'): Promise<void> {
  await irA(pagina, 'Configuración');
  const dialogo = pagina.getByRole('dialog', { name: 'Configuración' });
  await dialogo.getByLabel('Tema').selectOption(tema);
  await dialogo.getByRole('button', { name: 'Listo' }).click();
  await dialogo.waitFor({ state: 'hidden' });
}

/** Abre el detalle de un grupo de advertencias (efecto, intensidad, zonas y sticker). */
export async function personalizar(grupo: Locator): Promise<void> {
  const boton = grupo.getByRole('button', { name: /^Personalizar/ });
  if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click();
}

export function guardarTexto(ruta: string, texto: string): void {
  writeFileSync(ruta, texto);
}

/**
 * ¿Ya está en disco la llave con la que safeStorage cifra la recuperación? Chromium la escribe en
 * "Local State" unos segundos después de crearla. Un cierre forzado antes de eso, en un perfil nuevo,
 * deja la recuperación ilegible (limitación documentada en qa/REPORTE_FASE_1.md).
 */
export function llaveGuardada(datos: string): boolean {
  const ruta = join(datos, 'Local State');
  return existsSync(ruta) && readFileSync(ruta, 'utf-8').includes('"os_crypt"');
}
