"""Fatia L5-02 (cadastros e administração, módulo ADM): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L5-02`.
"""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_02

FATIA = set(l5_02.CARREGADAS) | set(l5_02.NAO_CARREGADAS)


class PlanoL502(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_declaradas_entram_na_carga(self):
        self.assertEqual(set(self.plano), set(l5_02.CARREGADAS))
        self.assertEqual(len(FATIA), 20)
        self.assertEqual(len(l5_02.CARREGADAS), 5)

    def test_catalogos_do_produto_fora_da_carga(self):
        # módulo e ação do sistema são carregados com o produto: módulo, opção de menu e papel x opção ficam fora
        for t in ("TBMODULO", "TBOPCOES", "TBPAPEL_TBOPCOES", "TBEVENTOS", "TBPERUSU"):
            self.assertNotIn(t, self.plano, t)
        for p in self.plano.values():
            self.assertFalse({"acao_sistema", "modulo_sistema", "papel_seguranca_acao"} & set(p["destinos"]), p["tabela"])

    def test_papel_entra_com_origem_migracao(self):
        c = self.cols("TBPAPEL", "papel_seguranca")
        self.assertEqual(c["origem"]["coluna"], "=migracao")
        self.assertEqual(set(c), {"codigo", "nome", "origem"})

    def test_codigos_numericos_viram_texto(self):
        # o número da origem vira o código VARCHAR do destino como texto (a soma de controle casa nos dois lados)
        for t, dt, col in [("TBLEITORBIOME", "modelo_leitor_biometrico", "ID"),
                           ("TBLGPDANONMOT", "base_legal_tratamento", "ID"),
                           ("TBLGPDANONUSERFUNCAO", "funcao_responsavel_lgpd", "ID"),
                           ("TBPAPEL", "papel_seguranca", "COD_PAPEL"), ("TBTERMCONREVTP", "tipo_termo_lgpd", "ID")]:
            c = self.cols(t, dt)["codigo"]
            self.assertEqual((c["coluna"], c["regra"]), (col, "texto"), t)

    def test_motivo_grava_descricao_e_explicacao(self):
        c = self.cols("TBLGPDANONMOT", "base_legal_tratamento")
        # o texto integral (até 999) cabe na explicação; a descrição curta (150) recebe o código, sem recusar a linha
        self.assertEqual((c["descricao"]["coluna"], c["descricao"]["regra"]), ("ID", "texto"))
        self.assertEqual(c["explicacao"]["coluna"], "DESCRICAO")
        self.assertEqual(self.plano["TBLGPDANONMOT"]["lidas"].count("DESCRICAO"), 1)
        self.assertTrue(any(len(m[1]) > 150 for m in l5_02.MOTIVOS))

    def test_funcao_nao_cria_encarregado(self):
        self.assertEqual(self.plano["TBLGPDANONUSERFUNCAO"]["destinos"], ["funcao_responsavel_lgpd"])

    def test_tipo_de_termo_entra_com_finalidade_outra(self):
        self.assertEqual(self.cols("TBTERMCONREVTP", "tipo_termo_lgpd")["finalidade"]["coluna"], "=outra")

    def test_nenhum_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)


class RegrasL502(unittest.TestCase):
    def test_codigo_numerico_como_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 13), ("13", None))

    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Leitor  óptico   modelo A".encode("cp1252"))[0],
                         "Leitor óptico modelo A")
        self.assertEqual(sentinela.aplicar("texto_nome", b"   "), (None, None))

    def test_texto_preserva_quebra_interna(self):
        v, _ = sentinela.aplicar("texto", b"  Exerc\xedcio regular\r\nem processo  ")
        self.assertEqual(v, "Exercício regular\r\nem processo")

    def test_sn_minusculo_e_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", b"s"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))


class ImagemL502(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(l5_02.CARREGADAS))
        for t in l5_02.NAO_CARREGADAS:
            self.assertGreater(cont.get(t, 0), 0, t)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, cont[t], t)


if __name__ == "__main__":
    unittest.main()
