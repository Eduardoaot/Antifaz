/** Carga y valida el catálogo. Si está dañado, falla al arrancar: no se muestran reglas sin validar. */
import { z } from 'zod';
import marca from '../../brand/brand.json';
import crudo from '../../rules/catalogo.json';

const esquemaFuente = z.object({
  institucion: z.string().min(1),
  documento: z.string().min(1),
  url: z.string().startsWith('https://'),
  fecha_consulta: z.string(),
  fecha_documento: z.string().optional(),
  vigente: z.boolean().nullable(),
  resumen: z.string().min(1),
  referencia: z.string().optional(),
  alcance: z.enum(['mexico_federal', 'mexico_local', 'internacional', 'plataforma']),
  tipo: z.enum(['ley', 'recomendacion_oficial', 'documento_historico', 'politica_plataforma', 'prensa', 'tecnica', 'resolucion']),
  respaldo: z.enum(['directo', 'parcial', 'contexto']),
  verificacion: z.enum(['abierta', 'pendiente']),
});
export type Fuente = z.infer<typeof esquemaFuente>;

const esquemaRegla = z.object({
  id: z.string(),
  categoria: z.string(),
  que_detecta: z.string(),
  /** Nombre del tema en la Guía, para leerla de un vistazo. Sin él, se usa `que_detecta`. */
  titulo_corto: z.string().optional(),
  nivel_riesgo: z.enum(['alto', 'medio', 'bajo']),
  por_que: z.string(),
  fuentes: z.array(esquemaFuente),
  aplica_a: z.enum(['foto', 'video', 'ambos']),
  estado: z.enum(['verificada', 'pendiente_de_verificar']),
  nota: z.string().optional(),
  texto_aviso: z.string().optional(),
  requiere_confirmacion: z.boolean().optional(),
});
export type Regla = z.infer<typeof esquemaRegla>;
export type Nivel = Regla['nivel_riesgo'];

const esquemaCatalogo = z.object({
  version: z.string(),
  aviso: z.string(),
  marco_general: z.array(esquemaFuente),
  reglas: z.array(esquemaRegla).min(1),
});

export const catalogo = esquemaCatalogo.parse(crudo);
export const MARCA = marca;
export const AVISO_LEGAL = catalogo.aviso.replace('{app}', marca.nombre);

const porId = new Map(catalogo.reglas.map((r) => [r.id, r]));

export function reglaDe(id: string): Regla {
  const regla = porId.get(id);
  if (regla === undefined) throw new Error(`Regla desconocida: ${id}`);
  return regla;
}

/** Todas las URLs citadas: main solo abre estas en el navegador. */
export function urlsDeFuentes(): Set<string> {
  const urls = new Set(catalogo.marco_general.map((f) => f.url));
  for (const regla of catalogo.reglas) for (const fuente of regla.fuentes) urls.add(fuente.url);
  return urls;
}

export function etiquetaNivel(nivel: Nivel): string {
  switch (nivel) {
    case 'alto':
      return 'Riesgo alto';
    case 'medio':
      return 'Riesgo medio';
    case 'bajo':
      return 'Riesgo bajo';
    default: {
      const inalcanzable: never = nivel;
      throw new Error(`Nivel desconocido: ${String(inalcanzable)}`);
    }
  }
}
