import { useEffect, useId, useRef } from 'react';

interface Grupo {
  titulo: string;
  atajos: readonly (readonly [string[], string])[];
}

/** Todos los atajos de la app, en un solo lugar: la ventana de ayuda y el menú los leen de aquí. */
export const ATAJOS: readonly Grupo[] = [
  {
    titulo: 'Para moverte',
    atajos: [
      [['Ctrl', 'O'], 'Abrir fotos'],
      [['Ctrl', 'Mayús', 'O'], 'Abrir un video'],
      [['Ctrl', '1'], 'Ir a Fotos'],
      [['Ctrl', '2'], 'Ir a Video'],
      [['Ctrl', '3'], 'Ir a la Guía de privacidad'],
      [['Ctrl', ','], 'Configuración'],
      [['F1'], 'Ver estos atajos'],
    ],
  },
  {
    titulo: 'En una foto',
    atajos: [
      [['Ctrl', 'Z'], 'Deshacer'],
      [['Ctrl', 'Y'], 'Rehacer (también Ctrl Mayús Z)'],
      [['Ctrl', '+'], 'Acercar la imagen'],
      [['Ctrl', '−'], 'Alejar la imagen'],
      [['Ctrl', '0'], 'Ajustar la imagen a la ventana'],
      [['Ctrl', 'E'], 'Exportar la copia'],
      [['Ctrl', 'Mayús', 'E'], 'Exportar todas'],
      [['V'], 'Solo ver (clic en una zona para saber por qué)'],
      [['C'], 'Clic en un objeto para taparlo'],
      [['R'], 'Dibujar un rectángulo'],
      [['P'], 'Pintar con pincel'],
    ],
  },
  {
    titulo: 'En un video',
    atajos: [
      [['Espacio'], 'Reproducir o pausar'],
      [['←'], 'Frame anterior'],
      [['→'], 'Frame siguiente'],
      [['Ctrl', 'E'], 'Exportar la copia'],
    ],
  },
  {
    titulo: 'Tamaño de la interfaz',
    atajos: [
      [['Ctrl', 'Mayús', '+'], 'Agrandar todo'],
      [['Ctrl', 'Mayús', '−'], 'Achicar todo'],
      [['Ctrl', 'Mayús', '0'], 'Tamaño normal'],
    ],
  },
];

export function DialogoAtajos({ alCerrar }: { alCerrar: () => void }): React.JSX.Element {
  const referencia = useRef<HTMLDialogElement | null>(null);
  const id = useId();
  const ultimo = useRef(alCerrar);
  useEffect(() => {
    ultimo.current = alCerrar;
  });
  useEffect(() => {
    const dialogo = referencia.current;
    if (dialogo !== null && !dialogo.open) dialogo.showModal();
    const cancelar = (e: Event): void => {
      e.preventDefault();
      ultimo.current();
    };
    dialogo?.addEventListener('cancel', cancelar);
    return () => {
      dialogo?.removeEventListener('cancel', cancelar);
      dialogo?.close();
    };
  }, []);

  return (
    <dialog ref={referencia} className="dialogo ancho atajos-dialogo" aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>Atajos de teclado</h2>
      <div className="atajos-grupos">
        {ATAJOS.map((g) => (
          <section key={g.titulo} aria-label={g.titulo}>
            <h3>{g.titulo}</h3>
            <dl className="atajos-lista">
              {g.atajos.map(([teclas, que]) => (
                <div key={que}>
                  <dt>{teclas.map((tecla, i) => <span key={tecla}>{i > 0 && <span className="mas" aria-hidden="true">+</span>}<kbd>{tecla}</kbd></span>)}</dt>
                  <dd>{que}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="fila-botones">
        <button type="button" className="boton primario" autoFocus onClick={alCerrar}>Listo</button>
      </div>
    </dialog>
  );
}
