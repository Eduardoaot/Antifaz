import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import marca from '../../brand/brand.json';
import { abrir, crearMuestras, entorno, lanzar, RAIZ, simularGuardar, type Sesion } from './ayuda';

const CAPTURAS = join(RAIZ, 'tests-ui', 'capturas');
mkdirSync(CAPTURAS, { recursive: true });

let muestras: string;
let sesion: Sesion;

test.beforeAll(() => {
  muestras = crearMuestras();
});

test.afterEach(async () => {
  // Sin esto, el aviso de cambios sin exportar detendría el cierre de la prueba.
  await sesion.app.evaluate(({ BrowserWindow }) => {
    for (const v of BrowserWindow.getAllWindows()) v.destroy();
  }).catch(() => undefined);
  await sesion.app.close().catch(() => undefined);
});

const m = (nombre: string): string => join(muestras, nombre);
const veredicto = (p: Page) => p.getByTestId('veredicto');

async function reintentar<T>(accion: () => Promise<T>): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      return await accion();
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw ultimo;
}

async function sinViolaciones(p: Page): Promise<void> {
  const r = await new AxeBuilder({ page: p }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('arranca con marca, aviso legal y sin violaciones de accesibilidad', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await expect(pagina.getByRole('heading', { name: 'Revisa tus fotos antes de publicarlas' })).toBeVisible();
  await expect(pagina.getByText('herramienta orientativa y no constituye asesoría legal')).toBeVisible();
  await expect(pagina.getByRole('img', { name: marca.nombre })).toBeVisible();
  await sinViolaciones(pagina);
});

test('flujo completo: cara, ¿Por qué?, ocultar y exportar sin metadatos', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toHaveText('Revisa estas advertencias', { timeout: 60_000 });

  const cara = pagina.locator('[data-regla="CAR-01"]');
  await expect(cara).toContainText('Riesgo medio');
  await expect(cara).toContainText('Se detectó una cara');
  await expect(pagina.locator('[data-regla="UBI-01"]')).toContainText('Riesgo alto');
  await expect(pagina.getByRole('group', { name: '¿Hay menores en esta foto?' })).toBeVisible();

  await cara.getByRole('button', { name: /^¿Por qué\?/ }).click();
  const dialogo = pagina.getByRole('dialog');
  await expect(dialogo).toContainText('Aún no tenemos una fuente oficial directa');
  await expect(dialogo).toContainText('Consultada el');
  await sinViolaciones(pagina);
  await pagina.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();

  await pagina.getByRole('button', { name: 'Sí, ocultar las caras' }).click();
  await expect(cara.getByRole('button', { name: /^Ocultar zona/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(pagina.getByTestId('resumen')).toContainText('1 para ocultar');
  await sinViolaciones(pagina);
  await pagina.locator('.marca.ocultar').waitFor();
  await pagina.waitForTimeout(500);
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).scrollIntoViewIfNeeded();
  await expect(pagina.getByAltText(/Vista previa/), 'la imagen sigue a la vista al decidir').toBeInViewport();
  await pagina.screenshot({ path: join(CAPTURAS, 'cara-oculta.png') });

  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'copia ñandú.jpg');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos, con 1 zona oculta');

  const bytes = readFileSync(salida);
  for (const secreto of ['Telefono secreto', 'Comentario secreto', 'Exif', 'GPS']) expect(bytes.includes(secreto)).toBe(false);
  const reanalisis = execFileSync(
    join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe'),
    ['-c', 'import sys;from pathlib import Path;from revisor import cargador;from revisor.caras import DetectorCaras;i=cargador.abrir(sys.argv[1]);print(len(DetectorCaras(Path("modelos")).detectar(i.pixeles,0.25)),i.tiene_gps)', salida],
    { cwd: join(RAIZ, 'sidecar') },
  ).toString().trim();
  expect(reanalisis, 'la cara exportada aún se detecta o sigue el GPS').toBe('0 False');
  expect(readdirSync(join(salida, '..'))).toEqual(['copia ñandú.jpg']);

  // Los logs no llevan nombres de archivo, rutas de usuario ni píxeles.
  const logs = join(sesion.datos, 'logs');
  for (const archivo of readdirSync(logs)) {
    const texto = readFileSync(join(logs, archivo), 'utf-8');
    for (const prohibido of ['cara con', 'ñandú', muestras, 'base64']) expect(texto.includes(prohibido), `${archivo}: ${prohibido}`).toBe(false);
  }
});

test('foto sin nada: lo dice sin prometer de más', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toHaveText('No encontramos nada riesgoso en lo que revisamos', { timeout: 60_000 });
  await expect(pagina.getByText('La revisión es orientativa')).toBeVisible();
  await expect(pagina.getByText(/Lo que todavía no revisamos \(15\)/)).toBeVisible();
  await sinViolaciones(pagina);
});

