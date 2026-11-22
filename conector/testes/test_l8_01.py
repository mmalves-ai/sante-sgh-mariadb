"""Fatia L8-01 (faturamento e restantes, módulo FAT), rodada de cobertura total: declarações, plano da carga dirigida
pelo mapa, descartes e regras das colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L8-01`)."""
import csv
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_01

FATIA = list(l8_01.FATIA)
CARREGADAS = {"FCPROCUNIBHMED": "parametro_opcao", "FCTPMOTGLOSA": "grupo_motivo_glosa", "RPDEDUTIVEL": "tipo_deducao_irrf",
              "FAPARUSU": "competencia_trabalho_usuario", "FCPARUSU": "competencia_trabalho_usuario",
              "FIPARUSU": "competencia_trabalho_usuario", "FCCODCON": "codigo_prestador_fonte_pagadora",
              "FCCPSCON": "codigo_prestador_fonte_pagadora",
              "FCFECMES": "fechamento_competencia_fonte_pagadora", "FCORCAME": "orcamento_particular",
              "FCHORATE": "horario_normal_tabela", "FCGUIAS": "guia_fonte_pagadora", "FCORCPAD": "modelo_orcamento",
              "FCORLAME": "orcamento_particular_item", "RPEVENTOESOC": "evento_repasse_incidencia",
              "RPLANEVE": "lancamento_repasse", "RPLANEVE_COMPOSICAOBASE": "lancamento_repasse_base",
              "FCTPPGTONFSE": "condicao_pagamento", "RECONTAS": "conta_hospitalar_etapa",
              "FCREFUND": "preco_referencia_matmed",
              # R5 (ADR 0006): passam a carregar
              "FCEMPAUDPLANSERV": "parametro_opcao", "RPPARAM": "sequencia_negocio",
              "RPLANEVE_TBCBOPRO": "lancamento_repasse"}
DESCARTES = {}  # r6: FCPROCUNIBHMED carrega como opções de parâmetro de lista (#grupo_seq@*)
# r4: FCREFUND carrega (preço das tabelas próprias; as de referência comercial são puladas pelo filtro de linha)
BLOQUEADAS = set()
EXTRAS = {"RPLANEVE": ["favorecido_repasse"],
          "FCREFUND": ["fonte_referencia_matmed", "edicao_referencia_matmed"],  # destino secundário declarado pela via
          "FCEMPAUDPLANSERV": ["modulo_sistema", "parametro_definicao"],
          "FCPROCUNIBHMED": ["modulo_sistema", "parametro_definicao"]}  # r6: lista de opções (módulo e parâmetro adotados)
CONTA = "FCCTAEXT.(ANOPRO,MESPRO,TIPO_CTA,COD)=(ANOPRO,MESPRO,TIPO_CTA,CONTA)"
PROF = "TBCBOPRO>ID_TBPROFIS>TBPROFIS"


def _decl():
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L8-01.tsv", encoding="utf-8") as f:
        return list(f)


def _sem_carga():
    with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
        return {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}


def _pares(tabela, coluna):
    with open(mapa.DIR_PACOTE / "declarado" / "valores.d" / "L8-01.tsv", encoding="utf-8") as f:
        return {r["valor_origem"]: r["valor_destino"] for r in csv.DictReader(f, delimiter="\t")
                if (r["tabela"], r["coluna"]) == (tabela, coluna)}


