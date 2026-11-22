"""ADR 0009 (decisão 27): extrator do texto livre da agenda e a gravação estruturada com o texto inteiro ao lado.

Textos e nomes SINTÉTICOS, um por formato da seção 2 da resposta do agente de marcação (nenhum texto real). A parte pura
roda em qualquer lugar; a parte com banco roda no container do conector (MariaDB da rede interna), num banco
descartável com o DDL do modelo (db/migracoes), e prova as perguntas de aceite: quanto custa a consulta particular,
se a agenda atende o convênio e o subplano, se precisa de preparo, se atende criança de 5 anos; e o Sincronizar
(texto mudou: estimadas saem, confirmada fica, nova extração)."""
import datetime as dt
import os
import unittest
import uuid

from sante_conector import estrutura_agenda as ea
from sante_conector import estruturar

FONTES = [{"id": 1, "nome": "PARTICULAR", "tipo": "outro"}, {"id": 2, "nome": "ALFA SAÚDE", "tipo": "outro"},
          {"id": 3, "nome": "BETA SAUDE INDIVIDUAL", "tipo": "outro"},
          {"id": 4, "nome": "BETA SAUDE EMPRESARIAL", "tipo": "outro"}, {"id": 5, "nome": "GAMA VIDA", "tipo": "outro"},
          {"id": 6, "nome": "DELTA E OMEGA", "tipo": "outro"}]


def ext(texto, campo="observacao", fonte=None):
    return ea.extrair(texto, campo, fonte, FONTES, estruturar.fonte_particular(FONTES))


def trechos(ex):
    return [(ex.texto[t["inicio"]:t["fim"]], t["interpretado"], t["tipo_regra"]) for t in ex.trechos]


