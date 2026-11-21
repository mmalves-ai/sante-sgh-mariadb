"""Fatia F4 L6-06 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo mapa.
Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import decimal
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_06

FATIA = "colunas.d/L6-06.tsv"
PRESUMIDAS = {("PROPCAOPERIODO", "periodo_consulta_sumario_alta.atendimento_inteiro"),
              ("PRPADRECEITA", "modelo_receita.abrangencia"),
              ("PRSITAPRAZAM", "situacao_aprazamento.categoria"),
              ("PRSITCHECAGEM", "situacao_checagem.categoria"),
              ("PRPROTGERAL", "protocolo_prescricao.sexo")}


class L6_06(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_06.CARREGADAS) | set(l6_06.NAO_CARREGADAS)
        cls.esp = l6_06.linhas(__import__("random").Random(1), lambda t, v: None)
        cls.plano = {x["tabela"]: x for x in carga_mapa.planejar(cls.m, cls.todas)}

    def test_fatia_tem_as_24_tabelas_e_a_imagem_tambem(self):
        self.assertEqual(len(self.todas), 24)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_06.DDL)), self.todas)

    def test_plano_so_com_as_carregadas_e_um_destino(self):
        self.assertEqual(set(self.plano), set(l6_06.CARREGADAS))
        self.assertEqual(self.plano["PRPADRECEITA"]["destinos"], ["modelo_receita"])
        self.assertEqual(self.plano["PRPROTGERAL"]["destinos"], ["protocolo_prescricao"])
        ordem = [x["tabela"] for x in carga_mapa.planejar(self.m, self.todas)]
        self.assertLess(ordem.index("PROFTGRUPEXAME"), ordem.index("PROFTEXAME"))

    def test_nao_carregadas_sem_destino_e_com_motivo(self):
        for c in self.decl:
            if c["tabela"] in l6_06.NAO_CARREGADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertRegex(c["motivo"], r"L6-06: (bloqueada|não carregada)", c["tabela"])
                self.assertIn("pedido L6-06.json", c["motivo"], c["tabela"])

    def test_literais_presumidos_e_fixos(self):
        lit = {(c["tabela"], c["destino"]): c["coluna"] for c in self.decl if c["coluna"].startswith("=")}
        self.assertEqual({k for k, v in lit.items() if v.startswith("=~")}, PRESUMIDAS)
        self.assertEqual(lit[("PRPADRECEITA", "modelo_receita.formato")], "=livre")
        self.assertEqual(lit[("PRSAE_LIKERT", "escala_resultado_enfermagem.tipo_escala")], "=likert_1_a_5")
        for t, _ in PRESUMIDAS:
            self.assertIn("valor_presumido", self.esp[t]["pendencias"], t)

    def test_referencias_declaradas_na_via(self):
        via = {(c["tabela"], c["coluna"]): (c["regra"], c["via"]) for c in self.decl if c["via"]}
        self.assertEqual(via, {("PROFTEXAME", "ID_OFTGRUPO"): ("chave_origem", "ref:PROFTGRUPEXAME"),
                               ("PRPADRECEITA", "USUARIO"): ("chave_origem", "ref:TBUSERS")})
        self.assertEqual(set(l6_06.PAIS_EXTERNOS), {"TBUSERS"})

    def test_vigencia_do_protocolo_suspensa_ate_o_pedido(self):
        # TIMESTAMP gravado em DATE diverge na soma de controle: fica fora até a regra genérica do motor
        ativas = {c["coluna"] for c in self.decl if c["tabela"] == "PRPROTGERAL" and c["destino"]}
        self.assertFalse({"VIGENCIAI", "VIGENCIAF"} & ativas)

    def test_sexo_do_protocolo_presumido_com_pendencia(self):
        # protocolo restrito a um sexo nunca vira "todos" em silêncio: literal presumido até o de-para A/F/M
        cols = {c["coluna"]: c["destino"] for c in self.decl if c["tabela"] == "PRPROTGERAL"}
        self.assertEqual(cols["SEXO"], "")
        self.assertEqual(cols["=~todos"], "protocolo_prescricao.sexo")
        self.assertEqual(self.esp["PRPROTGERAL"]["pendencias"]["valor_presumido"], 6)  # toda linha lida

    def test_uso_geral_do_protocolo_e_por_especialidade(self):
        # GERAL do protocolo = vale para todas as especialidades (vínculos em PRPROTGERALESP, outra fatia)
        g = [c for c in self.m["colunas_decl"] if c["tabela"] == "PRPROTGERALESP" and c["destino"]]
        self.assertIn("protocolo_prescricao_especialidade.protocolo_prescricao_id", {c["destino"] for c in g})
        ger = [c for c in self.decl if (c["tabela"], c["coluna"]) == ("PRPROTGERAL", "GERAL")][0]
        self.assertEqual((ger["destino"], ger["regra"]), ("protocolo_prescricao.uso_geral", "booleano_sn"))

    def test_extensoes_de_arquivo_nao_viram_tipo_de_anexo(self):
        self.assertIn("PROFTTPARQUIV", l6_06.NAO_CARREGADAS)
        self.assertNotIn("PROFTTPARQUIV", self.plano)
        self.assertFalse([c for c in self.m["colunas_decl"] if c["tabela"] == "PROFTTPARQUIV" and c["destino"]])

    def test_regras_da_fatia(self):
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", decimal.Decimal("0.000")), (None, None))
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", decimal.Decimal("40.500"))[0],
                         decimal.Decimal("40.500"))
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "T")[0], True)
        self.assertEqual(sentinela.aplicar("booleano_sn", "F")[0], False)
        self.assertEqual(sentinela.aplicar("texto", " 3")[0], "3")
        self.assertEqual(carga_mapa.tipar("3", "tinyint"), 3)
        self.assertEqual(sentinela.aplicar("texto_longo", "a\r\n  b ")[0], "a\r\n  b ")
        import datetime
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))

    def test_esperado_da_imagem_so_nas_carregadas(self):
        self.assertEqual(set(self.esp), set(l6_06.CARREGADAS))
        self.assertEqual(self.esp["PROFTEXAME"]["pendencias"],
                         {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 2})
        self.assertEqual(self.esp["PRPADRECEITA"]["gravados"], 3)


if __name__ == "__main__":
    unittest.main()
