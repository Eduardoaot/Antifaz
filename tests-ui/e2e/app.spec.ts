import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import marca from '../../brand/brand.json';
import { abrir, cerrar, crearMuestras, entorno, lanzar, llaveGuardada, matarArbol, RAIZ, simularGuardar, type Sesion } from './ayuda';

const CAPTURAS = join(RAIZ, 'tests-ui', 'capturas');
mkdirSync(CAPTURAS, { recursive: true });

let muestras: string;
let sesion: Sesion;

test.beforeAll(() => {
  muestras = crearMuestras();
});

test.afterEach(async () => {
  // Sin esto, el aviso de cambios sin exportar detendría el cierre de la prueba.
  await Promise.race([
    sesion.app.evaluate(({ BrowserWindow }) => {
      for (const v of BrowserWindow.getAllWindows()) v.destroy();
    }).catch(() => undefined),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  await cerrar(sesion.app);
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
  await expect(pagina.getByText(/Lo que todavía no revisamos \(5\)/)).toBeVisible();
  await sinViolaciones(pagina);
});

// Muestras sensibles fuera del repo: se corre en local con REVISOR_MUESTRAS apuntando a la carpeta.
const sensibles = process.env.REVISOR_MUESTRAS;
test.describe('contenido, con muestras locales', () => {
  test.skip(sensibles === undefined || sensibles === '', 'sin muestras locales');
  for (const [archivo, regla] of [['3.jpg', 'EXT-01'], ['6.jpg', 'EXT-01'], ['5.jpg', 'DES-01']] as const) {
    test(`${archivo} avisa ${regla}`, async () => {
      sesion = await lanzar();
      const { pagina } = sesion;
      await abrir(sesion, [join(sensibles ?? '', archivo)]);
      await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
      await expect(pagina.locator(`[data-regla="${regla}"]`).first()).toContainText('Podría');
      await sinViolaciones(pagina);
      await pagina.screenshot({ path: join(CAPTURAS, `contenido-${archivo}.png`) });
    });
  }

  test('foto común: la playa no genera avisos de contenido', async () => {
    sesion = await lanzar();
    await abrir(sesion, [join(sensibles ?? '', '4.jpg')]);
    await expect(veredicto(sesion.pagina)).toBeVisible({ timeout: 60_000 });
    for (const regla of ['ARM-01', 'EXT-01', 'DES-01', 'SUG-01']) await expect(sesion.pagina.locator(`[data-regla="${regla}"]`)).toHaveCount(0);
  });
});

test('texto y código: los encuentra, los tapa y el dato no sale en la copia', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('datos.png')]);
  await expect(veredicto(pagina)).toHaveText('Revisa estas advertencias', { timeout: 90_000 });
  await expect(pagina.locator('[data-regla="CON-01"]').first()).toContainText('Podría ser un dato de contacto');
  await expect(pagina.locator('[data-regla="COD-01"]').first()).toBeVisible();
  // El texto leído no se muestra en pantalla ni en el resumen.
  await expect(pagina.getByText('8123')).toHaveCount(0);
  await sinViolaciones(pagina);
  await pagina.getByRole('button', { name: 'Ocultar todo lo detectado' }).click();
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'limpia.png');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos', { timeout: 60_000 });
  const lectura = execFileSync(
    join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe'),
    ['-c', 'import sys;from revisor import cargador,texto,codigos;i=cargador.abrir(sys.argv[1]);print(len(texto.buscar(i.pixeles)),len(codigos.buscar(i.pixeles)))', salida],
    { cwd: join(RAIZ, 'sidecar') },
  ).toString().trim();
  expect(lectura, 'el dato o el código siguen legibles en la copia').toBe('0 0');

  // ERR-004: lo que se leyó con OCR o del código no llega a los logs.
  const logs = join(sesion.datos, 'logs');
  const archivosLog = readdirSync(logs);
  expect(archivosLog.length, 'sin logs no se prueba nada').toBeGreaterThan(0);
  for (const archivo of archivosLog) {
    const texto = readFileSync(join(logs, archivo), 'utf-8');
    for (const leido of ['8123', '4567', 'persona@', 'ejemplo.com', 'Tel:']) expect(texto.includes(leido), `${archivo}: ${leido}`).toBe(false);
  }
});

