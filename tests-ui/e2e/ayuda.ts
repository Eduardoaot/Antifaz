import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';

export const RAIZ = resolve(__dirname, '..', '..');
const PYTHON = join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe');

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
Image.new("RGB", (6000, 4500), (200, 210, 220)).save(d / "grande.png")
(d / "vacio.jpg").write_bytes(b"")
(d / "falsa.jpg").write_bytes(b"MZ esto no es una imagen")
`;

export function crearMuestras(): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-muestras-'));
  execFileSync(PYTHON, ['-c', GENERADOR, carpeta, join(RAIZ, 'sidecar', 'tests', 'datos', 'astronauta.jpg')]);
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

export async function lanzar(datos?: string, args: string[] = []): Promise<Sesion> {
  const carpeta = datos ?? mkdtempSync(join(tmpdir(), 'revisor-datos-'));
  mkdirSync(carpeta, { recursive: true });
  // Playwright fuerza el tema claro si no se le dice lo contrario: el modo oscuro no se probaría.
  const app = await _electron.launch({ args: [RAIZ, ...args], env: entorno(carpeta), colorScheme: null });
  const pagina = await app.firstWindow();
  await pagina.waitForLoadState('domcontentloaded');
  return { app, pagina, datos: carpeta };
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
  await sesion.pagina.getByRole('button', { name: 'Abrir fotos' }).first().click();
}

export function guardarTexto(ruta: string, texto: string): void {
  writeFileSync(ruta, texto);
}