class L801(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_fatia_inteira_classificada(self):
        self.assertEqual(len(FATIA), 23)
        self.assertEqual(set(CARREGADAS) | set(DESCARTES) | BLOQUEADAS, set(FATIA))
        self.assertFalse(set(CARREGADAS) & set(DESCARTES) or set(CARREGADAS) & BLOQUEADAS
                         or set(DESCARTES) & BLOQUEADAS)

    def test_so_as_carregaveis_entram_com_o_destino_certo(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt] + EXTRAS.get(t, []), t)

    def test_descartes_com_causa_de_produto_e_motivo(self):
        sc = _sem_carga()
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"], t)
        # o preço das tabelas PRÓPRIAS do hospital nunca é descartado como licenciado (regra 7 vale só para as marcadas)
        self.assertNotIn("FCREFUND", sc)
        self.assertNotIn("FCTPPGTONFSE", sc)
        self.assertNotIn("RECONTAS", sc)
        pronta = [l for l in _decl() if l.startswith("FCREFUND\t")]
        self.assertTrue(any("ref:TBMATMED.(TAB,COD,CLASSIF,COD_ALFA)=(TAB,COD,CLASSIF,COD_ALFA)" in l for l in pronta))
        self.assertTrue(any("preco_referencia_matmed.vigencia_inicio" in l for l in pronta))
        self.assertTrue(any("so_se:TAB>TBCTRMEM>REF_BRA=" in l and "!licenca_nao_comprovada" in l for l in pronta))

    def test_competencia_por_modulo_e_ano_mes(self):
        for t, mod in (("FAPARUSU", "sus_ambulatorial"), ("FCPARUSU", "fonte_pagadora"),
                       ("FIPARUSU", "sus_internacao")):
            c = self.cols(t)
            self.assertEqual(c["modulo"]["coluna"], "=" + mod, t)
            self.assertEqual(c["competencia"]["coluna"], "#data:ANOPRO,MESPRO", t)
            self.assertEqual((c["usuario_id"]["coluna"], c["usuario_id"]["referencia"]), ("USUARIO", "TBUSERS"), t)
            self.assertEqual(c["usuario_id"]["regra"], "chave_origem", t)  # regra declarada desligaria a ref
            self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento", t)
        # preferências soltas do faturista não vão para a competência
        self.assertEqual({x["coluna"] for x in self.cols("FCPARUSU").values()},
                         {"@estabelecimento", "USUARIO", "=fonte_pagadora", "#data:ANOPRO,MESPRO"})

    def test_codigo_no_convenio(self):
        c = self.cols("FCCODCON")
        self.assertEqual(c["tipo_prestador"]["coluna"], "=profissional")
        self.assertEqual(c["profissional_id"]["referencia"], PROF)
        self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        self.assertEqual(c["fonte_pagadora_id"]["regra"], "chave_origem")  # regra declarada desligaria a ref
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(c["valor_consulta"]["regra"], "decimal_nao_negativo")
        h = self.cols("FCCPSCON")
        self.assertEqual(h["tipo_prestador"]["coluna"], "=~estabelecimento")
        self.assertNotIn("profissional_id", h)

    def test_repetidos_adotam_sem_sobrescrever(self):
        op = {t: self.plano[t]["opcoes"] for t in ("FAPARUSU", "FCPARUSU", "FCCPSCON")}
        for t in ("FAPARUSU", "FCPARUSU"):
            self.assertEqual(op[t]["competencia_trabalho_usuario"]["adotar"], ["usuario_id", "modulo"], t)
        self.assertEqual(op["FCCPSCON"]["codigo_prestador_fonte_pagadora"]["adotar"],
                         ["estabelecimento_id", "fonte_pagadora_id", "tipo_prestador"])

    def test_horario_em_pares_no_principal(self):
        op = self.plano["FCHORATE"]["opcoes"]["horario_normal_tabela"]["desdobrar"]
        self.assertEqual([r for _, r in op], [str(i) for i in range(7)])  # domingo 0 ... sábado 6
        self.assertEqual(op[0][0], "DOM_I+DOM_F")
        c = self.cols("FCHORATE")
        self.assertEqual((c["hora_inicio"]["regra"], c["hora_fim"]["regra"]), ("hora_hhmm", "hora_hhmm"))
        self.assertEqual(c["tabela_preco_id"]["referencia"], "TBCTRTHM")

    def test_guia_pela_conta_composta(self):
        decl = [r for r in csv.DictReader(_decl(), delimiter="\t") if r["tabela"] == "FCGUIAS"]
        via = {r["destino"].split(".")[1]: r["via"] for r in decl if r["destino"]}
        self.assertEqual(via["conta_hospitalar_id"], "ref:" + CONTA)  # nunca só o número da conta
        self.assertTrue(via["paciente_id"].startswith("ref:" + CONTA + ">REG_ATE>RECADATE>PRONT>RICADPAC"))
        for r in decl:
            if r["via"].startswith("ref:"):
                self.assertIsNotNone(mapa.passos_ref(r["via"][4:].split(";")[0]), r["coluna"])
        datas = [r["coluna"] for r in decl if r["destino"] == "guia_fonte_pagadora.data_solicitacao"]
        self.assertEqual(datas, ["MESPRO", "TIPO_CTA", "#data:ANOPRO,MESPRO"])  # três fontes concorrentes, em ordem
        t = self.cols("FCGUIAS")["tipo_guia"]
        self.assertEqual((t["coluna"], t["depara"]), ("TP_GUIA", "valores"))  # nunca presumido
        self.assertEqual(self.plano["FCGUIAS"]["opcoes"]["guia_fonte_pagadora"]["adotar"],
                         ["estabelecimento_id", "fonte_pagadora_id", "numero"])  # mesma guia só no mesmo convênio
        self.assertEqual(_pares("FCGUIAS", "TP_GUIA"), {"S": "sp_sadt", "R": "internacao"})

    def test_modelo_e_item_do_orcamento(self):
        decl = {(r["tabela"], r["destino"]): r for r in csv.DictReader(_decl(), delimiter="\t")}
        self.assertEqual(decl[("FCORCPAD", "modelo_orcamento.item_faturavel_id")]["via"],
                         "ref:TBPROCTO.COD_PROCEDIMENTO")
        self.assertIn("ref:FCORCAME", decl[("FCORLAME", "orcamento_particular_item.orcamento_particular_id")]["via"])
        self.assertEqual(self.cols("FCORLAME")["sequencia"]["coluna"], "#seq:COD")

    def test_repasse(self):
        op = self.plano["RPLANEVE"]["opcoes"]["favorecido_repasse"]
        self.assertTrue(op["antes"])
        self.assertEqual(op["adotar"], ["estabelecimento_id", "profissional_id", "tipo_favorecido"])
        c = self.cols("RPLANEVE")
        self.assertEqual(c["favorecido_repasse_id"]["coluna"], "@id:favorecido_repasse")
        self.assertEqual((c["tipo_lancamento"]["coluna"], c["competencia"]["regra"]), ("=ajuste", "data_primeiro_dia_mes"))
        self.assertTrue(c["justificativa"]["coluna"].startswith("="))
        # situação pela evidência do RPA (nunca presumida aberta): ligado a RPA -> aprovado; sem RPA -> padrão aberto
        self.assertEqual((c["situacao"]["coluna"], c["situacao"]["regra"], c["situacao"]["depara"]),
                         ("ID_RPLANEVE", "preenchido", "valores"))
        self.assertEqual(c["situacao"]["referencia"], "RPLANRPA.ID_RPLANEVE>ID_RPRPA")
        self.assertEqual(_pares("RPLANEVE", "ID_RPLANEVE"), {"1": "aprovado"})
        self.assertEqual((c["tipo_favorecido"]["coluna"], c["tipo_favorecido"]["depara"]), ("TIPO", "valores"))
        self.assertEqual(_pares("RPLANEVE", "TIPO"), {"M": "medico", "E": "empresa"})
        e = self.cols("RPEVENTOESOC")
        self.assertEqual(tuple(e["natureza_rubrica_id"]["cod"]), ("natureza_rubrica", "codigo_esocial"))
        self.assertEqual(self.cols("RPLANEVE_COMPOSICAOBASE")["aliquota"]["regra"], "faixa:0,100")

    def test_fechamento_e_orcamento(self):
        f = self.cols("FCFECMES")
        self.assertEqual(f["competencia"]["coluna"], "#data:ANO,MES")
        self.assertEqual(f["data_abertura"]["coluna"], "#data:ANO,MES")
        self.assertEqual((f["situacao"]["coluna"], f["fechado_em"]["regra"]), ("=fechada", "data_hora"))
        o = self.cols("FCORCAME")
        self.assertEqual(o["paciente_id"]["referencia"], "RICADPAC.PRONT")
        self.assertEqual((o["validade_ate"]["coluna"], o["data_orcamento"]["coluna"]), ("DATA", "DATA"))
        self.assertEqual(o["cpf_interessado"]["regra"], "cpf")
        self.assertEqual(o["situacao"]["coluna"], "=~emitido")
        self.assertEqual((o["forma_pagamento"]["coluna"], o["forma_pagamento"]["depara"]), ("PARCELADO", "valores"))
        self.assertEqual(_pares("FCORCAME", "PARCELADO"),
                         {"S": "parcelado", "s": "parcelado", "N": "a_vista", "n": "a_vista"})

    def test_condicao_pagamento_e_abertura_da_conta(self):
        p = self.cols("FCTPPGTONFSE")
        self.assertEqual(p["codigo"]["coluna"], "#codigo_derivado:ID:30:nfse_")
        self.assertEqual((p["descricao"]["coluna"], p["finalidade"]["coluna"]), ("NOME", "=contas_receber"))
        e = self.cols("RECONTAS")
        self.assertEqual(e["conta_hospitalar_id"]["referencia"], "FCCTAEXT.(REG_ATE,COD)=(REG,CONTA)")  # adota a conta
        self.assertEqual((e["situacao_nova"]["coluna"], e["operacao"]["coluna"]), ("=aberta", "=inclusao"))
        self.assertEqual(e["dados"]["coluna"], "#retrato:*")

    def test_ordem_respeita_os_pais(self):
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if (r.get("ordem") or "").isdigit()}
        for filho, pais in (("FCHORATE", ["TBCTRTHM"]), ("FCGUIAS", ["TBCONVEN", "FCCTAEXT"]),
                            ("FCORCPAD", ["TBPROCTO", "TBCONVEN"]), ("FCORLAME", ["FCORCAME", "TBPROCTO"]),
                            ("RPLANEVE", ["TBPROFIS", "RPEVENTO"]), ("RECONTAS", ["FCCTAEXT"])):
            for pai in pais:
                self.assertLess(ordem[pai], ordem[filho], (filho, pai))

    def test_codigos_e_descricoes(self):
        g = self.cols("FCTPMOTGLOSA")
        self.assertEqual((g["codigo"]["coluna"], g["codigo"]["regra"]), ("ID", "inteiro"))
        self.assertNotIn("codigo_tiss", g)  # sem evidência do domínio: nada presumido
        d = self.cols("RPDEDUTIVEL")
        self.assertEqual(d["natureza"]["coluna"], "=~outra")
        self.assertEqual(carga_mapa.tipar(sentinela.aplicar("inteiro", 7)[0], "varchar"), "7")

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Guia   exemplo  ")[0], "Guia exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(carga_mapa.data_composta(2026, 13), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(None, None), (None, None))
        self.assertEqual(sentinela.aplicar("cpf", 12345678900), (None, "documento_invalido"))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", -5)[1], "valor_fora_do_dominio")

    def test_declaracoes_com_motivo_e_so_da_fatia(self):
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t") if not r["tabela"].startswith("#")]
        for r in rows:
            self.assertIn(r["tabela"], CARREGADAS)
            self.assertTrue(r["motivo"].startswith("L8-01"))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l8_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r in ("pai_pendente", "sem_item_a_gravar",
                                                                               "licenca_nao_comprovada"))
            linhas_gravadas = {"FCHORATE": 1}.get(t, e["gravados"])  # pares: gravados = itens (seis de uma linha)
            self.assertEqual(linhas_gravadas + recusas, lidas.count(t), t)
        self.assertTrue(set(l8_01.PAIS_EXTERNOS) >= {"TBCONVEN", "TBUSERS", "TBPROFIS", "RPEVENTO"})
        # intermediárias declaradas por outra fatia carregam pelo mapa nesta imagem: nunca como pai externo
        self.assertFalse(set(l8_01.PAIS_EXTERNOS) & {"FCCTAEXT", "TBPROCTO", "TBCTRTHM"})


if __name__ == "__main__":
    unittest.main()
