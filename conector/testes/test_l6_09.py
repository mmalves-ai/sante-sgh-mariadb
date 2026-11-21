"""Fatia L6-09 (domínios do PEP): declarações, plano da carga dirigida pelo mapa e regras das colunas. Sem banco;
só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L6-09`)."""
import csv
import datetime
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_09

FATIA = ["TBGRAUGRAVINT", "TBHORMED", "TBHORMED_TBUNIDAD", "TBLANC_DIAG_MANTER",
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
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        self.assertNotIn("TBHORMED_TBUNIDAD", sc)  # dado do cliente: carrega (unidade na grade, 06_PEP/16)
        for t in l6_09.NAO_CARREGADAS:  # o que não carrega é descarte com causa de produto
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "duplicado", "mecanismo_do_produto", "derivado"}, t)
            self.assertNotIn(t, {d["tabela"] for d in self.decl})
        for d in self.decl:
            self.assertTrue(d["motivo"].startswith("L6-09"))

    def test_um_destino_por_tabela(self):
        # princípio de validação = tipo de validação (a L6-10 liga as unidades a ele); referência = base da dose
        self.assertEqual(self.plano["TBPRINC_VALIDACAO"]["destinos"], ["tipo_validacao_dose"])
        self.assertEqual(self.plano["TBREFERENCIA"]["destinos"], ["referencia_dose"])
        self.assertEqual(self.plano["TBPROENF"]["destinos"], ["cuidado_enfermagem"])
        self.assertEqual(self.plano["PRSINAIS"]["destinos"], ["parametro_vital"])

    def test_situacao_do_lancamento_nao_vira_situacao_do_problema(self):
        # rodada 5: a situação do lançamento carrega como lista do hospital (parâmetro de lista), nunca no problema
        self.assertEqual(self.plano["TBLANC_DIAG_STATUS"]["destinos"][0], "parametro_opcao")
        alim = [t for t, p in self.plano.items() if "situacao_problema" in p["destinos"]]
        self.assertEqual(alim, ["TBLISTADIAGNOSTICOSITUACAO"])
        c = self.cols("TBLISTADIAGNOSTICOSITUACAO", "situacao_problema")["clinicamente_ativo"]
        self.assertEqual((c["coluna"], c["depara"]), ("NOME", "valores"))
        self.assertEqual(self.cols("TBSTATUSPROCEDIMENTO", "situacao_procedimento_prescrito")["codigo"]["coluna"],
                         "NOME")

    def test_comportamento_pelo_nome_nunca_presumido(self):
        for t, dt, dcs in [("TBLISTADIAGNOSTICOSITUACAO", "situacao_problema", ["categoria", "clinicamente_ativo"]),
                           ("TBLISTADIAGNOSTICOESTADO", "certeza_diagnostico", ["grau", "confirmado"]),
                           ("TBLISTADIAGNOSTICOTIPO", "tipo_diagnostico", ["papel", "unico_por_atendimento"]),
                           ("TBPRINC_VALIDACAO", "tipo_validacao_dose", ["base_calculo"]),
                           ("TBREFERENCIA", "referencia_dose", ["base_calculo", "unidade_base"]),
                           ("TBSITUACAOMP", "situacao_prescricao", ["categoria", "vigente", "final"]),
                           ("TBSTATUSPROCEDIMENTO", "situacao_procedimento_prescrito", ["etapa", "final"])]:
            for dc in dcs:
                c = self.cols(t, dt)[dc]
                self.assertEqual((c["coluna"], c["depara"]), ("NOME", "valores"), (t, dc))
        presumidas = [d for d in self.decl if d["coluna"].startswith("=~")]
        self.assertEqual([(d["tabela"], d["destino"]) for d in presumidas], [("TBPROENF", "cuidado_enfermagem.tipo"),
                                                                     ("PRSINAIS", "parametro_vital.tipo_resposta")])
        v = {(x["tabela"], x["destino"], x["valor_origem"]): x["valor_destino"] for x in self.m["valores"]}
        self.assertEqual(v[("TBLISTADIAGNOSTICOESTADO", "certeza_diagnostico.grau", "Confirmado")], "3")
        self.assertEqual(v[("TBLISTADIAGNOSTICOESTADO", "certeza_diagnostico.confirmado", "Confirmado")], "1")
        self.assertEqual(v[("TBLISTADIAGNOSTICOESTADO", "certeza_diagnostico.confirmado", "Provável")], "0")
        self.assertEqual(v[("TBLISTADIAGNOSTICOSITUACAO", "situacao_problema.clinicamente_ativo", "Resolvido")], "0")
        self.assertEqual(v[("TBLISTADIAGNOSTICOTIPO", "tipo_diagnostico.papel", "PRINCIPAL")], "principal")
        self.assertEqual(v[("TBREFERENCIA", "referencia_dose.base_calculo", "Por quilo")], "peso")
        self.assertEqual(v[("TBREFERENCIA", "referencia_dose.unidade_base", "Por quilo")], "kg")
        self.assertEqual(v[("TBREFERENCIA", "referencia_dose.unidade_base", "Dose fixa")], "")
        self.assertEqual(v[("TBPRINC_VALIDACAO", "tipo_validacao_dose.base_calculo", "Por superficie corporal")],
                         "superficie_corporal")
        self.assertEqual(v[("TBSITUACAOMP", "situacao_prescricao.vigente", "Liberada")], "1")
        self.assertEqual(v[("TBSITUACAOMP", "situacao_prescricao.final", "Suspensa")], "0")
        self.assertEqual(v[("TBSTATUSPROCEDIMENTO", "situacao_procedimento_prescrito.etapa", "Realizado")], "realizado")
        # o vigente nunca é final (CHECK do destino)
        for (t, dt, n), x in v.items():
            if dt == "situacao_prescricao.vigente" and x == "1":
                self.assertEqual(v[(t, "situacao_prescricao.final", n)], "0", n)

    def test_restricoes_do_cuidado_nunca_nulas_e_unidade_do_parametro(self):
        v = {(x["tabela"], x["destino"], x["valor_origem"]): x["valor_destino"] for x in self.m["valores"]}
        for dc in ("acao_restricao_sexo", "acao_restricao_idade"):
            self.assertEqual(v[("TBPROENF", "cuidado_enfermagem." + dc, "")], "alertar")
            self.assertEqual(v[("TBPROENF", "cuidado_enfermagem." + dc, "Exigir justificativa")], "alertar")
            self.assertEqual(v[("TBPROENF", "cuidado_enfermagem." + dc, "BLOQUEAR")], "bloquear")
        via = {d["destino"]: d["via"] for d in self.decl if d["tabela"] in ("TBPROENF", "PRSINAIS")}
        self.assertEqual(via["cuidado_enfermagem.acao_restricao_sexo"], "ref:PRTIPONOTIFICACAO>NOME")
        self.assertEqual(via["parametro_vital.unidade"], "ref:PRUNIDRESPOSTA>NOME")
        # tipo do cuidado: a letra A/E/M da origem não é a classificação do produto (sem evidência): presumido, com
        # valor_presumido por linha, e nenhum de-para inventado pela letra
        self.assertEqual(self.cols("TBPROENF", "cuidado_enfermagem")["tipo"]["coluna"], "=~cuidado")
        self.assertFalse([k for k in v if k[:2] == ("TBPROENF", "cuidado_enfermagem.tipo")])
        # nome acima de 150 resumido (nunca recusado: as prescrições de cuidado não perdem o pai), integral no detalhe
        c = self.cols("TBPROENF", "cuidado_enfermagem")
        self.assertEqual((c["descricao"]["coluna"], c["descricao"]["regra"]), ("NOME", "texto_resumo:150"))
        self.assertEqual(c["descricao_detalhada"]["coluna"], "NOME")
        x, pr = sentinela.aplicar("texto_resumo:150", "Cuidado " + "longo " * 26)
        self.assertEqual((len(x) <= 150, pr), (True, "texto_resumido"))

    def test_ordem_clinica_nunca_presumida_em_silencio(self):
        # nível da gravidade e grau da certeza pelo NOME (de-para de valores), nunca pela ordem da chave
        c = self.cols("TBGRAUGRAVINT", "gravidade_interacao")
        self.assertEqual((c["nivel"]["coluna"], c["nivel"]["depara"]), ("NOME", "valores"))
        self.assertNotIn("ID", [x["coluna"] for x in self.plano["TBGRAUGRAVINT"]["colunas"]["gravidade_interacao"]
                                if x["destino"] == "nivel"])
        self.assertNotIn("ID", [x["coluna"] for x in self.plano["TBLISTADIAGNOSTICOESTADO"]["colunas"]
                                ["certeza_diagnostico"] if x["destino"] == "grau"])
        self.assertEqual(self.cols("PRSINAIS", "parametro_vital")["tipo_resposta"]["coluna"], "=~numero")

    def test_acao_da_gravidade_opcional_pelo_nome(self):
        self.assertEqual(self.plano["TBGRAUGRAVINT"]["destinos"], ["gravidade_interacao", "acao_gravidade_interacao"])
        self.assertTrue(self.plano["TBGRAUGRAVINT"]["opcoes"]["acao_gravidade_interacao"]["opcional"])
        vals = {(v["tabela"], v["coluna"], v["valor_origem"]): v["valor_destino"] for v in self.m["valores"]}
        self.assertEqual(vals[("TBGRAUGRAVINT", "ID_TBACAOGRAUGRA", "Bloquear")], "bloquear")
        self.assertEqual(vals[("TBGRAUGRAVINT", "NOME", "Leve")], "1")
        self.assertEqual(vals[("TBGRAUGRAVINT", "NOME", "Grave")], "3")

    def test_grade_e_horarios_padrao(self):
        g = self.cols("TBHORMED", "grade_horario_unidade")
        self.assertEqual(g["tipo_atendimento"]["depara"], "valores")
        self.assertEqual(g["hora_inicio_dia"]["regra"], "hora_hhmm")
        self.assertEqual(sentinela.aplicar("hora_hhmm", "0730")[0], datetime.time(7, 30))
        self.assertEqual(sentinela.aplicar("hora_hhmm", "2575")[1], "hora_invalida")
        via = {d["destino"]: d["via"] for d in self.decl if d["tabela"] == "TBHORARIODOSE"}
        self.assertEqual(via["horario_padrao_dose.grade_horario_unidade_id"], "ref:TBNUMDOSE>ID_TBHORMED>TBHORMED")
        self.assertEqual(via["horario_padrao_dose.doses_por_dia"], "ref:TBNUMDOSE>NUM_DOSE")
        self.assertEqual(self.plano["TBNUMDOSE"]["destinos"], ["frequencia_administracao"])
        # grade da unidade = cópia da grade por linha de TBHORMED_TBUNIDAD (nunca UPDATE da grade: a grade com várias
        # unidades perderia as ligações e a conciliação derrubaria a importação)
        via = {d["destino"]: d["via"] for d in self.decl if d["tabela"] == "TBHORMED_TBUNIDAD"}
        self.assertNotIn("grade_horario_unidade.id", via)
        self.assertFalse(any("complementa" in x for x in via.values()))
        self.assertEqual(via["grade_horario_unidade.unidade_assistencial_id"], "ref:TBUNIDAD")
        self.assertEqual(via["grade_horario_unidade.estabelecimento_id"], "ref:TBUNIDAD@estabelecimento_id")
        for dc in ("tipo_atendimento", "hora_inicio_dia", "considera_vigencia", "permite_liberar_fora_vigencia"):
            self.assertEqual(via["grade_horario_unidade." + dc], "ref:TBHORMED@" + dc)
        self.assertEqual(self.plano["TBHORMED_TBUNIDAD"]["destinos"], ["grade_horario_unidade"])
        self.assertFalse(self.plano["TBHORMED_TBUNIDAD"]["opcoes"].get("grade_horario_unidade", {}).get("complementa"))
        vistos = {}
        l6_09.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        por_grade = {}
        for u, g in vistos["TBHORMED_TBUNIDAD"]:
            por_grade.setdefault(g, []).append(u)
        self.assertTrue(any(len(us) > 1 for us in por_grade.values()))  # a imagem prova a grade com duas unidades

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
        self.assertEqual(esp["TBHORARIODOSE"]["pendencias"]["pai_inexistente"], 2)  # 99: as duas colunas encadeadas
        extra = {}
        for t, e in esp.items():
            self.assertEqual(e["gravados"] + extra.get(t, 0)
                             + sum(v for k, v in e["pendencias"].items() if k.startswith(recusa)), len(vistos[t]), t)


