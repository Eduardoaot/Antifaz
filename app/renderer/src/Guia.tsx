import { BookOpen, ChevronRight, Hand, Info, ScanSearch, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { catalogo, type Nivel, type Regla } from '../../shared/catalogo';
import { agruparReglas, revisaSola } from '../../shared/logica';
import { IconoCategoria, PildoraNivel } from './Advertencias';
import { DialogoPorQue } from './Dialogos';

type Filtro = 'todos' | Nivel;

const FILTROS: readonly { valor: Filtro; texto: string }[] = [
  { valor: 'todos', texto: 'Todo' },
  { valor: 'alto', texto: 'Riesgo alto' },
  { valor: 'medio', texto: 'Riesgo medio' },
  { valor: 'bajo', texto: 'Riesgo bajo' },
];

const SIGNIFICADO: Readonly<Record<Nivel, string>> = {
  alto: 'Podría exponerte a ti o a alguien más a un daño serio. Conviene ocultarlo.',
  medio: 'Da pistas sobre ti o tu entorno. Decide según quién verá la foto.',
  bajo: 'Es común y casi nunca es un problema, pero vale la pena notarlo.',
};

const ancla = (titulo: string): string => `guia-${titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const normalizar = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const tituloDe = (r: Regla): string => r.titulo_corto ?? r.que_detecta;

function Insignia({ sola }: { sola: boolean }): React.JSX.Element {
  return sola
    ? <span className="insignia-revision sola"><ScanSearch aria-hidden="true" /> La app lo busca</span>
    : <span className="insignia-revision tuya"><Hand aria-hidden="true" /> Revísalo tú</span>;
}

/**
 * Se puede consultar sin cargar ninguna foto y sin internet: el catálogo viaja dentro de la app.
 * Cada tema se lee de un vistazo (nivel, quién lo revisa y nombre); el porqué y las fuentes se abren al tocarlo.
 */
export function Guia(): React.JSX.Element {
  const [abierta, setAbierta] = useState<Regla | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const grupos = useMemo(() => agruparReglas(), []);
  const termino = normalizar(busqueda.trim());
  const filtrados = grupos
    .map(({ titulo, reglas }) => ({
      titulo,
      // Busca también en lo que no se ve en la tarjeta, para que nada quede fuera de alcance.
      reglas: reglas.filter((r) =>
        (filtro === 'todos' || r.nivel_riesgo === filtro)
        && (termino === '' || normalizar(`${tituloDe(r)} ${r.que_detecta} ${r.por_que} ${titulo}`).includes(termino))),
    }))
    .filter((g) => g.reglas.length > 0);
  const total = filtrados.reduce((n, g) => n + g.reglas.length, 0);
  // El índice cuenta lo mismo que cada sección: con un filtro, solo lo que se ve.
  const visibles = new Map(filtrados.map((g) => [g.titulo, g.reglas.length]));

  return (
    <main id="principal" tabIndex={-1} className="guia">
      <div className="guia-marco">
        <nav className="guia-indice" aria-label="En esta guía">
          <p className="guia-indice-titulo">En esta guía</p>
          {grupos.map(({ titulo }) => {
            const cuantos = visibles.get(titulo) ?? 0;
            // Sin temas visibles no hay sección a la cual saltar: se queda como texto, sin enlace.
            return cuantos === 0
              ? (
                <span key={titulo} className="guia-indice-vacio">
                  <span>{titulo}</span>
                  <span className="guia-indice-conteo">0</span>
                </span>
              )
              : (
                <a key={titulo} href={`#${ancla(titulo)}`}>
                  <span>{titulo}</span>
                  <span className="guia-indice-conteo">{cuantos}</span>
                </a>
              );
          })}
        </nav>

        <div className="guia-contenido">
          <header className="guia-cabecera">
            <span className="guia-icono" aria-hidden="true"><BookOpen /></span>
            <div>
              <h1>Guía de privacidad</h1>
              <p>Lo que conviene revisar antes de publicar. Toca un tema para ver por qué importa.</p>
            </div>
          </header>

          <div className="guia-filtros" role="search">
            <label className="buscar-guia">
              <Search aria-hidden="true" />
              <span className="solo-lector">Buscar en la guía</span>
              <input type="search" placeholder="Buscar: placas, menores, boletos…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); }} />
              {busqueda !== '' && (
                <button type="button" className="boton fantasma chico" aria-label="Borrar la búsqueda" onClick={() => { setBusqueda(''); }}>
                  <X aria-hidden="true" />
                </button>
              )}
            </label>
            <div className="segmentado filtro-nivel" role="group" aria-label="Filtrar por nivel">
              {FILTROS.map(({ valor, texto }) => (
                <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => { setFiltro(valor); }}>{texto}</button>
              ))}
            </div>
            <p className="suave guia-resultados" aria-live="polite">{total} de {catalogo.reglas.length} temas</p>
          </div>

          <ul className="guia-leyenda" aria-label="Qué significan las insignias">
            <li><Insignia sola /> lo marca sola en cada foto</li>
            <li><Insignia sola={false} /> no lo detecta: tápalo con las herramientas</li>
          </ul>

          {filtrados.length === 0 && (
            <p className="guia-vacia">Nada coincide con tu búsqueda. Prueba con otra palabra o quita el filtro.</p>
          )}

          {filtrados.map(({ titulo, reglas }) => {
            const primera = reglas[0];
            return (
              <section key={titulo} id={ancla(titulo)} aria-labelledby={`${ancla(titulo)}-titulo`} className="guia-tema">
                <div className="guia-tema-cabecera">
                  {primera !== undefined && <span className="grupo-icono" aria-hidden="true"><IconoCategoria regla={primera} /></span>}
                  <h2 id={`${ancla(titulo)}-titulo`}>{titulo}</h2>
                  <span className="chip-conteo">{reglas.length}</span>
                </div>
                <ul className="guia-tarjetas">
                  {reglas.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`guia-tarjeta ${r.nivel_riesgo}`} data-regla={r.id} onClick={() => { setAbierta(r); }}>
                        <span className="guia-tarjeta-meta">
                          <PildoraNivel nivel={r.nivel_riesgo} />
                          <Insignia sola={revisaSola(r.id)} />
                        </span>
                        <span className="guia-tarjeta-titulo">{tituloDe(r)}</span>
                        <span className="guia-tarjeta-pie">Por qué y fuentes <ChevronRight aria-hidden="true" /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <aside className="guia-nota" aria-label="Sobre la revisión">
            <Info aria-hidden="true" />
            <div>
              <p>
                <strong>Es una ayuda, no una garantía.</strong> Si en una foto algo no se pudo revisar, te lo decimos ahí.
                Un documento o una tarjeta sin texto legible podría pasar sin aviso.
              </p>
              <p className="suave guia-nota-detalle">
                Si un tema no tiene una fuente oficial directa, lo verás al abrirlo. Catálogo {catalogo.version}.
              </p>
            </div>
          </aside>
        </div>
      </div>
      {abierta !== null && (
        <DialogoPorQue
          regla={abierta}
          alCerrar={() => { setAbierta(null); }}
          contexto={(
            <div className="porque-contexto">
              <p className="porque-tema">{abierta.que_detecta}</p>
              <p className="porque-nivel"><PildoraNivel nivel={abierta.nivel_riesgo} /> {SIGNIFICADO[abierta.nivel_riesgo]}</p>
            </div>
          )}
        />
      )}
    </main>
  );
}
