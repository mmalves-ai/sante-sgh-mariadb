"""Fatia L6-03 (agenda: cadastros, grade, horários e cancelamentos): declarações, plano e imagem sintética. Sem banco;
só valores inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L6-03`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_03

FATIA = ("AGCADMOTIVO", "AGCOMPLEXIDADE", "AGDURACAO", "AGGRPFASEEVOL", "AGTPAGENDA", "CDTPRETCONS", "PSTPRETORNO",
         "REAGECRI", "RECTRAGE", "RESITAGE", "RETIPAGE", "RETP_INTEG_AGENDA_ONLINE", "REAGENDA", "REPACAGI",
         "SICANAGE", "SICTRAGE")
FORA = set(FATIA) - set(l6_03.CARREGADAS)


class FatiaL603(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def test_so_as_carregaveis_tem_destino_e_toda_coluna_tem_motivo(self):
        com_destino = {c["tabela"] for c in self.decl if c["destino"]}
        self.assertEqual(com_destino, set(l6_03.CARREGADAS))
        self.assertEqual({c["tabela"] for c in self.decl}, set(FATIA) - set(l6_03.PRONTAS))
        for c in self.decl:
            self.assertTrue(c["motivo"], (c["tabela"], c["coluna"]))
        self.assertEqual(FORA, set(l6_03.DESCARTADAS) | set(l6_03.PRONTAS))

    def test_plano_em_ordem_do_mapa(self):
        p = carga_mapa.planejar(self.m, set(FATIA))
        self.assertEqual([x["tabela"] for x in p], list(l6_03.CARREGADAS))
        for t in FORA:
            self.assertNotIn(t, self.plano)

    def test_destinos_e_regras(self):
        def dest(t, dt):
            return {c["destino"]: (c["coluna"], c["regra"]) for c in self.plano[t]["colunas"][dt]}
        self.assertEqual(dest("AGTPAGENDA", "categoria_agenda")["codigo"], ("ID", "codigo_char"))
        self.assertEqual(dest("RESITAGE", "situacao_marcacao")["codigo"], ("COD", "codigo_char"))
        self.assertEqual(dest("AGTPAGENDA", "categoria_agenda")["natureza"][0], "=~consulta")
        sig = [(c["coluna"], c["depara"]) for c in self.plano["RESITAGE"]["colunas"]["situacao_marcacao"]
               if c["destino"] == "significado"]
        self.assertEqual(sig, [("COD", "valores"), ("=aguardando", "")])  # de-para e concorrente para o sem par
        self.assertEqual(dest("RETIPAGE", "canal_marcacao")["ativo"], ("SITUACAO", "booleano_ai"))
        modo = dest("RETP_INTEG_AGENDA_ONLINE", "modo_agendamento_online")
        self.assertEqual((modo["permite_central"][0], modo["permite_portal"][0]), ("=~0", "=~0"))
        self.assertEqual(dest("AGCOMPLEXIDADE", "complexidade_sessao")["codigo"], ("ID_COMPLEXIDADE", "texto"))
        for t, c in [("RESITAGE", "ICONE"), ("RETIPAGE", "COR"), ("AGCADMOTIVO", "ID_RETPAGEN")]:
            self.assertNotIn(c, self.plano[t]["lidas"])

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Alta   complexa ")[0], "Alta complexa")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("codigo_char", "c")[0], "c")
        self.assertEqual(sentinela.aplicar("texto", 3), ("3", None))

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l6_03.COLUNAS), set(FATIA))
        linhas = {}
        esp = l6_03.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l6_03.CARREGADAS))
        self.assertEqual(set(l6_03.NAO_CARREGADAS), FORA)  # descarte e declaração pronta: só a forma
        for t, n in l6_03.NAO_CARREGADAS.items():
            self.assertEqual(len(linhas[t]), n, t)
        for t, cols in l6_03.COLUNAS.items():
            for v in linhas[t]:
                self.assertEqual(len(v), len(cols))
        for t, e in esp.items():  # lidas = gravadas + recusadas
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k in ("pai_pendente", "codigo_colisao_caixa"))
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]), t)


    def test_dominios_de_retorno_carregam_como_opcoes_de_parametro(self):
        # rodada 5 (ADR 0006): nenhuma tabela da fatia fica em sem_carga; a lista do hospital vira opções do parâmetro
        sc = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertFalse(sc & set(FATIA))
        for t, chave in l6_03.PARAMETROS_LISTA.items():
            self.assertEqual(self.plano[t]["destinos"], ["parametro_opcao"], t)
            lit = {c["destino"]: c for c in self.decl if c["tabela"] == t}
            self.assertEqual(lit["parametro_opcao.parametro_definicao_id"]["coluna"], "=" + chave)
            self.assertEqual(lit["parametro_opcao.origem"]["coluna"], "=migracao")
            self.assertIn(chave, l6_03.PREPARO_DESTINO)

    def test_exclusao_de_marcacao_e_da_l6_04(self):
        # REPACAGD_EXCLUSAO é da L6-04 (ordem 1016): nenhuma linha dela na declaração nem na imagem da L6-03
        self.assertFalse([c for c in self.m["colunas_decl"] if c["tabela"] == "REPACAGD_EXCLUSAO"
                          and c.get("_arquivo", "").endswith("L6-03.tsv")])
        self.assertNotIn("REPACAGD_EXCLUSAO", l6_03.COLUNAS)

    def test_restricao_por_tipo_de_agenda_tem_o_significado_certo(self):
        # ID_RETPAGEN e TPAGEN apontam o tipo de agenda da recepção (duplicado de categoria_agenda), não o tipo de
        # marcação: não podem ir para tipo_marcacao_id e o motivo diz o conceito certo
        for t, c in [("AGCADMOTIVO", "ID_RETPAGEN"), ("RETIPAGE", "TPAGEN")]:
            d = next(x for x in self.decl if (x["tabela"], x["coluna"]) == (t, c))
            self.assertFalse(d["destino"], (t, c))
            self.assertIn("tipo de agenda da recepção", d["motivo"].lower())
            self.assertIn("categoria", d["motivo"])

    def test_colisao_de_caixa_na_situacao(self):
        linhas = {}
        l6_03.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        cods = [sentinela.aplicar("codigo_char", v[0])[0] for v in linhas["RESITAGE"]]
        self.assertIn("AG", cods)
        self.assertIn("ag", cods)


    def _d(self, t, c, dest):
        return next(x for x in self.decl if (x["tabela"], x["coluna"], x["destino"]) == (t, c, dest))

    def test_agenda_categoria_dono_e_duracao(self):
        self.assertEqual(self._d("REAGENDA", "@id:categoria_agenda", "agenda_servico.categoria_agenda_id")["via"], "")
        cod = self._d("REAGENDA", "EXAME", "categoria_agenda.codigo")
        self.assertEqual((cod["depara"], cod["via"]), ("valores", "categoria_agenda;antes;adotar:codigo"))
        for dc in ("descricao", "natureza"):
            self.assertEqual(self._d("REAGENDA", "EXAME", "categoria_agenda." + dc)["via"], "categoria_agenda")
        self.assertEqual(self._d("REAGENDA", "CRM", "agenda_servico.profissional_id")["via"],
                         "ref:TBCBOPRO.COD>ID_TBPROFIS>TBPROFIS")
        self.assertEqual(self._d("REAGENDA", "DURACAO", "agenda_servico.duracao_horario_minutos")["regra"],
                         "minutos_hhmm")
        self.assertEqual(self.plano["REAGENDA"]["destinos"][0], "agenda_servico")
        self.assertIn("categoria_agenda", self.plano["REAGENDA"]["destinos"])
        vs = {(v["destino"], v["valor_origem"]): v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"]) in (("REAGENDA", "EXAME"), ("REAGECRI", "STATUS"))}
        self.assertEqual(vs[("categoria_agenda.natureza", "F")], "consulta")
        self.assertEqual(vs[("categoria_agenda.natureza", "T")], "exame")
        self.assertEqual(vs[("geracao_grade.situacao", "C")], "concluida")
        self.assertEqual(vs[("geracao_grade.situacao", "E")], "revertida")

    def test_filhas_da_agenda_pela_chave_alternativa_e_data_hora(self):
        self.assertEqual(self._d("REAGECRI", "NOME", "geracao_grade.agenda_servico_id")["via"],
                         "ref:REAGENDA.(NOME,CRM)=(NOME,CRM)")
        self.assertEqual(self._d("RECTRAGE", "AGENDA", "agenda_escala.agenda_servico_id")["via"],
                         "ref:REAGENDA.(NOME,CRM)=(AGENDA,CRM)")
        self.assertEqual(self._d("SICTRAGE", "AGENDA", "agenda_escala.agenda_servico_id")["via"],
                         "ref:SIAGENDA.(NOME,CRM)=(AGENDA,CRM)")
        self._d("REAGECRI", "#data_hora:DT_CRIACAO,HR_CRIACAO", "geracao_grade.solicitada_em")
        self._d("REAGECRI", "#retrato:*", "geracao_grade.mensagem_processo")
        for t in ("RECTRAGE", "SICTRAGE"):
            self.assertEqual(self._d(t, "SEMANA", "agenda_escala.dia_semana")["regra"], "inteiro_faixa:1,7")
            self._d(t, "@vigencia_carga", "agenda_escala.vigencia_inicio")
            for c in ("INTER_INC", "INTER_FIN"):  # '0000' = sem intervalo pelo de-para; pausa real fica visível
                d = next(x for x in self.decl if (x["tabela"], x["coluna"]) == (t, c))
                self.assertEqual((d["regra"], d["depara"]), ("hora_hhmm", "valores"))
                vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
                      if (v["tabela"], v["coluna"]) == (t, c)}
                self.assertEqual(vs, {"00:00:00": ""})
                self.assertEqual(str(sentinela.aplicar("hora_hhmm", "0000")[0]), "00:00:00")

    def test_cancelamento_de_exame_na_trilha_interina(self):
        self.assertEqual(self.plano["SICANAGE"]["destinos"], ["trilha_auditoria"])
        self._d("SICANAGE", "#data_hora:DT_CAN,HR_CAN", "trilha_auditoria.ocorrido_em")
        self._d("SICANAGE", "#retrato:*", "trilha_auditoria.dados_antes")
        self.assertEqual(self._d("SICANAGE", "=operacao", "trilha_auditoria.acao")["via"], "trilha_auditoria")

    def test_horario_da_agenda_carrega_com_fim_pela_duracao(self):
        # rodada 4: fim = início + duração do horário; sem duração na linha, a da agenda
        fim = self._d("REPACAGI", "#data_hora_mais:DATA,HORA,DURACAO", "horario_agenda.fim_em")
        self.assertEqual((fim["regra"], fim["via"]),
                         ("minutos_hhmm", "ref:REAGENDA.(NOME,CRM)=(NOME,CRM)@duracao_horario_minutos"))
        self._d("REPACAGI", "#data_hora:DATA,HORA", "horario_agenda.inicio_em")
        self.assertEqual(self.plano["REPACAGI"]["destinos"][0], "horario_agenda")
        self.assertEqual(set(self.plano["REPACAGI"]["destinos"]),
                         {"horario_agenda", "bloqueio_agenda", "motivo_bloqueio_agenda"})

    def test_horario_bloqueado_cria_o_bloqueio_da_agenda(self):
        self._d("REPACAGI", "@id:bloqueio_agenda", "horario_agenda.bloqueio_agenda_id")
        self._d("REPACAGI", "@id:motivo_bloqueio_agenda", "bloqueio_agenda.motivo_bloqueio_agenda_id")
        c = self._d("REPACAGI", "SITUACAO", "motivo_bloqueio_agenda.codigo")
        self.assertIn("destino_se:SITUACAO=HR,Q,P", c["via"])
        self.assertIn("adotar:codigo", c["via"])
        e = self._d("REPACAGI", "@estabelecimento", "bloqueio_agenda.estabelecimento_id")
        self.assertIn("destino_se:SITUACAO=HR,Q,P", e["via"])
        vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"], v["destino"]) == ("REPACAGI", "SITUACAO", "motivo_bloqueio_agenda.codigo")}
        self.assertEqual(vs, {"HR": "horario_reservado", "Q": "feriado", "P": "manutencao"})

    def test_agenda_tem_dono_pelo_setor_da_unidade(self):
        self._d("REAGENDA", "@id:setor_funcional", "agenda_servico.setor_funcional_id")
        cod = self._d("REAGENDA", "#codigo_derivado:UNID:30:agenda_unidade_", "setor_funcional.codigo")
        self.assertEqual((cod["regra"], cod["via"]), ("inteiro_zero_nulo", "setor_funcional;antes;adotar:codigo"))
        self._d("REAGENDA", "=agenda_sem_unidade", "setor_funcional.codigo")
        self._d("REAGENDA", "=~assistencial", "setor_funcional.tipo")
        self.assertIn("setor_funcional", self.plano["REAGENDA"]["destinos"])
        self.assertEqual(carga_mapa.codigo_derivado("7", 30, "agenda_unidade_"), ("agenda_unidade_7", False))

    def test_situacao_da_marcacao_pela_legenda(self):
        vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"], v["destino"]) == ("RESITAGE", "COD", "situacao_marcacao.significado")}
        self.assertEqual((vs["C"], vs["F"], vs["X"], vs["S"], vs["HR"]),
                         ("confirmada", "falta", "cancelada", "realizada", "bloqueada"))

    def test_horario_fechado_sem_motivo_carrega_indisponivel(self):
        """r4b: LIVRE N sem paciente e sem situação de bloqueio carrega como 'cancelado' (indisponível), nunca
        recusado nem aberto como livre."""
        vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"], v["destino"]) == ("REPACAGI", "LIVRE", "horario_agenda.situacao")}
        self.assertEqual((vs["S"], vs["N"]), ("livre", "cancelado"))

    def test_reversao_da_geracao_nao_e_geracao(self):
        d = self._d("REAGECRI", "STATUS", "geracao_grade.situacao")
        self.assertIn("complementa a C", d["motivo"])
        self.assertIn("4025", d["motivo"])

    def test_horario_tem_situacao_ocupacao_e_encaixe(self):
        dc = [c for c in self.m["colunas_decl"] if c["tabela"] == "REPACAGI"]
        dest = {c["destino"] for c in dc}
        for x in ("situacao", "vagas_ocupadas", "tipo_horario", "encaixe_ordem", "criado_por", "teleatendimento"):
            self.assertIn("horario_agenda." + x, dest)
        cols = {c["coluna"] for c in dc}
        for c in ("LIVRE", "SITUACAO", "TIPOHR", "UNID", "PROCED", "USUARIO", "DATA_CTR", "HORA_CTR", "APAC",
                  "HR_PLANEJA", "RETORNO", "CONV", "TIPO", "DATA_SIT", "HORA_SIT", "AOL_HORARIO",
                  "COD_AGENDA_GERCON", "ID_DIGITAL_VIDEOTELEPHONY", "PACIENTE", "DURACAO", "HORA", "CRM"):
            self.assertIn(c, cols)
        self.assertTrue(all(c["motivo"] for c in dc))
        vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"], v["destino"]) == ("REPACAGI", "TIPOHR", "horario_agenda.encaixe_ordem")}
        self.assertEqual(vs, {"N": "0", "E": "1"})

    def test_regras_de_hora_e_duracao(self):
        self.assertEqual(sentinela.aplicar("minutos_hhmm", "0130")[0], 90)
        self.assertIsNone(sentinela.aplicar("minutos_hhmm", "0000")[0])
        self.assertEqual(str(sentinela.aplicar("hora_hhmm", "0800")[0])[:5], "08:00")
        self.assertEqual(sentinela.aplicar("hora_hhmm", "2575")[1], "hora_invalida")


if __name__ == "__main__":
    unittest.main()
