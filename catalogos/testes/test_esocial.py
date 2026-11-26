"""Carregador das tabelas 03 e 10 do eSocial (recusas da carga, fase 2, K2, C5), com página sintética no formato da
publicação oficial. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import unittest
from pathlib import Path

ARQ = Path(__file__).resolve().parents[1] / "carregadores/esocial.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_esocial_teste", ARQ)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _pagina(naturezas, lotacoes):
    t03 = "".join(f"<tr><td>{c}</td><td>{n}</td><td>{d}</td><td>{i}</td><td>{f}</td><td>Não</td></tr>"
                  for c, n, d, i, f in naturezas)
    t10 = "".join(f"<tr><td>{c}</td><td>{d}</td><td>{p}</td></tr>" for c, d, p in lotacoes)
    return (f'<table id="03"><thead><tr><th colspan="6">Tabela 03 - Natureza das Rubricas da Folha de Pagamento</th></tr>'
            f'</thead><tbody>{t03}</tbody></table>'
            f'<table id="10"><thead><tr><th colspan="3">Tabela 10 - Tipos de Lotação Tributária</th></tr></thead>'
            f'<tbody>{t10}</tbody></table>')


class CarregadorEsocial(unittest.TestCase):
    def setUp(self):
        self.mod = _mod()
        self.mod.MINIMO = {"03": 3, "10": 2}
        self.html = _pagina(
            [("1000", "Salário, vencimento, soldo", "Salário básico", "01/01/2014", "-"),
             ("1002", "Descanso semanal remunerado - DSR", "Dia de trabalho", "01/01/2014", "30/04/2024"),
             ("1002", "Descanso semanal remunerado - DSR", "Dia de trabalho (nova)", "01/05/2024", "-")],
            [("01", "Classificação da atividade<br>a) empreitada", "Não preencher"), ("04", "Pessoa Jurídica", "CNPJ")])

    def test_le_naturezas_com_vigencia_e_lotacoes(self):
        tab = self.mod.ler(self.html)
        self.assertEqual(len(tab["03"]), 3)
        self.assertEqual(tab["03"][1], ("1002", "Descanso semanal remunerado - DSR", "Dia de trabalho", "2014-01-01",
                                        "2024-04-30"))
        self.assertIsNone(tab["03"][0][4])
        self.assertEqual([c for c, _, _ in tab["10"]], ["01", "04"])
        self.assertEqual(tab["10"][0][1], "Classificação da atividade a) empreitada")

    def test_sql_idempotente_e_uma_tabela_10_so(self):
        sql = self.mod.gerar_sql(self.mod.ler(self.html), "esocial-s-1.3")
        self.assertIn("('1002', 'Descanso semanal remunerado - DSR', 'Dia de trabalho', '2014-01-01', '2024-04-30'", sql)
        self.assertIn("ON DUPLICATE KEY UPDATE", sql)
        self.assertIn("WHERE NOT EXISTS (SELECT 1 FROM tabela_esocial WHERE fonte = 'esocial' AND codigo_oficial = '10')", sql)
        self.assertIn("NOT IN ('01', '04')", sql)
        self.assertIn('"preenchimento_numero_inscricao": "CNPJ"', sql)

    def test_recusa_arquivo_sem_a_tabela_ou_fora_da_forma(self):
        with self.assertRaises(RuntimeError):
            self.mod.ler(self.html.replace('id="10"', 'id="11"'))
        with self.assertRaises(RuntimeError):
            self.mod.ler(self.html.replace("<td>1000</td>", "<td>10x0</td>"))

    def test_arquivo_oficial_do_cache_quando_existe(self):
        cache = Path(__file__).resolve().parents[1] / "cache/logradouro/tabelas.html"
        if not cache.exists():
            self.skipTest("sem o arquivo oficial no cache")
        tab = _mod().ler(cache.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(tab["03"]), 100)
        self.assertGreaterEqual(len(tab["10"]), 5)


if __name__ == "__main__":
    unittest.main()
