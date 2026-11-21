"""Fatia L5-12 (cadastros e administração, módulo RH): declarações, plano e imagem sintética. Sem banco; só valores
inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L5-12`."""
import datetime
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_12

FATIA = ("STFIL_PREV", "STLOCAL", "STRESULT", "STTPASO", "STTPMEDIDAS", "TBTABIRR", "TBTPCONSTRUT", "TBTPCOOPERAT",
         "FPEVENTO", "FPLOTTRIBCAD", "FPREMESSA", "FPRESP", "FPRUBRICAFGTS_FPEVENTO", "FPRUBRICAINSS_FPEVENTO",
         "FPRUBRICAIRRF_FPEVENTO", "FPRUBRICASIND_FPEVENTO", "FPTPEVENTOAUT_TBEMPHOS", "PEJUSTIF", "TBTPTRIBUTO",
         "FPPARAM", "FPPARAMVIG")
OFICIAIS = ("STFIL_PREV", "STLOCAL", "STRESULT", "STTPASO", "STTPMEDIDAS")


class FatiaL512(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c.get("_arquivo", "").endswith("L5-12.tsv")
                    or c["tabela"] in FATIA]

    def test_so_as_tabelas_carregaveis_tem_declaracao(self):
        self.assertEqual({c["tabela"] for c in self.decl}, set(l5_12.CARREGADAS))
        for t in OFICIAIS:  # catálogo oficial: só de-para pelo código, nunca gravado pela fatia
            self.assertNotIn(t, {c["tabela"] for c in self.decl})

    def test_plano_em_ordem_com_destino_principal(self):
        p = carga_mapa.planejar(self.m, set(FATIA))
        self.assertEqual([x["tabela"] for x in p], ["TBTABIRR", "PEJUSTIF", "TBTPTRIBUTO"])
        irrf = p[0]
        self.assertEqual(irrf["destinos"], ["tabela_legal_vigencia"])
        self.assertEqual(irrf["chave"], ["DTA_INSS_IRRF"])
        self.assertNotIn("=irrf", irrf["lidas"])
        self.assertNotIn("@id", irrf["lidas"])
        regras = {c["coluna"]: c["regra"] for c in irrf["colunas"]["tabela_legal_vigencia"]}
        self.assertEqual(regras["ISENTO"], "flutuante")
        self.assertEqual(regras["DTA_INSS_IRRF"], "data")
        dest = {c["destino"]: c["coluna"] for c in irrf["colunas"]["tabela_legal_vigencia"]}
        self.assertEqual((dest["reducao_de"], dest["reducao_ate"], dest["sem_reducao_acima_de"]),
                         ("F1_INICIO_26", "F1_FIM_26", "ACIMA_26"))
        for c in ("ISENTO_26", "REDUCAO_26", "SAL_MIN", "ISENTO_PJ", "ALIQ_PJ"):  # sem destino: motivo declarado
            self.assertNotIn(c, irrf["lidas"])
            self.assertTrue(any(d["coluna"] == c and not d["destino"] and d["motivo"] for d in self.decl))
        self.assertTrue(any(d["tabela"] == "PEJUSTIF" and d["coluna"] == "COD_EMP" and "UNIQUE" in d["motivo"]
                            for d in self.decl))
        trib = {c["destino"]: (c["coluna"], c["regra"]) for c in p[2]["colunas"]["tributo_folha"]}
        self.assertEqual(trib["tipo"][0], "=outro")
        self.assertEqual(trib["codigo"], ("ID", "texto"))  # destino VARCHAR: a soma compara texto com texto

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("flutuante", 1904.98)[0], decimal.Decimal("1904.98"))
        self.assertEqual(sentinela.aplicar("texto_nome", "  Consulta   de rotina ")[0], "Consulta de rotina")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)
        self.assertEqual(sentinela.aplicar("data", datetime.date(2016, 1, 1)), (datetime.date(2016, 1, 1), None))
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("texto", 10), ("10", None))

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l5_12.COLUNAS), set(FATIA))
        linhas = {}
        esp = l5_12.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l5_12.CARREGADAS))
        for t, cols in l5_12.COLUNAS.items():
            for v in linhas[t]:
                self.assertEqual(len(v), len(cols))
        for t, e in esp.items():  # lidas = gravadas + recusadas (recusa: restrição do destino ou pai pendente)
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_") or k == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]))
        self.assertEqual(len(l5_12.COLUNAS["FPEVENTO"]), 113)


if __name__ == "__main__":
    unittest.main()
