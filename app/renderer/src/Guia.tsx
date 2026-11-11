import { BookOpen, CheckCircle2, CircleDashed, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AVISO_LEGAL, catalogo, type Nivel, type Regla } from '../../shared/catalogo';
import { agruparReglas, alcanceRevision, revisaSola } from '../../shared/logica';
import { IconoCategoria, PildoraNivel } from './Advertencias';
import { DialogoPorQue } from './Dialogos';

type Filtro = 'todos' | Nivel;

const FILTROS: readonly { valor: Filtro; texto: string }[] = [
  { valor: 'todos', texto: 'Todo' },
  { valor: 'alto', texto: 'Riesgo alto' },
  { valor: 'medio', texto: 'Riesgo medio' },
  { valor: 'bajo', texto: 'Riesgo bajo' },
];

const SIGNIFICADO: readonly { nivel: Nivel; texto: string }[] = [
  { nivel: 'alto', texto: 'Podría exponerte a ti o a alguien más a un daño serio. Conviene ocultarlo.' },
  { nivel: 'medio', texto: 'Da pistas sobre ti o tu entorno. Decide según quién verá la foto.' },
  { nivel: 'bajo', texto: 'Es común y casi nunca es un problema, pero vale la pena notarlo.' },
];

const ancla = (titulo: string): string => `guia-${titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const normalizar = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Se puede consultar sin cargar ninguna foto y sin internet: el catálogo viaja dentro de la app. */
export function Guia(): React.JSX.Element {
  const [abierta, setAbierta] = useState<Regla | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const { revisa, noRevisa } = alcanceRevision();
  const grupos = useMemo(() => agruparReglas(), []);
  const termino = normalizar(busqueda.trim());
  const filtrados = grupos
    .map(({ titulo, reglas }) => ({
      titulo,
      reglas: reglas.filter((r) =>
        (filtro === 'todos' || r.nivel_riesgo === filtro)
        && (termino === '' || normalizar(`${r.que_detecta} ${r.por_que} ${titulo}`).includes(termino))),
    }))
    .filter((g) => g.reglas.length > 0);
  const total = filtrados.reduce((n, g) => n + g.reglas.length, 0);

  return (
    <main id="principal" tabIndex={-1} className="guia">
      <div className="guia-marco">
        <nav className="guia-indice" aria-label="En esta guía">
          <p className="guia-indice-titulo">En esta guía</p>
          <a href="#guia-como-leer">Cómo leerla</a>
          <a href="#guia-alcance">Qué revisamos en cada foto</a>
          <span className="guia-indice-separador" aria-hidden="true" />
          {grupos.map(({ titulo, reglas }) => (
            <a key={titulo} href={`#${ancla(titulo)}`}>
              <span>{titulo}</span>
              <span className="guia-indice-conteo">{reglas.length}</span>
            </a>
          ))}
        </nav>

        <div className="guia-contenido">
          <header className="guia-cabecera">
            <span className="guia-icono" aria-hidden="true"><BookOpen /></span>
            <div>
              <h1>Guía de privacidad</h1>
              <p>Qué conviene revisar antes de publicar, por qué, y de dónde sale cada recomendación.</p>
            </div>
          </header>

          <section id="guia-como-leer" aria-labelledby="guia-como-leer-titulo" className="guia-bloque">
            <h2 id="guia-como-leer-titulo">Cómo leer esta guía</h2>
            <ul className="guia-niveles">
              {SIGNIFICADO.map(({ nivel, texto }) => (
                <li key={nivel}><PildoraNivel nivel={nivel} /><span>{texto}</span></li>
              ))}
            </ul>
            <ul className="guia-leyenda">
              <li><span className="insignia-revision sola"><CheckCircle2 aria-hidden="true" /> Lo buscamos solos</span> La app lo marca en cada foto.</li>
              <li><span className="insignia-revision tuya"><CircleDashed aria-hidden="true" /> Revísalo tú</span> Todavía no lo detectamos: puedes taparlo con las herramientas.</li>
            </ul>
            <p className="suave guia-nota">Cuando no encontramos una fuente oficial directa, lo decimos. {AVISO_LEGAL} Versión del catálogo: {catalogo.version}.</p>
          </section>

          <section id="guia-alcance" aria-labelledby="guia-alcance-titulo" className="guia-bloque">
            <h2 id="guia-alcance-titulo">Qué revisamos en cada foto</h2>
            <p className="suave">
              La revisión es orientativa. Si en una foto algo no se pudo revisar, te lo decimos en esa foto.
              Un documento o una tarjeta sin texto legible podría pasar sin aviso.
            </p>
            <div className="alcance-columnas">
              <div className="alcance-caja">
                <h3><CheckCircle2 aria-hidden="true" /> Lo buscamos solos ({revisa.length})</h3>
                <ul className="lista-chips">
                  {revisa.map((nombre) => <li key={nombre}>{nombre}</li>)}
                </ul>
              </div>
              <div className="alcance-caja">
                <h3><CircleDashed aria-hidden="true" /> Todavía no lo revisamos solos ({noRevisa.length})</h3>
                <ul className="lista-chips">
                  {noRevisa.map((r) => <li key={r.id}>{r.que_detecta}</li>)}
                </ul>
              </div>
            </div>
          </section>

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
                    <li key={r.id} className={`guia-tarjeta ${r.nivel_riesgo}`}>
                      <div className="guia-tarjeta-meta">
                        <PildoraNivel nivel={r.nivel_riesgo} />
                        {revisaSola(r.id)
                          ? <span className="insignia-revision sola"><CheckCircle2 aria-hidden="true" /> Lo buscamos solos</span>
                          : <span className="insignia-revision tuya"><CircleDashed aria-hidden="true" /> Revísalo tú</span>}
                      </div>
                      <h3>{r.que_detecta}</h3>
                      <p>{r.por_que}</p>
                      <div className="guia-tarjeta-pie">
                        {r.estado === 'pendiente_de_verificar'
                          ? <span className="suave">Aún no tenemos una fuente oficial directa.</span>
                          : <span className="suave">{r.fuentes.length} {r.fuentes.length === 1 ? 'fuente' : 'fuentes'}</span>}
                        <button type="button" className="enlace" onClick={() => { setAbierta(r); }}>
                          Ver fuentes<span className="solo-lector">: {r.que_detecta}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {abierta !== null && <DialogoPorQue regla={abierta} alCerrar={() => { setAbierta(null); }} />}
    </main>
  );
}