class NumeroDoses(unittest.TestCase):  # revisão 2 (ADR 0006, 1): o número de doses CARREGA (nunca derivado)
    def test_numero_de_doses_vira_frequencia(self):
        m = mapa.carregar_execucao()
        p = {x["tabela"]: x for x in carga_mapa.planejar(m, {"TBNUMDOSE"})}["TBNUMDOSE"]
        self.assertEqual(p["destinos"], ["frequencia_administracao"])
        c = {x["destino"]: x for x in p["colunas"]["frequencia_administracao"]}
        self.assertEqual(c["tipo"]["coluna"], "=vezes_ao_dia")
        self.assertEqual(c["doses_por_dia"]["coluna"], "NUM_DOSE")
        self.assertEqual(c["horario_fixo"]["coluna"], "=1")
        self.assertTrue(c["codigo"]["coluna"].startswith("#codigo_derivado:NUM_DOSE:"))
        d = mapa.DIR_PACOTE / "declarado"
        with open(d / "provas.tsv", encoding="utf-8") as f:
            self.assertNotIn("TBNUMDOSE", {r["tabela"] for r in csv.DictReader(f, delimiter="\t")})
        self.assertFalse((d / "provas.d" / "TBNUMDOSE.sql").exists())
        vistos = {}
        l6_09.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        com_horario = {h[0] for h in vistos["TBHORARIODOSE"]}
        self.assertTrue([n for n in vistos["TBNUMDOSE"] if n[0] not in com_horario])  # número de doses sem horário