test('Guía de privacidad: se consulta sin ninguna foto', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await pagina.getByRole('button', { name: 'Guía de privacidad' }).click();
  await expect(pagina.getByRole('heading', { name: 'Guía de privacidad', level: 1 })).toBeVisible();
  await expect(pagina.getByRole('heading', { name: 'Armas y grupos armados' })).toBeVisible();
  await expect(pagina.getByText('Placas de autos y motos', { exact: true })).toBeVisible();
  await sinViolaciones(pagina);
  await pagina.getByRole('button', { name: /^Ver fuentes\s*:\s*Placas/ }).click();
  await expect(pagina.getByRole('dialog')).toContainText('Aún no tenemos una fuente oficial directa');
  await sinViolaciones(pagina);
  await pagina.keyboard.press('Escape');
  await pagina.getByRole('button', { name: 'Guía de privacidad' }).click();
  await expect(pagina.getByRole('heading', { name: 'Revisa tus fotos antes de publicarlas' })).toBeVisible();
});

async function arrastrar(p: Page, de: [number, number], a: [number, number]): Promise<void> {
  const caja = await p.getByTestId('lienzo').boundingBox();
  if (caja === null) throw new Error('sin lienzo');
  await p.mouse.move(caja.x + caja.width * de[0], caja.y + caja.height * de[1]);
  await p.mouse.down();
  await p.mouse.move(caja.x + caja.width * a[0], caja.y + caja.height * a[1], { steps: 4 });
  await p.mouse.up();
}

test('rectángulo con el mouse: tapa esa zona en la copia, y se puede deshacer', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: 'Dibujar rectángulo' }).click();
  await arrastrar(pagina, [0.2, 0.2], [0.5, 0.5]);
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toBeVisible();
  await sinViolaciones(pagina);
  await pagina.keyboard.press('Control+z');
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toHaveCount(0);
  await pagina.keyboard.press('Control+y');
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toBeVisible();
  await arrastrar(pagina, [0.7, 0.7], [0.7, 0.7]);
  await expect(pagina.getByText('Tu zona 2', { exact: true })).toHaveCount(0);
  await pagina.getByRole('button', { name: /^Quitar/ }).click();
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toHaveCount(0);
  await arrastrar(pagina, [0.2, 0.2], [0.5, 0.5]);
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'rect.png');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('con 1 zona oculta', { timeout: 60_000 });
});