test('imagen diminuta: nunca se presenta como limpia', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('diminuta.png')]);
  await expect(veredicto(pagina)).toHaveText('No pudimos revisar esta foto por completo', { timeout: 60_000 });
  await expect(pagina.getByText('No encontramos nada riesgoso')).toHaveCount(0);
});

test('archivos malos en un lote: avisa de cada uno y el resto sigue', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('vacio.jpg'), m('falsa.jpg'), m('no-existe.jpg'), muestras, m('negra.png')]);
  await expect(pagina.getByRole('alert').filter({ hasText: 'Este archivo está vacío' })).toBeVisible();
  await expect(pagina.getByRole('alert').filter({ hasText: 'no es una imagen' })).toBeVisible();
  await expect(pagina.getByRole('alert').filter({ hasText: 'No encontramos el archivo' })).toBeVisible();
  await expect(pagina.getByRole('alert').filter({ hasText: 'Esto es una carpeta' })).toBeVisible();
  await expect(veredicto(pagina)).toHaveText(/No encontramos nada/, { timeout: 60_000 });
  await sinViolaciones(pagina);
});

test('el mismo archivo dos veces no se duplica', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await abrir(sesion, [m('negra.png')]);
  await expect(pagina.getByTestId('anuncio')).toContainText('Ya tenías abierta');
  await expect(pagina.getByRole('navigation').getByRole('listitem')).toHaveCount(1);
});

test('doble clic en exportar solo guarda una vez; cancelar el diálogo no guarda', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-salida-'));
  await simularGuardar(app, join(carpeta, 'a.png'));
  await pagina.getByRole('button', { name: 'Exportar copia' }).dblclick();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos');
  expect(await app.evaluate(() => (globalThis as unknown as { llamadasGuardar: number }).llamadasGuardar)).toBe(1);
  await simularGuardar(app, null);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { llamadasGuardar: number }).llamadasGuardar)).toBe(1);
  expect(readdirSync(carpeta)).toEqual(['a.png']);
});

test('advertencias sin decidir: avisa y deja decidir, sin bloquear', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'visible.jpg');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  const dialogo = pagina.getByRole('dialog');
  await expect(dialogo).toContainText('Hay 2 advertencias sin decidir');
  await expect(dialogo).not.toContainText('no se revisó por completo');
  await dialogo.getByRole('button', { name: 'Volver a revisar' }).click();
  expect(existsSync(salida)).toBe(false);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await pagina.getByRole('button', { name: 'Exportar de todos modos' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('con 0 zonas ocultas');
  expect(existsSync(salida)).toBe(true);
});

test('campo de intensidad: rechaza lo inválido y conserva el último valor', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  const campo = pagina.getByLabel('Intensidad del efecto');
  for (const malo of ['-5', 'abc', '999999', '', '1e10', '0,5', '0', '101', 'x'.repeat(500)]) {
    await campo.fill(malo);
    await expect(campo, malo).toHaveAttribute('aria-invalid', 'true');
    await expect(pagina.getByRole('alert').filter({ hasText: 'Escribe un número entero' })).toBeVisible();
  }
  await campo.fill('20');
  await expect(campo).toHaveAttribute('aria-invalid', 'false');
  await expect(pagina.getByText(/Con poca intensidad es más fácil reconocer/)).toBeVisible();
  await expect(pagina.getByText(/usa Bloque sólido/)).toBeVisible();
  await campo.fill('1');
  await expect(campo).toHaveAttribute('aria-invalid', 'false');
  await campo.fill('100');
  await expect(campo).toHaveAttribute('aria-invalid', 'false');
});

test('deshacer y rehacer, incluidos los límites y con teclado', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  const deshacer = pagina.getByRole('button', { name: 'Deshacer' });
  const rehacer = pagina.getByRole('button', { name: 'Rehacer' });
  await expect(deshacer).toBeDisabled();
  await expect(rehacer).toBeDisabled();
  await pagina.keyboard.press('Control+z');
  const ocultar = pagina.getByRole('button', { name: /^Ocultar zona/ });
  await ocultar.click();
  await expect(ocultar).toHaveAttribute('aria-pressed', 'true');
  await pagina.keyboard.press('Control+z');
  await expect(ocultar).toHaveAttribute('aria-pressed', 'false');
  await expect(rehacer).toBeEnabled();
  await pagina.keyboard.press('Control+y');
  await expect(ocultar).toHaveAttribute('aria-pressed', 'true');
  await pagina.keyboard.press('Control+Shift+z');
  await expect(ocultar).toHaveAttribute('aria-pressed', 'true');
});

