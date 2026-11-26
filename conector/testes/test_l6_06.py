"""Fatia F4 L6-06 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo mapa.
Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import datetime
import decimal
import os
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_06

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

FATIA = "colunas.d/L6-06.tsv"
# de-para de valores da fatia (valores.d/L6-06.tsv): nenhum valor presumido em massa
COM_VALORES = {("PROPCAOPERIODO", "NOME", "periodo_consulta_sumario_alta.atendimento_inteiro"),
               ("PROPCAOPERIODO", "NOME", "periodo_consulta_sumario_alta.horas_retroativas"),
               ("PRPADRECEITA", "GERAL", "modelo_receita.abrangencia"),
               ("PRPROTGERAL", "SEXO", "protocolo_prescricao.sexo"),
               ("PRSAE_LIKERT", "PONTO_LIKERT", "escala_resultado_enfermagem.ponto"),
               ("PRSAE_LIKERT", "PONTO_LIKERT", "escala_resultado_enfermagem.descricao"),
               ("PRSITAPRAZAM", "NOME", "situacao_aprazamento.categoria"),
               # r6: S/N da checagem -> 'true'/'false' do parâmetro booleano do produto (formato canônico)
               ("PRPARAM_CHECAGEM", "#item", "parametro_valor.valor"),
               # recusas-fase2 C1c (K2): 1/0 -> 'true'/'false' do booleano do contrato
               ("PRPAROFTALMO", "#item@LANCAR_ADICAO", "parametro_valor.valor")}


# rodada 5 (ADR 0006): as antes descartadas, que carregam por parâmetro do produto e pelo agrupamento
R5 = {"PROFTGABARITO", "PROFTGRADUACAO", "PROFTTPARQUIV", "PRPARAM_CHECAGEM", "PRPARAM_PRESCFUTURA", "PRPAROFTALMO",
      "PRPARTAMPADPRESC", "PRPROCESSOPEP", "PRSITCHECAGEM"}



# Pedido 67 DECIDIDO (orquestrador, 26/11, T2-brief): quando a origem não informa uma situação ou papel clínico,
# nunca se presume estado que gere trabalho ou mude a conduta; vale o neutro do CHECK, senão o terminal não acionável
# (valor_presumido visível), senão a recusa visível. Aqui: a situação do aprazamento sem par vira 'suspenso'
# (nunca 'pendente': não há neutro no CHECK); o período sem par segue atendimento inteiro (o 1 é verdadeiro na janela
# de busca do sumário de alta: não é situação nem papel, não gera trabalho e não omite nada).
PRESUMIDAS_PEDIDO_67 = {("PROPCAOPERIODO", "periodo_consulta_sumario_alta.atendimento_inteiro"): "=~1",
                        ("PRSITAPRAZAM", "situacao_aprazamento.categoria"): "=~suspenso"}
# linhas da sintética que caem na presumida (nome sem par; a de nome nulo também, recusada depois pelo 1048)
PRESUMIDAS_NA_SINTETICA = {"PROPCAOPERIODO": 1, "PRSITAPRAZAM": 2}

class L6_06(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_06.CARREGADAS) | set(l6_06.DESCARTADAS)
        cls.sem_carga = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        cls.esp = l6_06.linhas(__import__("random").Random(1), lambda t, v: None)
        cls.plano = {x["tabela"]: x for x in carga_mapa.planejar(cls.m, cls.todas)}
        cls.val = {}
        for v in mapa.ler_valores(mapa.DIR_PACOTE):
            if v["tabela"] in l6_06.CARREGADAS:  # da fatia, também as linhas da fase 2 das recusas
                cls.val.setdefault((v["tabela"], v["coluna"], v["destino"]), {})[v["valor_origem"]] = v["valor_destino"]

    def test_fatia_tem_as_23_tabelas_e_a_imagem_tambem(self):
        # 24 na ficha; o protocolo aplicado à prescrição foi para L6-13 (depois da prescrição)
        self.assertEqual(len(self.todas), 23)
        self.assertEqual({c["tabela"] for c in self.decl}, set(l6_06.CARREGADAS))
        self.assertNotIn("PRPRESC_PRPROTGERAL", {c["tabela"] for c in self.decl})
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_06.DDL)), self.todas | set(l6_06.INTERMEDIARIAS))

    def test_plano_so_com_as_carregadas_e_um_destino(self):
        self.assertEqual(set(self.plano), set(l6_06.CARREGADAS))
        self.assertEqual(self.plano["PRPADRECEITA"]["destinos"], ["modelo_receita"])
        self.assertEqual(self.plano["PRPROTGERAL"]["destinos"], ["protocolo_prescricao"])
        ordem = [x["tabela"] for x in carga_mapa.planejar(self.m, self.todas)]
        self.assertLess(ordem.index("PROFTGRUPEXAME"), ordem.index("PROFTEXAME"))

    def test_cobertura_total_descartadas_com_motivo_de_produto(self):
        # nenhuma tabela da fatia fica bloqueada: carrega ou é descarte de produto, com motivo
        for t in l6_06.DESCARTADAS:
            r = self.sem_carga.get(t)
            self.assertIsNotNone(r, t)
            causa = "duplicado" if t == "PRSITCHECAGEM" else "mecanismo_do_produto"
            self.assertEqual((r["situacao"], r["causa"]), ("descarte", causa), t)
            self.assertTrue(r["motivo"].startswith("L6-06: "), t)
            self.assertNotIn("revisar", r["motivo"].lower(), t)  # decisão firme, nada adiado
        self.assertFalse(set(l6_06.CARREGADAS) & set(self.sem_carga))
        self.assertFalse(set(l6_06.DESCARTADAS) & set(self.plano))

    def test_sem_literal_presumido_e_fixos(self):
        lit = {(c["tabela"], c["destino"]): c["coluna"] for c in self.decl if c["coluna"].startswith("=")}
        # nenhuma presumida além das do pedido 67 (concorrentes do nome sem par, decididas)
        self.assertEqual({k: v for k, v in lit.items() if v.startswith("=~")}, PRESUMIDAS_PEDIDO_67)
        self.assertEqual(lit[("PRPADRECEITA", "modelo_receita.formato")], "=livre")
        self.assertEqual(lit[("PRSAE_LIKERT", "escala_resultado_enfermagem.tipo_escala")], "=likert_1_a_5")
        for t in self.esp:
            self.assertEqual(self.esp[t]["pendencias"].get("valor_presumido", 0), PRESUMIDAS_NA_SINTETICA.get(t, 0), t)

    def test_de_para_de_valores_declarado(self):
        dv = {(c["tabela"], c["coluna"], c["destino"]) for c in self.decl if c["depara"] == "valores"}
        self.assertEqual(dv, COM_VALORES)
        self.assertEqual(set(self.val), COM_VALORES)
        self.assertEqual(self.val[("PRPROTGERAL", "SEXO", "protocolo_prescricao.sexo")],
                         {"A": "todos", "F": "feminino", "M": "masculino", "": "todos"})
        self.assertEqual(self.val[("PRPADRECEITA", "GERAL", "modelo_receita.abrangencia")],
                         {"S": "geral", "N": "profissional", "T": "geral", "F": "profissional"})  # P3a: T/F também
        pt = self.val[("PRSAE_LIKERT", "PONTO_LIKERT", "escala_resultado_enfermagem.ponto")]
        self.assertEqual(pt, {str(i): str(i) for i in range(1, 6)})
        ds = self.val[("PRSAE_LIKERT", "PONTO_LIKERT", "escala_resultado_enfermagem.descricao")]
        self.assertTrue(all(not v.isdigit() for v in ds.values()))  # rótulo, não o número
        cat = self.val[("PRSITAPRAZAM", "NOME", "situacao_aprazamento.categoria")]
        self.assertTrue(set(cat.values()) == {"pendente", "aprazado", "reaprazado", "suspenso", "cancelado"})
        ai = self.val[("PROPCAOPERIODO", "NOME", "periodo_consulta_sumario_alta.atendimento_inteiro")]
        hr = self.val[("PROPCAOPERIODO", "NOME", "periodo_consulta_sumario_alta.horas_retroativas")]
        self.assertEqual(set(ai), set(hr))
        for nome in ai:  # CHECK: atendimento inteiro OU horas, nunca os dois vazios
            self.assertTrue((ai[nome] == "1") != bool(hr[nome]), nome)
        self.assertEqual((ai["Últimas 24 horas"], hr["Últimas 24 horas"]), ("0", "24"))
        self.assertEqual((ai["Atendimento inteiro"], hr["Atendimento inteiro"]), ("1", ""))

    def test_checagem_antiga_e_duplicado_da_vigente(self):
        # rodada 5: o cadastro antigo carrega como opções de parâmetro, nunca em situacao_checagem (a vigente)
        self.assertEqual(self.plano["PRSITCHECAGEM"]["destinos"], ["parametro_opcao"])
        refs = [c for c in self.m["colunas_decl"] if c["destino"].startswith("horario_administracao_evento.situacao_checagem_id")]
        self.assertTrue(refs and all(c["via"] == "ref:PRSITUACAOCHECAGEM" for c in refs))

    def test_referencias_declaradas_na_via(self):
        via = {(c["tabela"], c["coluna"], c["destino"], c["via"]) for c in self.decl if c["via"] and c["tabela"] not in R5}
        self.assertEqual(via, {("PROFTEXAME", "ID_OFTGRUPO", "tipo_exame_oftalmologico.grupo_exame_oftalmologico_id",
                                "ref:PROFTGRUPEXAME"),
                               ("PRPADRECEITA", "USUARIO", "modelo_receita.criado_por", "ref:TBUSERS"),
                               ("PRPADRECEITA", "USUARIO", "modelo_receita.profissional_id", "ref:TBPROFIS.ID_TBUSERS"),
                               # pedido 67 (pendente): a presumida só preenche quando o de-para não deu valor (senao)
                               ("PROPCAOPERIODO", "=~1", "periodo_consulta_sumario_alta.atendimento_inteiro", "senao")})
        self.assertEqual(set(l6_06.PAIS_EXTERNOS), {"TBUSERS", "TBPESSOA"})

    def test_vigencia_do_protocolo_suspensa_ate_o_pedido(self):
        # TIMESTAMP gravado em DATE diverge na soma de controle: fica fora até a regra genérica do motor
        ativas = {c["coluna"] for c in self.decl if c["tabela"] == "PRPROTGERAL" and c["destino"]}
        self.assertFalse({"VIGENCIAI", "VIGENCIAF"} & ativas)

    def test_sexo_do_protocolo_pelo_de_para(self):
        cols = {c["coluna"]: c for c in self.decl if c["tabela"] == "PRPROTGERAL"}
        self.assertEqual((cols["SEXO"]["destino"], cols["SEXO"]["regra"]), ("protocolo_prescricao.sexo", "codigo_char"))
        self.assertNotIn("=~todos", cols)
        self.assertEqual(self.esp["PRPROTGERAL"]["pendencias"]["valor_fora_do_dominio"], 2)  # ativo X e sexo Z

    def test_uso_geral_do_protocolo_e_por_especialidade(self):
        # GERAL do protocolo = vale para todas as especialidades (vínculos em PRPROTGERALESP, outra fatia)
        g = [c for c in self.m["colunas_decl"] if c["tabela"] == "PRPROTGERALESP" and c["destino"]]
        self.assertIn("protocolo_prescricao_especialidade.protocolo_prescricao_id", {c["destino"] for c in g})
        ger = [c for c in self.decl if (c["tabela"], c["coluna"]) == ("PRPROTGERAL", "GERAL")][0]
        self.assertEqual((ger["destino"], ger["regra"]), ("protocolo_prescricao.uso_geral", "booleano_sn"))

    def test_extensoes_de_arquivo_nao_viram_tipo_de_anexo(self):
        self.assertEqual(self.plano["PROFTTPARQUIV"]["destinos"], ["parametro_opcao"])

    def test_r5_listas_viram_opcoes_de_parametro_do_produto(self):
        for t, chave in l6_06.PARAMETROS_LISTA.items():
            lit = {c["destino"]: c for c in self.decl if c["tabela"] == t}
            self.assertEqual(lit["parametro_opcao.parametro_definicao_id"]["coluna"], "=" + chave, t)
            self.assertIn("cod:parametro_definicao.chave", lit["parametro_opcao.parametro_definicao_id"]["via"], t)
            self.assertEqual(lit["parametro_opcao.origem"]["coluna"], "=migracao", t)
            self.assertIn(chave, l6_06.PREPARO_DESTINO)

    def test_r5_parametros_de_linha_unica_desdobrados(self):
        for t in ("PRPARAM_CHECAGEM", "PRPARAM_PRESCFUTURA", "PRPAROFTALMO"):
            self.assertEqual(self.plano[t]["destinos"], ["parametro_valor"], t)
            item = next(c for c in self.decl if c["tabela"] == t and c["coluna"] == "#item")
            for par in item["via"].split(";")[0].split(":", 1)[1].split(","):
                self.assertIn(par.split("=")[1], l6_06.PARAMETROS_VALOR)

    def test_r5_semente_do_produto_cobre_as_chaves_com_o_tipo_certo(self):
        """Toda chave de parâmetro usada pelas fatias L6-03 a L6-06 está na semente do produto (a mesma do PREPARO),
        com o tipo do formato gravado: lista nas opções; booleano em sim/nao; inteiro nas durações em minutos."""
        import re as _re
        tipos = l6_06.tipos_semente()
        usadas = set()
        for f in ("L6-03", "L6-04", "L6-05", "L6-06"):
            # pelo pacote do mapa (no container a raiz do repositório não existe: /app)
            with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / (f + ".tsv"), encoding="utf-8") as a:
                for ln in a:
                    usadas.update(_re.findall(r"=((?:agenda|pep|oftalmologia|prescricao)\.[a-zA-Z.]+)", ln))
        self.assertTrue(usadas)
        self.assertEqual(sorted(usadas - set(tipos)), [])
        for k in ("prescricao.checagem.loteValidadeObrigatorioMedicamento",
                  "prescricao.checagem.loteValidadeObrigatorioSolucao",
                  "prescricao.checagem.loteValidadeObrigatorioHemocomponente"):
            self.assertEqual(tipos[k], "booleano", k)
        for k in ("prescricao.futura.tempoAvaliacao", "prescricao.futura.antecedenciaAvaliacao"):
            self.assertEqual(tipos[k], "inteiro", k)
        self.assertNotIn("CREATE TABLE IF NOT EXISTS parametro_definicao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                         " chave VARCHAR(100) NOT NULL, modulo_sistema_id BIGINT UNSIGNED NOT NULL, descricao"
                         " VARCHAR(500) NOT NULL, tipo VARCHAR(30) NOT NULL, criado_em", l6_06.PREPARO_DESTINO)
        self.assertIn(l6_06.semente_parametros(), l6_06.PREPARO_DESTINO)
        self.assertEqual(sentinela.aplicar("minutos_em_timestamp", datetime.time(0, 30))[0], 30)

    def test_r5_gabarito_agrupado_pela_forma(self):
        self.assertEqual(self.plano["PROFTGABARITO"]["destinos"][0], "gabarito_acuidade_visual")
        cod = next(c for c in self.decl if c["tabela"] == "PROFTGABARITO" and c["destino"] == "tipo_acuidade_visual.codigo")
        self.assertIn("agrupar:FORMA", cod["via"])

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
        # 6: a receita de vigência sentinela entra pela vigência da carga (recusas-fase2 P3a, @vigencia_carga)
        self.assertEqual(self.esp["PRPADRECEITA"]["gravados"], 6)
        self.assertEqual(self.esp["PRPADRECEITA"]["pendencias"]["pai_ambiguo"], 1)


if __name__ == "__main__":
    unittest.main()