class Puro(unittest.TestCase):
    def test_normalizar_mesmo_tamanho_e_chave(self):
        s = "Convênios: SUL-AMÉRICA ç"
        self.assertEqual(len(ea.normalizar(s)), len(s))
        self.assertEqual(ea.chave("Gama  Vida"), ea.chave("GAMAVIDA"))
        self.assertEqual(ea.hash_texto("abc").hex(), "ba7816bf8f01cfea414140de5dae2223")

    def test_fonte_particular(self):
        self.assertEqual(estruturar.fonte_particular(FONTES), 1)
        self.assertEqual(estruturar.fonte_particular(FONTES + [{"id": 9, "nome": "X", "tipo": "particular"}]), 9)
        self.assertIsNone(estruturar.fonte_particular(FONTES[1:]))

    def test_valor_particular_grafias(self):
        for txt, cent in [("VALOR DA CONSULTA PARTICULAR: R$: 275,00", 27500),
                          ("VALOR DA CONSULTA PARTICULAR: R$:275,00", 27500),
                          ("VALOR DE CONSULTA PARTICULAR: R$ 1.310,50", 131050),
                          ("valor da consulta particular : R$310.00", 31000)]:
            ex = ext(txt)
            self.assertEqual([p["valor_centavos"] for p in ex.precos], [cent], txt)
            self.assertEqual(trechos(ex), [(txt, True, "preco")])

    def test_valor_por_extenso_e_forma_de_pagamento(self):
        txt = "VALOR DA CONSULTA PARTICULAR : R$190,00 ( CENTO E NOVENTA REAIS) - PAGAMENTO SO NO PIX"
        ex = ext(txt)
        self.assertEqual(ex.precos[0]["valor_centavos"], 19000)
        self.assertEqual(trechos(ex), [("VALOR DA CONSULTA PARTICULAR : R$190,00 ( CENTO E NOVENTA REAIS)", True,
                                        "preco"), ("PAGAMENTO SO NO PIX", False, None)])

    def test_valores_nao_interpretados(self):
        for txt in ["VALOR DO EXAME PARTICULAR: R$ 410,00 + R$ 90,00 ( SEDACAO )",   # parcelas
                    "VALOR DO EXAME EXEMPLO PARTICULAR R$ 130,00",                  # exame nomeado sem item
                    "VALOR DO MAPEAMENTO EXEMPLO PARTICULAR: R$ 333,00 ( POR LADO )",
                    "Exame exemplo um R$ 145,00",                                    # tabela de procedimentos
                    "VALOR DA AVALIACAO PARA PACIENTES DE CONVÊNIO: R$ 60,00"]:      # decisão 24
            ex = ext(txt)
            self.assertEqual(ex.precos, [], txt)
            self.assertEqual([(i, tp) for _, i, tp in trechos(ex)], [(False, None)], txt)
        self.assertIn("decisão 24", ext("VALOR DA AVALIACAO PARA PACIENTES DE CONVÊNIO: R$ 60,00").trechos[0]["motivo"])

    def test_valor_do_exame_particular_vira_alvo_exame(self):
        ex = ext("VALOR DO EXAME PARTICULAR: R$ 130,00")
        self.assertEqual([(p["alvo"], p["valor_centavos"]) for p in ex.precos], [("exame", 13000)])
        self.assertEqual([(i, tp) for _, i, tp in trechos(ex)], [(True, "preco")])
        ex = ext("VALOR DO EXAME: R$ 99,90", "observacao_convenio", 1)   # no texto do convênio particular
        self.assertEqual([(p["alvo"], p["valor_centavos"]) for p in ex.precos], [("exame", 9990)])
        self.assertEqual(ext("VALOR DO EXAME: R$ 99,90", "observacao_convenio", 2).precos, [])

    def test_sem_fonte_particular_nao_grava_preco(self):
        ex = ea.extrair("VALOR DA CONSULTA PARTICULAR: R$ 200,00", "observacao", None, FONTES[1:], None)
        self.assertEqual((ex.precos, ex.trechos[0]["interpretado"]), ([], False))

    def test_lista_de_convenios_recusados_aceitos_marca_e_subplano(self):
        txt = "CONVÊNIOS SEM CREDENCIAMENTO: BETA, ALFA S10, GAMAVIDA, ZETA SAUDE, DELTA E OMEGA."
        ex = ext(txt)
        cob = sorted((c["fonte_pagadora_id"], c["subplano"], c["aceita"]) for c in ex.coberturas)
        self.assertEqual(cob, [(2, "ALFA S10", False), (3, None, False), (4, None, False), (5, None, False),
                               (6, None, False)])
        self.assertIn(("ZETA SAUDE", False, None), trechos(ex))
        ex = ext("CONVÊNIO COM CREDENCIAMENTO: ALFA SAUDE,GAMA VIDA")
        self.assertEqual(sorted((c["fonte_pagadora_id"], c["aceita"]) for c in ex.coberturas), [(2, True), (5, True)])

    def test_subplano_no_texto_do_convenio_e_no_geral(self):
        ex = ext("NÃO ATENDEMOS O SUBPLANO BETA SAUDE INDIVIDUAL PLUS E BETA SAUDE INDIVIDUAL TOP", "observacao_convenio", 3)
        self.assertEqual([(c["fonte_pagadora_id"], c["subplano"], c["aceita"]) for c in ex.coberturas],
                         [(3, "BETA SAUDE INDIVIDUAL PLUS", False), (3, "BETA SAUDE INDIVIDUAL TOP", False)])
        ex = ext("NÃO ATENDEMOS SUBPLANO ALFA S10")
        self.assertEqual([(c["fonte_pagadora_id"], c["subplano"]) for c in ex.coberturas], [(2, "ALFA S10")])

    def test_convenio_com_condicao(self):
        ex = ext("NECESSÁRIO SOLICITAR AUTORIZAÇÃO PRÉVIA", "observacao_convenio", 5)
        self.assertEqual([(c["fonte_pagadora_id"], c["aceita"], c["observacao"]) for c in ex.coberturas],
                         [(5, True, "NECESSÁRIO SOLICITAR AUTORIZAÇÃO PRÉVIA")])
        txt = "PARA PACIENTES DOS CONVÊNIOS ALFA SAUDE E GAMA VIDA,O EXAME SÓ PODE SER MARCADO COM 5 DIAS DE ANTECEDÊNCIA."
        ex = ext(txt)
        self.assertEqual(sorted(c["fonte_pagadora_id"] for c in ex.coberturas), [2, 5])
        self.assertTrue(all(c["aceita"] and c["observacao"].startswith("PARA PACIENTES") for c in ex.coberturas))
        self.assertIn(False, [t["interpretado"] for t in ex.trechos])   # a condição fica marcada no texto

    def test_preparo_documento_bloco_e_jejum(self):
        txt = ("NO DIA DO EXAME É NECESSÁRIO TRAZER PEDIDO MÉDICO E DOCUMENTO.\r\nNÃO É NECESSÁRIO PREPARO\r\n"
               "PREPARO PARA O EXAME EXEMPLO\r\nOrientações:\r\n\u0095 Jejum de 4 a 6 horas.\r\n· Vir com roupa leve\r\n"
               "FAIXA ETÁRIA: A PARTIR DE 12 ANOS")
        ex = ext(txt)
        self.assertEqual([(p["tipo"], p["jejum_horas"]) for p in ex.preparos],
                         [("documento", None), ("preparo", None), ("preparo", 6)])
        self.assertTrue(ex.preparos[2]["descricao"].startswith("PREPARO PARA O EXAME EXEMPLO"))
        self.assertNotIn("\u0095", ex.preparos[2]["descricao"])
        self.assertEqual(ex.restricoes[0]["idade_minima_anos"], 12)   # o bloco para na linha reconhecida

    def test_restricoes(self):
        for txt, esp in [("FAIXA ETÁRIA: TODAS AS IDADES", {"idade_minima_anos": 0}),
                         ("FAIXA ETÁRIA: ATENDE TODAS AS IDADES", {"idade_minima_anos": 0}),
                         ("FAIXA ETÁRIA: A PARTIR DE 07 ANOS", {"idade_minima_anos": 7}),
                         ("FAIXA ETÁRIA: DE 2 A 12 ANOS", {"idade_minima_anos": 2, "idade_maxima_anos": 12}),
                         ("SOMENTE MULHERES", {"sexo_atendido": "feminino"}),
                         ("NÃO ATENDE RETORNO. NÃO FAZ ENCAIXE", {"aceita_retorno": False, "permite_encaixe": False}),
                         ("RETORNO EM ATÉ 20 DIAS", {"dias_retorno": 20})]:
            ex = ext(txt)
            r = {k: v for k, v in ex.restricoes[0].items() if k != "trecho"}
            self.assertEqual(r, esp, txt)
        ex = ext("FAIXA ETÁRIA: A PARTIR DE 18 ANOS", "observacao_convenio", 2)
        self.assertEqual(ex.restricoes[0]["fonte_pagadora_id"], 2)

    def test_nao_atendemos_sem_subplano_nao_cria_plano(self):
        # revisão: "NÃO ATENDEMOS" sem a palavra SUBPLANO não vira plano dentro do convênio
        ex = ext("NÃO ATENDEMOS CRIANÇAS MENORES DE 2 ANOS", "observacao_convenio", 3)
        self.assertEqual(ex.coberturas, [])
        self.assertEqual([{k: v for k, v in r.items() if k != "trecho"} for r in ex.restricoes],
                         [{"idade_minima_anos": 2, "fonte_pagadora_id": 3}])
        ex = ext("NÃO ATENDEMOS RETORNO", "observacao_convenio", 3)
        self.assertEqual(ex.coberturas, [])
        self.assertEqual(ex.restricoes[0]["aceita_retorno"], False)
        ex = ext("NÃO ATENDEMOS PACIENTES ACAMADOS", "observacao_convenio", 3)
        self.assertEqual((ex.coberturas, ex.restricoes, [i for _, i, _ in trechos(ex)]), ([], [], [False]))
        # sem SUBPLANO, só o nome que casa com o próprio convênio vira plano dele
        ex = ext("NÃO ATENDEMOS BETA SAUDE INDIVIDUAL PLUS", "observacao_convenio", 3)
        self.assertEqual([(c["fonte_pagadora_id"], c["subplano"]) for c in ex.coberturas],
                         [(3, "BETA SAUDE INDIVIDUAL PLUS")])

    def test_restricao_parcial_marca_o_resto(self):
        ex = ext("SOMENTE MULHERES ACIMA DE 40 ANOS")
        self.assertEqual({k: v for k, v in ex.restricoes[0].items() if k != "trecho"},
                         {"sexo_atendido": "feminino", "idade_minima_anos": 40})
        self.assertEqual(trechos(ex), [("SOMENTE MULHERES ACIMA DE 40 ANOS", True, "restricao")])
        ex = ext("NÃO FAZ ENCAIXE, EXCETO URGÊNCIAS AUTORIZADAS PELO MÉDICO")
        self.assertEqual(ex.restricoes, [])
        self.assertEqual([(i, t["motivo"]) for (_, i, _), t in zip(trechos(ex), ex.trechos)],
                         [(False, ea.MOTIVO_EXCECAO)])
        ex = ext("FAIXA ETÁRIA: A PARTIR DE 5 ANOS, CRIANÇAS SÓ COM ACOMPANHANTE")
        self.assertEqual(ex.restricoes[0]["idade_minima_anos"], 5)
        self.assertEqual(trechos(ex), [("FAIXA ETÁRIA: A PARTIR DE 5 ANOS", True, "restricao"),
                                       ("CRIANÇAS SÓ COM ACOMPANHANTE", False, None)])
        ex = ext("PACIENTES ACIMA DE 60 ANOS DEVEM TRAZER ACOMPANHANTE")
        self.assertEqual((ex.restricoes, [i for _, i, _ in trechos(ex)]), ([], [False]))

    def test_bloco_de_preparo_para_nas_restricoes(self):
        ex = ext("PREPARO: JEJUM DE 8 HORAS\nSOMENTE MULHERES\nNÃO FAZ ENCAIXE")
        self.assertEqual([(p["descricao"], p["jejum_horas"]) for p in ex.preparos], [("PREPARO: JEJUM DE 8 HORAS", 8)])
        self.assertEqual([{k: v for k, v in r.items() if k != "trecho"} for r in ex.restricoes],
                         [{"sexo_atendido": "feminino"}, {"permite_encaixe": False}])
        # linha de valor também encerra o bloco
        ex = ext("ORIENTAÇÕES: VIR COM ROUPA LEVE\nVALOR DA CONSULTA PARTICULAR: R$ 200,00")
        self.assertEqual(([p["descricao"] for p in ex.preparos], [p["valor_centavos"] for p in ex.precos]),
                         (["ORIENTAÇÕES: VIR COM ROUPA LEVE"], [20000]))

    def test_primeira_palavra_generica_nao_vira_subplano(self):
        fontes = [{"id": 7, "nome": "SAUDE BRADESCO"}, {"id": 8, "nome": "ALFA SAÚDE"}]
        self.assertEqual(ea.resolver_convenio("SAUDE CAIXA", fontes), [])
        self.assertEqual(ea.resolver_convenio("ALFA S10", fontes), [(8, "ALFA S10")])
        ex = ea.extrair("CONVÊNIOS COM CREDENCIAMENTO: SAUDE CAIXA", "observacao", None, fontes, None)
        self.assertEqual(ex.coberturas, [])
        self.assertEqual([(t["interpretado"], t["motivo"]) for t in ex.trechos],
                         [(False, "convênio citado sem cadastro correspondente")])

    def test_texto_sem_regra_fica_marcado_inteiro(self):
        txt = "ESPECIALIDADE: EXEMPLO, NÃO REALIZA PROCEDIMENTO X\nATENDE POR HORA MARCADA"
        ex = ext(txt)
        self.assertEqual(ex.interpretados(), 0)
        self.assertEqual([(s, i) for s, i, _ in trechos(ex)],
                         [("ESPECIALIDADE: EXEMPLO, NÃO REALIZA PROCEDIMENTO X", False),
                          ("ATENDE POR HORA MARCADA", False)])


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


