"""C12 (2026-11-23): glosa do item da conta (FCLANEXT -> conta_hospitalar_item). Na origem GLOSADO vem T/F (T em 3,38
de 4,32 milhões de itens, 2,97 milhões sem MOTGLO) e o CHECK da glosa (situação 'glosado' exige motivo) recusava
12.963 itens no recorte. Decisão (prática TISS: glosa sempre tem motivo): 'glosado' só com o motivo reconhecido no
catálogo motivo_glosa (condição nova `se:COL@cod:tabela.coluna`); não glosado: 'lancado'; marcado sem motivo
reconhecido: 'lancado' presumido (valor_presumido), com GLOSADO e MOTGLO no retrato da trilha. Só dados falsos."""
import unittest

from sante_conector import carga_mapa, mapa, sentinela

COD = ("motivo_glosa", "codigo_tuss")


class Condicao(unittest.TestCase):
    def test_forma(self):
        c = mapa.condicao("MOTGLO@cod:motivo_glosa.codigo_tuss")
        self.assertEqual((c["coluna"], c["valores"], c["cod"], c["regra"]), ("MOTGLO", None, COD, ""))
        self.assertIsNone(mapa.condicao("MOTGLO@cod:motivo_glosa"))          # mal formada
        self.assertIsNone(mapa.condicao("GLOSADO=F,N,")["cod"])              # forma antiga intacta
        self.assertEqual(mapa.condicao("A>T>X=1!r")["regra"], "r")

    def _carga(self, catalogo):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        c._cod = {}
        c._todas = lambda sql, p: [(i,) for i in catalogo.get(str(p[0]), [])]
        return c

    def test_motivo_reconhecido_so_no_catalogo(self):
        cd = mapa.condicao("MOTGLO@cod:motivo_glosa.codigo_tuss")
        c = self._carga({"1001": [7], "2002": [8, 9]})
        self.assertTrue(c._cond({"MOTGLO": 1001}, cd))                       # motivo do catálogo
        self.assertFalse(c._cond({"MOTGLO": 7777}, cd))                      # código próprio fora do catálogo
        self.assertFalse(c._cond({"MOTGLO": 2002}, cd))                      # ambíguo não reconhece
        self.assertFalse(c._cond({"MOTGLO": 0}, cd))                         # zero = sem motivo
        self.assertFalse(c._cond({"MOTGLO": None}, cd))                      # vazio
        pend = []
        c._cond({"MOTGLO": 7777}, cd, pend)
        self.assertEqual(pend, [])                                           # a pendência fica com a coluna do cod:


class Mapa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(mapa.carregar_execucao(), {"FCLANEXT"})}

    def test_situacao_em_tres_concorrentes(self):
        cs = [c for c in self.plano["FCLANEXT"]["colunas"]["conta_hospitalar_item"]
              if c["destino"] == "situacao"]
        self.assertEqual([c["coluna"] for c in cs], ["GLOSADO", "=lancado", "=~lancado"])
        self.assertEqual(cs[0]["se"]["cod"], COD)                            # glosado só com motivo reconhecido
        self.assertEqual(cs[0]["regra"], "booleano_sn")
        self.assertEqual(cs[1]["se"]["coluna"], "GLOSADO")
        self.assertIn("F", cs[1]["se"]["valores"])
        self.assertIn("", cs[1]["se"]["valores"])                            # sem a marca: lançado
        self.assertNotIn("T", cs[1]["se"]["valores"])
        self.assertIsNone(cs[2].get("se"))                                   # T sem motivo: presumido
        mot = [c for c in self.plano["FCLANEXT"]["colunas"]["conta_hospitalar_item"]
               if c["destino"] == "motivo_glosa_id"]
        self.assertEqual([c["coluna"] for c in mot], ["MOTGLO"])
        self.assertIn("MOTGLO", self.plano["FCLANEXT"]["lidas"])

    def test_marca_t_f_da_origem(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "T"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "F"), (False, None))

    def test_retrato_guarda_glosa_original(self):
        tri = self.plano["FCLANEXT"]["colunas"].get("trilha_auditoria") or []
        ret = [c["coluna"] for c in tri if c["coluna"].startswith("#retrato:")]
        self.assertTrue(ret and "GLOSADO" in ret[0] and "MOTGLO" in ret[0])


if __name__ == "__main__":
    unittest.main()
