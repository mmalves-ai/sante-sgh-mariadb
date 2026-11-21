"""Fatia L5-04 (domínios do cadastro-base, credores, técnicos, pré-cadastro e titular): plano dirigido pelo mapa e
regras das colunas. Só a imagem SINTÉTICA."""
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_04

CARREGADAS = {"TBCOMPLEXIDADE_HOSPITALAR": ["complexidade_estabelecimento"],
              "TBPORTE_HOSPITALAR": ["porte_estabelecimento"], "CDTPENDERECO": ["tipo_endereco"],
              "FPTPTEL": ["tipo_telefone"], "TBCAPACIDADE_CIVIL": ["capacidade_civil"],
              "TBCLASSC": ["classe_fonte_pagadora"], "TBESCOLARIDADE": ["nivel_escolaridade"],
              "TBCLINICA": ["clinica_assistencial"], "FPECIV": ["estado_civil"], "TBECIV": ["estado_civil"],
              "GETABFUN": ["pessoa_fisica", "conta_bancaria_credor"],
              "SITECNIC": ["profissional", "pessoa_fisica"], "SHTECNIC": ["profissional", "pessoa_fisica"],
              "TBFONTE_PAGADORA": ["origem_recurso_compra"],
              "REPACAGN": ["pre_cadastro"], "SIPACAGN": ["pre_cadastro"], "RESEGUR": ["titular_cobertura"],
              "FAMEDSOL": ["solicitante_externo"], "TBCBOPRO": ["inscricao_conselho"],
              "TBESPPRO": ["especialidade_procedimento"], "TBFERIAD": ["dia_nao_util"]}
FATIA = set(CARREGADAS) | set(l5_04.NAO_CARREGADAS)


