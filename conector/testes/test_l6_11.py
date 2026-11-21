"""Fatia L6-11 (prontuário, assinatura e assistência, módulo PEP): declarações, plano e imagem sintética. Sem banco;
só valores inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L6-11`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_11

FATIA = ("PRUNITPLAN", "PRITEMNAOPAD", "PRITEMNAOPAD_GETABVIA", "PRITEM_GEITENS", "PRKITMED", "PRITENSKITMED",
         "PRKITSOLITENS", "TBKITPRO", "PRITEMNAOPAD_TBPRINC", "TBALERGIA_TBPRINC", "PRAGRUP_PRFILTROCLASSIF",
         "PRLOCAL_ASSISTENCIA", "TBCBARAREACAOADVERSA", "PRFAVORITO", "PRPROTGERALESP", "PREVOLUCAO", "PREVOLESPEC",
         "PREVOLTIPOACO", "PRPADEVOL", "PRFORMULCOMP", "PRMANCHESTER", "PRPARAM", "PRPAREVOLIMG")


class FatiaL611(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def test_so_as_tabelas_carregaveis_tem_destino(self):
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l6_11.CARREGADAS))
        self.assertTrue(all(c.get("_arquivo", "").endswith("L6-11.tsv") for c in self.decl))
        for c in self.decl:  # coluna sem destino sempre com motivo
            self.assertTrue(c["motivo"].strip(), c["coluna"])

    def test_plano_na_ordem_do_mapa(self):
        self.assertEqual(list(self.plano), ["PRLOCAL_ASSISTENCIA", "TBCBARAREACAOADVERSA", "PRPROTGERALESP",
                                            "PREVOLUCAO", "PREVOLESPEC", "PREVOLTIPOACO"])
        for p in self.plano.values():
            self.assertEqual(len(p["destinos"]), 1)

    def test_referencias(self):
        ref = {(t, c["destino"]): c["referencia"] for t, p in self.plano.items()
               for c in p["colunas"][p["destinos"][0]] if c["regra"] == "chave_origem"}
        self.assertEqual(ref, {
            ("PRPROTGERALESP", "protocolo_prescricao_id"): "PRPROTGERAL",
            ("PRPROTGERALESP", "especialidade_medica_id"): "TBESPEC",
            ("PREVOLUCAO", "tipo_documento_clinico_id"): "PRTPCOMP",
            ("PREVOLESPEC", "modelo_documento_clinico_id"): "PREVOLUCAO",
            ("PREVOLESPEC", "especialidade_medica_id"): "TBESPEC",
            ("PREVOLTIPOACO", "modelo_documento_clinico_id"): "PREVOLUCAO",
            ("PREVOLTIPOACO", "categoria_acomodacao_id"): "TBTIPOACOMOD"})

    def test_colunas_e_regras(self):
        def dest(t):
            p = self.plano[t]
            return {c["destino"]: (c["coluna"], c["regra"]) for c in p["colunas"][p["destinos"][0]]}
        self.assertEqual(dest("PREVOLUCAO")["tipo_registro"][0], "=~outro")
        self.assertEqual(dest("PREVOLUCAO")["codigo"], ("ID_EVOLUCAO", "texto"))
        self.assertEqual(dest("TBCBARAREACAOADVERSA")["codigo"], ("CODIGO", "codigo_char"))
        self.assertEqual(dest("TBCBARAREACAOADVERSA")["ativo"][1], "booleano_sn")
        self.assertEqual(dest("PRLOCAL_ASSISTENCIA")["ativo"], ("SITUACAO", "booleano_ai"))
        self.assertNotIn("=~outro", self.plano["PREVOLUCAO"]["lidas"])
        self.assertEqual(dest("PRLOCAL_ASSISTENCIA")["tipo_atendimento"][0], "=~todos")
        self.assertNotIn("TIPO_ATENDIMENTO", self.plano["PRLOCAL_ASSISTENCIA"]["lidas"])
        for c in ("TP_ATENDIMENTO", "CODCAB", "LAYOUT_VISUALIZACAO_IMPRESSAO", "FASE", "OLD_TIPOCOMP"):
            self.assertNotIn(c, self.plano["PREVOLUCAO"]["lidas"])
        for t, c in (("TBCBARAREACAOADVERSA", "ID_DIGITAL"), ("PREVOLTIPOACO", "NOME"), ("PREVOLUCAO", "COD")):
            self.assertNotIn(c, self.plano[t]["lidas"])

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("texto", "  Evolução   diária\r\nexemplo ")[0], "Evolução   diária\r\nexemplo")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Edema   de glote exemplo ")[0], "Edema de glote exemplo")
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))
        self.assertEqual(len(sentinela.colisoes_caixa(["ab12", "AB12", "RX001"])), 1)

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l6_11.COLUNAS), set(FATIA))
        for t in FATIA:
            self.assertIn("CREATE TABLE %s (" % t, l6_11.DDL)
        linhas = {}
        esp = l6_11.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l6_11.CARREGADAS))
        for t, cols in l6_11.COLUNAS.items():
            for v in linhas[t]:
                self.assertEqual(len(v), len(cols))
        for t, e in esp.items():  # lidas = gravadas + recusadas
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k in ("pai_pendente", "codigo_colisao_caixa"))
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]), t)


if __name__ == "__main__":
    unittest.main()
