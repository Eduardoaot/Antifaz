"""Bloque sólido: irreversible. Difuminado y pixelado: colores de la imagen, sin detalle reconocible."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays
from PIL import Image

from revisor import efectos
from revisor.caras import DetectorCaras
from revisor.errores import Codigo, ErrorRevisor

from .conftest import DATOS, MODELOS, oculto

EFECTOS = ["solido", "difuminado", "pixelado"]
CON_COLOR = ["difuminado", "pixelado"]
EMOJIS = ["emoji_sonrisa", "emoji_lentes", "emoji_gato", "emoji_estrella"]


def _imagen(alto: int = 200, ancho: int = 300, canales: int = 3, valor: int | None = None) -> np.ndarray:
    if valor is not None:
        return np.full((alto, ancho, canales), valor, dtype=np.uint8)
    return np.random.default_rng(5).integers(0, 256, size=(alto, ancho, canales), dtype=np.uint8)


def test_solido_es_irreversible_el_contenido_no_influye() -> None:
    a = _imagen()
    b = a.copy()
    b[60:120, 80:180] = 255 - b[60:120, 80:180]
    o = oculto(80, 60, 100, 60, "solido")
    salida_a, regiones = efectos.aplicar(a, [o])
    salida_b, _ = efectos.aplicar(b, [o])
    assert np.array_equal(salida_a, salida_b), "lo original se filtró a la salida"
    assert regiones[0] == (72, 52, 188, 128)


@pytest.mark.parametrize("efecto", CON_COLOR)
def test_usa_los_colores_de_la_imagen(efecto: str) -> None:
    """Sobre una foto rojiza, la zona sigue rojiza: no es una mancha gris."""
    a = np.zeros((300, 300, 3), dtype=np.uint8)
    a[:, :] = (200, 60, 40)
    a[120:180, 120:180] = (220, 40, 30)
    salida, regiones = efectos.aplicar(a, [oculto(120, 120, 60, 60, efecto)])
    x0, y0, x1, y1 = regiones[0]
    r, g, b = salida[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    assert r > 180 and g < 80 and b < 60, (r, g, b)


@pytest.mark.parametrize("efecto", CON_COLOR)
def test_cambia_con_el_contenido(efecto: str) -> None:
    a = _imagen(valor=40)
    b = _imagen(valor=200)
    o = oculto(80, 60, 100, 60, efecto)
    x0, y0, x1, y1 = efectos.region_dilatada(o, 200, 300)
    assert abs(float(efectos.aplicar(a, [o])[0][y0:y1, x0:x1].mean()) - float(efectos.aplicar(b, [o])[0][y0:y1, x0:x1].mean())) > 100


@pytest.mark.parametrize("efecto", EFECTOS)
def test_se_borra_el_detalle_fino(efecto: str) -> None:
    """Rayas finas tipo texto: la salida no debe conservar el patrón."""
    a = _imagen(valor=0)
    a[70:110, 90:170][::2, :] = 255
    salida, _ = efectos.aplicar(a, [oculto(80, 60, 100, 60, efecto)])
    zona_in = a[70:110, 90:170, 0].astype(float).ravel()
    zona_out = salida[70:110, 90:170, 0].astype(float).ravel()
    if zona_out.std() > 0:
        assert abs(np.corrcoef(zona_in, zona_out)[0, 1]) < 0.2


@pytest.mark.parametrize("efecto", EFECTOS)
def test_una_cara_real_deja_de_detectarse(efecto: str) -> None:
    """Con la caja justa, sin el margen de la app, el detector ya no la da por cara.

    Difuminado y pixelado aún pueden dejar una señal dudosa, por debajo de 0.6, porque conservan
    los colores. El flujo completo con el margen real se comprueba en la prueba E2E.
    """
    pixeles = np.array(Image.open(DATOS / "astronauta.jpg").convert("RGB"))
    detector = DetectorCaras(MODELOS)
    caras = detector.detectar(pixeles, 0.25)
    assert caras
    lista = [oculto(c.x, c.y, c.ancho, c.alto, efecto) for c in caras]
    salida, _ = efectos.aplicar(pixeles, lista)
    assert all(c.confianza < 0.6 for c in detector.detectar(salida, 0.25))


def test_es_determinista_para_que_la_vista_previa_coincida() -> None:
    a = _imagen()
    lista = [oculto(10, 10, 40, 40, "difuminado"), oculto(100, 100, 40, 40, "pixelado")]
    assert np.array_equal(efectos.aplicar(a, lista)[0], efectos.aplicar(a, lista)[0])


@pytest.mark.parametrize("efecto", EFECTOS + EMOJIS)
def test_fuera_de_la_zona_no_cambia_y_entrada_intacta(efecto: str) -> None:
    a = _imagen()
    copia = a.copy()
    salida, regiones = efectos.aplicar(a, [oculto(80, 60, 100, 60, efecto)])
    assert np.array_equal(a, copia), "se modificó el original en memoria"
    x0, y0, x1, y1 = regiones[0]
    mascara = np.zeros(a.shape[:2], dtype=bool)
    mascara[y0:y1, x0:x1] = True
    assert np.array_equal(salida[~mascara], a[~mascara])


def test_dilatacion_minima_y_porcentual() -> None:
    assert efectos.region_dilatada(oculto(50, 50, 10, 10), 200, 200) == (42, 42, 68, 68)
    assert efectos.region_dilatada(oculto(50, 50, 100, 100, dilatacion_pct=10.0), 300, 300) == (40, 40, 160, 160)
    assert efectos.region_dilatada(oculto(50, 50, 100, 100, dilatacion_pct=0.0, dilatacion_px=8), 300, 300) == (42, 42, 158, 158)


def test_margen_se_ajusta_al_borde() -> None:
    assert efectos.region_dilatada(oculto(0, 0, 10, 10), 20, 20) == (0, 0, 18, 18)


@pytest.mark.parametrize(
    ("x", "y", "ancho", "alto"),
    [(190, 0, 11, 10), (0, 190, 10, 11), (200, 0, 1, 1), (0, 0, 201, 1)],
)
def test_zona_fuera_de_la_imagen_se_rechaza_sin_recortar(x: int, y: int, ancho: int, alto: int) -> None:
    with pytest.raises(ErrorRevisor) as e:
        efectos.aplicar(_imagen(200, 200), [oculto(x, y, ancho, alto)])
    assert e.value.codigo is Codigo.REGION_FUERA_DE_IMAGEN


def test_borde_exacto_y_toda_la_imagen() -> None:
    a = _imagen(50, 50)
    salida, _ = efectos.aplicar(a, [oculto(0, 0, 50, 50)])
    assert salida.max() == 0
    salida, regiones = efectos.aplicar(a, [oculto(49, 49, 1, 1)])
    assert regiones[0] == (41, 41, 50, 50)
    assert salida[49, 49].max() == 0


@pytest.mark.parametrize("efecto", CON_COLOR)
def test_efectos_con_color_en_toda_la_imagen_y_en_el_borde(efecto: str) -> None:
    a = _imagen(50, 50)
    assert efectos.aplicar(a, [oculto(0, 0, 50, 50, efecto)])[0].shape == a.shape
    assert efectos.aplicar(a, [oculto(49, 49, 1, 1, efecto)])[0].shape == a.shape
    assert efectos.aplicar(_imagen(1, 1), [oculto(0, 0, 1, 1, efecto)])[0].shape == (1, 1, 3)
    assert efectos.aplicar(_imagen(1, 90), [oculto(0, 0, 90, 1, efecto)])[0].shape == (1, 90, 3)


def test_lista_vacia_copia_igual() -> None:
    a = _imagen(10, 10)
    salida, regiones = efectos.aplicar(a, [])
    assert regiones == []
    assert np.array_equal(salida, a)
    assert salida is not a


def test_difuminado_no_toma_color_de_un_bloque_solido_vecino() -> None:
    a = _imagen(100, 400, valor=0)
    b = a.copy()
    # La zona sólida queda dentro del alcance del difuminado.
    b[40:60, 90:110] = 255
    lista = [oculto(40, 40, 20, 20, "difuminado"), oculto(90, 40, 20, 20, "solido")]
    assert np.array_equal(efectos.aplicar(a, lista)[0], efectos.aplicar(b, lista)[0])


def test_el_efecto_se_calcula_sobre_lo_original_y_no_sobre_otro_efecto() -> None:
    a = _imagen()
    lista = [oculto(50, 50, 40, 40, "pixelado"), oculto(150, 50, 40, 40, "difuminado")]
    solo_pixel, _ = efectos.aplicar(a, lista[:1])
    ambos, regiones = efectos.aplicar(a, lista)
    x0, y0, x1, y1 = regiones[0]
    assert np.array_equal(ambos[y0:y1, x0:x1], solo_pixel[y0:y1, x0:x1])


@pytest.mark.parametrize("intensidad", [1, 30, 80, 100])
@pytest.mark.parametrize("efecto", CON_COLOR)
def test_cualquier_intensidad_borra_detalle_fino(efecto: str, intensidad: int) -> None:
    a = _imagen(valor=0)
    a[70:110, 90:170][::2, :] = 255
    salida, _ = efectos.aplicar(a, [oculto(80, 60, 100, 60, efecto, intensidad=intensidad)])
    assert salida[70:110, 90:170, 0].std() < a[70:110, 90:170, 0].std() / 2


def test_mas_intensidad_da_bloques_mas_grandes() -> None:
    a = _imagen(400, 400)
    colores = [
        len(np.unique(efectos.aplicar(a, [oculto(50, 50, 300, 300, "pixelado", intensidad=i)])[0][50:350, 50:350].reshape(-1, 3), axis=0))
        for i in (10, 50, 100)
    ]
    assert colores[0] > colores[1] > colores[2]


def test_pixelado_bloque_mayor_que_region_da_un_solo_color() -> None:
    a = _imagen(100, 100)
    salida, regiones = efectos.aplicar(a, [oculto(40, 40, 1, 1, "pixelado", dilatacion_px=8, intensidad=100)])
    x0, y0, x1, y1 = regiones[0]
    assert len(np.unique(salida[y0:y1, x0:x1].reshape(-1, 3), axis=0)) == 1


def test_difuminado_con_sigma_grande() -> None:
    a = _imagen(2000, 3000)
    salida, _ = efectos.aplicar(a, [oculto(100, 100, 2500, 1500, "difuminado")])
    assert salida.shape == a.shape


def test_alfa_transparente_no_esconde_ni_revela() -> None:
    a = _imagen(100, 100, canales=4)
    a[:, :, 3] = 0
    salida, regiones = efectos.aplicar(a, [oculto(30, 30, 20, 20)])
    x0, y0, x1, y1 = regiones[0]
    assert (salida[y0:y1, x0:x1, 3] == 255).all()
    assert (salida[y0:y1, x0:x1, :3] == 0).all()
    # Fuera de la zona, el color guardado bajo alfa 0 se borra.
    assert (salida[0:10, 0:10, :3] == 0).all()


@pytest.mark.parametrize("efecto", CON_COLOR)
def test_efecto_con_color_vuelve_opaca_la_zona(efecto: str) -> None:
    a = _imagen(100, 100, canales=4)
    a[:, :, 3] = 128
    salida, regiones = efectos.aplicar(a, [oculto(30, 30, 20, 20, efecto)])
    x0, y0, x1, y1 = regiones[0]
    assert (salida[y0:y1, x0:x1, 3] == 255).all()


def test_rgb_bajo_alfa_parcial_se_conserva() -> None:
    a = _imagen(20, 20, canales=4)
    a[:, :, 3] = 128
    salida, _ = efectos.aplicar(a, [])
    assert np.array_equal(salida, a)


@given(
    imagen=arrays(np.uint8, st.tuples(st.integers(1, 80), st.integers(1, 80), st.just(3))),
    efecto=st.sampled_from(EFECTOS + EMOJIS),
    datos=st.tuples(st.floats(0, 0.9), st.floats(0, 0.9), st.floats(0.05, 1), st.floats(0.05, 1)),
    intensidad=st.integers(1, 100),
)
def test_propiedad_cualquier_mascara_valida(
    imagen: np.ndarray, efecto: str, datos: tuple[float, float, float, float], intensidad: int
) -> None:
    alto, ancho = imagen.shape[:2]
    x, y = int(datos[0] * ancho), int(datos[1] * alto)
    w = max(1, min(ancho - x, int(datos[2] * ancho)))
    h = max(1, min(alto - y, int(datos[3] * alto)))
    o = oculto(x, y, w, h, efecto, intensidad=intensidad)
    salida, regiones = efectos.aplicar(imagen, [o])
    assert salida.shape == imagen.shape
    x0, y0, x1, y1 = regiones[0]
    fuera = np.ones(imagen.shape[:2], dtype=bool)
    fuera[y0:y1, x0:x1] = False
    assert np.array_equal(salida[fuera], imagen[fuera])
    if efecto == "solido":
        assert salida[y0:y1, x0:x1].max() == 0


# --- Emoji: se dibuja sobre bloque sólido, así que es tan irreversible como él ----------------------


@pytest.mark.parametrize("efecto", EMOJIS)
def test_emoji_es_irreversible_el_contenido_no_influye(efecto: str) -> None:
    """Las orillas del emoji son transparentes: debajo debe haber negro, nunca la foto."""
    a = _imagen()
    b = a.copy()
    b[52:128, 72:188] = 255 - b[52:128, 72:188]
    o = oculto(80, 60, 100, 60, efecto)
    salida_a, regiones = efectos.aplicar(a, [o])
    salida_b, _ = efectos.aplicar(b, [o])
    assert np.array_equal(salida_a, salida_b), "lo original se filtró a la salida"
    x0, y0, x1, y1 = regiones[0]
    assert salida_a[y0:y1, x0:x1].max() > 0, "no se dibujó el emoji"


def _silueta_dilatada(o: Any, silueta: np.ndarray, alto: int, ancho: int) -> np.ndarray:
    """La silueta con su margen, en coordenadas de la foto: lo que el emoji debe tapar."""
    region = efectos.region_dilatada(o, alto, ancho)
    recorte = efectos._silueta(o, region, {"m": silueta})  # pyright: ignore[reportPrivateUsage]
    assert recorte is not None
    completa = np.zeros((alto, ancho), dtype=bool)
    x0, y0, x1, y1 = region
    completa[y0:y1, x0:x1] = recorte
    return completa


@pytest.mark.parametrize("efecto", EMOJIS)
def test_emoji_con_silueta_tapa_la_silueta_sin_importar_lo_de_abajo(efecto: str) -> None:
    """Con silueta, el emoji se ajusta a ella: lo que está dentro nunca depende de la foto."""
    a = _imagen()
    b = a.copy()
    b[52:128, 72:188] = 255 - b[52:128, 72:188]
    silueta = np.zeros((60, 100), dtype=bool)
    silueta[20:40, 30:70] = True
    o = oculto(80, 60, 100, 60, efecto, mascara_id="m")
    salida_a, _ = efectos.aplicar(a, [o], {"m": silueta})
    salida_b, _ = efectos.aplicar(b, [o], {"m": silueta})
    tapada = _silueta_dilatada(o, silueta, 200, 300)
    assert np.array_equal(salida_a[tapada], salida_b[tapada]), "lo de la silueta se filtró"


def test_emoji_con_silueta_es_mas_chico_que_con_la_caja() -> None:
    a = _imagen()
    silueta = np.zeros((60, 100), dtype=bool)
    silueta[20:40, 30:70] = True
    con, _ = efectos.aplicar(a, [oculto(80, 60, 100, 60, "emoji_sonrisa", mascara_id="m")], {"m": silueta})
    sin, _ = efectos.aplicar(a, [oculto(80, 60, 100, 60, "emoji_sonrisa")])
    cambiados_con = int((con != a).any(axis=2).sum())
    cambiados_sin = int((sin != a).any(axis=2).sum())
    assert cambiados_con < cambiados_sin


def test_difuminado_no_toma_color_de_un_emoji_vecino() -> None:
    a = _imagen(100, 400, valor=0)
    b = a.copy()
    b[32:68, 82:118] = 255
    lista = [oculto(40, 40, 20, 20, "difuminado"), oculto(90, 40, 20, 20, "emoji_gato")]
    assert np.array_equal(efectos.aplicar(a, lista)[0], efectos.aplicar(b, lista)[0])


@pytest.mark.parametrize("efecto", EMOJIS)
def test_emoji_vuelve_opaca_la_caja(efecto: str) -> None:
    """La caja queda opaca; fuera de ella, lo transparente del emoji deja la foto como estaba."""
    a = _imagen(60, 60, canales=4)
    a[:, :, 3] = 0
    o = oculto(20, 20, 20, 20, efecto)
    salida, _ = efectos.aplicar(a, [o])
    x0, y0, x1, y1 = efectos.region_dilatada(o, 60, 60)
    assert (salida[y0:y1, x0:x1, 3] == 255).all()


@pytest.mark.parametrize(("ancho", "alto"), [(1, 1), (90, 1), (1, 90), (300, 200)])
def test_emoji_en_cajas_extremas(ancho: int, alto: int) -> None:
    a = _imagen(alto, ancho)
    salida, _ = efectos.aplicar(a, [oculto(0, 0, ancho, alto, "emoji_sonrisa")])
    assert salida.shape == a.shape


def test_los_emojis_del_esquema_tienen_archivo() -> None:
    from typing import get_args

    from revisor import emojis
    from revisor.esquemas import TipoEmoji

    assert set(emojis.ARCHIVOS) == set(get_args(TipoEmoji)) == set(EMOJIS)


@pytest.mark.parametrize("cambio", ["hash", "archivo"])
def test_emoji_alterado_o_ausente_detiene_sin_ocultar_con_otra_cosa(
    cambio: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from revisor import emojis

    nombre, sha256 = emojis.ARCHIVOS["emoji_sonrisa"]
    malo = (nombre, "0" * 64) if cambio == "hash" else ("no_existe.png", sha256)
    emojis.cargar.cache_clear()
    monkeypatch.setitem(emojis.ARCHIVOS, "emoji_sonrisa", malo)
    try:
        with pytest.raises(ErrorRevisor) as e:
            efectos.aplicar(_imagen(), [oculto(80, 60, 100, 60, "emoji_sonrisa")])
        assert e.value.codigo is Codigo.MODELO_NO_DISPONIBLE
    finally:
        emojis.cargar.cache_clear()


@pytest.mark.parametrize("efecto", EMOJIS)
def test_emoji_sin_rectangulo_negro(efecto: str) -> None:
    """Las esquinas de la caja, donde antes quedaba negro, muestran el emoji o su color principal.

    Se miran las esquinas y no toda la caja porque el gato tiene ojos y boca negros de verdad.
    """
    a = _imagen()
    o = oculto(80, 50, 90, 110, efecto)
    salida, _ = efectos.aplicar(a, [o])
    x0, y0, x1, y1 = efectos.region_dilatada(o, 200, 300)
    for ex, ey in [(x0, y0), (x1 - 4, y0), (x0, y1 - 4), (x1 - 4, y1 - 4)]:
        esquina = salida[ey : ey + 4, ex : ex + 4, :3]
        assert esquina.max() > 0, f"esquina negra en ({ex}, {ey})"


@pytest.mark.parametrize("efecto", ["emoji_sonrisa", "emoji_lentes"])
def test_emoji_redondo_crece_y_tapa_la_caja_con_su_parte_opaca(efecto: str) -> None:
    from revisor import emojis

    # La orilla de una caja de 100 x 140 medida desde su centro: un círculo debe abarcar su diagonal.
    xs = np.concatenate([np.arange(100), np.arange(100), np.zeros(140), np.full(140, 99)]) - 49.5
    ys = np.concatenate([np.zeros(100), np.full(100, 139), np.arange(140), np.arange(140)]) - 69.5
    lado = efectos.lado_emoji(emojis.opaco(efecto), xs, ys)  # type: ignore[arg-type]
    assert 172 <= lado <= 280
    a = _imagen()
    o = oculto(100, 30, 100, 140, efecto)
    _, regiones = efectos.aplicar(a, [o])
    caja = efectos.region_dilatada(o, 200, 300)
    rx0, ry0, rx1, ry1 = regiones[0]
    assert rx0 <= caja[0] and ry0 <= caja[1] and rx1 >= caja[2] and ry1 >= caja[3]


# --- Emoji sobre caras: tapa el óvalo para ajustarse a la cara ------------------------------------


@pytest.mark.parametrize("efecto", EMOJIS)
def test_emoji_en_cara_tapa_el_ovalo_sin_importar_lo_de_abajo(efecto: str) -> None:
    a = _imagen()
    b = a.copy()
    b[40:160, 60:200] = 255 - b[40:160, 60:200]
    o = oculto(100, 60, 60, 80, efecto, forma="elipse")
    salida_a, _ = efectos.aplicar(a, [o])
    salida_b, _ = efectos.aplicar(b, [o])
    region = efectos.region_dilatada(o, 200, 300)
    ovalo = efectos._elipse(o, region)  # pyright: ignore[reportPrivateUsage]
    x0, y0, x1, y1 = region
    assert np.array_equal(salida_a[y0:y1, x0:x1][ovalo], salida_b[y0:y1, x0:x1][ovalo])


def test_emoji_en_cara_es_mas_chico_que_en_un_rectangulo() -> None:
    a = _imagen()
    ovalo, _ = efectos.aplicar(a, [oculto(100, 60, 60, 80, "emoji_sonrisa", forma="elipse")])
    caja, _ = efectos.aplicar(a, [oculto(100, 60, 60, 80, "emoji_sonrisa")])
    assert int((ovalo != a).any(axis=2).sum()) < int((caja != a).any(axis=2).sum())


def test_la_forma_solo_cambia_al_emoji() -> None:
    a = _imagen()
    for efecto in EFECTOS:
        caja, _ = efectos.aplicar(a, [oculto(100, 60, 60, 80, efecto)])
        ovalo, _ = efectos.aplicar(a, [oculto(100, 60, 60, 80, efecto, forma="elipse")])
        assert np.array_equal(caja, ovalo), efecto


@given(
    ancho=st.integers(4, 400),
    proporcion=st.floats(0.5, 2.0),
    x=st.integers(0, 600),
    y=st.integers(0, 600),
)
def test_el_ovalo_contiene_la_caja_del_detector(ancho: int, proporcion: float, x: int, y: int) -> None:
    """Con el margen de las caras (x1.3, 10 % y 8 px), el óvalo tapa toda la caja que dio el detector.

    Se prueba también cerca del borde de la foto, donde la zona con margen se recorta, y pegada a él,
    donde la app recorta la caja de la cara y el emoji vuelve a tapar el rectángulo completo.
    """
    from revisor import analisis

    alto = max(4, round(ancho * proporcion))
    lado_img = 1100
    caja = analisis._ampliar(x, y, ancho, alto, 1.3, lado_img, lado_img)  # pyright: ignore[reportPrivateUsage]
    o = oculto(caja["x"], caja["y"], caja["ancho"], caja["alto"], "emoji_sonrisa", forma="elipse")
    region = efectos.region_dilatada(o, lado_img, lado_img)
    forma = efectos._forma(o, region, {}, lado_img, lado_img)  # pyright: ignore[reportPrivateUsage]
    x0, y0, x1, y1 = region
    ovalo = forma if forma is not None else np.ones((y1 - y0, x1 - x0), dtype=bool)
    detector = ovalo[max(0, y - y0) : min(lado_img, y + alto) - y0, max(0, x - x0) : min(lado_img, x + ancho) - x0]
    assert detector.all(), "una parte de la cara detectada quedó fuera del óvalo"


def test_emoji_gigante_no_reserva_un_cuadro_enorme() -> None:
    """Una caja que es toda la foto: el emoji crece más allá, pero solo se calcula lo visible."""
    a = _imagen(1500, 2500)
    salida, regiones = efectos.aplicar(a, [oculto(0, 0, 2500, 1500, "emoji_sonrisa")])
    assert regiones[0] == (0, 0, 2500, 1500)
    assert salida.shape == a.shape
    assert float((salida.max(axis=2) == 0).mean()) < 0.01


def test_color_principal_es_amarillo_en_las_caritas() -> None:
    from revisor import emojis

    r, g, b = emojis.color_principal("emoji_sonrisa")
    assert r > 200 and g > 150 and b < 120
