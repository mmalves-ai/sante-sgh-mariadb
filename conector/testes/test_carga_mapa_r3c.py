"""Mecanismos genéricos da rodada 3 de cobertura do conector (F4), grupo 3: catálogos fiscais oficiais (`cfop` e
`codigo_fiscal:<tabela>`) e o carregador oficial do CFOP. Só dados falsos (imagem sintética `exemplo_r3c`) e códigos
públicos do catálogo."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa
from sante_conector.sintetica_d import exemplo_r3c as ex

TABS = {"EX3C_NOTA"}
_CARREGADOR = Path(__file__).resolve().parents[2] / "catalogos/carregadores/cfop.py"


class DeparaFiscal(unittest.TestCase):
    def test_cfop(self):
        self.assertTrue(depara.conhecido("cfop"))
        for v, k in (("1.102", "1102"), (5102, "5102"), (" 6.949 ", "6949"), (b"1556", "1556"), ("7-101", "7101")):
            self.assertEqual(depara.norm_cfop(v), k, v)
        for v in ("9102", "0102", "110", "11020", "4102", "AB12"):
            self.assertIsNone(depara.norm_cfop(v), v)
        d = depara.Depara("cfop", [("1102", 11), ("5102", 12)])
        self.assertEqual(d.resolver("1.102"), (11, None))
        self.assertEqual(d.resolver("2102"), (None, "catalogo_codigo_inexistente"))
        self.assertEqual(d.resolver("9102"), (None, "catalogo_codigo_invalido"))
        self.assertEqual(d.resolver(None), (None, None))

    def test_codigo_fiscal(self):
        self.assertTrue(depara.conhecido("codigo_fiscal:modelo_documento"))
        self.assertFalse(depara.conhecido("codigo_fiscal:x'; --"))
        self.assertFalse(depara.conhecido("codigo_fiscal"))
        sql = depara.consulta("codigo_fiscal:cst_pis")
        self.assertIn("tabela = 'cst_pis'", sql)
        self.assertTrue(sql.endswith("ORDER BY vigencia_fim IS NULL DESC, vigencia_inicio DESC"))
        # o primeiro par do código vence (a consulta traz o vigente primeiro); zeros à esquerda não contam
        d = depara.Depara("codigo_fiscal:modelo_documento", [("01", 23), ("01", 22), ("55", 21), ("1B", 30)])
        self.assertEqual(d.resolver("1"), (23, None))
        self.assertEqual(d.resolver(" 1b "), (30, None))
        self.assertEqual(d.resolver("99"), (None, "catalogo_codigo_inexistente"))

    def test_tiss(self):
        for v, k in (("04.03.00", "4.03.00"), ("040300", "4.03.00"), ("4.3.0", "4.03.00"), ("3.05.00", "3.05.00")):
            self.assertEqual(depara.norm_versao_tiss(v), k, v)
        for v in ("x", "4.03", "4030000", "403.00.00"):
            self.assertIsNone(depara.norm_versao_tiss(v), v)
        self.assertIn("componente = 'troca'", depara.consulta("versao_tiss"))
        d = depara.Depara("versao_tiss", [("4.03.00", 31), ("03.05.01", 33)])
        self.assertEqual((d.resolver("040300"), d.resolver("3.5.1")), ((31, None), (33, None)))
        self.assertIn("numero_tabela_tiss = '61'", depara.consulta("tiss:61"))
        self.assertEqual(depara.catalogo("tiss:61")["pai"], "terminologia")
        t = depara.Depara("terminologia", [("18", 42), ("61", 41)])
        self.assertEqual(t.resolver("018"), (42, None))


class Plano(unittest.TestCase):
    def test_plano_e_verificador(self):
        p = {x["tabela"]: x for x in carga_mapa.planejar(ex.MAPA_TESTE, TABS)}["EX3C_NOTA"]
        cols = {c["destino"]: c for c in p["colunas"]["ex3c_nota"]}
        self.assertEqual(cols["cfop_id"]["depara"], "cfop")
        self.assertEqual([x for x in cols["cfop_id"]["passos"] if "tabela" in x][-1]["tabela"], "EX3C_CFOP")
        self.assertEqual(mapa.erros_referencia_e_valores(ex.MAPA_TESTE["colunas_decl"], [], TABS | {"EX3C_CFOP"}),
                         [])


def _carregador():
    esp = importlib.util.spec_from_file_location("carregador_cfop", _CARREGADOR)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


@unittest.skipUnless(_CARREGADOR.exists(), "carregador do CFOP fora do container (catalogos/ não montado)")
class CarregadorCfop(unittest.TestCase):
    def test_le_a_tabela_oficial(self):
        mod = _carregador()
        texto = ("CFOP|Descrição|Início|Fim\n"
                 "1.000|ENTRADAS OU AQUISIÇÕES DE SERVIÇOS DO ESTADO|01012003|\n"
                 "1.102|Compra para comercialização|01012003|\n"
                 "2102;Compra para comercialização (interestadual);2003-01-01;\n"
                 "3.102 - Compra para comercialização (exterior)\n"
                 "5.102|Venda de mercadoria adquirida|01012003|31122099\n"
                 "6.949|Outra saída não especificada|01012003|\n"
                 "7.949|Outra saída para o exterior||\n"
                 "1.102|repetido: o primeiro vale|01012003|\n"
                 "texto sem código\n")
        with tempfile.TemporaryDirectory() as d:
            arq = Path(d) / "cfop.txt"
            arq.write_text(texto, encoding="utf-8")
            linhas, avisos = mod.ler(arq)
        por = {x["codigo"]: x for x in linhas}
        self.assertEqual(sorted(por), ["1102", "2102", "3102", "5102", "6949", "7949"])  # 1000 é título de grupo
        self.assertEqual((por["1102"]["sentido"], por["1102"]["abrangencia"]), ("entrada", "estadual"))
        self.assertEqual((por["2102"]["abrangencia"], por["2102"]["vigencia_inicio"]), ("interestadual", "2003-01-01"))
        self.assertEqual((por["3102"]["abrangencia"], por["3102"]["descricao"]),
                         ("exterior", "Compra para comercialização (exterior)"))
        self.assertEqual((por["6949"]["sentido"], por["5102"]["vigencia_fim"]), ("saida", "2099-12-31"))
        self.assertEqual(por["1102"]["descricao"], "Compra para comercialização")
        self.assertEqual(len(avisos), 2)  # o repetido e a linha sem código


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR3c(unittest.TestCase):
    def test_depara_fiscal_carrega_concilia_e_reexecuta(self):
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT numero, cfop_id, modelo_documento_id, versao_tiss_id, via_termo_id FROM ex3c_nota"
                          " ORDER BY numero")
                lidos["nota"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT COUNT(*) FROM cfop")
                lidos["cfop"] = c.fetchone()[0]
        r = conferencia.conferir("exemplo_r3c", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertEqual(lidos["nota"], [[101, 11, 21, 31, 51], [102, 12, 23, 31, 51], [103, None, None, None, None],
                                         [104, None, None, None, None], [105, None, None, None, None],
                                         [106, None, None, None, None], [107, None, 23, None, None]])
        self.assertEqual(lidos["cfop"], 3)  # o catálogo oficial nunca é gravado pelo conector
        self.assertEqual(r["segunda"]["puladas_iguais"], 7)


if __name__ == "__main__":
    unittest.main()
