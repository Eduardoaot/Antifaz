import { BookOpen, Film, FolderOpen, Image as IconoFoto, Keyboard, Save, Settings, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import logoClaro from '../../../brand/logo/horizontal-claro.svg';
import logoOscuro from '../../../brand/logo/horizontal-oscuro.svg';
import { MARCA } from '../../shared/catalogo';

export type Vista = 'revision' | 'video' | 'guia';

interface Props {
  abierto: boolean;
  vista: Vista;
  /** Fotos listas para exportar: sin ellas, "Exportar todas" no aparece. */
  listasParaExportar: number;
  alCerrar: () => void;
  alElegirVista: (vista: Vista) => void;
  alAbrirFotos: () => void;
  alAbrirVideo: () => void;
  alExportarTodas: () => void;
  alConfigurar: () => void;
  alVerAtajos: () => void;
}

const VISTAS: readonly { valor: Vista; texto: string; Icono: typeof IconoFoto; atajo: string }[] = [
  { valor: 'revision', texto: 'Fotos', Icono: IconoFoto, atajo: 'Ctrl 1' },
  { valor: 'video', texto: 'Video', Icono: Film, atajo: 'Ctrl 2' },
  { valor: 'guia', texto: 'Guía de privacidad', Icono: BookOpen, atajo: 'Ctrl 3' },
];

/**
 * Menú lateral de verdad: se desliza desde la izquierda sobre la app, atrapa el foco como un diálogo
 * y se cierra con Esc, con la X o con un clic fuera. Agrupa navegación, archivos y configuración.
 */
export function Cajon({ abierto, vista, listasParaExportar, alCerrar, alElegirVista, alAbrirFotos, alAbrirVideo, alExportarTodas, alConfigurar, alVerAtajos }: Props): React.JSX.Element {
  const referencia = useRef<HTMLDialogElement | null>(null);
  const ultimo = useRef(alCerrar);
  useEffect(() => {
    ultimo.current = alCerrar;
  });

  useEffect(() => {
    const dialogo = referencia.current;
    if (dialogo === null) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  useEffect(() => {
    const dialogo = referencia.current;
    const cancelar = (e: Event): void => {
      e.preventDefault();
      ultimo.current();
    };
    dialogo?.addEventListener('cancel', cancelar);
    return () => {
      dialogo?.removeEventListener('cancel', cancelar);
    };
  }, []);

  // Cada acción cierra el menú primero: así el foco vuelve a la app antes de abrir otro diálogo.
  const y = (accion: () => void) => (): void => {
    alCerrar();
    accion();
  };

  return (
    <dialog
      ref={referencia}
      className="cajon"
      aria-label="Menú"
      onClick={(e) => {
        // Un clic en el fondo (el propio <dialog>, fuera del panel) cierra.
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className="cajon-panel">
        <div className="cajon-cabecera">
          <picture>
            <source srcSet={logoOscuro} media="(prefers-color-scheme: dark)" />
            <img className="logo" src={logoClaro} alt="" />
          </picture>
          <button type="button" className="boton fantasma chico" aria-label="Cerrar el menú" onClick={alCerrar}>
            <X aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Secciones" className="cajon-seccion">
          <p className="cajon-titulo">Revisar</p>
          {VISTAS.map(({ valor, texto, Icono, atajo }) => (
            <button
              key={valor}
              type="button"
              className="cajon-opcion"
              aria-current={vista === valor ? 'page' : undefined}
              onClick={y(() => { alElegirVista(valor); })}
            >
              <Icono aria-hidden="true" /> {texto}
              <kbd aria-hidden="true">{atajo}</kbd>
            </button>
          ))}
        </nav>

        <div className="cajon-seccion" role="group" aria-label="Archivos">
          <p className="cajon-titulo">Archivos</p>
          <button type="button" className="cajon-opcion" onClick={y(alAbrirFotos)}>
            <FolderOpen aria-hidden="true" /> Abrir fotos
            <kbd aria-hidden="true">Ctrl O</kbd>
          </button>
          <button type="button" className="cajon-opcion" onClick={y(alAbrirVideo)}>
            <Film aria-hidden="true" /> Abrir video
            <kbd aria-hidden="true">Ctrl Mayús O</kbd>
          </button>
          {listasParaExportar > 0 && (
            <button type="button" className="cajon-opcion" onClick={y(alExportarTodas)}>
              <Save aria-hidden="true" /> Exportar todas ({listasParaExportar})
              <kbd aria-hidden="true">Ctrl Mayús E</kbd>
            </button>
          )}
        </div>

        <div className="cajon-seccion cajon-final">
          <button type="button" className="cajon-opcion" onClick={y(alConfigurar)}>
            <Settings aria-hidden="true" /> Configuración
            <kbd aria-hidden="true">Ctrl ,</kbd>
          </button>
          <button type="button" className="cajon-opcion" onClick={y(alVerAtajos)}>
            <Keyboard aria-hidden="true" /> Atajos de teclado
            <kbd aria-hidden="true">F1</kbd>
          </button>
          <p className="suave cajon-nota">{MARCA.nombre} revisa todo en tu computadora. Ninguna foto ni video sale de aquí.</p>
        </div>
      </div>
    </dialog>
  );
}
