"""Pruebas de tools/limpiar_cache.py. Corre con: .venv\\Scripts\\python -m unittest tools\\test_limpiar_cache.py"""

from __future__ import annotations

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import limpiar_cache as lc


def crear(raiz: Path, rel: str, contenido: bytes = b"x") -> Path:
    ruta = raiz / rel
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(contenido)
    return ruta


class LimpiarCache(unittest.TestCase):
    def setUp(self) -> None:
        self.raiz = Path(tempfile.mkdtemp(prefix="limpiar-"))
        self.addCleanup(shutil.rmtree, self.raiz, True)

    def limpiar(self, profundo: bool = False) -> lc.Resultado:
        with contextlib.redirect_stdout(io.StringIO()):
            return lc.limpiar_cache(self.raiz, incluir_profundo=profundo)

    def test_borra_caches_y_conserva_codigo_modelos_y_herramientas(self) -> None:
        crear(self.raiz, "out/main/index.js")
        crear(self.raiz, "sidecar/.coverage", b"C:\\Users\\alguien")
        crear(self.raiz, "sidecar/revisor/__pycache__/a.cpython-312.pyc")
        crear(self.raiz, "tools/viejo.pyc")
        crear(self.raiz, "algo.tmp")
        codigo = crear(self.raiz, "sidecar/revisor/video.py")
        modelo = crear(self.raiz, "sidecar/modelos/edgetam/model.safetensors")
        herramienta = crear(self.raiz, "sidecar/herramientas/ffmpeg/ffmpeg.exe")
        resultado = self.limpiar()
        self.assertEqual(resultado.fallos, [])
        for rel in ("out", "sidecar/.coverage", "sidecar/revisor/__pycache__", "tools/viejo.pyc", "algo.tmp"):
            self.assertFalse((self.raiz / rel).exists(), rel)
        for ruta in (codigo, modelo, herramienta):
            self.assertTrue(ruta.exists(), ruta)

    def test_no_entra_a_dependencias(self) -> None:
        dentro = [
            crear(self.raiz, "node_modules/paquete/__pycache__/x.pyc"),
            crear(self.raiz, "node_modules/paquete/dato.tmp"),
            crear(self.raiz, ".venv/Lib/site-packages/mod/__pycache__/x.pyc"),
            crear(self.raiz, "sidecar/.venv/Lib/dato.tmp"),
            crear(self.raiz, ".git/objects/x.tmp"),
        ]
        self.limpiar()
        for ruta in dentro:
            self.assertTrue(ruta.exists(), ruta)

    def test_sin_profundo_no_borra_entornos(self) -> None:
        for rel in lc.PROFUNDAS:
            crear(self.raiz, f"{rel}/marca")
        self.limpiar()
        for rel in lc.PROFUNDAS:
            self.assertTrue((self.raiz / rel).exists(), rel)

    def test_profundo_borra_entornos(self) -> None:
        for rel in lc.PROFUNDAS:
            crear(self.raiz, f"{rel}/marca")
        resultado = self.limpiar(profundo=True)
        self.assertEqual(resultado.fallos, [])
        for rel in lc.PROFUNDAS:
            self.assertFalse((self.raiz / rel).exists(), rel)

    def test_profundo_no_borra_el_entorno_en_uso(self) -> None:
        crear(self.raiz, ".venv/marca")
        crear(self.raiz, "node_modules/marca")
        with mock.patch.object(lc.sys, "prefix", str(self.raiz / ".venv")):
            resultado = self.limpiar(profundo=True)
        self.assertTrue((self.raiz / ".venv").exists())
        self.assertFalse((self.raiz / "node_modules").exists())
        self.assertEqual(len(resultado.fallos), 1)
        self.assertIn("entorno con el que corre", resultado.fallos[0])

    def test_un_fallo_se_reporta_y_no_se_cuenta_como_borrado(self) -> None:
        crear(self.raiz, "out/index.js")

        def falla(_ruta: object) -> None:
            raise PermissionError(13, "Acceso denegado")

        with mock.patch.object(lc.shutil, "rmtree", falla):
            resultado = self.limpiar()
        self.assertEqual(resultado.carpetas, 0)
        self.assertEqual(len(resultado.fallos), 1)
        self.assertIn("out", resultado.fallos[0])

    def test_carpeta_vacia_no_falla(self) -> None:
        resultado = self.limpiar()
        self.assertEqual((resultado.carpetas, resultado.archivos, resultado.fallos), (0, 0, []))


class Main(unittest.TestCase):
    def correr(self, argumentos: list[str]) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return lc.main(argumentos)

    def test_profundo_sin_confirmar_no_hace_nada(self) -> None:
        with mock.patch.object(lc, "limpiar_cache") as limpiar:
            self.assertEqual(self.correr(["--profundo"]), 2)
        limpiar.assert_not_called()

    def test_opcion_desconocida(self) -> None:
        with mock.patch.object(lc, "limpiar_cache") as limpiar:
            self.assertEqual(self.correr(["--todo"]), 2)
        limpiar.assert_not_called()

    def test_codigo_de_salida_segun_fallos(self) -> None:
        with mock.patch.object(lc, "limpiar_cache", return_value=lc.Resultado()):
            self.assertEqual(self.correr([]), 0)
        with mock.patch.object(lc, "limpiar_cache", return_value=lc.Resultado(fallos=["out"])):
            self.assertEqual(self.correr([]), 1)

    def test_profundo_confirmado(self) -> None:
        with mock.patch.object(lc, "limpiar_cache", return_value=lc.Resultado()) as limpiar:
            self.assertEqual(self.correr(["--profundo", "--si"]), 0)
        limpiar.assert_called_once_with(lc.RAIZ, incluir_profundo=True)


if __name__ == "__main__":
    unittest.main()
