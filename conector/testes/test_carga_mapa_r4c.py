"""Mecanismos do conferidor da rodada 4 (F4): `#arquivo:<COLUNA>[:<finalidade>]` (binário no armazenamento de arquivos
da instalação, ADR 0004) e `#item@<COLUNA>` (item do desdobrar com regra, de-para e referência próprios por coluna).
A carga e a conciliação de ponta a ponta estão nas fatias L6-11/L6-12 (#arquivo) e L5-06 (#item@); aqui, as regras
de forma e o armazenamento sem banco."""
import os
import stat
import tempfile
import unittest

from sante_conector import carga_mapa, mapa


class Especiais(unittest.TestCase):
    def test_nomes_aceitos(self):
        for n in ("#arquivo:DOCUMENTO", "#arquivo:IMAGEM:imagem", "#item@ID_TBCONVCONSMAT"):
            self.assertTrue(mapa._ESPECIAIS.fullmatch(n), n)
        self.assertFalse(mapa._ESPECIAIS.fullmatch("#arquivo:documento"))
        self.assertFalse(mapa.eh_item("#item@COL"))  # não é marca do modelo da linha
        self.assertEqual(carga_mapa.fonte_especial("#arquivo:IMAGEM:imagem"), "IMAGEM")

    def test_tipo_pelos_primeiros_bytes(self):
        self.assertEqual(carga_mapa._tipo_arquivo(b"%PDF-1.4 x"), ("application/pdf", ".pdf"))
        self.assertEqual(carga_mapa._tipo_arquivo(b"\x89PNG\r\n\x1a\nx"), ("image/png", ".png"))
        self.assertEqual(carga_mapa._tipo_arquivo(b"\xff\xd8\xffx"), ("image/jpeg", ".jpg"))
        self.assertEqual(carga_mapa._tipo_arquivo(b"qualquer"), ("application/octet-stream", ".bin"))


class Armazenamento(unittest.TestCase):
    """`_arquivo` sem banco: o registro em `arquivo` é simulado; o binário vai para a raiz uma vez, só leitura."""

    class _Falso(carga_mapa.CargaMapa):
        def __init__(self):
            self.inseridos = []

        def _um(self, sql, args=()):
            if "DATABASE()" in sql:
                return "cliente_exemplo"
            return None

        def _c(self):
            dono = self

            class C:
                lastrowid = 0

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def execute(self, sql, args):
                    dono.inseridos.append(args)
                    C.lastrowid = len(dono.inseridos)
            return C()

    def test_grava_uma_vez_e_somente_leitura(self):
        with tempfile.TemporaryDirectory() as raiz:
            antes = os.environ.get("ARQUIVOS_RAIZ")
            os.environ["ARQUIVOS_RAIZ"] = raiz
            try:
                c, pend = self._Falso(), []
                x = c._arquivo("T", "1", "anexo_prontuario", {"DOC": b"%PDF-1.4 falso"}, "#arquivo:DOC", pend)
                self.assertEqual((x, pend), (1, []))
                caminho = [os.path.join(d, f) for d, _, fs in os.walk(raiz) for f in fs]
                self.assertEqual(len(caminho), 1)
                self.assertFalse(os.stat(caminho[0]).st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
                self.assertIn("cliente_exemplo", caminho[0])
                fin, nome, mime, tam = c.inseridos[0][1:5]
                self.assertEqual((fin, nome, mime, tam), ("anexo", "T-1.pdf", "application/pdf", 14))
                # o mesmo conteúdo de novo: nenhum arquivo novo no disco
                c._arquivo("T", "2", "anexo_prontuario", {"DOC": b"%PDF-1.4 falso"}, "#arquivo:DOC", pend)
                self.assertEqual(len([f for _, _, fs in os.walk(raiz) for f in fs]), 1)
                self.assertIsNone(c._arquivo("T", "3", "x", {"DOC": None}, "#arquivo:DOC", pend))
            finally:
                if antes is None:
                    os.environ.pop("ARQUIVOS_RAIZ", None)
                else:
                    os.environ["ARQUIVOS_RAIZ"] = antes

    def test_sem_armazenamento_pendencia_alta(self):
        antes = os.environ.pop("ARQUIVOS_RAIZ", None)
        try:
            pend = []
            self.assertIsNone(self._Falso()._arquivo("T", "1", "d", {"DOC": b"x"}, "#arquivo:DOC", pend))
            self.assertEqual(pend, [("armazenamento_indefinido", "alta")])
        finally:
            if antes is not None:
                os.environ["ARQUIVOS_RAIZ"] = antes


if __name__ == "__main__":
    unittest.main()