test('se puede usar completo sin mouse', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await app.evaluate(({ dialog }, r) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: r }));
  }, [m('cara con ñ.jpg')]);
  await expect(pagina.getByRole('heading', { name: 'Revisa tus fotos antes de publicarlas' })).toBeVisible();
  await pagina.keyboard.press('Control+o');
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'teclado.jpg');
  await simularGuardar(app, salida);
  const destino = pagina.getByRole('button', { name: 'Ocultar todo lo detectado' });
  for (let i = 0; i < 40 && !(await destino.evaluate((e) => e === document.activeElement)); i++) await pagina.keyboard.press('Tab');
  await expect(destino).toBeFocused();
  await pagina.keyboard.press('Enter');
  await expect(pagina.getByTestId('anuncio')).toContainText('Marcamos para ocultar');
  await pagina.keyboard.press('Control+e');
  await pagina.getByRole('dialog').getByRole('button', { name: 'Exportar de todos modos' }).focus();
  await pagina.keyboard.press('Enter');
  await expect(pagina.getByTestId('anuncio')).toContainText('con 1 zona oculta');
  expect(existsSync(salida)).toBe(true);
});

test('si el sidecar muere, nada queda como revisado y se recupera solo', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.evaluate(() => window.revisor.cancelar());
  await expect.poll(async () => {
    const r = await pagina.evaluate(() => window.revisor.analizar('6f9619ff-8b86-4011-b42d-00c04fc964ff'));
    return r.ok ? 'ok' : r.error.codigo;
  }).toBe('IMAGEN_NO_ABIERTA');
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'tras-reinicio.png');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos', { timeout: 60_000 });
  expect(existsSync(salida)).toBe(true);
});

test('el renderer no puede pedir nada inválido ni salirse del catálogo', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  const r = await pagina.evaluate(async () => {
    const id = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
    const api = window.revisor as unknown as Record<string, (...a: unknown[]) => Promise<{ error?: { codigo: string } }>>;
    const cod = async (f: Promise<{ error?: { codigo: string } }>): Promise<string> => (await f).error?.codigo ?? 'ok';
    return {
      idMalo: await cod(api.analizar!('../../etc')),
      idNulo: await cod(api.analizar!(null)),
      listaMala: await cod(api.vista!(id, [{ x: -1 }])),
      listaGrande: await cod(api.vista!(id, 'todo')),
      nan: await cod(api.vista!(id, [{ x: Number.NaN, y: 0, ancho: 1, alto: 1, efecto: 'solido', intensidad: 80, dilatacion_px: 8, dilatacion_pct: 10 }])),
      apis: Object.keys(window).filter((k) => ['require', 'process', 'ipcRenderer', 'module'].includes(k)),
    };
  });
  expect(r).toEqual({ idMalo: 'VALIDACION', idNulo: 'VALIDACION', listaMala: 'VALIDACION', listaGrande: 'VALIDACION', nan: 'VALIDACION', apis: [] });
});

test('seguridad: sin red durante el análisis', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  const salidas: string[] = [];
  pagina.on('request', (s) => salidas.push(s.url()));
  const intento = await pagina.evaluate(async () => {
    const resultados: string[] = [];
    try {
      await fetch('https://example.com/');
      resultados.push('fetch paso');
    } catch {
      resultados.push('fetch bloqueado');
    }
    return resultados;
  });
  expect(intento).toEqual(['fetch bloqueado']);
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });

  expect(salidas.filter((u) => !u.startsWith('app://') && !u.startsWith('blob:') && !u.startsWith('https://example.com'))).toEqual([]);

  // Captura real del sistema: conexiones TCP de la app y de sus procesos hijos.
  const pid = String(app.process().pid);
  const guion = `
    $todos = @{}; $cola = @(${pid})
    while ($cola.Count -gt 0) { $p = $cola[0]; $cola = @($cola | Select-Object -Skip 1); $todos[$p] = 1
      Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" | ForEach-Object { $cola += $_.ProcessId } }
    Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $todos.ContainsKey([int]$_.OwningProcess) -and $_.RemoteAddress -notin @('127.0.0.1','::1','0.0.0.0','::') } |
      ForEach-Object { "$($_.RemoteAddress):$($_.RemotePort) $($_.State)" }
  `;
  const conexiones = execFileSync('powershell', ['-NoProfile', '-Command', guion]).toString().trim();
  expect(conexiones, 'la app abrió conexiones hacia afuera').toBe('');
});

