"""Fatia L6-04 (agenda: situações, vínculos da agenda, escala e trilha das marcações canceladas e excluídas):
declarações, plano da carga dirigida pelo mapa, descartes e regras das colunas. Sem banco; só valores inventados (a
conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L6-04`)."""
import csv
import datetime
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_04

FATIA = ["SICANAGE", "SICTRAGE", "SIPACAGI", "TBESTADOCONFIRMACAO", "TBSITAGE", "AGPARAM", "SIAGENDA",
         "REAGENDA_TBCONVEN", "SIAGENDA_TBCONVEN", "AGCADAGENDA", "AGCADEIRA", "AGDIASINDISP", "REAGENDA_TBESPEC",
         "REPACAGD", "REPACAGD_EXCLUSAO", "SIPACAGD"]
CARREGADAS = {"TBSITAGE": "situacao_marcacao",
              "REAGENDA_TBCONVEN": "agenda_fonte_pagadora", "REAGENDA_TBESPEC": "agenda_especialidade",
              "REPACAGD_EXCLUSAO": "registro_excluido"}
# declaração pronta e comentada até SIAGENDA carregar e até as regras pedidas (L6-04.json)
PRONTAS = {"SIAGENDA_TBCONVEN": "agenda_fonte_pagadora", "SICTRAGE": "agenda_escala",
           "SICANAGE": "trilha_auditoria"}
SIGNIFICADOS = {"aguardando", "confirmada", "chegou", "em_atendimento", "realizada", "cancelada", "falta", "bloqueada"}
DESCARTES = {"TBESTADOCONFIRMACAO": "mecanismo_do_produto", "AGPARAM": "mecanismo_do_produto",
             "AGCADAGENDA": "sem_valor", "AGCADEIRA": "sem_valor", "AGDIASINDISP": "sem_valor"}
BLOQUEADAS = {"SIAGENDA", "SIPACAGI", "SIPACAGD", "REPACAGD"} | set(PRONTAS)


def _tsv(nome):
    with open(mapa.DIR_PACOTE / "declarado" / nome, encoding="utf-8") as f:
        return list(csv.DictReader((x for x in f if not x.startswith("#")), delimiter="\t"))


def _prontas():
    """Declarações comentadas (prontas) da fatia, por tabela e destino, como `mapa.carregar_execucao` as leria."""
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-04.tsv", encoding="utf-8") as f:
        linhas = f.read().splitlines()
    cab = linhas[0].split("\t")
    saida = {}
    for x in linhas[1:]:
        if x.startswith("#"):
            r = dict(zip(cab, x[1:].split("\t")))
            if r["tabela"] in PRONTAS and r["destino"]:
                saida.setdefault(r["tabela"], {})[r["destino"].split(".")[1]] = r
    return saida


