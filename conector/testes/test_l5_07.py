"""Fatia L5-07 (cadastros do RH): plano dirigido pelo mapa e regras das colunas. Só a imagem SINTÉTICA."""
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_07

FATIA = set(l5_07.NAO_CARREGADAS) | {"FPCONDFUNC"}


class PlanoL507(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def test_so_a_condicao_do_colaborador_e_carregada(self):
        self.assertEqual(set(self.plano) & FATIA, {"FPCONDFUNC"})

    def test_condicao_vira_situacao_com_codigo_descricao_e_categoria(self):
        p = self.plano["FPCONDFUNC"]
        self.assertEqual(p["destinos"], ["situacao_colaborador"])
        cols = {c["destino"]: c for c in p["colunas"]["situacao_colaborador"]}
        self.assertEqual(set(cols), {"codigo", "descricao", "categoria"})
        self.assertEqual(cols["codigo"]["regra"], "texto")
        self.assertEqual(cols["descricao"]["regra"], "texto_nome")
        self.assertEqual(cols["categoria"]["coluna"], "=outro")
        self.assertEqual(p["lidas"], ["ID", "NOME"])

    def test_catalogos_oficiais_da_fatia_nunca_sao_destino_gravado(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in FATIA - {"FPCONDFUNC", "FPDOSE_VACINA"}:
            self.assertTrue(por[t]["destinos_oficiais"], t)
            for c in self.m["colunas_decl"]:
                self.assertNotEqual(c["tabela"], t)

    def test_nomes_colapsam_espacos_e_nulo_fica_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Afastado   temporariamente  ")[0],
                         "Afastado temporariamente")
        self.assertEqual(sentinela.aplicar("texto_nome", None), (None, None))

    def test_esperado_da_imagem_sintetica(self):
        esp = l5_07.linhas(__import__("random").Random(1), lambda t, v: None)
        self.assertEqual(esp, {"FPCONDFUNC": {"gravados": 7, "pendencias": {"restricao_destino_1048": 1}}})


if __name__ == "__main__":
    unittest.main()
