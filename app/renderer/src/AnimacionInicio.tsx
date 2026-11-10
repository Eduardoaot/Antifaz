import { useCallback, useEffect, useRef, useState } from 'react';
import { MARCA } from '../../shared/catalogo';

interface Props {
  alTerminar?: () => void;
}

/**
 * Genera un sonido ambiental cinematográfico usando la Web Audio API nativa.
 * No requiere descargar archivos de audio externos y es completamente local y seguro.
 */
function reproducirIntroSonido(): void {
  try {
    const ctx = new window.AudioContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const t = ctx.currentTime;

    // Acorde cálido espacial estilo consola (D3, A3, D4, F#4, A4)
    const frecuencias = [146.83, 220.0, 293.66, 369.99, 440.0, 587.33];

    frecuencias.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const ganancia = ctx.createGain();

      osc.type = i === 0 ? 'sine' : i % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);

      const retardo = i * 0.04;
      const duracion = 1.6 + i * 0.12;

      ganancia.gain.setValueAtTime(0.0001, t + retardo);
      ganancia.gain.exponentialRampToValueAtTime(0.07 / (i + 1), t + retardo + 0.15);
      ganancia.gain.exponentialRampToValueAtTime(0.0001, t + retardo + duracion);

      osc.connect(ganancia);
      ganancia.connect(ctx.destination);

      osc.start(t + retardo);
      osc.stop(t + retardo + duracion + 0.1);
    });

    // Campana armónica brillante que resuelve el acorde (toque de privacidad activa)
    const campana = ctx.createOscillator();
    const gananciaCampana = ctx.createGain();
    campana.type = 'sine';
    campana.frequency.setValueAtTime(880, t + 0.35);
    campana.frequency.exponentialRampToValueAtTime(1174.66, t + 0.6);

    gananciaCampana.gain.setValueAtTime(0.0001, t + 0.35);
    gananciaCampana.gain.exponentialRampToValueAtTime(0.035, t + 0.45);
    gananciaCampana.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);

    campana.connect(gananciaCampana);
    gananciaCampana.connect(ctx.destination);
    campana.start(t + 0.35);
    campana.stop(t + 1.6);
  } catch {
    // Si la reproducción de audio no está permitida o falla, se continúa en silencio.
  }
}

export function AnimacionInicio({ alTerminar }: Props): React.JSX.Element | null {
  const [fase, setFase] = useState<'entrada' | 'resplandor' | 'salida' | 'cerrado'>('entrada');

  const omitir = useCallback((): void => {
    setFase('cerrado');
    alTerminar?.();
  }, [alTerminar]);

  const omitirRef = useRef(omitir);
  useEffect(() => {
    omitirRef.current = omitir;
  }, [omitir]);

  const cerrado = fase === 'cerrado';

  // Solo depende de `cerrado` para que la secuencia corra una vez y no se reinicie en cada fase.
  useEffect(() => {
    if (cerrado) return;

    // Iniciar sonido y etapas de animación
    reproducirIntroSonido();

    const t1 = setTimeout(() => {
      setFase('resplandor');
    }, 600);

    const t2 = setTimeout(() => {
      setFase('salida');
    }, 1900);

    const t3 = setTimeout(() => {
      omitirRef.current();
    }, 2400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [cerrado]);

  useEffect(() => {
    if (fase === 'cerrado') return;
    const manejarTecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        omitir();
      }
    };
    window.addEventListener('keydown', manejarTecla);
    return () => {
      window.removeEventListener('keydown', manejarTecla);
    };
  }, [fase, omitir]);

  if (fase === 'cerrado') return null;

  return (
    <div
      role="region"
      aria-label="Animación de bienvenida"
      className={`intro-cortinilla intro-${fase}`}
      onClick={omitir}
    >
      <div className="intro-resplandor-fondo" />
      <div className="intro-contenido">
        <div className="intro-emblema-caja">
          <svg
            className="intro-logo-svg"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Esquinas del encuadre tipo foto */}
            <path
              className="intro-esquinas"
              fill="currentColor"
              d="M2 2H18V6H6V18H2ZM46 2H62V18H58V6H46ZM62 62H46V58H58V46H62ZM2 62V46H6V58H18V62Z"
            />
            {/* Máscara Antifaz */}
            <path
              className="intro-mascara"
              fill="currentColor"
              fillRule="evenodd"
              d="M10 27C10 23 14 21 18 21C23 21 27 23 32 25C37 23 41 21 46 21C50 21 54 23 54 27V33C54 39 50 43 44 43C39 43 36 41 32 36C28 41 25 43 20 43C14 43 10 39 10 33ZM15 30.5a6 4 0 1 0 12 0a6 4 0 1 0-12 0ZM37 30.5a6 4 0 1 0 12 0a6 4 0 1 0-12 0Z"
            />
          </svg>
          <div className="intro-halo-anillo" />
        </div>

        <div className="intro-texto-caja">
          <h1 className="intro-titulo">{MARCA.nombre}</h1>
          <p className="intro-eslogan">{MARCA.eslogan}</p>
        </div>
      </div>

      <div className="intro-omitir-pista">
        <span>Toca cualquier tecla o haz clic para continuar</span>
      </div>
    </div>
  );
}
