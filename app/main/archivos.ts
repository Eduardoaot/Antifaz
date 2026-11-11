/**
 * Registro de archivos abiertos. Solo aquí viven las rutas: el renderer recibe un id opaco.
 * Si el sidecar se reinicia, la imagen se vuelve a abrir sola la próxima vez que se pide.
 */
import { randomUUID } from 'node:crypto';
import { basename, normalize } from 'node:path';
import {
  esquemaImagenAbierta,
  type ArchivoAbierto,
  type ArchivoCargado,
  type ErrorApp,
  type Resultado,
} from '../shared/contrato';
import type { RespuestaSidecar } from './sidecar';

export const ERROR_NO_ABIERTA: ErrorApp = {
  codigo: 'IMAGEN_NO_ABIERTA',
  mensaje: 'Esta imagen ya no está abierta. Vuelve a cargarla.',
};

export const ERROR_ARCHIVO_CAMBIO: ErrorApp = {
  codigo: 'ARCHIVO_CAMBIO',
  mensaje:
    'Este archivo cambió desde que lo revisaste, así que tus decisiones ya no le corresponden. No se guardó nada. Ciérralo y vuelve a abrirlo.',
};

interface Registro {
  ruta: string;
  huella: string;
  sidecarId: string | null;
  reapertura: Promise<Resultado<string>> | null;
  archivo: ArchivoAbierto;
}

type Pedir = (comando: Record<string, unknown>) => Promise<RespuestaSidecar>;

const claveDeRuta = (ruta: string): string => normalize(ruta).toLowerCase();
export const nombreDeRuta = (ruta: string): string => ruta.split(/[/\\]/).pop() || basename(ruta);

export interface PlanLote {
  /** Rutas a abrir, en el orden elegido: las ya abiertas y las nuevas que caben. */
  abrir: string[];
  /** Cuántas nuevas cabrían. */
  nuevas: number;
  /** Cuántas nuevas no caben. Nunca se descartan sin decirlo. */
  sobran: number;
}

/**
 * Reparte una selección entre lo que cabe y lo que no. El límite es de fotos abiertas a la vez,
 * no por selección: con más, la recuperación no se podría guardar. Una foto que ya está abierta
 * no ocupa otro lugar, y una ruta repetida en la selección cuenta una vez.
 */
export function planearLote(rutas: readonly string[], estaAbierta: (ruta: string) => boolean, lugares: number): PlanLote {
  const plan: PlanLote = { abrir: [], nuevas: 0, sobran: 0 };
  // Una ruta repetida corre la misma suerte que la primera vez que apareció.
  const cabe = new Map<string, boolean>();
  for (const ruta of rutas) {
    const clave = claveDeRuta(ruta);
    let entra = cabe.get(clave);
    if (entra === undefined) {
      entra = estaAbierta(ruta) || plan.nuevas < Math.max(0, lugares);
      if (entra && !estaAbierta(ruta)) plan.nuevas += 1;
      cabe.set(clave, entra);
    }
    if (entra) plan.abrir.push(ruta);
    else plan.sobran += 1;
  }
  return plan;
}

export class Archivos {
  private registros = new Map<string, Registro>();

  constructor(private readonly pedir: Pedir) {}

  get cantidad(): number {
    return this.registros.size;
  }

  estaAbierta(ruta: string): boolean {
    const clave = claveDeRuta(ruta);
    for (const registro of this.registros.values()) if (claveDeRuta(registro.ruta) === clave) return true;
    return false;
  }

  private async abrirEnSidecar(ruta: string): Promise<Resultado<{ sidecarId: string; huella: string; archivo: Omit<ArchivoAbierto, 'id' | 'duplicado'> }>> {
    const { resultado } = await this.pedir({ tipo: 'abrir_imagen', ruta });
    if (!resultado.ok) return resultado;
    const datos = esquemaImagenAbierta.parse(resultado.datos);
    return {
      ok: true,
      datos: {
        sidecarId: datos.imagen_id,
        huella: datos.huella,
        archivo: { nombre: nombreDeRuta(ruta), ancho: datos.ancho, alto: datos.alto, formato: datos.formato },
      },
    };
  }

  async abrir(ruta: string): Promise<ArchivoCargado> {
    const clave = claveDeRuta(ruta);
    for (const registro of this.registros.values()) {
      if (claveDeRuta(registro.ruta) === clave) {
        return { ok: true, archivo: { ...registro.archivo, duplicado: true } };
      }
    }
    const abierto = await this.abrirEnSidecar(ruta);
    if (!abierto.ok) return { ok: false, nombre: nombreDeRuta(ruta), error: abierto.error };
    const archivo: ArchivoAbierto = { ...abierto.datos.archivo, id: randomUUID(), duplicado: false };
    this.registros.set(archivo.id, { ruta, huella: abierto.datos.huella, sidecarId: abierto.datos.sidecarId, reapertura: null, archivo });
    return { ok: true, archivo };
  }

  /** Id del sidecar para un archivo, reabriéndolo si el proceso se reinició. */
  async sidecarId(id: string): Promise<Resultado<string>> {
    const registro = this.registros.get(id);
    if (registro === undefined) return { ok: false, error: ERROR_NO_ABIERTA };
    if (registro.sidecarId !== null) return { ok: true, datos: registro.sidecarId };
    // Dos pedidos a la vez comparten la misma reapertura, para no cargar la imagen dos veces.
    registro.reapertura ??= this.reabrir(registro).finally(() => {
      registro.reapertura = null;
    });
    return registro.reapertura;
  }

  /** Fail-closed: si los bytes ya no son los que se revisaron, nada de lo decidido se aplica. */
  private async reabrir(registro: Registro): Promise<Resultado<string>> {
    const abierto = await this.abrirEnSidecar(registro.ruta);
    if (!abierto.ok) return abierto;
    if (abierto.datos.huella !== registro.huella) {
      await this.pedir({ tipo: 'cerrar', imagen_id: abierto.datos.sidecarId });
      return { ok: false, error: ERROR_ARCHIVO_CAMBIO };
    }
    registro.sidecarId = abierto.datos.sidecarId;
    return { ok: true, datos: registro.sidecarId };
  }

  huella(id: string): string | undefined {
    return this.registros.get(id)?.huella;
  }

  alReiniciarSidecar(): void {
    for (const registro of this.registros.values()) registro.sidecarId = null;
  }

  nombre(id: string): string | undefined {
    return this.registros.get(id)?.archivo.nombre;
  }

  ruta(id: string): string | undefined {
    return this.registros.get(id)?.ruta;
  }

  /** Formato con el que el sidecar abrió la foto, como "JPEG" o "PNG". */
  formato(id: string): string | undefined {
    return this.registros.get(id)?.archivo.formato;
  }

  async cerrar(id: string): Promise<void> {
    const registro = this.registros.get(id);
    this.registros.delete(id);
    if (registro?.sidecarId != null) await this.pedir({ tipo: 'cerrar', imagen_id: registro.sidecarId });
  }
}
