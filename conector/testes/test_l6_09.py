"""Fatia L6-09 (domínios do PEP): declarações, plano da carga dirigida pelo mapa e regras das colunas. Sem banco;
só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L6-09`)."""
import csv
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_09

FATIA = ["TBDIGITAL_VIAACESSO", "TBGRAUGRAVINT", "TBHORMED", "TBHORMED_TBUNIDAD", "TBLANC_DIAG_MANTER",
         "TBLANC_DIAG_STATUS", "TBLANC_DIAG_SUJ_CUID", "TBLISTADIAGNOSTICOESTADO", "TBLISTADIAGNOSTICOSITUACAO",
         "TBLISTADIAGNOSTICOTIPO", "TBLISTAPROBLEMACLASSIF", "TBMODALIDADE_ASSIST", "TBMOTIVOMP", "TBNUMDOSE",
         "TBHORARIODOSE", "TBPRINC_VALIDACAO", "TBPROBOCINTMED", "TBPROENF", "PRSINAIS", "TBREFERENCIA",
         "TBSITUACAOMP", "TBSTATUSPROCEDIMENTO", "TBTABELA_CAMPO"]


class L609(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-09.tsv", encoding="utf-8") as f:
            cls.decl = list(csv.DictReader(f, delimiter="\t"))

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_carregadas_e_nao_carregadas(self):
        self.assertEqual(set(self.plano), set(FATIA) - set(l6_09.NAO_CARREGADAS))
        sem_destino = {d["tabela"] for d in self.decl if not d["destino"]}
        self.assertTrue(set(l6_09.NAO_CARREGADAS) <= sem_destino)
        for d in self.decl:
            self.assertTrue(d["motivo"].startswith("L6-09: "))

    def test_um_destino_por_tabela(self):
        self.assertEqual(self.plano["TBREFERENCIA"]["destinos"], ["tipo_validacao_dose"])
        self.assertEqual(self.plano["TBPROENF"]["destinos"], ["cuidado_enfermagem"])
        self.assertEqual(self.plano["PRSINAIS"]["destinos"], ["parametro_vital"])

    def test_situacao_do_lancamento_nao_vira_situacao_do_problema(self):
        self.assertNotIn("TBLANC_DIAG_STATUS", self.plano)
        alim = [t for t, p in self.plano.items() if "situacao_problema" in p["destinos"]]
        self.assertEqual(alim, ["TBLISTADIAGNOSTICOSITUACAO"])
        self.assertEqual(self.cols("TBLISTADIAGNOSTICOSITUACAO", "situacao_problema")["clinicamente_ativo"]["coluna"],
                         "=~1")
        self.assertEqual(self.cols("TBSTATUSPROCEDIMENTO", "situacao_procedimento_prescrito")["codigo"]["coluna"],
                         "NOME")

    def test_colunas_de_dominio_presumidas(self):
        for t, dt, dc, lit in [("TBLISTADIAGNOSTICOSITUACAO", "situacao_problema", "categoria", "=~ativo"),
                               ("TBLISTADIAGNOSTICOTIPO", "tipo_diagnostico", "papel", "=~secundario"),
                               ("TBPRINC_VALIDACAO", "referencia_dose", "base_calculo", "=~dose_fixa"),
                               ("TBREFERENCIA", "tipo_validacao_dose", "base_calculo", "=~dose"),
                               ("TBSITUACAOMP", "situacao_prescricao", "categoria", "=~planejada"),
                               ("TBSTATUSPROCEDIMENTO", "situacao_procedimento_prescrito", "etapa", "=~pedido"),
                               ("TBLISTADIAGNOSTICOESTADO", "certeza_diagnostico", "confirmado", "=~0")]:
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit)

    def test_ordem_clinica_nunca_presumida_em_silencio(self):
        # nível da gravidade: tabela bloqueada até o de-para; grau da certeza: pela chave, com valor_presumido na linha
        self.assertNotIn("TBGRAUGRAVINT", self.plano)
        self.assertIn("=~0", {c["coluna"] for c in self.plano["TBLISTADIAGNOSTICOESTADO"]["colunas"]
                              ["certeza_diagnostico"]})
        self.assertEqual(self.cols("PRSINAIS", "parametro_vital")["tipo_resposta"]["coluna"], "=~numero")

    def test_grade_de_horario_bloqueada(self):
        # sem hora em texto e sem de-para do tipo de atendimento a grade não carrega: presumir o tipo gravaria
        # escopos idênticos (estabelecimento, tipo, unidade/bloco/setor NULL) que a chave única não barra
        self.assertNotIn("TBHORMED", self.plano)
        vistos = {}
        l6_09.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        tipos = [v[1] for v in vistos["TBHORMED"]]
        self.assertGreater(len(tipos), len(set(tipos)))  # a imagem tem duas grades do mesmo tipo

    def test_toda_coluna_da_origem_declarada(self):
        decl = {(d["tabela"], d["coluna"]) for d in self.decl}
        with open(mapa.DIR_PACOTE / "colunas.tsv", encoding="utf-8") as f:
            orig = [(r["tabela"], r["coluna"]) for r in csv.DictReader(f, delimiter="\t") if r["tabela"] in FATIA]
        chaves = {(t, c) for t in FATIA for c in self.m_chave(t)}
        faltam = [x for x in orig if x not in decl and x not in chaves
                  and x[0] not in l6_09.NAO_CARREGADAS]
        self.assertEqual(faltam, [])

    def m_chave(self, t):
        with open(mapa.DIR_PACOTE / "tabelas.tsv", encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                if r["tabela"] == t:
                    return r["chave"].split(",")
        return []

    def test_referencias_aos_pais(self):
        c = self.cols("TBPROENF", "cuidado_enfermagem")
        self.assertEqual(c["sexo_id"]["referencia"], "TBSEXO")
        self.assertEqual(c["idade_minima_unidade_idade_id"]["referencia"], "TBUNID_IDADE")
        self.assertEqual(c["idade_maxima_unidade_idade_id"]["referencia"], "TBUNID_IDADE")

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("booleano_ai", "A")[0], True)
        self.assertEqual(sentinela.aplicar("booleano_ai", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_01", 0)[0], False)
        self.assertEqual(sentinela.aplicar("flutuante", 18.0)[0], decimal.Decimal("18.0"))
        self.assertEqual(carga_mapa.canon(sentinela.aplicar("flutuante", 18.0)[0]), carga_mapa.canon(18))
        self.assertEqual(sentinela.aplicar("texto_nome", "  Moderada  ")[0], "Moderada")
        self.assertEqual(carga_mapa.tipar(7, "varchar"), "7")

    def test_esperado_da_imagem_sintetica(self):
        vistos = {}
        esp = l6_09.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(self.plano))
        recusa = ("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")
        for t, e in esp.items():
            self.assertEqual(e["gravados"] + sum(v for k, v in e["pendencias"].items() if k.startswith(recusa)),
                             len(vistos[t]), t)


if __name__ == "__main__":
    unittest.main()