test('recupera las decisiones tras un cierre forzado', async () => {
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  const crudo = readFileSync(join(datos, 'recuperacion.json'));
  expect(crudo.length, 'la recuperación no debe llevar píxeles').toBeLessThan(4000);
  expect(crudo.includes('cara con'), 'la recuperación va cifrada').toBe(false);
  app.process().kill('SIGKILL');
  await app.close().catch(() => undefined);
  // La instancia anterior tarda un momento en soltar el candado de instancia única.
  sesion = await reintentar(() => lanzar(datos));
  const segunda = sesion.pagina;
  const dialogo = segunda.getByRole('dialog');
  await expect(dialogo).toContainText('Tienes una revisión sin terminar', { timeout: 60_000 });
  await dialogo.getByRole('button', { name: 'Recuperar' }).click();
  await expect(segunda.getByRole('button', { name: /^Ocultar zona/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
});

test('recuperación sobre una foto que cambió: no aplica las decisiones', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-cambio-'));
  const foto = join(carpeta, 'foto.jpg');
  copyFileSync(m('cara con ñ.jpg'), foto);
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [foto]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Dejar visible/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  app.process().kill('SIGKILL');
  await app.close().catch(() => undefined);
  copyFileSync(m('gps.jpg'), foto);

  sesion = await reintentar(() => lanzar(datos));
  await expect(sesion.pagina.getByRole('alert').filter({ hasText: 'no aplicamos tus decisiones anteriores' })).toBeVisible({ timeout: 60_000 });
  await expect(sesion.pagina.getByRole('dialog')).toHaveCount(0);
});

test('el diálogo de recuperación no se borra si la app vuelve a cerrarse', async () => {
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  app.process().kill('SIGKILL');
  await app.close().catch(() => undefined);

  sesion = await reintentar(() => lanzar(datos));
  await expect(sesion.pagina.getByRole('dialog')).toContainText('sin terminar', { timeout: 60_000 });
  await sesion.pagina.waitForTimeout(800);
  expect(existsSync(join(datos, 'recuperacion.json'))).toBe(true);
});

test('si el archivo cambió en disco, no exporta otra foto con las cajas viejas', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-cambio-'));
  const foto = join(carpeta, 'foto.jpg');
  copyFileSync(m('gps.jpg'), foto);
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [foto]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  copyFileSync(m('cara con ñ.jpg'), foto);
  await pagina.evaluate(() => window.revisor.cancelar());
  const salida = join(carpeta, 'salida.jpg');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByRole('alert').filter({ hasText: 'Este archivo cambió' })).toBeVisible({ timeout: 60_000 });
  expect(existsSync(salida)).toBe(false);
});

test('cancelar a mitad del análisis: nada queda como revisado y se puede reintentar', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('grande.png'), m('negra.png')]);
  await pagina.getByRole('button', { name: 'Cancelar revisión' }).click();
  const lista = pagina.getByRole('navigation');
  await expect(lista.getByText('No revisada')).toHaveCount(2, { timeout: 60_000 });
  await expect(pagina.getByText('No encontramos nada riesgoso')).toHaveCount(0);
  await expect(pagina.getByRole('heading', { name: 'Esta foto no está revisada' })).toBeVisible();
  await expect(pagina.getByRole('button', { name: 'Exportar copia' })).toBeDisabled();
  await pagina.getByRole('button', { name: 'Revisar de nuevo' }).click();
  await expect(veredicto(pagina)).toBeVisible({ timeout: 90_000 });
});

test('una revisión parcial pide confirmar y nunca se muestra como revisada', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('diminuta.png')]);
  await expect(veredicto(pagina)).toHaveText('No pudimos revisar esta foto por completo', { timeout: 60_000 });
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'x.png');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  const dialogo = pagina.getByRole('dialog');
  await expect(dialogo).toContainText('no se revisó por completo');
  await dialogo.getByRole('button', { name: 'Exportar de todos modos' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos');
  await expect(pagina.getByRole('navigation')).toContainText('Exportada, con revisión parcial');
});

