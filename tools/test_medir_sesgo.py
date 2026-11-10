"""Pruebas de las métricas de sesgo. No necesitan modelos ni fotos."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from medir_sesgo import Conteo, Grupo, aciertos, brecha, iou, leer_manifiesto, reporte, wilson


def grupo(caras: tuple[int, int], falsas: tuple[int, int] = (0, 0)) -> Grupo:
    g = Grupo(fotos=caras[1])
    g.caras = Conteo(*caras)
    g.caras_seguras = Conteo(*caras)
    g.falsas_alarmas = Conteo(*falsas)
    return g


class Metricas(unittest.TestCase):
    def test_iou(self) -> None:
        self.assertEqual(iou((0, 0, 10, 10), (0, 0, 10, 10)), 1.0)
        self.assertEqual(iou((0, 0, 10, 10), (20, 20, 5, 5)), 0.0)
        self.assertAlmostEqual(iou((0, 0, 10, 10), (5, 0, 10, 10)), 50 / 150)

    def test_una_deteccion_no_cuenta_para_dos_caras(self) -> None:
        reales = [(0, 0, 10, 10), (1, 0, 10, 10)]
        self.assertEqual(aciertos(reales, [(0, 0, 10, 10)]), 1)
        self.assertEqual(aciertos(reales, [(0, 0, 10, 10), (1, 0, 10, 10)]), 2)
        self.assertEqual(aciertos(reales, []), 0)
        self.assertEqual(aciertos([(0, 0, 10, 10)], [(6, 6, 10, 10)]), 0)

    def test_wilson(self) -> None:
        bajo, alto = wilson(50, 100)
        self.assertLess(bajo, 0.5)
        self.assertGreater(alto, 0.5)
        self.assertAlmostEqual(wilson(0, 10)[0], 0.0)
        self.assertAlmostEqual(wilson(10, 10)[1], 1.0)
        with self.assertRaises(ValueError):
            wilson(1, 0)
        with self.assertRaises(ValueError):
            wilson(11, 10)


class Brechas(unittest.TestCase):
    def test_grupos_chicos_no_cuentan(self) -> None:
        grupos = {"A": grupo((95, 100)), "B": grupo((5, 10))}
        self.assertIsNone(brecha(grupos, "caras", 30, 0.05, mayor_es_mejor=True))

    def test_brecha_de_recall(self) -> None:
        grupos = {"A": grupo((95, 100)), "B": grupo((80, 100)), "C": grupo((93, 100))}
        b = brecha(grupos, "caras", 30, 0.05, mayor_es_mejor=True)
        assert b is not None
        self.assertEqual((b.mejor, b.peor, b.diferencia, b.excede), ("A", "B", 0.15, True))

    def test_en_falsas_alarmas_lo_peor_es_lo_mas_alto(self) -> None:
        grupos = {"A": grupo((90, 100), (2, 100)), "B": grupo((90, 100), (12, 100))}
        b = brecha(grupos, "falsas_alarmas", 30, 0.05, mayor_es_mejor=False)
        assert b is not None
        self.assertEqual((b.mejor, b.peor, b.excede), ("A", "B", True))

    def test_sin_datos_suficientes_nunca_se_aprueba(self) -> None:
        self.assertFalse(reporte({"A": grupo((10, 10))}, 30, 0.05)["aprobado"])

    def test_aprueba_solo_si_ninguna_brecha_excede(self) -> None:
        parejos = {"A": grupo((95, 100), (3, 100)), "B": grupo((93, 100), (4, 100))}
        self.assertTrue(reporte(parejos, 30, 0.05)["aprobado"])
        dispares = {"A": grupo((95, 100), (3, 100)), "B": grupo((93, 100), (20, 100))}
        self.assertFalse(reporte(dispares, 30, 0.05)["aprobado"])

    def test_el_reporte_no_lleva_rutas(self) -> None:
        texto = str(reporte({"A": grupo((95, 100)), "B": grupo((93, 100))}, 30, 0.05))
        self.assertNotIn("\\", texto)
        self.assertNotIn(".jpg", texto)


class Manifiesto(unittest.TestCase):
    base = Path(".")

    def fila(self, **cambios: str) -> dict[str, str]:
        return {
            "archivo": "a.jpg",
            "grupo": "MST-3",
            "caras": "[[1, 2, 30, 40]]",
            "contenido_sensible": "0",
            **cambios,
        }

    def test_fila_valida(self) -> None:
        [foto] = leer_manifiesto([self.fila()], self.base)
        self.assertEqual(
            (foto.grupo, foto.caras, foto.contenido_sensible), ("MST-3", ((1, 2, 30, 40),), False)
        )

    def test_filas_invalidas_detienen_todo(self) -> None:
        for cambio in (
            {"grupo": " "},
            {"caras": "no es json"},
            {"caras": "{}"},
            {"caras": "[[1, 2, 3]]"},
            {"caras": "[[1, 2, 0, 4]]"},
            {"caras": "[[-1, 2, 3, 4]]"},
            {"caras": "[[1.5, 2, 3, 4]]"},
            {"contenido_sensible": "sí"},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(ValueError):
                leer_manifiesto([self.fila(**cambio)], self.base)
        with self.assertRaises(ValueError):
            leer_manifiesto([], self.base)
        with self.assertRaises(ValueError):
            leer_manifiesto([{"archivo": "a.jpg"}], self.base)


if __name__ == "__main__":
    unittest.main()
