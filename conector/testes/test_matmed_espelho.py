"""conta-itens-2 (ADR 0006, 3): o item de mat/med da tabela LICENCIADA (TBCTRMEM com REF_BRA/REF_SIMP) liga ao item do
espelho padrão da base pelo código; não acha: entra como item PRÓPRIO ativo com `espelho_codigo_inexistente`.

Causa reproduzida: no recorte da cadeia, as 20.000 linhas de TBMATMED eram de tabela licenciada e eram TODAS recusadas
com `licenca_nao_comprovada` (o filtro só deixava a tabela própria): o item ficava fora e o que a ele se refere
(TBREFUNI, TBPACTHM, FCLANEXT TIPO 4) ficava sem pai. A sintética L8-03 (TBMATMED 3: licenciada no espelho, ligada;
TBMATMED 8: licenciada fora do espelho, própria; 1, 2, 5, 6: tabela própria) prova o caminho no banco
(`conferir-fatia L8-03`, CONFERIR_DESTINO); aqui ficam a forma da declaração e o esperado da imagem."""
import unittest

from sante_conector import mapa
from sante_conector.sintetica_d import l8_03


class LigarEspelho(unittest.TestCase):
    def test_spec(self):
        lg = mapa.ligar_espelho_spec("ligar_espelho:brasindice:COD:TAB>TBCTRMEM>REF_BRA=S,T")
        self.assertEqual(lg["espelho"]["catalogo"], "brasindice")
        self.assertEqual(lg["coluna"], "COD")
        self.assertEqual((lg["cond"]["coluna"], lg["cond"]["valores"]), ("TAB", ["S", "T"]))
        self.assertEqual(lg["cond"]["passos"][-1].get("coluna"), "REF_BRA")

    def test_spec_recusa_mal_formado(self):
        for x in ("ligar_espelho:cep:COD:TAB>TBCTRMEM>REF_BRA=S",          # só mat/med licenciado
                  "ligar_espelho:brasindice:COD:TAB>TBCTRMEM>REF_BRA=S!x",  # sem regra de filtro
                  "ligar_espelho:brasindice::REF_BRA=S", "ligar_espelho:brasindice:COD"):
            self.assertIsNone(mapa.ligar_espelho_spec(x), x)

    def test_declaracao_do_item(self):
        dec = [c for c in mapa.carregar_execucao()["colunas_decl"] if c["tabela"] == "TBMATMED"
               and c["destino"] == "item_referencia_matmed.codigo_referencia"]
        self.assertEqual(len(dec), 1)
        via = dec[0]["via"].split(";")
        self.assertIn("ligar_espelho:brasindice:COD:TAB>TBCTRMEM>REF_BRA=S,T", via)
        self.assertIn("ligar_espelho:simpro:COD:TAB>TBCTRMEM>REF_SIMP=S,T", via)
        # pai do filtro ausente continua recusando (nunca vira própria por engano)
        self.assertIn("so_se:TAB>TBCTRMEM>REF_BRA=N,F,,S,T!licenca_nao_comprovada", via)
        # o item próprio grava a fonte 'outra' por literal: nunca uma fonte licenciada
        fontes = [c["coluna"] for c in mapa.carregar_execucao()["colunas_decl"] if c["tabela"] == "TBMATMED"
                  and c["destino"] == "item_referencia_matmed.fonte_referencia"]
        self.assertEqual(fontes, ["=outra"])

    def test_esperado_da_sintetica(self):
        esp = l8_03.linhas(None, lambda t, v: None)["TBMATMED"]
        pend = esp["pendencias"]
        self.assertEqual((pend.get("ligado_espelho"), pend.get("espelho_codigo_inexistente")), (1, 1))
        self.assertNotIn("licenca_nao_comprovada", pend)

    def test_cobertura_aceita_a_ligacao(self):
        import importlib.util
        from pathlib import Path
        arq = Path(__file__).resolve().parents[2] / "tools/obra/cobertura_conector.py"
        if not arq.exists():  # dentro do container só o conector é montado
            self.skipTest("tools/obra fora do container")
        spec = importlib.util.spec_from_file_location("cobertura_conector", arq)
        cob = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cob)
        decl = [{"tabela": "T", "coluna": "#codigo_derivado:COD:20", "destino": "item_referencia_matmed.codigo_referencia",
                 "via": "ligar_espelho:brasindice:COD:TAB>TBCTRMEM>REF_BRA=S,T"}]
        self.assertTrue(cob._so_proprio(decl, "T"))


if __name__ == "__main__":
    unittest.main()