class L604(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_cobertura_da_fatia(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt])
        sc = {r["tabela"]: r for r in _tsv("sem_carga.tsv")}
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].strip(), t)
        self.assertEqual(set(FATIA), set(CARREGADAS) | set(DESCARTES) | BLOQUEADAS)

    def test_literais_e_padroes(self):
        # o convênio da agenda era oferecido na marcação online (o portão é o modo online da agenda): padrão TRUE
        self.assertNotIn("aceita_marcacao_online", self.cols("REAGENDA_TBCONVEN"))
        self.assertNotIn("aceita_marcacao_online", _prontas()["SIAGENDA_TBCONVEN"])
        self.assertEqual(self.cols("REAGENDA_TBESPEC")["principal"]["coluna"], "=~0")

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
        c = self.cols("REAGENDA_TBCONVEN")
        self.assertEqual(c["agenda_servico_id"]["referencia"], "REAGENDA")
        self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        self.assertEqual(c["observacao_marcacao_online"]["regra"], "texto_longo")
        si = _prontas()["SIAGENDA_TBCONVEN"]
        self.assertEqual((si["agenda_servico_id"]["coluna"], si["fonte_pagadora_id"]["coluna"]),
                         ("ID_SIAGENDA", "ID_TBCONVEN"))
        self.assertEqual(si["observacao_marcacao_online"]["regra"], "texto_longo")
        c = self.cols("REAGENDA_TBESPEC")
        self.assertEqual(c["agenda_servico_id"]["referencia"], "REAGENDA")
        self.assertEqual(c["especialidade_medica_id"]["referencia"], "TBESPEC")

    def test_escala_da_agenda_de_exames(self):
        c = _prontas()["SICTRAGE"]
        # a agenda de exames não tem profissional (CRM 0): o nome é a chave alternativa
        self.assertEqual(mapa.passos_ref(mapa.referencia_declarada(c["agenda_servico_id"])),
                         [{"tabela": "SIAGENDA", "modo": "alt", "arg": "NOME"}])
        self.assertEqual(c["dia_semana"]["regra"], "inteiro_faixa:1,7")
        self.assertEqual((c["hora_inicio"]["regra"], c["hora_fim"]["regra"]), ("hora_hhmm", "hora_hhmm"))
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        # '0000' é "sem pausa" e viraria 00:00: o intervalo fica fora até a regra pedida
        self.assertNotIn("intervalo_inicio", c)
        self.assertEqual(sentinela.aplicar("hora_hhmm", "0800"), (datetime.time(8, 0), None))
        self.assertEqual(sentinela.aplicar("hora_hhmm", "2575")[1], "hora_invalida")
        self.assertEqual(sentinela.aplicar("inteiro_faixa:1,7", "9")[1], "valor_fora_do_dominio")

    def test_cancelamento_na_trilha_e_exclusao_em_registro_excluido(self):
        pr = _prontas()
        c = pr["SICANAGE"]
        self.assertTrue(all("trilha_auditoria" in x["via"].split(";") for x in c.values()))
        self.assertEqual((c["acao"]["coluna"], c["entidade"]["coluna"]), ("=operacao", "=marcacao_horario"))
        self.assertEqual(c["dados_antes"]["coluna"], "#retrato")
        self.assertNotIn("entidade_id", c)   # o cancelamento da origem não tem id da marcação apagada
        self.assertEqual(mapa.referencia_declarada(c["usuario_id"]), "TBUSERS")
        # mesma decisão das outras cópias de registro excluído (SIPACAGD_EXCLUSAO, CCCADCIR_EXCLUSAO)
        e = self.cols("REPACAGD_EXCLUSAO")
        self.assertEqual((e["entidade"]["coluna"], e["operacao"]["coluna"]), ("=marcacao_horario", "=exclusao"))
        self.assertEqual((e["entidade_id"]["coluna"], e["entidade_id"]["regra"]), ("ID_REPACAGD", "inteiro"))
        self.assertEqual(e["dados"]["coluna"], "#retrato")
        self.assertEqual(e["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(e["ocorrido_em"]["regra"], "data_hora")
        self.assertEqual(e["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(e["paciente_id"]["referencia"], "RICADPAC")
        self.assertTrue(e["justificativa"]["coluna"].startswith("="))
        self.assertEqual(set(pr), set(PRONTAS))

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
        comentadas = {x[1:].split("\t")[0] for x in linhas if x.startswith("#")}
        self.assertEqual(comentadas, BLOQUEADAS)
        for t, dt in PRONTAS.items():
            self.assertEqual({r["destino"].split(".")[0] for r in _prontas()[t].values()}, {dt})

    def test_imagem_sintetica_cobre_as_carregadas(self):
        linhas = []
        esp = l6_04.linhas(__import__("random").Random(1), lambda t, v: linhas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        self.assertEqual(set(l6_04.ESPERADO_PRONTO), set(PRONTAS))
        for t, e in l6_04._esperado().items():
            lidas = linhas.count(t)
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r == "codigo_colisao_caixa")
            self.assertEqual(e["gravados"] + recusas, lidas, t)


if __name__ == "__main__":
    unittest.main()
