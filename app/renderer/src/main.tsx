import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MARCA } from '../../shared/catalogo';
import type { ApiRevisor } from '../../shared/contrato';
import { App } from './App';
import './tokens.css';
import './estilos.css';

declare global {
  interface Window {
    revisor: ApiRevisor;
  }
}

document.title = MARCA.nombre;
const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Falta el contenedor de la app');
// Sin el puente no hay análisis posible: se dice, en vez de mostrar una ventana en blanco.
const puenteListo = (window as Partial<Window>).revisor !== undefined;
createRoot(raiz).render(
  <StrictMode>
    {puenteListo ? (
      <App />
    ) : (
      <p role="alert">No pudimos iniciar la revisión. Ninguna foto se analizó. Cierra la app y vuelve a abrirla.</p>
    )}
  </StrictMode>,
);