class PlanoL504(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt=None):
        p = self.plano[t]
        return {c["destino"]: c for c in p["colunas"][dt or p["destinos"][0]]}

    def test_tabelas_carregadas_e_destinos(self):
        self.assertEqual(set(self.plano) & FATIA, set(CARREGADAS))
        for t, dts in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)
        # meta zero descarte sem motivo de produto: os técnicos e a fonte do recurso carregam
        self.assertEqual(l5_04.NAO_CARREGADAS, {})
        sem = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertFalse(sem & FATIA)

    def test_conferencia_nao_carrega_pai_so_lido(self):
        # TBPROCTO (L8-03) está na imagem só para a chave alternativa: a conferência da fatia não o carrega
        mt = l5_04.MAPA_TESTE
        self.assertFalse({c["tabela"] for c in mt["colunas_decl"]} & set(l5_04.SO_LIDOS))
        self.assertIn("TBPROCTO", l5_04.PAIS_EXTERNOS)

    def test_estado_civil_folha_com_prefixo_cadastro_adotado_por_sexo(self):
        # a folha e o cadastro são espaços de código distintos: a folha tem prefixo de domínio e nunca é adotada pelo
        # número; o cadastro adota só as próprias variantes por sexo
        self.assertFalse(self.plano["FPECIV"]["opcoes"]["estado_civil"].get("adotar"))
        self.assertEqual(self.cols("FPECIV")["codigo"]["coluna"], "#codigo_derivado:COD_ECIV:30:folha_")
        self.assertEqual(carga_mapa.codigo_derivado("2", 30, "folha_"), ("folha_2", False))
        self.assertEqual(self.plano["TBECIV"]["opcoes"]["estado_civil"]["adotar"], ["codigo"])
        self.assertEqual(self.cols("FPECIV")["codigo_esocial"]["regra"], "inteiro_faixa:1,5")
        self.assertEqual(sentinela.aplicar("inteiro_faixa:1,5", 9), (None, "valor_fora_do_dominio"))

    def test_presumidos_com_pendencia(self):
        self.assertEqual(self.cols("TBCLASSC")["natureza"]["coluna"], "=~outro")
        self.assertEqual(self.cols("TBCLINICA")["natureza"]["coluna"], "=~outra")

    def test_clinica_situacao_ai(self):
        self.assertEqual(self.cols("TBCLINICA")["ativo"]["regra"], "booleano_ai")
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.colisoes_caixa(["M", "C", "O", "P", "c", "X"]), [["C", "c"]])

    def test_credor_pessoa_unica_e_conta_so_com_banco(self):
        p = self.plano["GETABFUN"]
        self.assertEqual(p["opcoes"]["pessoa_fisica"]["adotar"], ["cpf"])
        self.assertEqual(p["opcoes"]["conta_bancaria_credor"]["desdobrar"], [("BANCO", "corrente")])
        c = self.cols("GETABFUN", "conta_bancaria_credor")
        self.assertEqual((c["banco_id"]["coluna"], c["banco_id"]["depara"]), ("#item", "banco"))
        self.assertEqual(c["pessoa_fisica_id"]["coluna"], "@id")
        self.assertEqual(self.cols("GETABFUN")["pis_pasep"]["regra"], "inteiro_zeros_esquerda:11")
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:11", "123.45678.90-1"), ("12345678901", None))

    def test_tecnico_como_profissional_da_pessoa_adotada_pelo_cpf(self):
        for t, sit, pares in (("SITECNIC", "ATIVO", {"1": "ativo", "0": "inativo"}),
                              ("SHTECNIC", "SITUACAO", {"A": "ativo", "I": "inativo"})):
            op = self.plano[t]["opcoes"]
            self.assertEqual((op["pessoa_fisica"]["adotar"], op["pessoa_fisica"]["antes"]), (["cpf"], True), t)
            self.assertEqual(op["profissional"]["adotar"], ["pessoa_fisica_id"], t)
            c = self.cols(t)
            self.assertEqual(c["pessoa_fisica_id"]["coluna"], "@id:pessoa_fisica", t)
            self.assertEqual(c["tipo"]["coluna"], "=~assistencial", t)
            self.assertEqual((c["situacao"]["coluna"], c["situacao"]["valores"]), (sit, pares), t)
            self.assertEqual(c["celular"]["coluna"], "CELULAR", t)
        self.assertEqual(self.cols("TBFONTE_PAGADORA")["descricao"]["regra"], "texto_nome")
        self.assertEqual(sentinela.aplicar("cpf", l5_04.CPF_A), ("%011d" % l5_04.CPF_A, None))

    def test_pre_cadastro(self):
        for t in ("REPACAGN", "SIPACAGN"):
            c = self.cols(t)
            self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
            self.assertEqual(c["cep"]["regra"], "inteiro_zeros_esquerda:8")
            self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
            self.assertEqual(c["municipio_ibge_id"]["depara"], "ibge_municipio")
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:8", 1310100), ("01310100", None))
        # a agenda de exames não tem data de nascimento: vem do paciente pelo prontuário (encadeada)
        dn = self.cols("SIPACAGN")["data_nascimento"]
        self.assertEqual(dn["passos"], [{"tabela": "RICADPAC", "modo": "alt", "arg": "PRONT"}, {"coluna": "NASC"}])
        self.assertEqual(dn["regra"], "data")
        # marcação de paciente já cadastrado: paciente e situação pelo prontuário (fora da fila de conversão)
        for t in ("REPACAGN", "SIPACAGN"):
            c = self.cols(t)
            self.assertEqual(c["paciente_id"]["passos"], [{"tabela": "RICADPAC", "modo": "alt", "arg": "PRONT"}])
            for dc in ("situacao", "convertido_em"):
                self.assertEqual(c[dc]["passos"][-1], {"coluna": "DTCAD"}, (t, dc))
            self.assertEqual((c["situacao"]["regra"], c["situacao"]["valores"]), ("preenchido", {"1": "convertido"}))
        self.assertEqual(sentinela.aplicar("preenchido", datetime.date(2020, 1, 1)), (True, None))

    def test_titular_pela_cobertura_encadeada_e_adotado(self):
        c = self.cols("RESEGUR")["cobertura_paciente_id"]
        self.assertEqual([s.get("tabela") or s.get("coluna") for s in c["passos"]],
                         ["RECADATE", "PRONT", "RICADPAC", "ID", "RICADPAC_TBCONVEN"])
        self.assertEqual(self.plano["RESEGUR"]["opcoes"]["titular_cobertura"]["adotar"], ["cobertura_paciente_id"])
        r = self.cols("RESEGUR")
        self.assertEqual(r["tipo_titular"]["valores"], {"F": "pessoa_fisica", "f": "pessoa_fisica",
                                                        "J": "pessoa_juridica", "j": "pessoa_juridica"})
        self.assertEqual(r["cnpj"]["regra"], "cnpj")
        self.assertEqual(r["tipo_parentesco_id"]["referencia"], "TBPARENTE")
        self.assertEqual(sentinela.aplicar("cnpj", 11222333000181), ("11222333000181", None))

    def test_solicitante_do_sus_completa_o_solicitante(self):
        p = self.plano["FAMEDSOL"]
        self.assertTrue(p["opcoes"]["solicitante_externo"]["complementa"])
        c = self.cols("FAMEDSOL")
        self.assertEqual(c["id"]["passos"], [{"tabela": "TBMEDSOL", "modo": "alt", "arg": "COD_CONSELHO_PROFISSIONAL"}])
        self.assertEqual(c["cns"]["regra"], "inteiro_zeros_esquerda:15")

    def test_feriado_recorrente_pelo_ano_marca(self):
        c = self.cols("TBFERIAD")
        self.assertEqual((c["recorrencia"]["regra"], c["recorrencia"]["valores"]),
                         ("ano_recorrente:9999", {"1": "anual", "0": "data_unica"}))
        for dc, rg in (("dia", "dia_recorrente:9999"), ("mes", "mes_recorrente:9999"),
                       ("data", "data_nao_recorrente:9999")):
            self.assertEqual((c[dc]["coluna"], c[dc]["regra"]), ("DATA", rg))
        self.assertEqual(c["abrangencia"]["coluna"], "=estabelecimento")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        natal = datetime.date(9999, 12, 25)
        self.assertEqual(sentinela.aplicar("dia_recorrente:9999", natal), (25, None))
        self.assertEqual(sentinela.aplicar("mes_recorrente:9999", natal), (12, None))
        self.assertEqual(sentinela.aplicar("data_nao_recorrente:9999", natal), (None, None))
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        lin = []
        l5_04.linhas(random.Random(1), lambda t, v: lin.append((t, v)))
        self.assertTrue(any(t == "TBFERIAD" and v[1].year == 9999 for t, v in lin))

    def test_inscricao_no_conselho(self):
        c = self.cols("TBCBOPRO")
        self.assertEqual(c["profissional_id"]["passos"][-1].get("tabela"), "TBPROFIS")
        self.assertEqual(c["sequencia"]["coluna"], "#seq:ID_TBPROFIS")
        self.assertEqual(c["conselho_classe_id"]["depara"], "conselho_classe")
        self.assertEqual(c["unidade_federativa_id"]["depara"], "ibge_uf")
        self.assertEqual((c["ocupacao_cbo_id"]["depara"], c["ocupacao_cbo_id"]["passos"][-1]), ("cbo", {"coluna": "COD"}))
        self.assertEqual(c["situacao"]["valores"], {"1": "ativa", "0": "inativa"})
        self.assertEqual(c["competencia_inicio"]["regra"], "competencia_aaaamm")
        self.assertEqual(sentinela.aplicar("competencia_aaaamm", 202001), (datetime.date(2020, 1, 1), None))
        self.assertEqual(sentinela.aplicar("competencia_aaaamm", 202013), (None, "valor_fora_do_dominio"))

    def test_especialidade_procedimento_pelo_codigo(self):
        c = self.cols("TBESPPRO")
        self.assertEqual(c["item_faturavel_id"]["passos"], [{"tabela": "TBPROCTO", "modo": "alt", "arg": "COD_PROCEDIMENTO"}])
        self.assertEqual(c["especialidade_medica_id"]["referencia"], "TBESPEC")
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")

    def test_esperado_da_imagem_sintetica(self):
        esp = l5_04.linhas(random.Random(1), lambda t, v: None)
        self.assertEqual(set(esp), set(CARREGADAS))
        self.assertEqual(sum(e["gravados"] for e in esp.values()), 64 if l5_04.MOTOR_APLICA_COLISAO else 65)
        self.assertEqual(esp["RESEGUR"]["pendencias"].get("documento_invalido", 0), 0 if l5_04.MOTOR_CPF_DOUBLE else 2)


if __name__ == "__main__":
    unittest.main()
