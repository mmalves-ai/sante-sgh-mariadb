"""Fatia L6-14 (prontuário, assinatura e assistência, módulo INT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-14`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_14

TABELAS = set(l6_14.CARREGADAS)
# RIPARAM carrega os contadores de numeração (rodada 3); a fatia não tem descarte
DESCARTADAS = set()
FORA = set()


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | DESCARTADAS | FORA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["RETPLEITO"]["destinos"], ["tipo_leito_observacao"])
        self.assertEqual(self.plano["RIBLOCOS"]["destinos"], ["bloco_internacao", "unidade_internacao"])
        self.assertEqual(self.plano["RICTRLOC"]["destinos"], ["ocupacao_leito"])
        self.assertEqual(self.plano["RIACOMOD"]["destinos"], ["acomodacao"])
        self.assertEqual(self.plano["RILEITOS"]["destinos"], ["leito_hospitalar"])
        self.assertEqual(self.plano["RIPARAM"]["destinos"], ["sequencia_negocio"])
        self.assertEqual(self.plano["RISITREGLEITO"]["destinos"], ["situacao_pedido_leito"])
        self.assertEqual(self.plano["TBALTARN"]["destinos"], ["desfecho_recem_nascido"])
        self.assertEqual(self.plano["RITITFIC"]["destinos"], ["titulo_documento_internacao"])
        self.assertEqual(self.plano["RIMODFIC"]["destinos"], ["modelo_documento_internacao"])
        for t in ("RICONFIC", "RIESPFIC"):
            self.assertEqual(self.plano[t]["destinos"], ["regra_documento_internacao"])

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "descricao", "categoria"} <= set(self.cols("RETPLEITO", "tipo_leito_observacao")))
        self.assertTrue({"estabelecimento_id", "codigo", "nome"} <= set(self.cols("RIBLOCOS", "bloco_internacao")))
        self.assertTrue({"codigo", "descricao", "estado"} <= set(self.cols("RISITREGLEITO", "situacao_pedido_leito")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBALTARN", "desfecho_recem_nascido")))
        self.assertTrue({"codigo", "descricao", "finalidade"} <= set(self.cols("RITITFIC", "titulo_documento_internacao")))
        # CHECK: conteúdo ou modelo do editor; a origem não tem conteúdo: aviso presumido e modelo inativo
        cs = self.cols("RIMODFIC", "modelo_documento_internacao")
        self.assertTrue({"codigo", "titulo", "conteudo"} <= set(cs))
        self.assertTrue(cs["conteudo"]["coluna"].startswith("=~"))
        self.assertEqual(cs["ativo"]["coluna"], "=0")
        for t in ("RICONFIC", "RIESPFIC"):
            self.assertTrue({"estabelecimento_id", "modelo_documento_internacao_id"}
                            <= set(self.cols(t, "regra_documento_internacao")), t)

    def test_chave_composta_e_variante_adotada(self):
        # GRAFICA é a variante de impressão: o modelo e a regra apontam o pai por COD,GRAFICA; a variante é adotada
        ref = self.cols("RIMODFIC", "modelo_documento_internacao")["titulo_documento_internacao_id"]
        self.assertEqual(ref["passos"], [{"tabela": "RITITFIC", "modo": "composta", "arg": ["COD", "GRAFICA"]}])
        for t in ("RICONFIC", "RIESPFIC"):
            cs = self.cols(t, "regra_documento_internacao")
            self.assertEqual(cs["modelo_documento_internacao_id"]["passos"][0]["tabela"], "RIMODFIC")
            self.assertEqual(cs["titulo_documento_internacao_id"]["passos"][0]["tabela"], "RITITFIC")
        self.assertEqual(self.cols("RICONFIC", "regra_documento_internacao")["fonte_pagadora_id"]["referencia"],
                         "TBCONVEN")
        self.assertEqual(self.cols("RIESPFIC", "regra_documento_internacao")["especialidade_medica_id"]["referencia"],
                         "TBESPEC")
        self.assertEqual(self.plano["RITITFIC"]["opcoes"]["titulo_documento_internacao"]["adotar"], ["codigo"])
        self.assertEqual(self.plano["RIMODFIC"]["opcoes"]["modelo_documento_internacao"]["adotar"], ["codigo"])
        self.assertEqual(self.plano["RICONFIC"]["opcoes"]["regra_documento_internacao"]["adotar"],
                         ["estabelecimento_id", "modelo_documento_internacao_id", "fonte_pagadora_id"])
        self.assertEqual(self.plano["RIESPFIC"]["opcoes"]["regra_documento_internacao"]["adotar"],
                         ["estabelecimento_id", "modelo_documento_internacao_id", "especialidade_medica_id"])

    def test_literais_presumidos_e_estabelecimento(self):
        self.assertEqual(self.cols("RETPLEITO", "tipo_leito_observacao")["categoria"]["coluna"], "=~outro")
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["estado"]["coluna"], "=~solicitado")
        self.assertEqual(self.cols("TBALTARN", "desfecho_recem_nascido")["obito"]["coluna"], "=~0")
        # estado e óbito presumidos: a linha entra inativa até o de-para de valores (o NIR só usa situação ativa)
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["ativo"]["coluna"], "=0")
        self.assertEqual(self.cols("TBALTARN", "desfecho_recem_nascido")["ativo"]["coluna"], "=0")
        # nunca um estabelecimento fixo: o único do cliente, ou recusa
        self.assertEqual(self.cols("RIBLOCOS", "bloco_internacao")["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_bloco_e_unidade_de_internacao(self):
        cs = self.cols("RIBLOCOS", "unidade_internacao")
        self.assertTrue({"estabelecimento_id", "unidade_assistencial_id", "codigo", "descricao", "tipo",
                         "bloco_internacao_id"} <= set(cs))
        self.assertEqual(cs["unidade_assistencial_id"]["referencia"], "TBUNIDAD")
        self.assertEqual(cs["tipo"]["coluna"], "=~outro")
        self.assertEqual(cs["bloco_internacao_id"]["coluna"], "@id")
        self.assertEqual((cs["idade_minima_anos"]["regra"], cs["idade_maxima_anos"]["regra"]),
                         ("faixa:0,150", "faixa:0,150"))
        # UNIQUE do modelo em unidade_assistencial_id (M5 pedido): o segundo bloco adota, sem perder o bloco
        self.assertEqual(self.plano["RIBLOCOS"]["opcoes"]["unidade_internacao"]["adotar"], ["unidade_assistencial_id"])

    def test_ocupacao_de_leito(self):
        cs = self.cols("RICTRLOC", "ocupacao_leito")
        self.assertTrue({"estabelecimento_id", "internacao_id", "leito_hospitalar_id", "unidade_internacao_id",
                         "acomodacao_id", "data_hora_inicio"} <= set(cs))
        self.assertEqual(cs["internacao_id"]["referencia"], "RICADINT")
        self.assertEqual(cs["acomodacao_id"]["passos"], [{"tabela": "RIACOMOD", "modo": "composta",
                                                          "arg": ["BLOCO", "ACOMOD"]}])
        # leito pela chave alternativa COMPOSTA (o mesmo código de leito em dois quartos não confunde)
        self.assertEqual(cs["leito_hospitalar_id"]["passos"][0]["tabela"], "RILEITOS")
        self.assertEqual(cs["leito_hospitalar_id"]["passos"][0]["modo"], "alt_composta")
        self.assertEqual(cs["unidade_internacao_id"]["passos"][0]["tabela"], "RIBLOCOS")
        self.assertEqual(cs["unidade_internacao_id"]["passos"][-1].get("destino"), "unidade_internacao")
        self.assertEqual(cs["data_hora_inicio"]["coluna"], "#data_hora:ENTRADA,HORAENT")
        self.assertEqual(cs["data_hora_fim"]["coluna"], "#data_hora:SAIDA,HORASAI")
        self.assertEqual((cs["situacao"]["regra"], cs["situacao"]["valores"]), ("preenchido", {"1": "encerrada", "0": ""}))
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_acomodacao(self):
        cs = self.cols("RIACOMOD", "acomodacao")
        self.assertTrue({"estabelecimento_id", "unidade_internacao_id", "categoria_acomodacao_id", "codigo", "nome"}
                        <= set(cs))
        self.assertEqual(cs["unidade_internacao_id"]["passos"][-1].get("destino"), "unidade_internacao")
        self.assertEqual(cs["categoria_acomodacao_id"]["referencia"], "TBTIPOACOMOD")
        self.assertEqual(cs["bloco_internacao_id"]["referencia"], "RIBLOCOS")
        self.assertEqual(cs["quantidade_leitos"]["regra"], "faixa:1,999")
        self.assertEqual(cs["idade_minima_dias"]["coluna"], "#dias:IDADE_MINIMA,ID_TBUNID_IDADE_MIN")
        self.assertEqual(cs["idade_minima_dias"]["valores"]["Anos"], "ano")
        self.assertEqual(cs["sexo_permitido"]["valores"], {"M": "masculino", "F": "feminino", "I": "indiferente"})
        # nome concorrente: sem NOME, o código do quarto (nada se perde, o quarto e os leitos carregam)
        nomes = [c["coluna"] for c in self.plano["RIACOMOD"]["colunas"]["acomodacao"] if c["destino"] == "nome"]
        self.assertEqual(nomes, ["NOME", "ACOMOD"])
        # alimentadora única de acomodacao: a outra tabela que escreve nela (TBACOMODLEITO, L6-15) só COMPLETA o
        # quarto de RIACOMOD (`complementa` na via do id: UPDATE da linha resolvida por ref:RIACOMOD, nunca linha nova)
        decl = [c for c in self.mapa["colunas_decl"] if (c.get("destino") or "").startswith("acomodacao.")]
        complementa = {c["tabela"] for c in decl if "complementa" in (c.get("via") or "").split(";")}
        self.assertEqual({c["tabela"] for c in decl} - complementa, {"RIACOMOD"})
        for t in complementa:
            via = next(c["via"] for c in decl if c["tabela"] == t and c["destino"] == "acomodacao.id")
            self.assertTrue(via.startswith("ref:RIACOMOD("), t)
            # nenhuma coluna que RIACOMOD grava é escrita pela complementar (duas fontes divergiriam na conciliação)
            proprias = {c["destino"] for c in decl if c["tabela"] == "RIACOMOD"}
            self.assertFalse({c["destino"] for c in decl if c["tabela"] == t and c["destino"] != "acomodacao.id"}
                             & proprias, t)

    def test_ordem_de_carga(self):
        """Referência declarada a pai que carrega DEPOIS fica NULL (pai_inexistente). Em regra_documento_internacao NULL
        quer dizer 'vale para todas as fontes/especialidades': a ordem real do mapa tem de pôr o pai antes. Falha até
        as dependências pedidas no L6-14.json serem aplicadas e o mapa regerado."""
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.mapa["tabelas"] if r["ordem"].isdigit()}
        faltam = [(f, p) for f, p in [("RICONFIC", "TBCONVEN"), ("RIESPFIC", "TBESPEC"), ("RICTRLOC", "RICADINT"),
                                      ("RICTRLOC", "RIACOMOD"), ("RICTRLOC", "RILEITOS"),
                                      ("RICTRLOC", "RIBLOCOS"), ("RIACOMOD", "RIBLOCOS"),
                                      ("RIACOMOD", "TBTIPOACOMOD"), ("RIACOMOD", "TBUNID_IDADE")] if ordem[f] <= ordem[p]]
        self.assertEqual(faltam, [], "pai depois do filho na ordem do mapa (dependência pedida no L6-14.json)")

    def test_codigos_como_texto(self):
        for t, dt in [("RETPLEITO", "tipo_leito_observacao"), ("RISITREGLEITO", "situacao_pedido_leito"),
                      ("TBALTARN", "desfecho_recem_nascido")]:
            self.assertEqual(self.cols(t, dt)["codigo"]["regra"], "texto", t)
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["codigo_central"]["regra"], "texto")
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))

    def test_bloco_preserva_caixa_e_negativo_nao_recusa(self):
        cs = self.cols("RIBLOCOS", "bloco_internacao")
        self.assertEqual(cs["codigo"]["regra"], "codigo_char")
        # atributos opcionais UNSIGNED: negativo vira NULL com pendência, sem recusar o bloco e os leitos em cascata
        self.assertEqual(cs["quantidade_andares"]["regra"], "inteiro_nao_negativo")
        self.assertEqual(cs["ordem_exibicao"]["regra"], "inteiro_nao_negativo")

    def test_unica_alimentadora_dos_codigos(self):
        for t, dt in [("RETPLEITO", "tipo_leito_observacao"), ("RISITREGLEITO", "situacao_pedido_leito"),
                      ("TBALTARN", "desfecho_recem_nascido"), ("RIBLOCOS", "bloco_internacao")]:
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_descarte_e_fora_da_fatia(self):
        self.assertFalse((DESCARTADAS | FORA) & set(self.plano))
        sem = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertFalse(sem & TABELAS)

    def test_contadores_da_internacao_em_sequencia_inativa(self):
        c = self.cols("RIPARAM", "sequencia_negocio")
        self.assertEqual((c["proximo_valor"]["coluna"], c["proximo_valor"]["regra"]), ("#item", "inteiro_nao_negativo"))
        self.assertEqual(c["tipo"]["coluna"], "#rotulo")
        self.assertEqual(c["ativo"]["coluna"], "=~0")   # inativa e presumida: o cliente confere antes de ligar
        via = next(x for x in self.mapa["colunas_decl"] if x["tabela"] == "RIPARAM" and x["coluna"] == "#item")["via"]
        rot = dict(p.split("=") for p in via.split("desdobrar:")[1].split(";")[0].split(","))
        self.assertEqual(set(rot), {"PRONT", "REGISTRO", "PRTANT", "REGANT", "PRT_OTMU", "PRTA_OTMU"})
        for col, tipo in rot.items():   # nome de negócio, nunca o nome da coluna da origem (regra 1)
            self.assertTrue(tipo.startswith("origem_internacao_") and tipo[18:] != col.lower() and "otmu" not in tipo,
                            col)
        # os tipos não colidem com os contadores da recepção (REPARAM, L6-02) na UNIQUE (estabelecimento, tipo)
        rec = next(x for x in self.mapa["colunas_decl"] if x["tabela"] == "REPARAM" and x["coluna"] == "#item")["via"]
        self.assertFalse(set(rot.values()) & {p.split("=")[1] for p in rec.split("desdobrar:")[1].split(";")[0].split(",")})


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  UTI   adulto ".encode("cp1252")), ("UTI adulto", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", b" A "), ("A", None))
        self.assertEqual(a("codigo_char", b"a  "), ("a", None))
        self.assertEqual(a("codigo_char", b" A"), (" A", None))
        self.assertEqual(sentinela.colisoes_caixa(["A", "a", "B", "UTI"]), [["A", "a"]])
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(a("faixa:1,99", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("faixa:0,150", 200), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("faixa:0,150", 12), (12, None))
        self.assertEqual(a("faixa:1,999", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("preenchido", "2026-01-07"), (True, None))
        self.assertEqual(sentinela.periodo_em_dias(18, "ano"), (6570, "periodo_aproximado"))
        self.assertEqual(sentinela.periodo_em_dias(30, "dia"), (30, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_14.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertFalse((DESCARTADAS | FORA) & set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], l6_14.DESDOBRADAS.get(t, e["gravados"]) + recusas, t)