test('coordenadas sin mouse: valida, avisa si cubre todo y agrega', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await abrir(sesion, [m('negra.png')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByText('Escribir coordenadas (sin mouse)').click();
  const llenar = async (x: string, y: string, an: string, al: string): Promise<void> => {
    await pagina.getByLabel('X', { exact: true }).fill(x);
    await pagina.getByLabel('Y', { exact: true }).fill(y);
    await pagina.getByLabel('Ancho').fill(an);
    await pagina.getByLabel('Alto').fill(al);
    await pagina.getByRole('button', { name: 'Agregar rectángulo' }).click();
  };
  await llenar('600', '0', '100', '10');
  await expect(pagina.getByRole('alert').filter({ hasText: 'se sale de la imagen' })).toBeVisible();
  await llenar('abc', '0', '10', '10');
  await expect(pagina.getByRole('alert').filter({ hasText: 'Escribe X de 0 a 639' })).toBeVisible();
  await llenar('0', '0', '640', '480');
  await expect(pagina.getByRole('dialog')).toContainText('cubre toda la imagen');
  await pagina.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toHaveCount(0);
  await llenar('10', '10', '100', '100');
  await expect(pagina.getByText('Tu zona 1', { exact: true })).toBeVisible();
  await expect(pagina.getByText('(rectángulo)')).toBeVisible();

  // INT-012: buscar un objeto fuera de la imagen no crea nada y lo explica.
  await pagina.getByLabel('X', { exact: true }).fill('640');
  await pagina.getByLabel('Y', { exact: true }).fill('0');
  await pagina.getByRole('button', { name: 'Buscar objeto en X, Y' }).click();
  await expect(pagina.getByRole('alert').filter({ hasText: 'Escribe X de 0 a 639' })).toBeVisible();
  await expect(pagina.getByText('Tu zona 2', { exact: true })).toHaveCount(0);
});

test('clic en un objeto: SAM da la silueta y la cara deja de verse en la copia', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: 'Clic en un objeto' }).click();
  await pagina.getByTestId('lienzo').click({ position: { x: 0, y: 0 } }).catch(() => undefined);
  const caja = await pagina.getByTestId('lienzo').boundingBox();
  if (caja === null) throw new Error('sin lienzo');
  await pagina.mouse.click(caja.x + caja.width * (230 / 512), caja.y + caja.height * (100 / 512));
  await expect(pagina.getByText('(silueta)').first()).toBeVisible({ timeout: 60_000 });
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: join(CAPTURAS, 'silueta.png') });
  await pagina.getByRole('button', { name: 'No', exact: true }).click();
  await pagina.getByRole('button', { name: /^Dejar visible/ }).click();
  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'silueta.jpg');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('sin metadatos', { timeout: 60_000 });
  const lectura = execFileSync(
    join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe'),
    ['-c', 'import sys;from pathlib import Path;from revisor import cargador;from revisor.caras import DetectorCaras;i=cargador.abrir(sys.argv[1]);print(len([c for c in DetectorCaras(Path("modelos")).detectar(i.pixeles,0.25) if c.confianza>=0.6]))', salida],
    { cwd: join(RAIZ, 'sidecar') },
  ).toString().trim().split(/\s+/).at(-1);
  expect(lectura, 'la cara sigue reconocible').toBe('0');
});

