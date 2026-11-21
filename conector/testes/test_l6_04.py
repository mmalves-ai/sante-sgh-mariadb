"""Fatia L6-04 (agenda: situações da marcação de exame, agenda de exames, vínculos da agenda, grade gerada e cópias
das marcações de consulta canceladas e excluídas): declarações, plano da carga dirigida pelo mapa, descartes e regras
das colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L6-04`)."""
import csv
import datetime
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_04

FATIA = list(l6_04.FATIA)
CARREGADAS = {"TBSITAGE": "situacao_marcacao", "SIAGENDA": "agenda_servico", "SIAGECRI": "geracao_grade",
              "REAGENDA_TBCONVEN": "agenda_fonte_pagadora", "SIAGENDA_TBCONVEN": "agenda_fonte_pagadora",
              "REAGENDA_TBESPEC": "agenda_especialidade", "RECANAGE": "registro_excluido",
              "REPACAGD_EXCLUSAO": "registro_excluido", "SIPACAGI": "horario_agenda",
              "SIPACAGD": "marcacao_horario", "REPACAGD": "marcacao_horario"}
# rodada 4: as declarações prontas carregam (fim do horário por #data_hora_mais)
PRONTAS = {}
SIGNIFICADOS = {"aguardando", "confirmada", "chegou", "em_atendimento", "realizada", "cancelada", "falta", "bloqueada"}
DESCARTES = {"TBESTADOCONFIRMACAO": "mecanismo_do_produto", "AGPARAM": "mecanismo_do_produto",
             "AGCADAGENDA": "sem_valor", "AGCADEIRA": "sem_valor", "AGDIASINDISP": "sem_valor"}
BLOQUEADAS = set(PRONTAS)
# a agenda de exames é identificada por NOME e CRM, a junção do próprio sistema antigo (o EXAME é atributo)
AGENDA_EXAME = [{"tabela": "SIAGENDA", "modo": "alt_composta", "arg": ["NOME", "CRM"], "cols": ["NOME", "CRM"]}]


def _tsv(nome):
    with open(mapa.DIR_PACOTE / "declarado" / nome, encoding="utf-8") as f:
        return list(csv.DictReader((x for x in f if not x.startswith("#")), delimiter="\t"))


def _prontas():
    """Declarações comentadas (prontas) da fatia, por tabela e coluna de destino."""
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-04.tsv", encoding="utf-8") as f:
        linhas = f.read().splitlines()
    cab = linhas[0].split("\t")
    saida = {}
    for x in linhas[1:]:
        if x.startswith("#"):
            r = dict(zip(cab, x[1:].split("\t")))
            if r["destino"]:
                saida.setdefault(r["tabela"], {})[r["destino"].split(".")[1]] = r
    return saida


