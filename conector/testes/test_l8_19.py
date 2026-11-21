"""Fatia L8-19 (qualidade: tipos de surto): declarações, literal presumido dentro do CHECK do destino, regras das
colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-19`."""
import random
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_19

RAIZ = Path(__file__).resolve().parents[1]  # /app no container (db/migracoes montado só leitura)
T, DT = "TBTPSURTO", "tipo_surto_infeccao"


def _ddl_destino():
    for f in sorted((RAIZ / "db/migracoes/18_QUA").glob("*.sql")):
        m = re.search(r"CREATE TABLE %s \((.*?)\n\)" % DT, f.read_text(encoding="utf-8"), re.S)
        if m:
            return m.group(1)
    raise AssertionError("DDL de %s não encontrado" % DT)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, set(l8_19.CARREGADAS))}
        cls.ddl = _ddl_destino()
        cls.cols = {c["destino"]: c for c in cls.plano[T]["colunas"][DT]}

    def test_tabela_e_destino(self):
        self.assertEqual(set(self.plano), {T})
        self.assertEqual(self.plano[T]["destinos"], [DT])

    def test_obrigatorias_sem_padrao_cobertas(self):
        obrig = {m.group(1) for m in re.finditer(r"^\s*(\w+)\s+[^\n]*?NOT NULL(?![^\n]*DEFAULT)", self.ddl, re.M)}
        obrig -= {"id", "criado_em"}
        self.assertTrue(obrig <= set(self.cols), sorted(obrig - set(self.cols)))

    def test_categoria_presumida_dentro_do_check(self):
        c = self.cols["categoria"]
        self.assertTrue(c["coluna"].startswith("=~"))
        m = re.search(r"CHECK \(categoria IN \(([^)]*)\)\)", self.ddl)
        self.assertIn("'%s'" % c["coluna"].lstrip("=~"), m.group(1))

    def test_regras_das_colunas(self):
        self.assertEqual(self.cols["codigo"]["regra"], "texto")
        self.assertEqual(self.cols["descricao"]["regra"], "texto_nome")
        self.assertEqual(sentinela.aplicar("texto", 3), ("3", None))
        self.assertEqual(sentinela.aplicar("texto_nome", "  Surto   exemplo  B "), ("Surto exemplo B", None))
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)

    def test_esperado_da_imagem(self):
        linhas = []
        esp = l8_19.linhas(random.Random(1), lambda t, v: linhas.append((t, v)))
        self.assertEqual(len(linhas), 5)
        self.assertEqual(esp[T]["gravados"], 4)
        self.assertEqual(esp[T]["pendencias"], {"valor_presumido": 5, "restricao_destino_1048": 1})


if __name__ == "__main__":
    unittest.main()
