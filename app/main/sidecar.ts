/** Proceso Python y su protocolo: marcos con prefijo de longitud por stdio. No abre puertos. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ErrorApp, Resultado } from '../shared/contrato';

const BYTES_LONGITUD = 4;
/** Una respuesta nunca llega a esto: si lo declara, el canal está corrompido. */
export const MAX_BYTES_MARCO = 512 * 1024 * 1024;
/** Límite por pedido: mejor reiniciar y avisar que dejar una foto en "Revisando…" para siempre. */
export const LIMITE_PEDIDO_MS = 5 * 60 * 1000;
export const ERROR_SIDECAR: ErrorApp = {
  codigo: 'SIDECAR_CAIDO',
  mensaje: 'El análisis se detuvo y esa acción no se completó. Nada se marcó como revisado. Intenta de nuevo.',
};

interface Pendiente {
  resolver(r: RespuestaSidecar): void;
}

export interface RespuestaSidecar {
  resultado: Resultado<Record<string, unknown>>;
  binario: Buffer | null;
}

/** Separa un flujo de bytes en marcos. Tolera marcos partidos en varios bloques. */
export class LectorMarcos {
  private buffer: Buffer = Buffer.alloc(0);

  agregar(parte: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, parte]);
    const marcos: Buffer[] = [];
    while (this.buffer.length >= BYTES_LONGITUD) {
      const longitud = this.buffer.readUInt32BE(0);
      if (longitud > MAX_BYTES_MARCO) throw new Error('Marco demasiado grande');
      if (this.buffer.length < BYTES_LONGITUD + longitud) break;
      marcos.push(this.buffer.subarray(BYTES_LONGITUD, BYTES_LONGITUD + longitud));
      this.buffer = this.buffer.subarray(BYTES_LONGITUD + longitud);
    }
    return marcos;
  }
}

export interface OpcionesSidecar {
  ejecutable: string;
  argumentos: string[];
  cwd: string;
  alCaer: () => void;
  limitePedidoMs?: number;
  registrar: (mensaje: string) => void;
}

export class Sidecar {
  private proceso: ChildProcessWithoutNullStreams | null = null;
  private lector = new LectorMarcos();
  private siguienteId = 1;
  private pendientes = new Map<number, Pendiente>();
  private esperandoBinario: { id: number; datos: Record<string, unknown> } | null = null;

  constructor(private readonly opciones: OpcionesSidecar) {}

  private iniciar(): ChildProcessWithoutNullStreams {
    if (this.proceso !== null) return this.proceso;
    const proceso = spawn(this.opciones.ejecutable, this.opciones.argumentos, {
      cwd: this.opciones.cwd,
      windowsHide: true,
      stdio: 'pipe',
    });
    this.lector = new LectorMarcos();
    this.esperandoBinario = null;
    proceso.stdout.on('data', (parte: Buffer) => {
      try {
        for (const marco of this.lector.agregar(parte)) this.recibir(marco);
      } catch (e) {
        // Un canal corrompido no se puede resincronizar. Reiniciar responde error a lo pendiente.
        this.opciones.registrar(`Canal con el sidecar corrompido: ${e instanceof Error ? e.name : 'desconocido'}`);
        proceso.kill();
      }
    });
    // stderr puede traer rutas: se descarta el contenido y solo se anota que hubo salida.
    proceso.stderr.on('data', () => {
      this.opciones.registrar('El sidecar escribió en stderr');
    });
    proceso.stdin.on('error', () => {
      this.opciones.registrar('Se perdió el canal hacia el sidecar');
    });
    const alTerminar = (): void => {
      if (this.proceso === proceso) this.alCaer();
    };
    proceso.on('error', alTerminar);
    proceso.on('exit', alTerminar);
    this.proceso = proceso;
    return proceso;
  }

  private alCaer(): void {
    this.opciones.registrar('El sidecar terminó');
    this.proceso = null;
    const pendientes = [...this.pendientes.values()];
    this.pendientes.clear();
    for (const p of pendientes) p.resolver({ resultado: { ok: false, error: ERROR_SIDECAR }, binario: null });
    this.opciones.alCaer();
  }

  private entregar(id: number, respuesta: RespuestaSidecar): void {
    const pendiente = this.pendientes.get(id);
    this.pendientes.delete(id);
    pendiente?.resolver(respuesta);
  }

  private recibir(marco: Buffer): void {
    if (this.esperandoBinario !== null) {
      const { id, datos } = this.esperandoBinario;
      this.esperandoBinario = null;
      // Se copia porque el marco comparte memoria con el búfer de lectura.
      this.entregar(id, { resultado: { ok: true, datos }, binario: Buffer.from(marco) });
      return;
    }
    const mensaje = JSON.parse(marco.toString('utf-8')) as {
      id: number | null;
      ok: boolean;
      datos?: Record<string, unknown>;
      error?: ErrorApp;
    };
    if (mensaje.id === null) {
      this.opciones.registrar('El sidecar rechazó un mensaje sin id');
      return;
    }
    if (mensaje.ok && mensaje.datos !== undefined) {
      if (typeof mensaje.datos.binario_bytes === 'number') {
        this.esperandoBinario = { id: mensaje.id, datos: mensaje.datos };
        return;
      }
      this.entregar(mensaje.id, { resultado: { ok: true, datos: mensaje.datos }, binario: null });
      return;
    }
    this.entregar(mensaje.id, { resultado: { ok: false, error: mensaje.error ?? ERROR_SIDECAR }, binario: null });
  }

  pedir(comando: Record<string, unknown>): Promise<RespuestaSidecar> {
    return new Promise((resolver) => {
      const proceso = this.iniciar();
      const id = this.siguienteId++;
      const limite = setTimeout(() => {
        this.opciones.registrar('Un pedido al sidecar rebasó el límite de tiempo');
        proceso.kill();
      }, this.opciones.limitePedidoMs ?? LIMITE_PEDIDO_MS);
      this.pendientes.set(id, {
        resolver: (r) => {
          clearTimeout(limite);
          resolver(r);
        },
      });
      const contenido = Buffer.from(JSON.stringify({ id, comando }), 'utf-8');
      const cabecera = Buffer.alloc(BYTES_LONGITUD);
      cabecera.writeUInt32BE(contenido.length, 0);
      proceso.stdin.write(Buffer.concat([cabecera, contenido]));
    });
  }

  /** Cancelar es terminar el proceso: lo que estaba en curso no se presenta como hecho. */
  reiniciar(): void {
    this.proceso?.kill();
  }

  apagar(): void {
    const proceso = this.proceso;
    this.proceso = null;
    proceso?.stdin.end();
    proceso?.kill();
  }
}
