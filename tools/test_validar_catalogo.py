"""Comprueba que el validador sí rechaza catálogos malos. Uso: python -m unittest tools/test_validar_catalogo.py"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validar_catalogo import RAIZ, validar  # noqa: E402

CATALOGO = json.loads((RAIZ / "rules/catalogo.json").read_text(encoding="utf-8"))
ESQUEMA = json.loads((RAIZ / "rules/catalogo.schema.json").read_text(encoding="utf-8"))


def regla(cat, rid):
    return next(r for r in cat["reglas"] if r["id"] == rid)


class TestValidador(unittest.TestCase):
    def rechaza(self, mutar):
        cat = copy.deepcopy(CATALOGO)
        mutar(cat)
        self.assertTrue(validar(cat, ESQUEMA), "debió rechazarse")

    def test_catalogo_real_valido(self):
        self.assertEqual(validar(CATALOGO, ESQUEMA), [])

    def test_ausencias(self):
        for campo in ("id", "por_que", "fuentes", "estado", "nivel_riesgo", "aplica_a"):
            with self.subTest(campo=campo):
                self.rechaza(lambda c: regla(c, "DOC-01").pop(campo))
        self.rechaza(lambda c: c.update(reglas=[]))

    def test_tipos_y_valores(self):
        self.rechaza(lambda c: regla(c, "DOC-01").update(nivel_riesgo="altísimo"))
        self.rechaza(lambda c: regla(c, "DOC-01").update(nivel_riesgo=None))
        self.rechaza(lambda c: regla(c, "DOC-01").update(por_que=""))
        self.rechaza(lambda c: regla(c, "DOC-01").update(aplica_a="audio"))
        self.rechaza(lambda c: regla(c, "DOC-01")["fuentes"][0].update(url="http://inseguro.mx"))
        self.rechaza(lambda c: regla(c, "DOC-01")["fuentes"][0].update(fecha_consulta="3/11/2026"))
        self.rechaza(lambda c: regla(c, "DOC-01")["fuentes"][0].update(vigente="sí"))

    def test_id_repetido_y_categoria_faltante(self):
        self.rechaza(lambda c: regla(c, "FIN-01").update(id="DOC-01"))
        self.rechaza(lambda c: c.update(reglas=[r for r in c["reglas"] if r["categoria"] != "codigos"]))

    def test_verificada_necesita_fuente_directa_no_prensa(self):
        self.rechaza(lambda c: regla(c, "PAN-01").update(fuentes=[]))
        self.rechaza(lambda c: regla(c, "PAN-01")["fuentes"][0].update(respaldo="contexto"))
        self.rechaza(lambda c: regla(c, "PAN-01")["fuentes"][0].update(verificacion="pendiente"))
        self.rechaza(lambda c: regla(c, "PAN-01")["fuentes"][0].update(tipo="prensa"))

    def test_pendiente_necesita_nota(self):
        self.rechaza(lambda c: regla(c, "COD-01").pop("nota"))

    def test_inai_no_puede_estar_vigente(self):
        self.rechaza(lambda c: regla(c, "CON-01")["fuentes"][0].update(vigente=True))

    def test_tono_de_marca(self):
        self.rechaza(lambda c: regla(c, "MAT-01").update(por_que="¡PELIGRO! Estás exponiendo datos."))
        self.rechaza(lambda c: regla(c, "MAT-01").update(por_que="Publicar esto es ilegal."))
        self.rechaza(lambda c: regla(c, "MAT-01").update(por_que="Uno. Dos. Tres."))

    def test_menores_no_afirma_edad_y_confirma(self):
        self.rechaza(lambda c: regla(c, "MEN-01").update(texto_aviso="Parece tener 12 años"))
        self.rechaza(lambda c: regla(c, "MEN-01").update(requiere_confirmacion=False))


if __name__ == "__main__":
    unittest.main()