test('durante la exportación no se pueden cambiar las decisiones', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: 'Sí, ocultar las caras' }).click();
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'x.jpg');
  // El diálogo tarda: da tiempo de comprobar el bloqueo mientras se exporta.
  await app.evaluate(({ dialog }, r) => {
    dialog.showSaveDialog = (() => new Promise((listo) => setTimeout(() => { listo({ canceled: false, filePath: r }); }, 1500)));
  }, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByRole('button', { name: /^Dejar visible/ })).toBeDisabled();
  await expect(pagina.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
  await expect(pagina.getByTestId('anuncio')).toContainText('con 1 zona oculta');
  await expect(pagina.getByRole('button', { name: /^Dejar visible/ })).toBeEnabled();
});

test('una segunda instancia no abre otra ventana', async () => {
  sesion = await lanzar();
  const segunda = execFileSync(join(RAIZ, 'node_modules', 'electron', 'dist', 'electron.exe'), [RAIZ], {
    env: entorno(sesion.datos),
    timeout: 30_000,
  });
  expect(segunda).toBeDefined();
  expect(sesion.app.windows()).toHaveLength(1);
});

for (const tema of ['claro', 'oscuro'] as const) {
  for (const [nombre, ancho, alto] of [['minimo', 800, 600], ['normal', 1280, 800], ['grande', 1920, 1080]] as const) {
    test(`vista ${tema}, ventana ${nombre}: nada se sale y pasa axe`, async () => {
      sesion = await lanzar();
      const { pagina, app } = sesion;
      await pagina.getByLabel('Tema').selectOption(tema);
      await abrir(sesion, [m('cara con ñ.jpg')]);
      await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }, t) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(t.ancho, t.alto);
      }, { ancho, alto });
      await pagina.getByAltText(/Vista previa/).waitFor();
      await pagina.waitForTimeout(300);
      const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, 'scroll horizontal').toBeLessThanOrEqual(0);
      const fondo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(fondo).toBe(tema === 'oscuro' ? 'rgb(19, 18, 42)' : 'rgb(247, 247, 251)');
      await sinViolaciones(pagina);
      await pagina.screenshot({ path: join(CAPTURAS, `${tema}-${nombre}.png`), fullPage: true });
    });
  }
}

for (const tema of ['claro', 'oscuro'] as const) {
  test(`el texto de los botones se lee con el mouse encima, tema ${tema}`, async () => {
    sesion = await lanzar();
    const { pagina } = sesion;
    await pagina.getByLabel('Tema').selectOption(tema);
    await abrir(sesion, [m('cara con ñ.jpg')]);
    await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
    await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
    const botones = [
      pagina.getByRole('button', { name: 'Abrir fotos' }).first(),
      pagina.getByRole('button', { name: 'Exportar copia' }),
      pagina.getByRole('button', { name: /^Ocultar zona/ }),
      pagina.getByRole('button', { name: /^Dejar visible/ }),
      pagina.getByRole('button', { name: 'Ocultar todo lo detectado' }),
    ];
    for (const boton of botones) {
      await boton.hover();
      await sinViolaciones(pagina);
    }
  });
}

test('cambiar el tema con la app abierta cambia los colores sin reiniciar', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  const fondo = (): Promise<string> => pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await pagina.getByLabel('Tema').selectOption('claro');
  await expect.poll(fondo).toBe('rgb(247, 247, 251)');
  await pagina.getByLabel('Tema').selectOption('oscuro');
  await expect.poll(fondo).toBe('rgb(19, 18, 42)');
  await pagina.getByLabel('Tema').selectOption('sistema');
  await expect(pagina.getByLabel('Tema')).toHaveValue('sistema');
});

test('zoom del 200%, colores forzados y simulación de daltonismo', async () => {
  sesion = await lanzar(undefined, ['--force-device-scale-factor=2']);
  const { pagina } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.evaluate(() => { document.body.style.zoom = '2'; });
  await pagina.waitForTimeout(300);
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await pagina.evaluate(() => { document.body.style.zoom = '1'; });

  await pagina.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await pagina.screenshot({ path: join(CAPTURAS, 'colores-forzados.png') });
  await expect(pagina.locator('[data-regla="CAR-01"]')).toContainText('Riesgo medio');
  await pagina.emulateMedia({ forcedColors: 'none' });

  const cdp = await pagina.context().newCDPSession(pagina);
  for (const tipo of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: tipo });
    await pagina.screenshot({ path: join(CAPTURAS, `${tipo}.png`) });
    // El nivel se comunica con palabra e ícono, no solo con color.
    await expect(pagina.locator('[data-regla="UBI-01"] .nivel')).toContainText('Riesgo alto');
    await expect(pagina.locator('[data-regla="UBI-01"] .nivel svg').first()).toBeVisible();
  }
});
