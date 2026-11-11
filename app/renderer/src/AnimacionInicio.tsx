import { useCallback, useEffect, useRef, useState } from 'react';
import { MARCA } from '../../shared/catalogo';

interface Props {
  alTerminar?: () => void;
}

/** Duración total del sonido, en segundos: el contexto de audio se cierra al terminar. */
const DURACION_SONIDO = 2.6;

/**
 * Un "ding" suave y cálido: tres campanas de vidrio que suben (Sol, Do, Mi) sobre un fondo grave que
 * apenas se nota, con un eco corto. Se genera con la Web Audio API: sin archivos ni internet.
 */
function reproducirIntroSonido(): void {
  let ctx: AudioContext;
  try {
    ctx = new window.AudioContext();
  } catch {
    // Sin audio en este equipo: la animación sigue en silencio.
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime + 0.05;

  // Salida: compresor suave para que nada sature, y un volumen bajo y amable.
  const salida = ctx.createGain();
  salida.gain.value = 0.22;
  const compresor = ctx.createDynamicsCompressor();
  compresor.threshold.value = -18;
  compresor.ratio.value = 3;
  salida.connect(compresor);
  compresor.connect(ctx.destination);

  // Eco corto y apagado: da espacio sin sonar a "cueva".
  const eco = ctx.createDelay(1);
  eco.delayTime.value = 0.19;
  const retorno = ctx.createGain();
  retorno.gain.value = 0.28;
  const filtroEco = ctx.createBiquadFilter();
  filtroEco.type = 'lowpass';
  filtroEco.frequency.value = 2600;
  eco.connect(filtroEco);
  filtroEco.connect(retorno);
  retorno.connect(eco);
  retorno.connect(salida);

  /** Una campana: la nota y dos armónicos que se apagan antes, como un vidrio al tocarlo. */
  const campana = (frecuencia: number, inicio: number, volumen: number): void => {
    const parciales: readonly [number, number, number][] = [[1, 1, 1.5], [2.01, 0.28, 0.6], [3.98, 0.1, 0.3]];
    for (const [multiplo, nivel, caida] of parciales) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frecuencia * multiplo, t + inicio);
      g.gain.setValueAtTime(0.0001, t + inicio);
      g.gain.exponentialRampToValueAtTime(volumen * nivel, t + inicio + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + inicio + caida);
      osc.connect(g);
      g.connect(salida);
      g.connect(eco);
      osc.start(t + inicio);
      osc.stop(t + inicio + caida + 0.05);
    }
  };

  // Fondo grave (Do y Sol): entra despacio y se va con la última campana.
  for (const [frecuencia, volumen] of [[130.81, 0.18], [196.0, 0.1]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filtro = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = frecuencia;
    filtro.type = 'lowpass';
    filtro.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volumen, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    osc.connect(filtro);
    filtro.connect(g);
    g.connect(salida);
    osc.start(t);
    osc.stop(t + 2.3);
  }

  campana(783.99, 0.0, 0.55); // Sol
  campana(1046.5, 0.13, 0.5); // Do
  campana(1318.51, 0.26, 0.45); // Mi
  campana(2093.0, 0.42, 0.14); // Brillo final, Do agudo

  setTimeout(() => { void ctx.close(); }, DURACION_SONIDO * 1000);
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
