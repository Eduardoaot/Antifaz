/** Puente mínimo: lista cerrada de canales. El renderer nunca recibe ipcRenderer ni rutas. */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CANALES } from '../shared/canales';
import type { ApiRevisor } from '../shared/contrato';

const api: ApiRevisor = {
  seleccionarArchivos: () => ipcRenderer.invoke(CANALES.seleccionar),
  // La ruta se obtiene aquí y va directo a main: el renderer no llega a verla.
  soltarArchivos: (archivos) => ipcRenderer.invoke(CANALES.soltar, archivos.map((a) => webUtils.getPathForFile(a))),
  analizar: (id) => ipcRenderer.invoke(CANALES.analizar, id),
  vista: (id, ocultamientos) => ipcRenderer.invoke(CANALES.vista, id, ocultamientos),
  exportar: (id, ocultamientos) => ipcRenderer.invoke(CANALES.exportar, id, ocultamientos),
  segmentar: (id, x, y) => ipcRenderer.invoke(CANALES.segmentar, id, x, y),
  pintar: (id, puntos, tamano) => ipcRenderer.invoke(CANALES.pintar, id, puntos, tamano),
  cerrar: (id) => ipcRenderer.invoke(CANALES.cerrar, id),
  cancelar: () => ipcRenderer.invoke(CANALES.cancelar),
  abrirFuente: (url) => ipcRenderer.invoke(CANALES.abrirFuente, url),
  obtenerTema: () => ipcRenderer.invoke(CANALES.obtenerTema),
  definirTema: (tema) => ipcRenderer.invoke(CANALES.definirTema, tema),
  guardarEdiciones: (ediciones) => ipcRenderer.invoke(CANALES.guardarEdiciones, ediciones),
  recuperar: () => ipcRenderer.invoke(CANALES.recuperar),
  descartarRecuperacion: () => ipcRenderer.invoke(CANALES.descartarRecuperacion),
  abrirVideo: () => ipcRenderer.invoke(CANALES.abrirVideo),
  vistaVideo: (id, posicion, pistas) => ipcRenderer.invoke(CANALES.vistaVideo, id, posicion, pistas),
  seguirVideo: (id, posicion, x, y) => ipcRenderer.invoke(CANALES.seguirVideo, id, posicion, x, y),
  quitarPista: (id, pistaId) => ipcRenderer.invoke(CANALES.quitarPista, id, pistaId),
  exportarVideo: (id, pistas) => ipcRenderer.invoke(CANALES.exportarVideo, id, pistas),
  cerrarVideo: (id) => ipcRenderer.invoke(CANALES.cerrarVideo, id),
};

contextBridge.exposeInMainWorld('revisor', api);