test('pincel: el trazo se oculta en la copia, solo donde se pintó, y se puede deshacer', async () => {
  sesion = await lanzar();
  const { pagina, app } = sesion;
  await abrir(sesion, [m('gps.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: 'Pintar con pincel' }).click();
  const tamano = pagina.getByLabel(/^Tamaño del pincel/);
  await expect(tamano).toHaveValue('32');
  await tamano.fill('48');
  await expect(pagina.getByText('Tamaño del pincel: 48 px de la foto')).toBeVisible();
  await sinViolaciones(pagina);

  const lienzo = await pagina.getByTestId('lienzo').boundingBox();
  if (lienzo === null) throw new Error('sin lienzo');
  await pagina.mouse.move(lienzo.x + lienzo.width * 0.2, lienzo.y + lienzo.height * 0.5);
  await pagina.mouse.down();
  await pagina.mouse.move(lienzo.x + lienzo.width * 0.8, lienzo.y + lienzo.height * 0.5, { steps: 12 });
  await pagina.screenshot({ path: join(CAPTURAS, 'pincel-trazando.png') });
  await pagina.mouse.up();
  await expect(pagina.getByText('(trazo a mano)')).toBeVisible({ timeout: 30_000 });
  await expect(pagina.getByTestId('anuncio')).toContainText('Agregamos tu trazo');
  await pagina.keyboard.press('Control+z');
  await expect(pagina.getByText('(trazo a mano)')).toHaveCount(0);
  await pagina.keyboard.press('Control+y');
  await expect(pagina.getByText('(trazo a mano)')).toBeVisible();
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: join(CAPTURAS, 'pincel.png') });
  await sinViolaciones(pagina);

  const salida = join(mkdtempSync(join(tmpdir(), 'revisor-salida-')), 'pincel.png');
  await simularGuardar(app, salida);
  await pagina.getByRole('button', { name: 'Exportar copia' }).click();
  await expect(pagina.getByTestId('anuncio')).toContainText('con 1 zona oculta', { timeout: 60_000 });
  const colores = execFileSync(
    join(RAIZ, 'sidecar', '.venv', 'Scripts', 'python.exe'),
    ['-c', 'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGB");print(*[i.getpixel(p) for p in ((320,240),(150,240),(320,100),(320,400),(40,240))],sep="|")', salida],
  ).toString().trim().split('|');
  const negro = '(0, 0, 0)';
  expect(colores.slice(0, 2), 'lo pintado sale tapado').toEqual([negro, negro]);
  for (const c of colores.slice(2)) expect(c, 'fuera del trazo, la foto queda igual').not.toBe(negro);
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

/** Simula la respuesta del diálogo nativo de preguntas y cuenta cuántas veces se mostró. */
async function simularPregunta(sesion: Sesion, respuesta: number): Promise<void> {
  await sesion.app.evaluate(({ dialog }, r) => {
    const g = globalThis as unknown as { preguntas?: number };
    g.preguntas ??= 0;
    dialog.showMessageBox = (() => {
      g.preguntas = (g.preguntas ?? 0) + 1;
      return Promise.resolve({ response: r, checkboxChecked: false });
    });
  }, respuesta);
}

const preguntas = (s: Sesion): Promise<number> => s.app.evaluate(() => (globalThis as unknown as { preguntas?: number }).preguntas ?? 0);

test('lote de 500 y de 501: pregunta, nada se descarta en silencio y la interfaz no se congela', async () => {
  test.setTimeout(240_000);
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-lote-'));
  const rutas = Array.from({ length: 502 }, (_, i) => {
    const ruta = join(carpeta, `foto ${String(i).padStart(3, '0')}.png`);
    copyFileSync(m('negra.png'), ruta);
    return ruta;
  });
  sesion = await lanzar();
  const { pagina } = sesion;
  const lista = pagina.getByRole('navigation', { name: 'Fotos abiertas' }).getByRole('listitem');

  // 501: si cancelas, no se abre ninguna.
  await simularPregunta(sesion, 1);
  await abrir(sesion, rutas.slice(0, 501));
  await expect.poll(() => preguntas(sesion)).toBe(1);
  await expect(pagina.getByText('Abre una foto o arrástrala aquí.')).toBeVisible();
  await expect(lista).toHaveCount(0);

  // 501: si sigues, se abren 500 y se dice cuántas quedaron fuera.
  await simularPregunta(sesion, 0);
  const inicio = Date.now();
  await abrir(sesion, rutas.slice(0, 501));
  await expect(lista).toHaveCount(500, { timeout: 120_000 });
  const segundos = (Date.now() - inicio) / 1000;
  await expect(pagina.getByRole('alert').filter({ hasText: '1 foto más:' })).toContainText('hasta 500 fotos abiertas a la vez');
  // Con la cola llena, la interfaz sigue respondiendo y se puede cancelar.
  await pagina.getByRole('button', { name: 'Guía de privacidad' }).click();
  await expect(pagina.getByRole('heading', { name: 'Guía de privacidad', level: 1 })).toBeVisible({ timeout: 2_000 });
  await pagina.getByRole('button', { name: 'Guía de privacidad' }).click();
  await pagina.getByRole('button', { name: 'Cancelar revisión' }).click();
  await expect(pagina.getByRole('button', { name: 'Cancelar revisión' })).toHaveCount(0, { timeout: 60_000 });
  await expect(pagina.getByText('Revisando…')).toHaveCount(0);

  // Ya en el límite: una foto nueva no cabe y no hace falta preguntar; una ya abierta no cuenta.
  await abrir(sesion, [rutas[501] ?? '', rutas[0] ?? '']);
  await expect(pagina.getByRole('alert').filter({ hasText: '1 foto más:' })).toHaveCount(2);
  expect(await preguntas(sesion)).toBe(2);
  await expect(lista).toHaveCount(500);
  console.log(`500 fotos cargadas en ${segundos.toFixed(1)} s`);
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
  // Lanza la app dos veces y espera un análisis: en un equipo lento no cabe en 120 s.
  test.setTimeout(300_000);
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  const crudo = readFileSync(join(datos, 'recuperacion.json'));
  expect(crudo.length, 'la recuperación no debe llevar píxeles').toBeLessThan(4000);
  expect(crudo.includes('cara con'), 'la recuperación va cifrada').toBe(false);
  // Lo que se prueba es recuperar tras un cierre forzado, no un cierre en los primeros segundos de un perfil nuevo.
  await expect.poll(() => llaveGuardada(datos), { timeout: 60_000 }).toBe(true);
  await matarArbol(app);
  // La instancia anterior tarda un momento en soltar el candado de instancia única.
  sesion = await reintentar(() => lanzar(datos));
  const segunda = sesion.pagina;
  const dialogo = segunda.getByRole('dialog');
  await expect(dialogo).toContainText('Tienes una revisión sin terminar', { timeout: 60_000 });
  await dialogo.getByRole('button', { name: 'Recuperar' }).click();
  await expect(segunda.getByRole('button', { name: /^Ocultar zona/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
});

test('recuperación sobre una foto que cambió: no aplica las decisiones', async () => {
  // Lanza la app dos veces y espera un análisis: en un equipo lento no cabe en 120 s.
  test.setTimeout(300_000);
  const carpeta = mkdtempSync(join(tmpdir(), 'revisor-cambio-'));
  const foto = join(carpeta, 'foto.jpg');
  copyFileSync(m('cara con ñ.jpg'), foto);
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [foto]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Dejar visible/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  // Lo que se prueba es recuperar tras un cierre forzado, no un cierre en los primeros segundos de un perfil nuevo.
  await expect.poll(() => llaveGuardada(datos), { timeout: 60_000 }).toBe(true);
  await matarArbol(app);
  copyFileSync(m('gps.jpg'), foto);

  sesion = await reintentar(() => lanzar(datos));
  await expect(sesion.pagina.getByRole('alert').filter({ hasText: 'no aplicamos tus decisiones anteriores' })).toBeVisible({ timeout: 60_000 });
  await expect(sesion.pagina.getByRole('dialog')).toHaveCount(0);
});

test('el diálogo de recuperación no se borra si la app vuelve a cerrarse', async () => {
  // Lanza la app dos veces y espera un análisis: en un equipo lento no cabe en 120 s.
  test.setTimeout(300_000);
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  // Lo que se prueba es recuperar tras un cierre forzado, no un cierre en los primeros segundos de un perfil nuevo.
  await expect.poll(() => llaveGuardada(datos), { timeout: 60_000 }).toBe(true);
  await matarArbol(app);

  sesion = await reintentar(() => lanzar(datos));
  await expect(sesion.pagina.getByRole('dialog')).toContainText('sin terminar', { timeout: 60_000 });
  await sesion.pagina.waitForTimeout(800);
  expect(existsSync(join(datos, 'recuperacion.json'))).toBe(true);
});

test('al cerrar con cambios sin exportar, el aviso es de la app y se puede contestar', async () => {
  test.setTimeout(180_000);
  sesion = await lanzar();
  const { pagina, datos, app } = sesion;
  await abrir(sesion, [m('cara con ñ.jpg')]);
  await expect(veredicto(pagina)).toBeVisible({ timeout: 60_000 });
  await pagina.getByRole('button', { name: /^Ocultar zona/ }).click();
  await expect.poll(() => existsSync(join(datos, 'recuperacion.json'))).toBe(true);
  // El de Windows no se puede contestar desde la prueba: si apareciera, se cuenta y se cancela.
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { avisosWindows: number };
    g.avisosWindows = 0;
    dialog.showMessageBoxSync = () => {
      g.avisosWindows += 1;
      return 1;
    };
  });
  const pedirCierre = (): Promise<void> => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
  const aviso = pagina.getByRole('dialog').filter({ hasText: 'Tienes cambios sin exportar' });

  await pedirCierre();
  await expect(aviso).toContainText('podrás recuperarlas');
  await expect(aviso.getByRole('button', { name: 'Seguir revisando' })).toBeFocused();
  await sinViolaciones(pagina);
  // Con el aviso abierto no se puede usar el selector de tema: se cambia por la API.
  for (const tema of ['claro', 'oscuro'] as const) {
    await pagina.evaluate((t) => window.revisor.definirTema(t), tema);
    await pagina.screenshot({ path: join(CAPTURAS, `aviso-cierre-${tema}.png`) });
  }
  await aviso.getByRole('button', { name: 'Seguir revisando' }).click();
  await expect(aviso).toHaveCount(0);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  await pedirCierre();
  await expect(aviso).toBeVisible();
  expect(await app.evaluate(() => (globalThis as unknown as { avisosWindows: number }).avisosWindows)).toBe(0);
  const cerrada = app.waitForEvent('close');
  // Clic diferido: la ventana se cierra antes de que Playwright termine un clic normal.
  await aviso.getByRole('button', { name: 'Cerrar de todos modos' }).evaluate((b: HTMLElement) => { setTimeout(() => { b.click(); }, 0); });
  await cerrada;
  expect(existsSync(join(datos, 'recuperacion.json')), 'cerrar no borra lo que se puede recuperar').toBe(true);
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

test('modo de video: se entra sin archivo, dice lo que no hace y es accesible', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  await pagina.getByRole('button', { name: 'Video' }).click();
  await expect(pagina.getByRole('heading', { name: 'Revisa un video antes de publicarlo' })).toBeVisible();
  await expect(pagina.getByText('hasta 3 segundos')).toBeVisible();
  await expect(pagina.getByText('Todavía no detectamos nada solos en video')).toBeVisible();
  // Un solo destino para "Saltar al contenido", aunque el modo de fotos siga montado.
  await expect(pagina.locator('#principal')).toHaveCount(1);
  await sinViolaciones(pagina);
  for (const tema of ['claro', 'oscuro'] as const) {
    await pagina.getByLabel('Tema').selectOption(tema);
    await pagina.screenshot({ path: join(CAPTURAS, `video-vacio-${tema}.png`) });
  }
  await pagina.getByRole('button', { name: 'Fotos' }).click();
  await expect(pagina.getByRole('heading', { name: 'Revisa tus fotos antes de publicarlas' })).toBeVisible();
  await expect(pagina.locator('#principal')).toHaveCount(1);
});

test('video: el renderer no puede pedir nada inválido', async () => {
  sesion = await lanzar();
  const { pagina } = sesion;
  const r = await pagina.evaluate(async () => {
    const id = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
    const api = window.revisor as unknown as Record<string, (...a: unknown[]) => Promise<{ error?: { codigo: string } }>>;
    const cod = async (f: Promise<{ error?: { codigo: string } }>): Promise<string> => (await f).error?.codigo ?? 'ok';
    const pista = { pista_id: 'a', efecto: 'solido' };
    return {
      idMalo: await cod(api.vistaVideo!('../x', 0, [])),
      posicionNegativa: await cod(api.vistaVideo!(id, -1, [])),
      posicionDecimal: await cod(api.vistaVideo!(id, 1.5, [])),
      repetidas: await cod(api.vistaVideo!(id, 0, [pista, pista])),
      efectoMalo: await cod(api.exportarVideo!(id, [{ pista_id: 'a', efecto: 'borroso' }])),
      coordenadaNaN: await cod(api.seguirVideo!(id, 0, Number.NaN, 0)),
      noAbierto: await cod(api.vistaVideo!(id, 0, [])),
      seguirNoAbierto: await cod(api.seguirVideo!(id, 0, 1, 1)),
    };
  });
  expect(r).toEqual({
    idMalo: 'VALIDACION', posicionNegativa: 'VALIDACION', posicionDecimal: 'VALIDACION', repetidas: 'VALIDACION',
    efectoMalo: 'VALIDACION', coordenadaNaN: 'VALIDACION', noAbierto: 'VIDEO_NO_ABIERTO', seguirNoAbierto: 'VIDEO_NO_ABIERTO',
  });
});
