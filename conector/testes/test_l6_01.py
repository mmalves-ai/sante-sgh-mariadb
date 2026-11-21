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
        self.assertEqual((len(l6_01.CARREGADAS), len(l6_01.DESCARTADAS), len(l6_01.SEM_CARGA)), (12, 4, 3))
        self.assertEqual(set(self.plano), set(l6_01.CARREGADAS))

    def test_ordem_do_mapa_pai_antes(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        for filho in ("RECONFIC", "REESPFIC", "REUNIFIC", "REGRPFIC"):
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
        self.assertEqual(cs["tipo_padrao"]["valores"], {"": ""})

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
        for t in l6_01.SEM_CARGA:  # decisão tomada; só falta regra genérica no motor (pedidos no L6-01.json)
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", "regra_faltante"), t)

    def test_sem_carga_tem_declaracao_pronta_comentada(self):
        prontas = {}
        arq = mapa.DIR_PACOTE / "declarado/colunas.d/L6-01.tsv"
        for linha in arq.read_text(encoding="utf-8").splitlines()[1:]:
            t, col, destino, _, _, via, _ = linha.split("\t")
            if t.startswith("#"):
                prontas.setdefault(t[1:], {})[col] = {"destino": destino, "via": via}
        self.assertEqual(prontas["REEXCATE"]["=exclusao"]["destino"], "trilha_auditoria.acao")
        self.assertEqual(prontas["REEXCATE"]["#retrato"]["destino"], "trilha_auditoria.dados_antes")
        itens = prontas["REPARATE"]["#item"]["via"]
        self.assertEqual(len(itens.split(":", 1)[1].split(",")), 23)
        self.assertIn("complementa", prontas["RETITFIC"]["COD"]["via"])
        self.assertIn("ref:REMODFIC(COD,GRAFICA)", prontas["RETITFIC"]["COD"]["via"])

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
