/** Sin dependencias: el preload corre con sandbox y no puede cargar módulos externos como zod. */
export const CANALES = {
  seleccionar: 'archivos:seleccionar',
  soltar: 'archivos:soltar',
  analizar: 'imagen:analizar',
  vista: 'imagen:vista',
  exportar: 'imagen:exportar',
  segmentar: 'imagen:segmentar',
  cerrar: 'imagen:cerrar',
  cancelar: 'imagen:cancelar',
  abrirFuente: 'fuente:abrir',
  obtenerTema: 'tema:obtener',
  definirTema: 'tema:definir',
  guardarEdiciones: 'recuperacion:guardar',
  recuperar: 'recuperacion:consultar',
  descartarRecuperacion: 'recuperacion:descartar',
} as const;
