/** Puente mínimo: lista cerrada de canales. El renderer nunca recibe ipcRenderer ni rutas. */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { CANALES } from '../shared/canales';
import type { ApiRevisor } from '../shared/contrato';

const api: ApiRevisor = {
  seleccionarArchivos: () => ipcRenderer.invoke(CANALES.seleccionar),
  // La ruta se obtiene aquí y va directo a main: el renderer no llega a verla.
  soltarArchivos: (archivos) => ipcRenderer.invoke(CANALES.soltar, archivos.map((a) => webUtils.getPathForFile(a))),
  analizar: (id) => ipcRenderer.invoke(CANALES.analizar, id),
  vista: (id, ocultamientos) => ipcRenderer.invoke(CANALES.vista, id, ocultamientos),
  exportar: (id, ocultamientos) => ipcRenderer.invoke(CANALES.exportar, id, ocultamientos),
  prepararLote: () => ipcRenderer.invoke(CANALES.prepararLote),
  exportarEnLote: (loteId, id, ocultamientos) => ipcRenderer.invoke(CANALES.exportarEnLote, loteId, id, ocultamientos),
  miniatura: (id) => ipcRenderer.invoke(CANALES.miniatura, id),
  segmentar: (id, x, y) => ipcRenderer.invoke(CANALES.segmentar, id, x, y),
  pintar: (id, puntos, tamano) => ipcRenderer.invoke(CANALES.pintar, id, puntos, tamano),
  cerrar: (id) => ipcRenderer.invoke(CANALES.cerrar, id),
  cancelar: () => ipcRenderer.invoke(CANALES.cancelar),
  abrirFuente: (url) => ipcRenderer.invoke(CANALES.abrirFuente, url),
  obtenerTema: () => ipcRenderer.invoke(CANALES.obtenerTema),
  definirTema: (tema) => ipcRenderer.invoke(CANALES.definirTema, tema),
  obtenerAjustes: () => ipcRenderer.invoke(CANALES.obtenerAjustes),
  definirCopia: (preferencias) => ipcRenderer.invoke(CANALES.definirCopia, preferencias),
  elegirCarpeta: () => ipcRenderer.invoke(CANALES.elegirCarpeta),
  guardarEdiciones: (ediciones) => ipcRenderer.invoke(CANALES.guardarEdiciones, ediciones),
  recuperar: () => ipcRenderer.invoke(CANALES.recuperar),
  descartarRecuperacion: () => ipcRenderer.invoke(CANALES.descartarRecuperacion),
  abrirVideo: () => ipcRenderer.invoke(CANALES.abrirVideo),
  // Igual que con las fotos: la ruta va directo a main y el renderer no la ve.
  soltarVideo: (archivo) => ipcRenderer.invoke(CANALES.soltarVideo, webUtils.getPathForFile(archivo)),
  vistaVideo: (id, posicion, pistas) => ipcRenderer.invoke(CANALES.vistaVideo, id, posicion, pistas),
  seguirVideo: (id, posicion, x, y) => ipcRenderer.invoke(CANALES.seguirVideo, id, posicion, x, y),
  zonaVideo: (id, forma, puntos, tamano) => ipcRenderer.invoke(CANALES.zonaVideo, id, forma, puntos, tamano),
  quitarPista: (id, pistaId) => ipcRenderer.invoke(CANALES.quitarPista, id, pistaId),
  exportarVideo: (id, pistas) => ipcRenderer.invoke(CANALES.exportarVideo, id, pistas),
  cerrarVideo: (id) => ipcRenderer.invoke(CANALES.cerrarVideo, id),
  alPedirCierre: (avisar) => {
    // El evento de Electron no cruza al renderer: solo el dato, que la UI valida con Zod.
    const escuchar = (_evento: IpcRendererEvent, aviso: unknown): void => {
      avisar(aviso);
    };
    ipcRenderer.on(CANALES.pedirCierre, escuchar);
    return () => {
      ipcRenderer.removeListener(CANALES.pedirCierre, escuchar);
    };
  },
  confirmarCierre: () => ipcRenderer.invoke(CANALES.confirmarCierre),
};

contextBridge.exposeInMainWorld('revisor', api);
