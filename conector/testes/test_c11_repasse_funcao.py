"""C11 (2026-11-23): a produção de repasse (FCINTEGRPA -> producao_repasse) gravava 0 na carga real. A função da equipe
vinha do ATO do item (FCLANEXT.ATO) lido como grau de participação (TBGRAUPARTPROC), mas o ATO é o GRUPO de ato
(TBTABATO -> grupo_ato): 4.407 de 10.726 produções com ATO sem grau igual eram recusadas (1048). A função passa a ser o
TITULAR (tipo de profissional 1, TBTPPROFPROC, código tipo_prof_1), porque o profissional da produção é o titular do
item. Só dados falsos; a conciliação na imagem sintética (sintetica_d/l8_06.py) usa um item com ATO 42."""
import os
import unittest

from sante_conector import carga_mapa, mapa

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Mapa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, {"FCINTEGRPA", "TBTPPROFPROC", "TBTABATO"})}

    def conc(self, t, dt, dc):
        return [c for c in self.plano[t]["colunas"][dt] if c["destino"] == dc]

    def test_funcao_da_producao_e_o_titular_pelo_codigo(self):
        cs = self.conc("FCINTEGRPA", "producao_repasse", "funcao_equipe_cobranca_id")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["coluna"], "=tipo_prof_1")
        self.assertEqual(tuple(cs[0]["cod"]), ("funcao_equipe_cobranca", "codigo"))
        # nunca mais o ATO do item como grau de participação
        self.assertFalse(any("TBGRAUPARTPROC" in str(c.get("passos")) for c in cs))

    def test_profissional_da_producao_e_o_titular_do_item(self):
        cs = self.conc("FCINTEGRPA", "producao_repasse", "profissional_id")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in cs[0]["passos"]][:2],
                         ["FCLANEXT", "ID_TBCBOPRO_TITULAR"])

    def test_codigo_do_titular_e_o_do_tipo_de_profissional(self):
        cs = self.conc("TBTPPROFPROC", "funcao_equipe_cobranca", "codigo")
        self.assertEqual(cs[0]["coluna"], "#codigo_derivado:ID:30:tipo_prof_")
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "tipo_prof_")[0], "tipo_prof_1")
        # a L8-05 carrega antes da produção (ordem do plano)
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.mapa, {"FCINTEGRPA", "TBTPPROFPROC"})]
        self.assertLess(ordem.index("TBTPPROFPROC"), ordem.index("FCINTEGRPA"))

    def test_grupo_de_ato_vai_ao_grupo_ato(self):
        self.assertEqual(self.plano["TBTABATO"]["destinos"], ["grupo_ato"])

    def test_recorte_traz_os_cadastros_da_funcao_e_do_grupo(self):
        p = os.path.join(RAIZ, "tools", "obra", "recorte-nucleo.tsv")
        if not os.path.exists(p):
            self.skipTest("recorte fora do container")
        tabs = {ln.split("\t")[0] for ln in open(p, encoding="utf-8") if ln.strip() and not ln.startswith("#")}
        self.assertTrue({"TBTABATO", "TBGRAUPARTPROC", "TBTPPROFPROC"} <= tabs)


if __name__ == "__main__":
    unittest.main()
