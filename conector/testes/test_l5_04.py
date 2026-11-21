"""Fatia L5-04 (domínios do cadastro-base): plano dirigido pelo mapa e regras das colunas. Só a imagem SINTÉTICA."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_04

CARREGADAS = {"TBCOMPLEXIDADE_HOSPITALAR": "complexidade_estabelecimento", "TBPORTE_HOSPITALAR": "porte_estabelecimento",
              "CDTPENDERECO": "tipo_endereco", "FPTPTEL": "tipo_telefone", "TBCAPACIDADE_CIVIL": "capacidade_civil",
              "TBCLASSC": "classe_fonte_pagadora", "TBESCOLARIDADE": "nivel_escolaridade"}
# fora até o motor ter a regra genérica: gravar sem ela daria valor errado em silêncio
FORA_SEM_REGRA = {"TBCLINICA", "TBECIV", "TBFERIAD"}
FATIA = set(CARREGADAS) | set(l5_04.NAO_CARREGADAS)


class PlanoL504(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t):
        p = self.plano[t]
        return {c["destino"]: c for c in p["colunas"][p["destinos"][0]]}

    def test_so_os_dominios_sao_carregados_cada_um_num_destino(self):
        self.assertEqual(set(self.plano) & FATIA, set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_codigo_numerico_vira_texto_e_descricao_nome(self):
        for t in CARREGADAS:
            c = self.cols(t)
            self.assertIn(c["codigo"]["regra"], ("texto", "codigo_char"), t)
            self.assertIn(c["descricao"]["regra"], ("texto", "texto_nome"), t)
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))

    def test_finalidade_do_endereco_vai_para_o_dominio_e_nao_para_o_endereco(self):
        self.assertNotIn("endereco_pessoa", self.plano["CDTPENDERECO"]["destinos"])
        decl = [c for c in self.m["colunas_decl"] if c["tabela"] == "CDTPENDERECO"]
        self.assertTrue(decl and all(c["via"] == "tipo_endereco" for c in decl))

    def test_natureza_da_classe_presumida_e_avisada(self):
        c = self.cols("TBCLASSC")["natureza"]
        self.assertEqual(c["coluna"], "=outro")
        decl = [x for x in self.m["colunas_decl"] if x["tabela"] == "TBCLASSC" and x["coluna"] == "=outro"]
        self.assertIn("PRESUMIDA", decl[0]["motivo"])

    def test_clinica_estado_civil_e_feriado_fora_com_motivo(self):
        for t in FORA_SEM_REGRA:
            self.assertIn(t, l5_04.NAO_CARREGADAS)
            self.assertNotIn(t, self.plano)
        self.assertIn("9999", l5_04.NAO_CARREGADAS["TBFERIAD"])
        self.assertIn("COD", l5_04.NAO_CARREGADAS["TBECIV"])
        self.assertIn("A/I", l5_04.NAO_CARREGADAS["TBCLINICA"])
        # nenhuma regra existente reconhece A/I nem o ano 9999 (por isso ficam fora)
        self.assertEqual(sentinela.aplicar("booleano_sn", "I"), (None, "valor_fora_do_dominio"))
        import datetime
        self.assertEqual(sentinela.aplicar("data", datetime.date(9999, 12, 25)), (datetime.date(9999, 12, 25), None))

    def test_imagem_sintetica_tem_feriado_de_todo_ano(self):
        lin = []
        l5_04.linhas(random.Random(1), lambda t, v: lin.append((t, v)))
        self.assertTrue(any(t == "TBFERIAD" and v[1].year == 9999 for t, v in lin))

    def test_tipo_de_telefone_preserva_caixa_e_aponta_colisao(self):
        self.assertEqual(sentinela.aplicar("codigo_char", "c ")[0], "c")
        self.assertEqual(sentinela.colisoes_caixa(["R", "C", "M", "c"]), [["C", "c"]])
        # o esperado segue o EFEITO da carga (a conferência na imagem sintética o confere contra o banco):
        # regra do brief se o motor a aplica; senão a restrição do destino, com o pedido registrado ao integrador
        esp = l5_04.linhas(random.Random(1), lambda t, v: None)["FPTPTEL"]["pendencias"]
        aplica = "colisoes_caixa" in open(carga_mapa.__file__, encoding="utf-8").read()
        self.assertEqual(aplica, l5_04.MOTOR_APLICA_COLISAO)
        self.assertEqual(esp, {"codigo_colisao_caixa": 2} if aplica else {"restricao_destino_1062": 1})

    def test_feriado_sentinela_e_facultativo_fora_do_dominio(self):
        import datetime
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))

    def test_nao_carregadas_sem_declaracao(self):
        for c in self.m["colunas_decl"]:
            self.assertNotIn(c["tabela"], l5_04.NAO_CARREGADAS)

    def test_esperado_da_imagem_sintetica(self):
        esp = l5_04.linhas(random.Random(1), lambda t, v: None)
        self.assertEqual(set(esp), set(CARREGADAS))
        self.assertEqual(sum(e["gravados"] for e in esp.values()), 26 if l5_04.MOTOR_APLICA_COLISAO else 27)


if __name__ == "__main__":
    unittest.main()
