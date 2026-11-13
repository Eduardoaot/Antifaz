import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Regla } from '../../shared/catalogo';
import { esEmoji, LIMITES, type Hallazgo, type Ocultamiento, type Punto } from '../../shared/contrato';
import {
  agregarPuntoTrazo,
  anchoAjustado,
  aPuntoDeImagen,
  cajaConMargen,
  cajaEntre,
  construirOcultamientos,
  descartarZona,
  desplazamientoAnclado,
  efectoDe,
  escalaDe,
  limitarCorte,
  limitarZoom,
  margenPctDe,
  opacidadRotulo,
  pasoZoom,
  posicionDe,
  rotacionDe,
  textoZoom,
  zonaEnPunto,
  zonasConSticker,
  type Caja,
  type CambioSticker,
  type Herramienta,
  type Resaltado,
  type Revision,
} from '../../shared/logica';
import type { Archivo } from './App';
import { BarraHerramientas } from './BarraHerramientas';
import { MarcoSticker } from './Sticker';
import { TarjetaZona, type ZonaElegida } from './TarjetaZona';

/** Lo que la cinta de herramientas necesita de afuera. Comparar vive aquí, en el visor. */
export type PropsBarra = Omit<React.ComponentProps<typeof BarraHerramientas>, 'comparando' | 'alComparar' | 'atenuada'>;

interface Props {
  archivo: Archivo;
  hallazgos: readonly Hallazgo[];
  ocultamientos: readonly Ocultamiento[];
  revision: Revision | null;
  herramienta: Herramienta;
  tamanoPincel: number;
  alClic: (x: number, y: number) => void;
  alDibujar: (caja: Caja) => void;
  alPintar: (puntos: Punto[]) => void;
  alFuera: () => void;
  /** Zona resaltada a la vez aquí y en el panel. */
  resaltado?: Resaltado | null;
  alResaltar?: (r: Resaltado | null) => void;
  /** Con "Solo ver", un clic en una zona abre su explicación junto a ella. */
  alCambiar?: (cambio: (r: Revision) => Revision) => void;
  alQuitarManual?: (id: string) => void;
  alPorQue?: (regla: Regla) => void;
  barra: PropsBarra;
  /** Sticker de una cara elegido para moverlo o cambiar su tamaño. El panel abre sus controles. */
  seleccionSticker?: string | null;
  alSeleccionarSticker?: (id: string | null) => void;
  alAjustarSticker?: (h: Hallazgo, cambio: CambioSticker) => void;
}

const porcentajes = (c: Caja, ancho: number, alto: number): React.CSSProperties => ({
  left: `${(c.x / ancho) * 100}%`,
  top: `${(c.y / alto) * 100}%`,
  width: `${(c.ancho / ancho) * 100}%`,
  height: `${(c.alto / alto) * 100}%`,
});

/** Más de esto, en píxeles de pantalla, ya es arrastrar y no un clic. */
const UMBRAL_ARRASTRE = 4;
/** Un clic a esta distancia de una zona, en píxeles de pantalla, también la elige: las chicas se alcanzan. */
const TOLERANCIA_CLIC = 10;
/** Por debajo de esto, en píxeles de pantalla, la zona se señala con un anillo alrededor. */
const ZONA_DIMINUTA = 22;
/** Tiempo que se ven los rótulos de la comparación tras moverla. */
const ROTULOS_MS = 1800;
/** En ventanas angostas la imagen usa todo el ancho; al acercarla, la ventana de la imagen se limita. */
const CONSULTA_ANGOSTA = '(max-width: 1000px)';

/** Relleno horizontal y vertical total de un elemento, en píxeles. */
function rellenoDe(estilo: CSSStyleDeclaration): { x: number; y: number } {
  const px = (valor: string): number => Number.parseFloat(valor) || 0;
  return {
    x: px(estilo.paddingLeft) + px(estilo.paddingRight),
    y: px(estilo.paddingTop) + px(estilo.paddingBottom),
  };
}

interface Arrastre {
  x: number;
  y: number;
  izquierda: number;
  arriba: number;
  movido: boolean;
  boton: number;
}

