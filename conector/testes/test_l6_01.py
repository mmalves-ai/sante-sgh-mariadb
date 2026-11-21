"""Fatia L6-01 (recepção, módulo REC): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-01`.
"""
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_01

FATIA = set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS)


class PlanoL601(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_declaradas_entram_na_carga(self):
        self.assertEqual(len(FATIA), 19)
        self.assertEqual((len(l6_01.CARREGADAS), len(l6_01.DESCARTADAS), len(l6_01.SEM_CARGA)), (15, 4, 0))
        self.assertEqual(set(self.plano), set(l6_01.CARREGADAS))

    def test_ordem_do_mapa_pai_antes(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        for filho in ("RECONFIC", "REESPFIC", "REUNIFIC", "REGRPFIC", "RETITFIC"):
            self.assertLess(ordem.index("REMODFIC"), ordem.index(filho))

    def test_criterio_da_regra_carrega_depois_do_pai(self):
        # sem a dependência declarada, o critério ficaria NULL e a regra valeria para todos
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if (r.get("ordem") or "").isdigit()}
        deps = {(d["tabela"], d["depende_de"]) for d in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/dependencias.tsv")}
        for filho, pai in [("RECONFIC", "TBCONVEN"), ("REESPFIC", "TBESPEC"), ("REUNIFIC", "TBUNIDAD")]:
            self.assertLess(ordem[pai], ordem[filho], (filho, pai))
        self.assertLessEqual({("RECONFIC", "TBCONVEN"), ("REESPFIC", "TBESPEC")}, deps)

    def test_regra_de_impressao_pelo_modelo_de_chave_composta(self):
        for t, col, dc, pai in [("RECONFIC", "CONV", "fonte_pagadora_id", "TBCONVEN"),
                                ("REESPFIC", "ESP", "especialidade_medica_id", "TBESPEC"),
                                ("REUNIFIC", "UNID", "unidade_assistencial_id", "TBUNIDAD")]:
            cs = self.cols(t, "regra_impressao_ficha")
            m = cs["modelo_ficha_impressa_id"]
            self.assertEqual(m["passos"], [{"tabela": "REMODFIC", "modo": "composta", "arg": ["COD", "GRAFICA"]}])
            self.assertIn("GRAFICA", self.plano[t]["lidas"])
            self.assertEqual((cs[dc]["coluna"], cs[dc]["referencia"], cs[dc]["regra"]), (col, pai, "chave_origem"))
            self.assertEqual(cs["selecionada_padrao"]["regra"], "booleano_sn")

    def test_criterio_sem_pai_deixa_a_regra_inativa(self):
        # NULL no critério quer dizer 'todos': sem o pai na origem, a regra não pode entrar ativa
        for t, col, pai in [("RECONFIC", "CONV", "TBCONVEN"), ("REESPFIC", "ESP", "TBESPEC"),
                            ("REUNIFIC", "UNID", "TBUNIDAD")]:
            at = [c for c in self.plano[t]["colunas"]["regra_impressao_ficha"] if c["destino"] == "ativo"]
            self.assertEqual([c["coluna"] for c in at], [col, "=0"], t)
            self.assertEqual(at[0]["regra"], "preenchido")
            self.assertEqual(at[0]["passos"][0]["tabela"], pai)
            self.assertEqual(at[0]["passos"][-1].get("coluna"), "COD")
        self.assertEqual(sentinela.aplicar("preenchido", 9), (True, None))

    def test_modelo_entra_inativo_com_aviso(self):
        cs = self.cols("REMODFIC", "modelo_ficha_impressa")
        self.assertEqual(cs["ativo"]["coluna"], "=0")
        self.assertTrue(cs["conteudo"]["coluna"].startswith("="))
        self.assertEqual(cs["tipo_documento"]["coluna"], "=~outro")
        self.assertEqual(cs["copias"]["regra"], "faixa:1,9")
        self.assertEqual(cs["ordem"]["regra"], "inteiro_nao_negativo")
        self.assertEqual(cs["formulario_pre_impresso"]["coluna"], "GRAFICA")

    def test_regra_por_grupo_entra_inativa(self):
        cs = self.cols("REGRPFIC", "regra_impressao_ficha")
        self.assertEqual(cs["ativo"]["coluna"], "=~0")
        self.assertNotIn("grupo_faturamento_id", cs)
        self.assertIn("GRP", self.plano["REGRPFIC"]["chave"])

    def test_procedencia_por_depara_de_valores(self):
        cs = self.cols("TBPROCED", "procedencia")
        self.assertEqual(cs["ativo"]["valores"], {"S": "1", "A": "1", "N": "0", "I": "0"})
        tp = cs["tipo_padrao"]
        self.assertEqual((tp["regra"], tp["passos"][0]["tabela"], tp["passos"][-1].get("coluna")),
                         ("texto_nome", "TBPROCEDPADRAO", "NOME"))
        v = tp["valores"]
        self.assertEqual(v[""], "")
        for nome, tipo in [("Residência", "residencia"), ("RESIDENCIA", "residencia"), ("Retorno", "retorno"),
                           ("DEMANDA ESPONTÂNEA", "demanda_espontanea"), ("Encaminhado", "referenciada"),
                           ("Via pública", "via_publica"), ("Judicial", "judicial"), ("Outros", "outro")]:
            self.assertEqual(v[nome], tipo, nome)
        dominio = {"residencia", "retorno", "demanda_espontanea", "referenciada", "via_publica", "judicial", "outro"}
        self.assertEqual(set(v.values()) - {""}, dominio)
        self.assertNotIn("Reconhecido", v)

    def test_codigos_numericos_viram_texto(self):
        for t, dt, col in [("PNTIPO", "tipo_painel", "ID"), ("REMODFIC", "modelo_ficha_impressa", "COD"),
                           ("RETPINDATEND", "tipo_indicacao", "ID"), ("TBACAOFLUXOSENHA", "acao_fluxo_senha", "ID"),
                           ("TBCADGRUPOATEN", "grupo_atendimento", "ID"),
                           ("TBGRUPOPRIORIDADE", "grupo_prioridade_legal", "ID"),
                           ("TBMODULO_RECEPCAO", "modulo_recepcao", "ID"), ("TBPROCED", "procedencia", "COD")]:
            c = self.cols(t, dt)["codigo"]
            self.assertEqual((c["coluna"], c["regra"]), (col, "texto"), t)

    def test_classificacao_sem_fonte_e_presumida(self):
        for t, dt, dc in [("PNTIPO", "tipo_painel", "finalidade"), ("RETPINDATEND", "tipo_indicacao", "categoria"),
                          ("TBACAOFLUXOSENHA", "acao_fluxo_senha", "encerra_senha"),
                          ("REMODFIC", "modelo_ficha_impressa", "tipo_documento")]:
            self.assertTrue(self.cols(t, dt)[dc]["coluna"].startswith("=~"), (t, dc))

    def test_descartes_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        causas = {"TBMOTEXC": "duplicado", "TBMOTCANCMOD": "sem_valor",
                  "TBMOTCANCTP": "mecanismo_do_produto", "TBPROCEDPADRAO": "mecanismo_do_produto"}
        self.assertEqual(set(causas), set(l6_01.DESCARTADAS))
        for t, causa in causas.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"], t)
        self.assertFalse(set(l6_01.SEM_CARGA) & set(sc))

    def test_exclusao_de_atendimento_vai_para_a_trilha(self):
        cs = self.cols("REEXCATE", "trilha_auditoria")
        self.assertEqual((cs["acao"]["coluna"], cs["entidade"]["coluna"]), ("=exclusao", "=atendimento"))
        self.assertNotIn("entidade_id", cs)
        self.assertEqual(cs["ocorrido_em"]["coluna"], "#data_hora:DTCANCEL,HRCANCEL")
        self.assertEqual(cs["dados_antes"]["coluna"], "#retrato:*")
        self.assertEqual((cs["usuario_id"]["referencia"], cs["usuario_id"]["regra"]), ("TBUSERS", "chave_origem"))
        self.assertEqual(cs["motivo"]["coluna"], "JUSTIF")

    def test_heranca_desdobrada_no_principal_com_falso(self):
        cs = self.cols("REPARATE", "regra_heranca_campo")
        self.assertEqual((cs["herda"]["coluna"], cs["herda"]["regra"]), ("#item", "booleano_sn"))
        self.assertEqual(cs["campo"]["coluna"], "#rotulo")
        op = self.plano["REPARATE"]["opcoes"]["regra_heranca_campo"]
        self.assertTrue(op.get("com_falso"))
        pares = dict(op["desdobrar"])
        self.assertEqual(len(pares), 23)
        self.assertEqual(set(pares), {c for c in l6_01.HERANCA if c != "POR_USUARIO"})
        self.assertEqual(len(set(pares.values())), 23)

    def test_titulo_impresso_prevalece_sobre_o_nome(self):
        tit = [c for c in self.plano["REMODFIC"]["colunas"]["modelo_ficha_impressa"] if c["destino"] == "titulo"]
        self.assertEqual([c["coluna"] for c in tit], ["COD", "NOME"])
        self.assertEqual(tit[0]["passos"][0], {"tabela": "RETITFIC", "modo": "composta", "arg": ["COD", "GRAFICA"]})
        self.assertEqual(tit[0]["passos"][1].get("coluna"), "NOME")
        self.assertEqual({c["regra"] for c in tit}, {"texto_nome"})

    def test_titulo_impresso_completa_o_modelo(self):
        # diferencial próprio: título alterado na origem fica para o Sincronizar (a origem vence)
        cs = self.plano["RETITFIC"]["colunas"]["modelo_ficha_impressa"]
        self.assertTrue(self.plano["RETITFIC"]["opcoes"]["modelo_ficha_impressa"]["complementa"])
        idc = next(c for c in cs if c["destino"] == "id")
        self.assertEqual(idc["passos"], [{"tabela": "REMODFIC", "modo": "composta", "arg": ["COD", "GRAFICA"]}])
        tit = [c for c in cs if c["destino"] == "titulo"]
        self.assertEqual([c["coluna"] for c in tit], ["NOME", "COD"])
        self.assertEqual(tit[1]["passos"][-1].get("coluna"), "NOME")

    def test_nao_carregadas_sem_destino_e_com_motivo(self):
        decl = {}
        for c in self.m["colunas_decl"]:
            decl.setdefault(c["tabela"], []).append(c)
        for t in l6_01.NAO_CARREGADAS:
            self.assertTrue(decl.get(t), t)
            for c in decl[t]:
                self.assertEqual(c.get("destino") or "", "", t)
                self.assertTrue((c.get("motivo") or "").startswith("L6-01:"), t)


class RegrasL601(unittest.TestCase):
    def test_zero_e_sem_valor(self):
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 12), (12, None))

    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Painel  de   senhas".encode("cp1252"))[0], "Painel de senhas")
        self.assertEqual(sentinela.aplicar("texto_nome", b"  "), (None, None))

    def test_texto_preserva_quebra_interna(self):
        v, _ = sentinela.aplicar("texto", "  Encaminhar\r\npara outro guichê ".encode("cp1252"))
        self.assertEqual(v, "Encaminhar\r\npara outro guichê")

    def test_sn_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_faixa_e_nao_negativo(self):
        self.assertEqual(sentinela.aplicar("faixa:1,9", 12)[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("faixa:1,9", 0)[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("faixa:1,9", 3), (3, None))
        self.assertEqual(sentinela.aplicar("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))

    def test_codigo_numerico_como_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))


class ImagemL601(unittest.TestCase):
    def test_esperado_cobre_so_as_carregadas(self):
        linhas = []
        esp = l6_01.linhas(__import__("random").Random(1), lambda t, v: linhas.append(t))
        self.assertEqual(set(esp), set(l6_01.CARREGADAS))
        self.assertEqual(set(linhas), set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS))
        self.assertEqual(sum(1 for t in linhas if t == "REMODFIC"), len(l6_01.MODELOS))

    def test_ddl_tem_as_19_tabelas(self):
        criadas = {x.split()[2] for x in l6_01.DDL.split(";") if x.strip().startswith("CREATE TABLE")}
        self.assertEqual(criadas, set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS))
