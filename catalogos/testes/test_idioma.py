"""Carregador oficial das línguas indígenas (09-AREA linha 73, C1-099), com metadados sintéticos na forma da
classificação do Censo Demográfico publicada pelo IBGE. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

IDIOMA = Path(__file__).resolve().parents[1] / "carregadores/idioma.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_idioma_teste", IDIOMA)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _dados(n, extras=()):
    cats = [{"id": 1, "nome": "1. Tronco Sintetico", "nivel": 0}, {"id": 2, "nome": "1.1. Familia A", "nivel": 1}]
    cats += [{"id": 100 + i, "nome": f"1.1.{i}. Lingua Sintetica {i}", "nivel": 2} for i in range(1, n + 1)]
    cats += list(extras)
    return {"classificacoes": [{"id": 9, "categorias": []}, {"id": 2105, "categorias": cats}]}


class LeituraDaClassificacao(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_le_so_as_linguas_com_a_familia_e_ignora_respostas_que_nao_sao_lingua(self):
        extras = [{"id": 900, "nome": "2. Outro Tronco", "nivel": 0}, {"id": 901, "nome": "2.1. Familia B", "nivel": 1},
                  {"id": 902, "nome": "2.1.1.  Lingua   D'E", "nivel": 2}, {"id": 950, "nome": "9. Não sabe", "nivel": 0}]
        ls = self.m.ler_classificacao(_dados(self.m.MINIMO, extras))
        self.assertEqual(len(ls), self.m.MINIMO + 1)
        self.assertEqual(ls, sorted(ls, key=lambda x: int(x[0])))
        d = {c: (n, f) for c, n, f in ls}
        self.assertEqual(d["902"], ("Lingua D'E", "Outro Tronco, Familia B"))
        self.assertEqual(d["101"], ("Lingua Sintetica 1", "Tronco Sintetico, Familia A"))
        self.assertNotIn("950", d)

    def test_nome_repetido_em_outra_familia_leva_a_familia(self):
        extras = [{"id": 901, "nome": "1.2. Familia B", "nivel": 1}, {"id": 902, "nome": "1.2.1. Lingua Sintetica 1", "nivel": 2}]
        d = {c: n for c, n, _ in self.m.ler_classificacao(_dados(self.m.MINIMO, extras))}
        self.assertEqual(d["101"], "Lingua Sintetica 1 (Tronco Sintetico, Familia A)")
        self.assertEqual(d["902"], "Lingua Sintetica 1 (Tronco Sintetico, Familia B)")
        self.assertEqual(len(self.m.AVISOS), 2)

    def test_recusa_arquivo_fora_da_forma(self):
        casos = {
            "sem classificação": {"classificacoes": []},
            "poucas línguas": _dados(self.m.MINIMO - 1),
            "nível divergente": _dados(self.m.MINIMO, [{"id": 900, "nome": "1.1.9. X", "nivel": 1}]),
            "sem numeração": _dados(self.m.MINIMO, [{"id": 900, "nome": "Lingua X", "nivel": 2}]),
            "código repetido": _dados(self.m.MINIMO, [{"id": 101, "nome": "1.1.99. X", "nivel": 2}]),
        }
        for nome, dados in casos.items():
            with self.subTest(nome), self.assertRaises(RuntimeError):
                self.m.ler_classificacao(dados)
        orfa = {"classificacoes": [{"id": 2105, "categorias": [{"id": 1, "nome": "1. T", "nivel": 0},
                                                                {"id": 2, "nome": "1.1.1. X", "nivel": 2}]}]}
        with self.assertRaises(RuntimeError):
            self.m.ler_classificacao(orfa)


class Carga(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_script_idempotente_pela_chave_do_codigo_e_encerra_a_vigencia_de_quem_saiu(self):
        s = self.m.montar_script([("101", "Lingua O'A", "Tronco")], "ibge-censo-2022")
        self.assertIn("ON DUPLICATE KEY UPDATE", s)
        self.assertIn("'Lingua O''A'", s)
        self.assertIn("codigo_ibge NOT IN ('101')", s)
        self.assertIn("vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)", s)
        self.assertNotIn("DELETE", s)

    def test_sem_arquivo_baixado_nao_falha_e_avisa(self):
        self.m.estado = lambda banco: (True, 0)
        with tempfile.TemporaryDirectory() as d:
            self.m.ARQUIVO = Path(d) / "ausente"
            self.assertEqual(self.m.carregar("qualquer"), {"idioma_indigena": 0})
        self.assertIn("não baixada", self.m.AVISOS[0])

    def test_sem_a_chave_unica_recusa(self):
        self.m.estado = lambda banco: (False, 0)
        with self.assertRaises(RuntimeError):
            self.m.carregar("qualquer")


if __name__ == "__main__":
    unittest.main()
