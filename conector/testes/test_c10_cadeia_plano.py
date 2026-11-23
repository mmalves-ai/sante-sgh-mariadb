"""C10 (2026-11-23): a prova da cadeia na cópia real recusou os 2 planos (fonte pagadora vazia na origem: o plano é
genérico e se liga às fontes por TBTIPPLCONV) e, em cascata, contas, itens, etapas e produção de repasse
(pai_pendente). Correções: fonte do plano ESTIMADA pela ligação (menor fonte, pendência baixa), percentual negativo do
item volta ao padrão com pendência (antes CHECK 4025) e integração do repasse sem data estimada pela data do item
(antes 1048). Só dados falsos."""
import decimal
import unittest

from sante_conector import carga_mapa, mapa, sentinela

D = decimal.Decimal


class Mapa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, {"TBTIPPLANO", "FCLANEXT", "FCINTEGRPA"})}

    def conc(self, t, dt, dc):
        return [c for c in self.plano[t]["colunas"][dt] if c["destino"] == dc]

    def test_fonte_do_plano_pela_ligacao_quando_vazia(self):
        cs = self.conc("TBTIPPLANO", "plano_fonte_pagadora", "fonte_pagadora_id")
        self.assertEqual([c["coluna"] for c in cs], ["ID_TBCONVEN", "ID"])   # a da origem primeiro
        est = cs[1]
        self.assertEqual(est["se"]["coluna"], "ID_TBCONVEN")
        self.assertEqual(est["se"]["valores"], [""])                        # só com a fonte vazia
        ps = est["passos"]
        self.assertEqual((ps[0]["tabela"], ps[0]["modo"], ps[0]["arg"]), ("TBTIPPLCONV", "alt", "ID_TBTIPPLANO"))
        self.assertEqual(ps[0]["escolha"], ("min", "CONV"))
        self.assertEqual(ps[-1]["tabela"], "TBCONVEN")
        self.assertIn("ID_TBCONVEN", self.plano["TBTIPPLANO"]["lidas"])

    def test_escolha_da_menor_fonte(self):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        k = ("TBTIPPLCONV", "ID_TBTIPPLANO")
        c._alt_lista = {k: {"8": ["2|8", "1|8"]}}
        c._origem_pai = {("TBTIPPLCONV", "CONV"): {"2|8": 2, "1|8": 1}}
        pend = []
        s = {"tabela": "TBTIPPLCONV", "modo": "alt", "arg": "ID_TBTIPPLANO", "escolha": ("min", "CONV")}
        self.assertEqual(c._desambiguar(s, k, "8", False, pend), "1|8")
        self.assertEqual(pend, [("escolha_pelo_menor", "baixa")])

    def test_percentual_negativo_do_item_volta_ao_padrao(self):
        cs = self.conc("FCLANEXT", "conta_hospitalar_item", "percentual_cobranca")
        self.assertEqual([c["regra"] for c in cs], ["decimal_nao_negativo"])
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", D("-20")), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", D("100"))[1], None)

    def test_integracao_sem_data_pela_data_do_item(self):
        cs = self.conc("FCINTEGRPA", "producao_repasse", "integrado_em")
        self.assertEqual([c["coluna"] for c in cs], ["DATA_HORA_INTEGRACAO", "ID_FCLANEXT"])
        est = cs[1]
        self.assertEqual((est["se"]["coluna"], est["se"]["valores"]), ("DATA_HORA_INTEGRACAO", [""]))
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in est["passos"]], ["FCLANEXT", "DATA"])
        self.assertTrue(est.get("presumida"))      # estimada: a linha deixa valor_presumido (revisão de 20c4b234)
        self.assertFalse(cs[0].get("presumida"))   # a data da origem não
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        self.assertTrue(c._cond({"DATA_HORA_INTEGRACAO": None}, est["se"]))
        self.assertFalse(c._cond({"DATA_HORA_INTEGRACAO": "2025-01-01 10:00"}, est["se"]))


if __name__ == "__main__":
    unittest.main()
