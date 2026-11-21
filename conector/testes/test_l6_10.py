"""Fatia F4 L6-10 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo
mapa. Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_10

FATIA = "colunas.d/L6-10.tsv"


class L6_10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_10.CARREGADAS) | set(l6_10.BLOQUEADAS)
        cls.esp = l6_10.linhas(random.Random(1), lambda t, v: None)
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, cls.todas)}

    def test_fatia_tem_as_23_tabelas_e_a_imagem_tambem(self):
        self.assertEqual(len(self.todas), 23)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_10.DDL)), self.todas)

    def test_toda_coluna_da_origem_declarada(self):
        geradas = {(c["tabela"], c["coluna"]) for c in self.m["colunas"] if c["tabela"] in self.todas}
        declaradas = {(c["tabela"], c["coluna"]) for c in self.decl}
        self.assertEqual(geradas - declaradas, set())

    def test_plano_so_com_as_carregadas_e_destinos(self):
        self.assertEqual(set(self.plano), set(l6_10.CARREGADAS))
        self.assertEqual(self.plano["TBUNIDADEMEDIDA"]["destinos"], ["unidade_prescricao", "unidade_resultado"])
        # a resposta pontuada é opção da variável, não escala nem variável nova
        self.assertEqual(self.plano["PRGLASGOW"]["destinos"], ["escala_clinica_opcao"])
        self.assertEqual(self.plano["PRINDICEPONTUACAO"]["destinos"], ["escala_clinica_opcao"])

    def test_bloqueadas_sem_destino_e_com_pedido(self):
        for c in self.decl:
            if c["tabela"] in l6_10.BLOQUEADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertIn("bloqueada (pedido L6-10.json)", c["motivo"], c["tabela"])

    def test_literal_sempre_presumido(self):
        # valor que a origem não tem (classificação ou rótulo) só entra com pendência de revisão (=~): nenhum fixo
        fixos = [c for c in self.decl if c["coluna"].startswith("=") and not c["coluna"].startswith("=~")]
        self.assertEqual(fixos, [])

    def test_presumido_de_seguranca_no_padrao_mais_seguro(self):
        lit = {c["destino"]: c["coluna"] for c in self.decl if c["coluna"].startswith("=~")}
        # 'avisar' tiraria o bloqueio de uma ação que bloqueava: o presumido nunca é o mais permissivo
        self.assertEqual(lit["acao_alerta_alergia.comportamento"], "=~exigir_justificativa")
        for d in ("acao_alerta_alergia.comportamento", "tipo_parto.cirurgico",
                  "condicao_recem_nascido.nascido_vivo"):
            motivo = next(c["motivo"] for c in self.decl if c["destino"] == d)
            self.assertIn("revisão obrigatória antes do uso", motivo, d)

    def test_bloqueadas_aparecem_na_conciliacao(self):
        # tabela do mapa com destino mas sem coluna declarada não pode sumir em silêncio (pedido L6-10.json)
        f = getattr(carga_mapa, "tabelas_bloqueadas", None)
        if f is None:
            self.skipTest("regra genérica tabela_bloqueada ainda não aplicada no motor (pedido L6-10.json)")
        self.assertEqual(set(f(self.m, self.todas)), set(l6_10.BLOQUEADAS))

    def test_referencias_de_outro_dominio_nao_sao_gravadas(self):
        # unidade_medida_id e unidade_resposta_id apontam tabelas que estes pais não alimentam
        destinos = {c["destino"] for c in self.decl}
        for d in ("escala_clinica_variavel.unidade_medida_id", "variavel_calculo_dose.unidade_resposta_id",
                  "tipo_validacao_dose_unidade.unidade_medida_id", "acao_alerta_alergia.gravidade_aplicavel"):
            self.assertNotIn(d, destinos)

    def test_sequencia_por_pai(self):
        seq = {(c["tabela"], c["coluna"]) for c in self.decl if c["coluna"].startswith("#seq:")}
        self.assertEqual(seq, {("PRINDICEVARIAVEL", "#seq:ID_PRINDICEAGRUPAMENTO"),
                               ("PRGLASGOW", "#seq:ID_PRINDICEVARIAVEL"),
                               ("PRINDICEPONTUACAO", "#seq:ID_PRINDICEVARIAVEL")})

    def test_regras_da_fatia(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Externo   ao  hospital ")[0], "Externo ao hospital")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_esperado_da_imagem_so_nas_carregadas(self):
        self.assertEqual(set(self.esp), set(l6_10.CARREGADAS))
        self.assertEqual(self.esp["TBUNIDADEMEDIDA"]["gravados"], 4)


if __name__ == "__main__":
    unittest.main()
