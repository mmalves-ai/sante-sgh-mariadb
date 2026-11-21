"""Fatia L8-02 (faturamento e restantes, módulo FAT): declarações, plano, de-para de valores e imagem sintética. Sem
banco; só valores inventados. Três tabelas carregadas (rendimento isento, tipo de favorecido, classificação da
despesa); as outras 20 ficam fora com motivo e pedido em saida/L8-02.json. A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L8-02`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_02

FATIA = tuple(l8_02.FORMAS)


class FatiaL802(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def _col(self, t, dest):
        cols = [c for cs in self.plano[t]["colunas"].values() for c in cs]
        return next(c for c in cols if c["destino"] == dest)

    def test_fatia_tem_as_23_tabelas_e_cada_coluna_declarada(self):
        self.assertEqual(len(FATIA), 23)
        self.assertTrue(all(c.get("_arquivo", "").endswith("L8-02.tsv") for c in self.decl))
        declaradas = {(c["tabela"], c["coluna"]) for c in self.decl}
        for t, cols in l8_02.COLUNAS.items():
            for c, _, _ in cols:
                self.assertIn((t, c), declaradas)
        for c in self.decl:
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
            if c.get("regra"):
                self.assertTrue(sentinela.regra_conhecida(c["regra"]), c["regra"])

    def test_so_as_tres_carregadas_no_plano(self):
        self.assertEqual(set(self.plano), set(l8_02.CARREGADAS))
        self.assertEqual({c["tabela"] for c in self.decl if c.get("destino")}, set(l8_02.CARREGADAS))
        self.assertEqual(self.plano["RPRENDISENTO"]["destinos"], ["tipo_rendimento_isento"])
        self.assertEqual(self.plano["RPTIPOPRESTADOR"]["destinos"], ["tipo_prestador_repasse"])
        self.assertEqual(self.plano["TBCLASSI"]["destinos"], ["classificacao_despesa"])

    def test_regras_declaradas(self):
        self.assertEqual(self._col("RPRENDISENTO", "descricao")["regra"], "texto_nome")
        self.assertEqual(self._col("RPTIPOPRESTADOR", "codigo")["regra"], "codigo_char")
        self.assertEqual(self._col("RPTIPOPRESTADOR", "categoria")["coluna"], "=~outro")
        self.assertEqual(self._col("TBCLASSI", "usa_codigo_despesa_item")["regra"], "booleano_sn")

    def test_codigo_tiss_por_valores(self):
        c = self._col("TBCLASSI", "codigo_despesa_tiss")
        self.assertEqual(c["depara"], "valores")
        self.assertEqual(c["valores"], {"1": "01", "2": "02", "3": "03", "5": "05", "7": "07", "8": "08"})
        # só códigos aceitos pelo CHECK do destino
        self.assertTrue(set(c["valores"].values()) <= {"01", "02", "03", "05", "07", "08"})

    def test_fora_da_carga_tem_pedido(self):
        for c in self.decl:
            if c["tabela"] not in l8_02.CARREGADAS:
                self.assertIn("pedido", c["motivo"], (c["tabela"], c["coluna"]))
        mot = next(c["motivo"] for c in self.decl if c["tabela"] == "TBCONVCONSMAT")
        self.assertIn("OPÇÕES", mot)

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l8_02.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(set(esp), set(l8_02.CARREGADAS))
        por = {}
        for t, v in a:
            self.assertEqual(len(v), len(l8_02.COLUNAS[t]), t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith(("restricao_destino", "codigo_colisao")))
            self.assertEqual(e["gravados"] + recusas, por[t], t)
        self.assertIn("PRIMARY KEY (NOME,EXAME,DATA,ATO)", l8_02.DDL)


if __name__ == "__main__":
    unittest.main()