/** La imagen la dibuja el sidecar con los mismos efectos que la exportación: lo que ves es lo que sale. */
export function Visor({ archivo, hallazgos, ocultamientos, revision, herramienta, tamanoPincel, alClic, alDibujar, alPintar, alFuera, resaltado = null, alResaltar, alCambiar, alQuitarManual, alPorQue, barra, seleccionSticker = null, alSeleccionarSticker, alAjustarSticker }: Props): React.JSX.Element {
  const { id, ancho, alto, nombre } = archivo.info;
  const [arrastrado, setArrastrado] = useState<string | null>(null);
  // Mientras se arrastra un sticker, la vista va sin él: si no, se vería dos veces.
  const clave = useMemo(() => {
    if (arrastrado === null || revision === null) return JSON.stringify(ocultamientos);
    const sin = {
      ...revision,
      decisiones: { ...revision.decisiones, [arrastrado]: 'ignorar' as const },
      manuales: revision.manuales.filter((z) => z.id !== arrastrado),
    };
    return JSON.stringify(construirOcultamientos(sin, hallazgos));
  }, [arrastrado, revision, hallazgos, ocultamientos]);
  const [url, setUrl] = useState<string | null>(null);
  const [vistaDe, setVistaDe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [actual, setActual] = useState<{ x: number; y: number } | null>(null);
  const [trazo, setTrazo] = useState<readonly Punto[] | null>(null);
  const [zoom, setZoom] = useState<number>(LIMITES.zoom.porDefecto);
  const [ajuste, setAjuste] = useState<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Comparar antes y después. La original se pide al sidecar con cero ocultamientos, solo al comparar.
  const [comparando, setComparando] = useState(false);
  const [urlOriginal, setUrlOriginal] = useState<string | null>(null);
  const [errorOriginal, setErrorOriginal] = useState<string | null>(null);
  const [corte, setCorte] = useState<number>(LIMITES.comparacion.porDefecto);
  // "cortina": una línea que se arrastra; "lado": las dos versiones una junto a la otra.
  const [modoComparar, setModoComparar] = useState<'cortina' | 'lado'>('cortina');
  // Los rótulos "Original" y "Tu copia" se van solos tras un momento para ver la imagen completa.
  const [rotulos, setRotulos] = useState(true);
  const esperaRotulos = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mostrarRotulos = (): void => {
    setRotulos(true);
    clearTimeout(esperaRotulos.current);
    esperaRotulos.current = setTimeout(() => { setRotulos(false); }, ROTULOS_MS);
  };
  useEffect(() => () => { clearTimeout(esperaRotulos.current); }, []);
  const moviendoCorte = useRef(false);
  // Zona cuya explicación está abierta, y una clave que cambia al moverse la imagen para recolocarla.
  const [abierta, setAbierta] = useState<string | null>(null);
  const [desplazamiento, setDesplazamiento] = useState(0);
  const marco = useRef<HTMLDivElement | null>(null);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const ventana = useRef<HTMLDivElement | null>(null);
  const ancla = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const listo = url !== null;
  const ampliada = zoom > LIMITES.zoom.min;

  useEffect(() => {
    let vigente = true;
    let creada: string | null = null;
    void window.revisor.vista(id, JSON.parse(clave) as Ocultamiento[]).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) {
        creada = URL.createObjectURL(new Blob([new Uint8Array(resultado.datos.datos)], { type: resultado.datos.mime }));
        setUrl(creada);
        setVistaDe(clave);
        setError(null);
      } else {
        setUrl(null);
        setError(resultado.error.mensaje);
      }
    });
    return () => {
      vigente = false;
      if (creada !== null) URL.revokeObjectURL(creada);
    };
  }, [id, clave]);

  // La original no cambia con las decisiones: se pide una vez y se libera al salir de esta foto.
  const pedirOriginal = comparando && urlOriginal === null && errorOriginal === null;
  useEffect(() => {
    if (!pedirOriginal) return undefined;
    let vigente = true;
    window.revisor.vista(id, []).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) {
        setUrlOriginal(URL.createObjectURL(new Blob([new Uint8Array(resultado.datos.datos)], { type: resultado.datos.mime })));
      } else {
        setErrorOriginal(resultado.error.mensaje);
      }
    }, () => {
      if (vigente) setErrorOriginal('Inténtalo de nuevo en un momento.');
    });
    return () => {
      vigente = false;
    };
  }, [id, pedirOriginal]);
  useEffect(() => () => {
    if (urlOriginal !== null) URL.revokeObjectURL(urlOriginal);
  }, [urlOriginal]);

  const alternarComparar = (): void => {
    setComparando((c) => !c);
    mostrarRotulos();
    // Si falló antes, al volver a pedir la comparación se intenta otra vez.
    setErrorOriginal(null);
  };

  const corteEn = (clienteX: number): void => {
    const rect = lienzo.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0) return;
    setCorte(limitarCorte(((clienteX - rect.left) / rect.width) * 100));
  };

  // Tamaño al 100 %: lo más grande que cabe en la ventana. Se vuelve a medir si la ventana cambia.
  useEffect(() => {
    const v = ventana.current;
    if (v === null) return undefined;
    const medir = (): void => {
      const estilo = getComputedStyle(v);
      const relleno = rellenoDe(estilo);
      const angosta = window.matchMedia(CONSULTA_ANGOSTA).matches;
      // En ventana ancha el área se adapta a la foto hasta un tope (max-height, que incluye el relleno
      // por box-sizing: border-box). El tope no cambia al acercar, así el tamaño base no brinca.
      // En angosta manda el ancho.
      //
      // Ancho desde el border-box (offsetWidth), no clientWidth: si aparece o desaparece la barra
      // de desplazamiento (p. ej. al comparar una foto ancha), clientWidth oscila y el ajuste
      // entra en un bucle de parpadeo. offsetWidth no depende de esa barra.
      const bordeX = (Number.parseFloat(estilo.borderLeftWidth) || 0) + (Number.parseFloat(estilo.borderRightWidth) || 0);
      const disponibleAncho = v.offsetWidth - bordeX - relleno.x;
      const tope = Number.parseFloat(estilo.maxHeight);
      const disponibleAlto = angosta || !Number.isFinite(tope) ? null : tope - relleno.y;
      const siguiente = anchoAjustado(disponibleAncho, disponibleAlto, ancho, alto);
      setAjuste((prev) => (prev === siguiente ? prev : siguiente));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(v);
    window.addEventListener('resize', medir);
    return () => {
      observador.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, [ancho, alto, listo]);

  // Tras el zoom, el punto que estaba bajo el cursor (o el centro) sigue en el mismo lugar.
  useLayoutEffect(() => {
    const a = ancla.current;
    const v = ventana.current;
    const l = lienzo.current;
    if (a === null || v === null || l === null) return;
    ancla.current = null;
    // El contenido desplazable es la imagen más el relleno gris de cada lado.
    const relleno = rellenoDe(getComputedStyle(v));
    const total = (lado: number, rellenoLado: number, fraccion: number): [number, number] => [
      (rellenoLado / 2 + fraccion * lado) / (lado + rellenoLado),
      lado + rellenoLado,
    ];
    const [fx, anchoTotal] = total(l.offsetWidth, relleno.x, a.fx);
    const [fy, altoTotal] = total(l.offsetHeight, relleno.y, a.fy);
    v.scrollLeft = desplazamientoAnclado(fx, a.vx, anchoTotal, v.clientWidth);
    v.scrollTop = desplazamientoAnclado(fy, a.vy, altoTotal, v.clientHeight);
  }, [zoom]);

  const cambiarZoom = (nuevo: number, cliente?: { x: number; y: number }): void => {
    const z = limitarZoom(nuevo);
    const v = ventana.current;
    const l = lienzo.current;
    if (z === zoom || v === null || l === null) return;
    const rv = v.getBoundingClientRect();
    const rl = l.getBoundingClientRect();
    const cx = cliente?.x ?? rv.left + v.clientWidth / 2;
    const cy = cliente?.y ?? rv.top + v.clientHeight / 2;
    ancla.current = { fx: (cx - rl.left) / rl.width, fy: (cy - rl.top) / rl.height, vx: cx - rv.left, vy: cy - rv.top };
    setZoom(z);
  };

  // Ctrl + y Ctrl − acercan y alejan la foto desde cualquier parte; Ctrl 0 la ajusta. Con un diálogo
  // abierto no hacen nada. El tamaño de la interfaz queda en Ctrl Mayús + y −, en el menú Ver.
  const alTeclaZoom = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    alTeclaZoom.current = (e: globalThis.KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || document.querySelector('dialog[open]') !== null) return;
      if (e.key === '+' || e.key === '=') cambiarZoom(pasoZoom(zoom, 1));
      else if (e.key === '-') cambiarZoom(pasoZoom(zoom, -1));
      else if (e.key === '0') cambiarZoom(LIMITES.zoom.min);
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const oyente = (e: globalThis.KeyboardEvent): void => { alTeclaZoom.current(e); };
    window.addEventListener('keydown', oyente);
    return () => { window.removeEventListener('keydown', oyente); };
  }, []);

  /*
   * Zoom con la rueda y con dos dedos. Necesita un oyente no pasivo para que la página no haga su zoom.
   * - Pellizco del touchpad (llega como rueda con Ctrl) y Ctrl + rueda: zoom continuo, suave.
   * - Rueda del mouse (saltos enteros y verticales): un nivel por muesca.
   * - Deslizar dos dedos en el touchpad (pasos chicos o de lado): mueve la imagen ampliada.
   */
  const alRuedaActual = useRef<(e: WheelEvent) => void>(() => undefined);
  useEffect(() => {
    alRuedaActual.current = (e: WheelEvent): void => {
      const punto = { x: e.clientX, y: e.clientY };
      if (e.ctrlKey) {
        e.preventDefault();
        cambiarZoom(zoom * Math.exp(-e.deltaY * 0.01), punto);
        return;
      }
      // Sin exigir entero: en Windows la rueda a veces manda 100.0… y el zoom no disparaba.
      const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 2;
      const deRaton = e.deltaMode !== 0 || (vertical && Math.abs(e.deltaY) >= 40);
      if (!deRaton) return;
      e.preventDefault();
      cambiarZoom(pasoZoom(zoom, e.deltaY < 0 ? 1 : -1), punto);
    };
  });
  useEffect(() => {
    const v = ventana.current;
    if (v === null) return undefined;
    const alRueda = (e: WheelEvent): void => { alRuedaActual.current(e); };
    v.addEventListener('wheel', alRueda, { passive: false });
    return () => { v.removeEventListener('wheel', alRueda); };
  }, [listo]);

  const conCaja = hallazgos.filter((h) => h.caja !== null && revision?.descartadas.includes(h.id) !== true);
  // Las marcas auto se dibujan dilatadas: el clic usa la misma caja para que coincida con lo que se ve.
  const zonas = [
    ...conCaja.flatMap((h) => {
      if (h.caja === null) return [];
      const caja = revision === null ? h.caja : cajaConMargen(h.caja, margenPctDe(revision, h.id), ancho, alto);
      return [{ id: h.id, caja }];
    }),
    ...(revision?.manuales ?? []).map((z) => ({ id: z.id, caja: { x: z.x, y: z.y, ancho: z.ancho, alto: z.alto } })),
  ];

  // Stickers que se pueden mover, en cualquier zona con emoji (también las tuyas): solo con "Solo ver",
  // para no competir con las herramientas.
  const editables = !comparando && herramienta === 'ninguna' && revision !== null && alAjustarSticker !== undefined;
  const stickers = editables ? zonasConSticker(revision, conCaja) : [];
  const elegido = stickers.find((h) => h.id === seleccionSticker);

  // Con el teclado en el panel, la imagen ampliada se mueve para mostrar la zona.
  useEffect(() => {
    if (resaltado?.origen !== 'foco' || !ampliada) return;
    const marca = lienzo.current?.querySelector<HTMLElement>(`[data-marca="${CSS.escape(resaltado.id)}"]`);
    marca?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [resaltado, ampliada]);

  /** Cuántos píxeles de la imagen mide la tolerancia del clic a este zoom. */
  const margenClic = (): number => {
    const ancho_pantalla = lienzo.current?.getBoundingClientRect().width ?? 0;
    return ancho_pantalla > 0 ? (TOLERANCIA_CLIC * ancho) / ancho_pantalla : 0;
  };

  // Ctrl X o Supr quitan la zona elegida: la tuya se borra; la detectada se quita de la foto.
  const alTeclaQuitar = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    alTeclaQuitar.current = (e: globalThis.KeyboardEvent): void => {
      const quitar = (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'x') || e.key === 'Delete';
      const objetivo = e.target;
      const enCampo = objetivo instanceof HTMLInputElement || objetivo instanceof HTMLSelectElement || objetivo instanceof HTMLTextAreaElement;
      const id = abierta ?? seleccionSticker;
      if (!quitar || enCampo || id === null || revision === null || document.querySelector('dialog[open]') !== null) return;
      e.preventDefault();
      setAbierta(null);
      alSeleccionarSticker?.(null);
      if (revision.manuales.some((z) => z.id === id)) alQuitarManual?.(id);
      else alCambiar?.((r) => descartarZona(r, id));
    };
  });
  useEffect(() => {
    const oyente = (e: globalThis.KeyboardEvent): void => { alTeclaQuitar.current(e); };
    window.addEventListener('keydown', oyente);
    return () => { window.removeEventListener('keydown', oyente); };
  }, []);

  useEffect(() => {
    if (abierta === null) return undefined;
    const alPresionar = (e: globalThis.PointerEvent): void => {
      const objetivo = e.target;
      if (!(objetivo instanceof Node)) return;
      const enTarjeta = marco.current?.querySelector('.tarjeta-zona')?.contains(objetivo) === true;
      const enImagen = lienzo.current?.contains(objetivo) === true;
      if (!enTarjeta && !enImagen) setAbierta(null);
    };
    document.addEventListener('pointerdown', alPresionar);
    return () => { document.removeEventListener('pointerdown', alPresionar); };
  }, [abierta]);

  const elegida: ZonaElegida | null = (() => {
    if (abierta === null || revision === null) return null;
    const h = conCaja.find((x) => x.id === abierta);
    if (h !== undefined) return { tipo: 'hallazgo', hallazgo: h };
    const i = revision.manuales.findIndex((z) => z.id === abierta);
    const zona = revision.manuales[i];
    return zona === undefined ? null : { tipo: 'manual', zona, numero: i + 1 };
  })();

  const punto = (e: PointerEvent): { x: number; y: number } | null => {
    const rect = lienzo.current?.getBoundingClientRect();
    return rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto);
  };

  const resaltarEn = (e: PointerEvent): void => {
    if (alResaltar === undefined) return;
    const p = punto(e);
    const zona = p === null ? null : zonaEnPunto(p.x, p.y, zonas, margenClic());
    if (zona === null) {
      if (resaltado?.origen === 'imagen') alResaltar(null);
    } else if (resaltado?.id !== zona) {
      alResaltar({ id: zona, origen: 'imagen' });
    }
  };

  const alBajar = (e: PointerEvent): void => {
    // Un clic fuera del sticker elegido lo suelta; el sticker mismo no deja llegar su clic hasta aquí.
    if (seleccionSticker !== null && e.button === 0) alSeleccionarSticker?.(null);
    // Botón central siempre, o "Solo ver" con el principal: mover la imagen.
    if (e.button === 1 || (!comparando && herramienta === 'ninguna' && e.button === 0)) {
      const v = ventana.current;
      if (v === null) return;
      if (e.button === 1) e.preventDefault();
      arrastre.current = { x: e.clientX, y: e.clientY, izquierda: v.scrollLeft, arriba: v.scrollTop, movido: false, boton: e.button };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // Al comparar, las herramientas no actúan: el botón principal mueve la línea.
    if (comparando) {
      moviendoCorte.current = true;
      corteEn(e.clientX);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (herramienta === 'rectangulo') {
      const p = punto(e);
      setInicio(p);
      setActual(p);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (herramienta === 'pincel') {
      const p = punto(e);
      if (p === null) return;
      setTrazo([p]);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const alMover = (e: PointerEvent): void => {
    const a = arrastre.current;
    if (a !== null) {
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      if (!a.movido && Math.abs(dx) + Math.abs(dy) > UMBRAL_ARRASTRE) {
        a.movido = true;
        setArrastrando(true);
      }
      if (a.movido && ventana.current !== null) {
        ventana.current.scrollLeft = a.izquierda - dx;
        ventana.current.scrollTop = a.arriba - dy;
      }
      return;
    }
    if (comparando) {
      if (moviendoCorte.current) {
        corteEn(e.clientX);
        mostrarRotulos();
      }
      return;
    }
    if (trazo !== null) {
      const rect = lienzo.current?.getBoundingClientRect();
      // Al salirse con el pincel, el trazo sigue por el borde: no se pinta fuera de la imagen.
      const p = rect === undefined ? null : aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true);
      if (p !== null) setTrazo((t) => (t === null ? t : agregarPuntoTrazo(t, p, tamanoPincel)));
      return;
    }
    if (inicio === null) {
      resaltarEn(e);
      return;
    }
    const rect = lienzo.current?.getBoundingClientRect();
    if (rect !== undefined) setActual(aPuntoDeImagen(e.clientX, e.clientY, rect, ancho, alto, true));
  };

  const alSoltar = (e: PointerEvent): void => {
    const a = arrastre.current;
    if (a !== null) {
      arrastre.current = null;
      setArrastrando(false);
      // Un clic sin arrastrar en "Solo ver": abre la explicación de la zona, o la cierra si fue fuera.
      if (!a.movido && a.boton === 0 && herramienta === 'ninguna') {
        const p = punto(e);
        const zona = p === null ? null : zonaEnPunto(p.x, p.y, zonas, margenClic());
        setAbierta(zona);
        if (zona !== null) alResaltar?.({ id: zona, origen: 'imagen' });
      }
      return;
    }
    if (comparando) {
      moviendoCorte.current = false;
      return;
    }
    if (herramienta === 'clic') {
      if (e.button !== 0) return;
      const p = punto(e);
      if (p === null) alFuera();
      else alClic(p.x, p.y);
      return;
    }
    if (trazo !== null) {
      alPintar([...trazo]);
      setTrazo(null);
      return;
    }
    if (inicio !== null && actual !== null) {
      const caja = cajaEntre(inicio, actual);
      if (caja !== null) alDibujar(caja);
    }
    setInicio(null);
    setActual(null);
  };

  /** Con un sticker elegido: flechas lo mueven (Mayús, más), [ y ] cambian su tamaño, Esc lo suelta. */
  const teclaSticker = (e: KeyboardEvent): boolean => {
    if (elegido === undefined || revision === null || alAjustarSticker === undefined) return false;
    const { paso, pasoGrande } = LIMITES.posicionSticker;
    const d = e.shiftKey ? pasoGrande : paso;
    const p = posicionDe(revision, elegido.id);
    const escala = escalaDe(revision, elegido.id);
    switch (e.key) {
      case 'ArrowUp': alAjustarSticker(elegido, { posicion: { x: p.x, y: p.y - d } }); return true;
      case 'ArrowDown': alAjustarSticker(elegido, { posicion: { x: p.x, y: p.y + d } }); return true;
      case 'ArrowLeft': alAjustarSticker(elegido, { posicion: { x: p.x - d, y: p.y } }); return true;
      case 'ArrowRight': alAjustarSticker(elegido, { posicion: { x: p.x + d, y: p.y } }); return true;
      case ',': alAjustarSticker(elegido, { rotacion: rotacionDe(revision, elegido.id) - LIMITES.rotacionSticker.paso }); return true;
      case '.': alAjustarSticker(elegido, { rotacion: rotacionDe(revision, elegido.id) + LIMITES.rotacionSticker.paso }); return true;
      case '[': alAjustarSticker(elegido, { escala: escala - LIMITES.escalaSticker.paso }); return true;
      case ']': alAjustarSticker(elegido, { escala: escala + LIMITES.escalaSticker.paso }); return true;
      case 'Escape': alSeleccionarSticker?.(null); return true;
      default: return false;
    }
  };

  const alTecla = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (teclaSticker(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === '+' || e.key === '=') cambiarZoom(pasoZoom(zoom, 1));
    else if (e.key === '-') cambiarZoom(pasoZoom(zoom, -1));
    else if (e.key === '0') cambiarZoom(LIMITES.zoom.min);
    else return;
    e.preventDefault();
  };

  const dibujo = inicio !== null && actual !== null ? cajaEntre(inicio, actual) : null;
  // Píxeles de pantalla por píxel de la imagen, del ancho que el visor le da al lienzo.
  const escala = ajuste === null || ancho <= 0 ? 0 : (ajuste * zoom) / ancho;
  const claseMarca = (zona: string, caja: Caja): string =>
    `${resaltado?.id === zona || abierta === zona ? ' resaltada' : ''}${Math.max(caja.ancho, caja.alto) * escala < ZONA_DIMINUTA ? ' diminuta' : ''}`;
  const sobreZona = !comparando && herramienta === 'ninguna' && resaltado?.origen === 'imagen';
  // Mientras se dibuja o pinta, la cinta se aparta para no estorbar.
  const dibujando = inicio !== null || trazo !== null;
  const original = comparando ? urlOriginal : null;
  const verTarjeta = elegida !== null && !comparando && herramienta === 'ninguna' && revision !== null && alCambiar !== undefined;

  if (error !== null) return <p role="alert">No pudimos mostrar la vista previa. {error}</p>;
  if (url === null) return <p className="suave preparando">Preparando la vista previa…</p>;
  return (
    <figure className={`visor${comparando ? ' con-comparar' : ''}`}>
      {/* El marco ancla las barras flotantes al área visible: con zoom, la imagen se desplaza y ellas no. */}
      <div className="marco-visor" ref={marco}>
        <BarraHerramientas {...barra} comparando={comparando} alComparar={alternarComparar} atenuada={dibujando} />
        <span className="solo-lector" id="pista-zoom">
          {comparando
            ? 'Arrastra la línea o usa el control de abajo. Las herramientas están en pausa.'
            : elegido !== undefined
              ? 'Arrastra el sticker o usa las flechas. Las esquinas o [ y ] cambian su tamaño. Esc para terminar.'
              : stickers.length > 0
                ? 'Arrastra un sticker para moverlo. Haz clic en una zona para ver por qué es un riesgo. Ctrl + rueda o + y − para acercar.'
                : ampliada
              ? herramienta === 'ninguna' ? 'Arrastra la imagen para moverte. Haz clic en una zona para ver por qué es un riesgo.' : 'Muévete con la rueda, las barras o el botón central del mouse.'
              : herramienta === 'ninguna' ? 'Haz clic en una zona para ver por qué es un riesgo. Ctrl + rueda o las teclas + y − para acercar.' : 'Ctrl + rueda o las teclas + y − para acercar.'}
        </span>
        <div
          ref={ventana}
          className={`ventana-lienzo${ampliada ? ' ampliada' : ''}`}
          tabIndex={0}
          role="group"
          aria-label="Imagen"
          aria-describedby="pista-zoom"
          onKeyDown={alTecla}
          onScroll={() => { if (abierta !== null) setDesplazamiento((n) => n + 1); }}
        >
          {comparando && modoComparar === 'lado' && urlOriginal !== null && (
            <div className="dos-lados" onPointerMove={mostrarRotulos}>
              <figure style={{ aspectRatio: `${ancho} / ${alto}` }}>
                <img src={urlOriginal} draggable={false} alt={`Original de ${nombre}, sin ocultar nada.`} />
                <figcaption className="rotulo antes" style={{ opacity: rotulos ? 1 : 0 }}>Original</figcaption>
              </figure>
              <figure style={{ aspectRatio: `${ancho} / ${alto}` }}>
                <img src={url} draggable={false} alt={`Tu copia de ${nombre}, con lo que decidiste ocultar.`} />
                <figcaption className="rotulo despues" style={{ opacity: rotulos ? 1 : 0 }}>Tu copia</figcaption>
              </figure>
            </div>
          )}
          <div
            hidden={comparando && modoComparar === 'lado' && urlOriginal !== null}
            ref={lienzo}
            className={`lienzo ${comparando ? 'comparando' : `herramienta-${herramienta}`}${arrastrando ? ' arrastrando' : ''}${sobreZona ? ' sobre-zona' : ''}${dibujando ? ' dibujando' : ''}`}
            style={{ aspectRatio: `${ancho} / ${alto}`, width: ajuste === null ? '100%' : `${Math.round(ajuste * zoom)}px` }}
            data-testid="lienzo"
            onPointerDown={alBajar}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerLeave={() => { if (resaltado?.origen === 'imagen') alResaltar?.(null); }}
            onPointerCancel={() => { arrastre.current = null; moviendoCorte.current = false; setArrastrando(false); setTrazo(null); setInicio(null); setActual(null); }}
          >
            <img src={url} draggable={false} alt={`Vista previa de ${nombre}. El detalle está en el panel de advertencias.`} />
            {original !== null && (
              <>
                {/* La parte izquierda muestra la original; la derecha, la copia con lo que decidiste ocultar. */}
                <img className="original" src={original} draggable={false} alt={`Original de ${nombre}, sin ocultar nada, en el ${corte} % izquierdo.`} style={{ clipPath: `inset(0 ${100 - corte}% 0 0)` }} />
                <div className="corte" aria-hidden="true" style={{ left: `${corte}%` }}><span /></div>
                {/* Se desvanecen cuando la línea se acerca a su lado, para no quedar encima de la otra versión. */}
                <span className="rotulo antes" aria-hidden="true" style={{ opacity: rotulos ? opacidadRotulo(corte) : 0 }}>Original</span>
                <span className="rotulo despues" aria-hidden="true" style={{ opacity: rotulos ? opacidadRotulo(100 - corte) : 0 }}>Tu copia</span>
              </>
            )}
            {/* Sin números encima: el contorno va por fuera y una zona diminuta lleva un anillo. */}
            {!comparando && conCaja.map((h) => {
              const caja = h.caja;
              if (caja === null) return null;
              const vista = revision === null ? caja : cajaConMargen(caja, margenPctDe(revision, h.id), ancho, alto);
              return (
                <div
                  key={h.id}
                  aria-hidden="true"
                  data-marca={h.id}
                  className={`marca ${revision?.decisiones[h.id] ?? 'sin-decidir'}${claseMarca(h.id, vista)}`}
                  style={porcentajes(vista, ancho, alto)}
                />
              );
            })}
            {!comparando && revision?.manuales.map((z) => (
              <div key={z.id} aria-hidden="true" data-marca={z.id} className={`marca ocultar manual${claseMarca(z.id, z)}`} style={porcentajes(z, ancho, alto)} />
            ))}
            {revision !== null && stickers.map((h) => {
              const efecto = efectoDe(revision, h);
              if (!esEmoji(efecto)) return null;
              return (
                <MarcoSticker
                  key={`sticker-${h.id}`}
                  hallazgo={h}
                  emoji={efecto}
                  revision={revision}
                  ancho={ancho}
                  alto={alto}
                  lienzo={lienzo}
                  seleccionado={h.id === seleccionSticker}
                  alSeleccionar={(sid) => { alSeleccionarSticker?.(sid); }}
                  alAjustar={(hz, cambio) => { alAjustarSticker?.(hz, cambio); }}
                  alArrastrar={setArrastrado}
                  vistaAlDia={vistaDe === clave}
                />
              );
            })}
            {dibujo !== null && <div aria-hidden="true" className="marca sin-decidir" style={porcentajes(dibujo, ancho, alto)} />}
            {trazo !== null && (
              <svg aria-hidden="true" className="trazo" viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none">
                <polyline
                  points={trazo.map((p) => `${p.x + 0.5},${p.y + 0.5}`).join(' ')}
                  strokeWidth={tamanoPincel}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </div>
        {verTarjeta && (
          <TarjetaZona
            elegida={elegida}
            revision={revision}
            lienzo={lienzo}
            marco={marco}
            posicionClave={`${zoom}-${desplazamiento}-${ajuste ?? 0}`}
            alCambiar={alCambiar}
            alQuitarManual={(zid) => { setAbierta(null); alQuitarManual?.(zid); }}
            alPorQue={(regla) => { alPorQue?.(regla); }}
            alCerrar={() => {
              setAbierta(null);
              ventana.current?.focus({ preventScroll: true });
            }}
          />
        )}
        {/* Herramientas de vista: compactas, sobre la esquina, para no competir con la foto. */}
        <div className={`barra-visor${dibujando ? ' atenuada' : ''}${ampliada ? ' con-barras' : ''}`} role="group" aria-label="Vista de la imagen">
          <button type="button" className="boton chico" aria-label="Alejar" title="Alejar (−)" disabled={zoom <= LIMITES.zoom.min} onClick={() => { cambiarZoom(pasoZoom(zoom, -1)); }}>
            <ZoomOut aria-hidden="true" />
          </button>
          <output className="nivel-zoom" aria-live="polite" aria-label={`Zoom al ${textoZoom(zoom)}`}>{textoZoom(zoom)}</output>
          <button type="button" className="boton chico" aria-label="Acercar" title="Acercar (+)" disabled={zoom >= LIMITES.zoom.max} onClick={() => { cambiarZoom(pasoZoom(zoom, 1)); }}>
            <ZoomIn aria-hidden="true" />
          </button>
          <button type="button" className="boton chico" aria-label="Ajustar" title="Ajustar a la ventana (0)" disabled={!ampliada} onClick={() => { cambiarZoom(LIMITES.zoom.min); }}>
            <Maximize aria-hidden="true" />
          </button>
        </div>
      </div>
      {comparando && (
        <div className="barra-comparar">
          {errorOriginal !== null ? (
            <p role="alert">No pudimos mostrar la original. {errorOriginal}</p>
          ) : urlOriginal === null ? (
            <p className="suave" role="status">Preparando la original…</p>
          ) : (
            <>
              <div className="segmentado compacto modo-comparar" role="group" aria-label="Cómo comparar">
                <button type="button" aria-pressed={modoComparar === 'cortina'} onClick={() => { setModoComparar('cortina'); mostrarRotulos(); }}>Con línea</button>
                <button type="button" aria-pressed={modoComparar === 'lado'} onClick={() => { setModoComparar('lado'); mostrarRotulos(); }}>Lado a lado</button>
              </div>
              {modoComparar === 'cortina' && (
                <>
                  <label htmlFor="corte-comparacion">Original a la izquierda, tu copia a la derecha</label>
                  <input
                    id="corte-comparacion"
                    type="range"
                    min={LIMITES.comparacion.min}
                    max={LIMITES.comparacion.max}
                    value={corte}
                    aria-valuetext={`${corte} % original`}
                    onChange={(e) => { setCorte(limitarCorte(Number(e.target.value))); mostrarRotulos(); }}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
      <figcaption className="suave">{ancho} × {alto} px · {archivo.info.formato}</figcaption>
    </figure>
  );
}