class L604(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def todas(self, t, dc):
        return [c for c in self.plano[t]["colunas"][CARREGADAS[t]] if c["destino"] == dc]

    def test_cobertura_da_fatia(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"][0], dt)
        sc = {r["tabela"]: r for r in _tsv("sem_carga.tsv")}
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].strip(), t)
        self.assertEqual(set(FATIA), set(CARREGADAS) | set(DESCARTES) | BLOQUEADAS)

    def test_literais_e_padroes(self):
        # o convênio da agenda era oferecido na marcação online (o portão é o modo online da agenda): padrão TRUE
        self.assertNotIn("aceita_marcacao_online", self.cols("REAGENDA_TBCONVEN"))
        self.assertNotIn("aceita_marcacao_online", self.cols("SIAGENDA_TBCONVEN"))
        self.assertEqual(self.cols("REAGENDA_TBESPEC")["principal"]["coluna"], "=~0")

    def test_agenda_de_exames(self):
        c = self.cols("SIAGENDA")
        # categoria pelo cadastro do cliente com a natureza fixa do produto, nunca id fixo
        self.assertEqual((c["categoria_agenda_id"]["coluna"], c["categoria_agenda_id"]["cod"]),
                         ("=exame", ("categoria_agenda", "natureza")))
        self.assertEqual(c["duracao_horario_minutos"]["regra"], "minutos_hhmm")
        self.assertEqual(sentinela.aplicar("minutos_hhmm", b"0030"), (30, None))
        self.assertEqual(sentinela.aplicar("minutos_hhmm", "0000"), (None, None))
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in c["profissional_id"]["passos"]],
                         ["TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"])
        self.assertEqual(c["profissional_id"]["passos"][0]["modo"], "alt")
        self.assertEqual(c["ativo"]["regra"], "booleano_sn")
        self.assertEqual(c["dias_retorno"]["regra"], "inteiro_zero_nulo")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        # a agenda de exames é identificada por nome e número do conselho (chave alternativa composta)
        self.assertEqual(self.cols("SIAGECRI")["agenda_servico_id"]["passos"], AGENDA_EXAME)

    def test_grade_gerada(self):
        c = self.cols("SIAGECRI")
        st = self.todas("SIAGECRI", "situacao")
        self.assertEqual([(x["coluna"], x["depara"]) for x in st], [("STATUS", "valores"), ("=concluida", "")])
        self.assertEqual((st[0]["valores"]["C"], st[0]["valores"]["E"]), ("concluida", "revertida"))
        self.assertEqual(c["solicitada_em"]["coluna"], "#data_hora:DT_CRIACAO,HR_CRIACAO")
        self.assertEqual(carga_mapa.data_hora_composta(datetime.date(2026, 2, 20), b"1015"),
                         (datetime.datetime(2026, 2, 20, 10, 15), None))
        self.assertEqual(carga_mapa.data_hora_composta(datetime.date(2026, 2, 20), "2575")[1], "hora_invalida")
        self.assertTrue(c["mensagem_processo"]["coluna"].startswith("#retrato:SEM1,"))
        self.assertEqual(c["responsavel_usuario_id"]["referencia"], "TBUSERS")

    def test_cancelamento_de_consulta_vira_registro_cancelado(self):
        c = self.cols("RECANAGE")
        # o PROTOCOLO é a sequência própria do cancelamento, não o id da marcação: entidade própria, para não
        # misturar dois espaços de números sob (entidade, entidade_id) com as cópias de marcação excluída
        self.assertEqual((c["entidade"]["coluna"], c["operacao"]["coluna"]),
                         ("=cancelamento_marcacao", "=cancelamento"))
        self.assertNotEqual(c["entidade"]["coluna"], self.cols("REPACAGD_EXCLUSAO")["entidade"]["coluna"])
        self.assertEqual((c["entidade_id"]["coluna"], c["dados"]["coluna"]), ("PROTOCOLO", "#retrato:*"))
        self.assertEqual(c["ocorrido_em"]["coluna"], "#data_hora:DT_CAN,HR_CAN")
        j = self.todas("RECANAGE", "justificativa")
        self.assertEqual(j[0]["coluna"], "MOTIVO")
        self.assertTrue(j[1]["coluna"].startswith("="))
        self.assertNotIn("marcacao_horario_id", c)   # a marcação foi apagada na origem: nada a ligar

    def test_horario_e_marcacao_carregam(self):
        self.assertEqual(_prontas(), {})
        self.assertEqual(set(self.plano["SIPACAGI"]["destinos"]),
                         {"horario_agenda", "bloqueio_agenda", "motivo_bloqueio_agenda"})
        for t in ("SIPACAGD", "REPACAGD"):
            self.assertEqual(set(self.plano[t]["destinos"]),
                             {"marcacao_horario", "pre_cadastro", "marcacao_horario_item", "trilha_auditoria"})
        fim = self.todas("SIPACAGI", "fim_em")[0]
        self.assertEqual((fim["coluna"], fim["regra"]), ("#data_hora_mais:DATA,HORA,DATA", "data_fim_aberta:1801"))
        dc = [c for c in self.m["colunas_decl"] if (c["tabela"], c["destino"]) == ("SIPACAGI", "horario_agenda.fim_em")]
        self.assertEqual(dc[0]["via"], "ref:SIAGENDA.(NOME,CRM)=(NOME,CRM)@duracao_horario_minutos")
        # a coluna de minutos anulada sem pendência: a duração vem da agenda
        self.assertEqual(sentinela.aplicar("data_fim_aberta:1801", datetime.date(2026, 3, 2)), (None, None))
        via = {(c["tabela"], c["destino"]): c["via"] for c in self.m["colunas_decl"] if c["destino"]}
        self.assertEqual(via[("SIPACAGI", "horario_agenda.agenda_servico_id")], "ref:SIAGENDA.(NOME,CRM)=(NOME,CRM)")
        # a marcação não traz EXAME e acha o horário como o sistema antigo: NOME, CRM, DATA e HORA
        self.assertEqual(via[("SIPACAGD", "marcacao_horario.horario_agenda_id")],
                         "ref:SIPACAGI.(NOME,CRM,DATA,HORA)=(NOME,CRM,DATA,HORA)")
        self.assertEqual([c["coluna"] for c in self.todas("REPACAGD", "duracao_minutos")], ["HORA", "NOME"])
        self.assertEqual([c["coluna"] for c in self.todas("REPACAGD", "tipo_marcacao_id")], ["RETORNO", "=primeira_vez"])
        self.assertEqual([c["coluna"] for c in self.todas("REPACAGD", "responsavel_usuario_id")],
                         ["USUARIO", "ID_TBUSERS_INCLUSAO"])
        for t in ("SIPACAGD", "REPACAGD"):
            self.assertIn("destino_se:ID_RICADPAC=", via[(t, "pre_cadastro.estabelecimento_id")])

    def test_marcacao_carrega_procedimento_solicitante_municipio_e_retrato(self):
        """r4b: nada da marcação fica sem carga por falta de coluna: procedimento no item, solicitante externo pelo
        nome, município pelo IBGE e todas as colunas no retrato da trilha (sem segredo)."""
        via = {(c["tabela"], c["destino"], c["coluna"]): c for c in self.m["colunas_decl"] if c["destino"]}
        for t in ("SIPACAGD", "REPACAGD"):
            p = via[(t, "marcacao_horario_item.item_faturavel_id", "PROCED")]
            self.assertEqual(p["regra"], "inteiro_zero_nulo")
            self.assertIn("ref:TBPROCTO.COD_PROCEDIMENTO", p["via"])
            self.assertIn("opcional", p["via"])
            s = via[(t, "marcacao_horario.solicitante_externo_id", "MED_SOL")]
            self.assertIn("ref:TBMEDSOL.NOME", s["via"])
            self.assertIn("se:CRM_SOL=,0", s["via"])
            self.assertEqual(via[(t, "pre_cadastro.municipio_ibge_id", "IBGE")]["depara"], "ibge_municipio")
            self.assertEqual(via[(t, "pre_cadastro.cep", "CEP")]["regra"], "inteiro_zeros_esquerda:8")
            self.assertIn((t, "trilha_auditoria.dados_depois", "#retrato:*"), via)
            self.assertIn((t, "trilha_auditoria.entidade_id", "@id"), via)
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:8", 1310100)[0], "01310100")
        # a coluna de minutos do horário de exame é a DATA anulada: ano < 1801 ou sentinela nunca vira minutos
        self.assertEqual(sentinela.aplicar("data_fim_aberta:1801", datetime.date(1700, 1, 1)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("data_fim_aberta:1801", datetime.date(1899, 12, 30)),
                         (None, "data_sentinela"))

    def test_horario_fechado_sem_motivo_carrega_indisponivel(self):
        vs = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
              if (v["tabela"], v["coluna"], v["destino"]) == ("SIPACAGI", "LIVRE", "horario_agenda.situacao")}
        self.assertEqual((vs["S"], vs["N"]), ("livre", "cancelado"))

    def test_significado_pelo_de_para_de_valores(self):
        c = self.cols("TBSITAGE")["significado"]
        self.assertEqual((c["coluna"], c["depara"]), ("COD", "valores"))
        v = c["valores"]
        self.assertEqual(len(v), 15)   # as 16 situações menos a de código vazio (recusada pela chave)
        self.assertTrue(set(v.values()) <= SIGNIFICADOS)
        self.assertEqual((v["C"], v["X"], v["F"], v["S"], v["A"], v["HR"]),
                         ("confirmada", "cancelada", "falta", "realizada", "chegou", "bloqueada"))

    def test_estado_de_confirmacao_de_alergia_nao_vai_para_a_agenda(self):
        self.assertNotIn("TBESTADOCONFIRMACAO", self.plano)
        for p in self.plano.values():
            self.assertNotIn("situacao_confirmacao", p["destinos"])

    def test_referencias_pelos_pais_da_origem(self):
        for t, ag in (("REAGENDA_TBCONVEN", "REAGENDA"), ("SIAGENDA_TBCONVEN", "SIAGENDA")):
            c = self.cols(t)
            self.assertEqual(c["agenda_servico_id"]["referencia"], ag)
            self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
            self.assertEqual(c["observacao_marcacao_online"]["regra"], "texto_longo")
        c = self.cols("REAGENDA_TBESPEC")
        self.assertEqual(c["agenda_servico_id"]["referencia"], "REAGENDA")
        self.assertEqual(c["especialidade_medica_id"]["referencia"], "TBESPEC")
        e = self.cols("REPACAGD_EXCLUSAO")
        self.assertEqual((e["entidade"]["coluna"], e["operacao"]["coluna"]), ("=marcacao_horario", "=exclusao"))
        self.assertEqual((e["entidade_id"]["coluna"], e["entidade_id"]["regra"]), ("ID_REPACAGD", "inteiro"))
        self.assertEqual(e["usuario_id"]["referencia"], "TBUSERS")
        # decisão única das *_EXCLUSAO: retrato completo e justificativa/autor presumidos (valor_presumido)
        self.assertEqual(e["dados"]["coluna"], "#retrato:*")
        self.assertTrue(e["justificativa"]["coluna"].startswith("=~"))
        self.assertIn("usuário presumido", e["justificativa"]["coluna"])
        self.assertEqual(e["paciente_id"]["referencia"], "RICADPAC")

    def test_codigo_da_situacao_tem_prefixo_do_dominio_de_exame(self):
        c = self.cols("TBSITAGE")["codigo"]
        self.assertEqual((c["coluna"], c["regra"]), ("#codigo_derivado:COD:30:exame_", "codigo_char"))
        self.assertEqual(carga_mapa.codigo_derivado("C", 30, "exame_"), ("exame_C", False))
        self.assertEqual(carga_mapa.codigo_derivado("HR", 30, "exame_"), ("exame_HR", False))
        self.assertEqual(sentinela.aplicar("codigo_char", "a "), ("a", None))

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Confirmada   exemplo  ")[0], "Confirmada exemplo")
        txt = sentinela.aplicar("texto_longo", "Aviso\r\n  linha  ".encode("cp1252"))[0]
        self.assertEqual(txt, "Aviso\r\n  linha  ")

    def test_declaracoes_com_motivo(self):
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-04.tsv", encoding="utf-8") as f:
            linhas = f.read().splitlines()
        decl = list(csv.DictReader((x for x in linhas if not x.startswith("#")), delimiter="\t"))
        self.assertEqual({r["tabela"] for r in decl if r["destino"]}, set(CARREGADAS))
        for r in decl:
            self.assertTrue(r["motivo"])
        self.assertEqual({x[1:].split("\t")[0] for x in linhas if x.startswith("#")}, BLOQUEADAS)

    def test_imagem_sintetica_cobre_as_carregadas(self):
        linhas = []
        esp = l6_04.linhas(__import__("random").Random(1), lambda t, v: linhas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(e["gravados"] + recusas + l6_04.RECUSAS_SEM_RESTRICAO.get(t, 0), linhas.count(t), t)

    def test_mapa_da_conferencia_so_com_esta_fatia(self):
        m = l6_04.MAPA_TESTE
        self.assertTrue(m["colunas_decl"])
        self.assertTrue(all(c["tabela"] in l6_04.FATIA for c in m["colunas_decl"]))


if __name__ == "__main__":
    unittest.main()
