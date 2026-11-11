import { Film, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export const EXTENSIONES_VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'mkv'] as const;

export const esNombreDeVideo = (nombre: string): boolean => {
  const punto = nombre.lastIndexOf('.');
  return punto > 0 && (EXTENSIONES_VIDEO as readonly string[]).includes(nombre.slice(punto + 1).toLowerCase());
};

const traeArchivos = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;

/** Mientras se arrastra llegan "dragover" sin parar; si dejan de llegar, el arrastre terminó o se canceló. */
const SIN_ARRASTRE_MS = 350;

interface Props {
  /** Las fotos y los videos se separan aquí; el resto lo valida main. */
  alSoltar: (archivos: File[]) => void;
}

/**
 * Se puede soltar en cualquier parte de la ventana. Mientras arrastras, toda la app se cubre con
 * "Suelta aquí". Escucha en la ventana, así ningún panel se queda sin aceptar archivos.
 */
export function SoltarAqui({ alSoltar }: Props): React.JSX.Element | null {
  const [activo, setActivo] = useState(false);
  // dragenter y dragleave llegan por cada elemento que se cruza: se cuentan para saber si se salió.
  const profundidad = useRef(0);
  const ultimo = useRef(alSoltar);
  useEffect(() => {
    ultimo.current = alSoltar;
  });

  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    const apagar = (): void => {
      clearTimeout(espera);
      profundidad.current = 0;
      setActivo(false);
    };
    const vigilar = (): void => {
      clearTimeout(espera);
      espera = setTimeout(apagar, SIN_ARRASTRE_MS);
    };
    const entrar = (e: DragEvent): void => {
      if (!traeArchivos(e)) return;
      e.preventDefault();
      profundidad.current += 1;
      setActivo(true);
      vigilar();
    };
    const sobre = (e: DragEvent): void => {
      if (!traeArchivos(e)) return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
      vigilar();
    };
    const salir = (e: DragEvent): void => {
      if (!traeArchivos(e)) return;
      profundidad.current = Math.max(0, profundidad.current - 1);
      if (profundidad.current === 0) setActivo(false);
    };
    const soltar = (e: DragEvent): void => {
      // Cualquier "drop" termina el arrastre, traiga archivos o no.
      apagar();
      if (!traeArchivos(e)) return;
      e.preventDefault();
      const archivos = [...(e.dataTransfer?.files ?? [])];
      if (archivos.length > 0) ultimo.current(archivos);
    };
    window.addEventListener('dragenter', entrar);
    window.addEventListener('dragover', sobre);
    window.addEventListener('dragleave', salir);
    window.addEventListener('drop', soltar);
    return () => {
      clearTimeout(espera);
      window.removeEventListener('dragenter', entrar);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('dragleave', salir);
      window.removeEventListener('drop', soltar);
    };
  }, []);

  if (!activo) return null;
  return (
    <div className="soltar-aqui" aria-hidden="true">
      <div className="soltar-marco">
        <div className="soltar-iconos">
          <ImagePlus />
          <Film />
        </div>
        <p className="soltar-titulo">Suelta aquí</p>
        <p className="soltar-pista">Fotos para revisarlas, o un video</p>
      </div>
    </div>
  );
}