OBS1 = ("VALOR DA CONSULTA PARTICULAR: R$: 275,00\n"
        "CONVÊNIOS SEM CREDENCIAMENTO: BETA, ALFA S10\n"
        "FAIXA ETÁRIA: A PARTIR DE 06 ANOS\n"
        "ESPECIALIDADE: EXEMPLO SINTETICO")
OBS2 = ("NO DIA DO EXAME É NECESSÁRIO TRAZER PEDIDO MÉDICO E DOCUMENTO.\n"
        "PREPARO PARA O EXAME EXEMPLO\n\u0095 Jejum de 8 horas.\n\u0095 Trazer exames anteriores")
TABS = ("fonte_pagadora", "plano_fonte_pagadora", "agenda_servico", "agenda_fonte_pagadora") + estruturar.REGRAS + (
    "texto_origem_agenda", "trecho_texto_agenda")


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class Banco(unittest.TestCase):
    def test_estrutura_aceite_e_sincronizar(self):
        from sante_conector import banco, conferencia, mapa
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        nome = "cliente_adr9_conector_" + uuid.uuid4().hex[:8]
        root = banco.conectar(None, multi=True)
        try:
            with root.cursor() as c:
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
            root.select_db(nome)
            banco.aplicar_script(root, ";\n".join(
                [conferencia._sem_fk(ddl[t]["create"]).rstrip().rstrip(";") for t in TABS]
                + [a.rstrip().rstrip(";") for t in TABS for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]) + ";")
            cc = banco.conectar(nome, autocommit=False)

            def q(sql, args=()):
                with cc.cursor() as c:
                    c.execute(sql, args)
                    return c.fetchall()
            for f in FONTES:
                q("INSERT INTO fonte_pagadora (id, codigo, nome, tipo, origem, criado_em) VALUES (%s,%s,%s,%s,"
                  "'migracao',NOW(3))", (f["id"], str(f["id"]), f["nome"], f["tipo"]))
            for i, obs in [(1, OBS1), (2, OBS2)]:
                q("INSERT INTO agenda_servico (id, estabelecimento_id, nome, categoria_agenda_id, setor_funcional_id,"
                  " duracao_horario_minutos, observacao, origem, criado_em) VALUES (%s,1,%s,1,1,20,%s,'migracao',"
                  "NOW(3))", (i, "Agenda exemplo %d" % i, obs))
            q("INSERT INTO agenda_fonte_pagadora (agenda_servico_id, fonte_pagadora_id, observacao_marcacao_online,"
              " criado_em) VALUES (1,5,'NECESSÁRIO SOLICITAR AUTORIZAÇÃO PRÉVIA',NOW(3)),(1,2,NULL,NOW(3))")
            cc.commit()
            # sem evidência de vigência: o texto fica guardado inteiro e pendente, sem regra (decisão 16)
            r0 = estruturar.executar(cc)
            self.assertEqual((r0["novos"], r0["sem_evidencia"], r0["precos"], r0["coberturas"]), (3, 3, 0, 0), r0)
            self.assertEqual(q("SELECT COUNT(*) FROM texto_origem_agenda WHERE situacao_estruturacao <> 'pendente'")
                             [0][0], 0)
            self.assertEqual(q("SELECT COUNT(*) FROM regra_preco_particular")[0][0], 0)
            # com a evidência, os pendentes são extraídos com a vigência dela
            vp = dt.date(2019, 1, 2)
            r1 = estruturar.executar(cc, vigencia_padrao=vp)
            self.assertEqual(q("SELECT DISTINCT vigencia_inicio FROM agenda_restricao"), ((vp,),))
            self.assertEqual((r1["pendentes_extraidos"], r1["falhas"], r1["precos"], r1["coberturas"], r1["restricoes"],
                              r1["preparos"], r1["planos_criados"]), (3, 0, 1, 4, 1, 2, 1), r1)
            # quanto custa a consulta particular na agenda 1: pela regra, com o texto original ao lado
            (valor, tid, sit), = q("SELECT valor, texto_origem_agenda_id, situacao_revisao FROM regra_preco_particular"
                                   " WHERE agenda_servico_id=1 AND alvo='consulta' AND excluido_em IS NULL")
            self.assertEqual((str(valor), sit), ("275.00", "estimada"))
            self.assertEqual(q("SELECT texto FROM texto_origem_agenda WHERE id=%s", (tid,))[0][0], OBS1)
            # atende o convênio Beta (as duas fontes da marca)? não. Alfa, plano S10? não (subplano criado). Gama? sim.
            cob = q("SELECT c.fonte_pagadora_id, p.descricao, c.aceita, p.fonte_pagadora_id FROM agenda_cobertura c"
                    " LEFT JOIN plano_fonte_pagadora p ON p.id=c.plano_fonte_pagadora_id WHERE c.agenda_servico_id=1"
                    " ORDER BY 1")
            self.assertEqual([(a, b, bool(x), d) for a, b, x, d in cob],
                             [(2, "ALFA S10", False, 2), (3, None, False, None), (4, None, False, None),
                              (5, None, True, None)])
            # atende criança de 5 anos? não (a partir de 6)
            self.assertEqual(q("SELECT idade_minima_anos FROM agenda_restricao WHERE agenda_servico_id=1")[0][0], 6)
            # precisa de preparo no exame da agenda 2? sim: jejum de 8 horas, e documentos
            self.assertEqual(sorted(q("SELECT tipo, jejum_horas FROM agenda_preparo WHERE agenda_servico_id=2")),
                             [("documento", None), ("preparo", 8)])
            # o trecho não interpretado fica marcado e continua valendo pelo texto
            (ini, fim), = q("SELECT posicao_inicio, posicao_fim FROM trecho_texto_agenda WHERE texto_origem_agenda_id"
                            "=%s AND NOT interpretado", (tid,))
            self.assertEqual(OBS1[ini:fim], "ESPECIALIDADE: EXEMPLO SINTETICO")
            # segunda execução sem mudança: nada muda
            r2 = estruturar.executar(cc, vigencia_padrao=vp)
            self.assertEqual((r2["iguais"], r2["novos"], r2["reextraidos"], r2["trechos"]), (3, 0, 0, 0), r2)
            # Sincronizar: o hospital confirmou a restrição; o texto mudou na origem (valor novo, sem lista)
            q("UPDATE agenda_restricao SET situacao_revisao='confirmada' WHERE agenda_servico_id=1")
            q("UPDATE agenda_servico SET observacao=%s WHERE id=1",
              ("VALOR DE CONSULTA PARTICULAR: R$ 300,00\nFAIXA ETÁRIA: A PARTIR DE 06 ANOS",))
            cc.commit()
            r3 = estruturar.executar(cc, vigencia_padrao=vp)
            self.assertEqual((r3["reextraidos"], r3["estimadas_retiradas"], r3["confirmadas_a_rever"], r3["precos"],
                              r3["restricoes"], r3["ja_confirmadas"]), (1, 4, 1, 1, 0, 1), r3)
            self.assertEqual([str(v) for v, in q("SELECT valor FROM regra_preco_particular WHERE agenda_servico_id=1"
                                                 " AND excluido_em IS NULL")], ["300.00"])
            self.assertEqual(q("SELECT COUNT(*) FROM agenda_cobertura WHERE agenda_servico_id=1 AND fonte_pagadora_id"
                               "<>5 AND excluido_em IS NULL")[0][0], 0)
            self.assertEqual(q("SELECT COUNT(*) FROM agenda_restricao WHERE agenda_servico_id=1 AND situacao_revisao="
                               "'confirmada' AND excluido_em IS NULL")[0][0], 1)
            self.assertEqual(q("SELECT COUNT(*) FROM agenda_restricao WHERE agenda_servico_id=1 AND excluido_em IS"
                               " NULL")[0][0], 1)   # a confirmada igual não ganha estimada repetida
            cc.close()
        finally:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
            root.close()


if __name__ == "__main__":
    unittest.main()
