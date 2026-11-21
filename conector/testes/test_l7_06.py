"""Fatia L7-06 (suprimentos, módulo SUP: cadastros de estoque, compras e fornecedores): declarações planejadas, regras
das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L7-06`."""
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_06

TABELAS = set(l7_06.CARREGADAS)
NA_IMAGEM = TABELAS | set(l7_06.DESCARTADAS)
DESTINOS = {
    "GENIVELSERV": "nivel_servico", "GEPADRAO_DATAMATRIX_QRCODE": "padrao_leitura_codigo",
    "GEPORTALCOMPRAS": "portal_cotacao", "GEREFER": "categoria_contabil_insumo",
    "GESITUACAOPED": "situacao_pedido_compra", "GETPLANCTO": "tipo_movimento_estoque",
    "TBCATEGO": "categoria_fornecimento", "TBFABOPM": "fabricante", "TBGRUPOUNIDADEMEDIDA": "grupo_unidade_medida",
    "TBLABORA": "fabricante", "TBSITUACAOFARMACIA": "situacao_farmaceutica",
    "GELOCUSU": "local_estoque_usuario", "GEUSERS": "local_estoque_usuario", "GESUBGRU": "subgrupo_insumo",
    "PRPARVARUNIRESP": "unidade_resposta", "TBFORNEC": "empresa_fornecedora",
    "TBCATFOR": "empresa_fornecedora_categoria", "TBFORNECTEL": "empresa_fornecedora_contato",
    "GEBARRAS": "insumo_codigo_barras", "GESALDOS": "insumo", "GESALCON": "insumo"}
# destinos secundários (rodada 2 da cobertura): conta do credor e trilha da entidade (um valor da origem por linha)
TRILHA = "trilha_auditoria"
SECUNDARIOS = {"TBFORNEC": ["conta_bancaria_credor", TRILHA], "GEREFER": [TRILHA], "GESALDOS": [TRILHA],
               "GESALCON": [TRILHA]}
# âncora no insumo sem coluna alterada (`complementa`): insumo nunca visto recusa a linha com pai_inexistente
COMPLEMENTA = {"GESALDOS", "GESALCON"}
# cadastros simples da primeira rodada: código pela chave (texto)
COM_CODIGO = {"GENIVELSERV", "GEPADRAO_DATAMATRIX_QRCODE", "GEPORTALCOMPRAS", "GEREFER", "GESITUACAOPED",
              "GETPLANCTO", "TBCATEGO", "TBGRUPOUNIDADEMEDIDA", "TBSITUACAOFARMACIA"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "nivel_servico": {"codigo", "descricao", "percentual_nivel_servico", "fator_seguranca"},
    "padrao_leitura_codigo": {"codigo", "descricao", "simbologia"}, "portal_cotacao": {"codigo", "descricao"},
    "categoria_contabil_insumo": {"codigo", "descricao"}, "situacao_pedido_compra": {"codigo", "descricao"},
    "tipo_movimento_estoque": {"codigo", "descricao", "natureza", "sentido"},
    "categoria_fornecimento": {"codigo", "descricao"}, "fabricante": {"nome"},
    "grupo_unidade_medida": {"codigo", "descricao", "grandeza"}, "situacao_farmaceutica": {"codigo", "descricao"},
    "local_estoque_usuario": {"local_estoque_id", "usuario_id"},
    "subgrupo_insumo": {"grupo_insumo_id", "codigo", "descricao"}, "unidade_resposta": {"codigo", "descricao", "sigla"},
    "empresa_fornecedora": {"tipo_pessoa", "razao_social"},
    "empresa_fornecedora_categoria": {"empresa_fornecedora_id", "categoria_fornecimento_id"},
    "empresa_fornecedora_contato": {"empresa_fornecedora_id", "sequencia", "finalidade"},
    "insumo_codigo_barras": {"insumo_id", "sequencia", "codigo_barras", "unidade_medida_id"}, "insumo": {"id"},
    TRILHA: {"ocorrido_em", "acao", "entidade", "entidade_id", "motivo", "dados_depois"},
    "conta_bancaria_credor": {"empresa_fornecedora_id", "banco_id", "numero_conta", "titular_nome",
                              "titular_documento"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}
        cls.decl = [c for c in cls.mapa["colunas_decl"] if c["tabela"] in NA_IMAGEM]

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt] + SECUNDARIOS.get(t, []), t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)
        for t, dts in SECUNDARIOS.items():
            for dt in dts:
                self.assertTrue(OBRIGATORIAS[dt] <= {c["destino"] for c in self.plano[t]["colunas"][dt]}, (t, dt))

    def test_toda_coluna_da_origem_declarada_com_motivo(self):
        por = {}
        for c in self.decl:
            por.setdefault(c["tabela"], set()).add(c["coluna"])
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
        for t in NA_IMAGEM:
            self.assertTrue({n for n, _, _ in l7_06.colunas(t)} <= por[t], t)

    def test_descartadas_sem_destino_e_com_causa_de_produto(self):
        for c in self.decl:
            if c["tabela"] in l7_06.DESCARTADAS:
                self.assertFalse(c["destino"], (c["tabela"], c["coluna"]))
        import os
        from pathlib import Path
        dm = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)
        sc = {d["tabela"]: d for d in mapa.ler_tsv(dm / "declarado/sem_carga.tsv")}
        for t in l7_06.DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "duplicado", "licenciado", "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t]["motivo"].strip(), t)

    def via(self, t, dc):
        """`via` declarada da coluna de destino `dc` da tabela `t`."""
        return next(c for c in self.decl if c["tabela"] == t and c["destino"] == DESTINOS[t] + "." + dc)["via"]

    def test_par_local_usuario_adotado_entre_as_duas_origens(self):
        for t, col in (("GELOCUSU", "ARM"), ("GEUSERS", "LOC_ARM")):
            self.assertEqual(self.cols(t)["local_estoque_id"]["coluna"], col)
            self.assertIn("adotar:local_estoque_id,usuario_id", self.via(t, "local_estoque_id"))
            self.assertEqual(self.cols(t)["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(self.plano["GEUSERS"]["opcoes"]["local_estoque_usuario"]["adotar"],
                         ["local_estoque_id", "usuario_id"])
        self.assertEqual(self.cols("GEUSERS")["padrao"]["coluna"], "=1")

    def test_fornecedor(self):
        c = self.cols("TBFORNEC")
        self.assertEqual((c["cnpj"]["regra"], c["cpf"]["regra"]), ("cnpj", "cpf"))
        self.assertEqual(self.plano["TBFORNEC"]["opcoes"]["empresa_fornecedora"]["adotar"], ["cnpj"])
        self.assertEqual(c["tipo_pessoa"]["valores"], {"J": "juridica", "F": "fisica", "j": "juridica", "f": "fisica"})
        self.assertEqual(c["disponibilidade"]["passos"][0]["tabela"], "TBDISPON")
        self.assertEqual(c["disponibilidade"]["passos"][1]["coluna"], "NOME")
        self.assertTrue(set(c["disponibilidade"]["valores"].values()) <= {"comercial", "plantao_24h", "sob_demanda"})
        self.assertEqual(c["municipio_ibge_id"]["depara"], "ibge_municipio")
        self.assertEqual(c["cep"]["regra"], "inteiro_zeros_esquerda:8")
        # conta do credor só com CONTA preenchida e diferente de zero (desdobrar no secundário); retenções na trilha
        op = self.plano["TBFORNEC"]["opcoes"]
        self.assertEqual(op["conta_bancaria_credor"]["desdobrar"], [("CONTA", "corrente")])
        cc = {c["destino"]: c for c in self.plano["TBFORNEC"]["colunas"]["conta_bancaria_credor"]}
        self.assertEqual((cc["numero_conta"]["coluna"], cc["numero_conta"]["regra"]), ("#item", "inteiro_zero_nulo"))
        self.assertEqual(cc["banco_id"]["depara"], "banco")
        self.assertEqual(cc["titular_documento"]["regra"], "cpf_cnpj")
        self.assertEqual(cc["empresa_fornecedora_id"]["coluna"], "@id")
        ret = dict(op[TRILHA]["desdobrar"])
        self.assertTrue({"ALIQISS", "COFINS", "CSLL", "PIS", "ALIQUOTA_IR", "ALIQINSS"} <= set(ret))
        tr = {c["destino"]: c for c in self.plano["TBFORNEC"]["colunas"][TRILHA]}
        self.assertEqual(tr["dados_depois"]["regra"], "decimal_zero_nulo")
        self.assertEqual(tr["entidade"]["coluna"], "=empresa_fornecedora")

    def test_historico_e_consignado_na_trilha_do_insumo(self):
        for t in COMPLEMENTA:
            self.assertTrue(self.plano[t]["opcoes"]["insumo"]["complementa"], t)
            self.assertEqual(self.cols(t)["id"]["referencia"], "GEITENS")
            self.assertEqual(set(self.cols(t)), {"id"})  # nada do insumo é alterado
            tr = {c["destino"]: c["coluna"] for c in self.plano[t]["colunas"][TRILHA]}
            self.assertEqual((tr["entidade"], tr["entidade_id"]), ("=insumo", "@id"))
        self.assertEqual([r for _, r in self.plano["GESALDOS"]["opcoes"][TRILHA]["desdobrar"]],
                         ["saldo_mensal_quantidade", "saldo_mensal_valor", "saldo_mensal_estoque_medio"])
        tr = {c["destino"]: c["coluna"] for c in self.plano["GESALDOS"]["colunas"][TRILHA]}
        self.assertEqual(tr["ocorrido_em"], "#data:ANO,MES")
        # o retrato do consignado leva o fornecedor (sem destino próprio: saldo_consignado exige o local)
        self.assertIn("FORN", self.plano["GESALCON"]["retrato"])
        self.assertIn("QTDE", self.plano["GESALCON"]["retrato"])

    def test_conta_contabil_antiga_na_trilha_da_categoria(self):
        op = self.plano["GEREFER"]["opcoes"][TRILHA]
        self.assertEqual(op["desdobrar"], [("CTA_EMP", "conta_contabil_empresa"), ("COD_OPE", "operacao_contabil")])

    def test_referencias_novas(self):
        cb = self.cols("GEBARRAS")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in cb["unidade_medida_id"]["passos"]],
                         ["GEITENS", "UNI_ARM", "TBUNICON"])
        self.assertEqual(cb["sequencia"]["coluna"], "#seq:ITEM")
        self.assertEqual(self.cols("GESUBGRU")["codigo"]["coluna"], "#codigo_derivado:NOME:30")
        self.assertEqual(self.cols("GESUBGRU")["grupo_insumo_id"]["referencia"], "GEGRUPOS")
        u = self.cols("PRPARVARUNIRESP")
        self.assertEqual(u["codigo"]["coluna"], "#codigo_derivado:ID:30:var_")
        self.assertEqual(u["sigla"]["regra"], "texto_resumo:20")
        self.assertEqual(self.cols("TBFORNECTEL")["finalidade"]["coluna"], "=~outro")
        self.assertIn("adotar:empresa_fornecedora_id,categoria_fornecimento_id", self.via("TBCATFOR",
                                                                                         "empresa_fornecedora_id"))

    def test_credenciais_e_licenciado_nunca_carregados(self):
        fora = {("GEUSERS", "SENHA"), ("GEUSERS", "OLD_SENHA"), ("GEUSERS", "EMAIL_SERV"), ("GEUSERS", "PORTA_SMTP"),
                ("TBLABORA", "COD_LAB_BRASINDICE"), ("GEUSERS", "EMAIL_USER"), ("GEUSERS", "ASSINATURA")}
        for c in self.decl:
            if (c["tabela"], c["coluna"]) in fora:
                self.assertFalse(c["destino"], c["coluna"])
        self.assertNotIn("codigo_tabela_referencia", self.cols("TBLABORA"))
        # integração L7: CNPJ do fabricante pela regra de documento (zeros à esquerda e dígito verificador)
        self.assertEqual(self.cols("TBFABOPM")["cnpj"]["regra"], "cnpj")

    def test_codigo_texto_e_booleanos(self):
        for t in COM_CODIGO:
            if DESTINOS[t] != "fabricante":
                self.assertEqual(self.cols(t)["codigo"]["regra"], "texto", t)
        self.assertEqual(self.cols("GEREFER")["consignado"]["regra"], "booleano_sn")
        self.assertEqual(self.cols("TBSITUACAOFARMACIA")["ativo"]["regra"], "booleano_sn")

    def test_presumidos_e_literais(self):
        tm = self.cols("GETPLANCTO")
        # presunção neutra: não movimenta saldo até o cliente classificar (CHECK afeta_saldo = sentido <> neutro)
        self.assertEqual(tm["natureza"]["coluna"], "=~ajuste")
        self.assertEqual(tm["sentido"]["coluna"], "=~neutro")
        self.assertEqual(tm["afeta_saldo"]["coluna"], "=~0")
        self.assertEqual(self.cols("GEPADRAO_DATAMATRIX_QRCODE")["simbologia"]["coluna"], "=~gs1_datamatrix")
        self.assertEqual(self.cols("TBGRUPOUNIDADEMEDIDA")["grandeza"]["coluna"], "=~outro")
        self.assertEqual(self.cols("TBFABOPM")["fabricante_opme"]["coluna"], "=1")
        self.assertNotIn("fabricante_opme", self.cols("TBLABORA"))

    def test_indicadores_sem_origem_presumidos(self):
        # nada que muda o comportamento do sistema fica com o padrão do destino em silêncio: literal presumido (=~)
        esperado = {
            "TBSITUACAOFARMACIA": {"permite_dispensacao": "=~0", "encerra_item": "=~0"},
            "GESITUACAOPED": {"permite_alteracao": "=~0", "permite_recebimento": "=~0", "situacao_final": "=~0"},
            "TBFABOPM": {"situacao_sanitaria": "=~regular", "origem_fabricacao": "=~nacional"},
            "TBLABORA": {"situacao_sanitaria": "=~regular", "origem_fabricacao": "=~nacional"},
            "TBCATEGO": {"tipo": "=~outro"}, "GEPORTALCOMPRAS": {"tipo_integracao": "=~manual"}}
        for t, cols in esperado.items():
            c = self.cols(t)
            for d, lit in cols.items():
                self.assertEqual(c[d]["coluna"], lit, (t, d))

    def test_nivel_servico_descricao_pelo_percentual(self):
        c = self.cols("GENIVELSERV")
        self.assertEqual(c["descricao"]["coluna"], "NIVEL_SERVICO")
        self.assertEqual(c["percentual_nivel_servico"]["regra"], "decimal")


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", "  Laboratório   dois  ".encode("cp1252")), ("Laboratório dois", None))
        self.assertEqual(a("texto", "  Padrão  QR exemplo  ".encode("cp1252")), ("Padrão  QR exemplo", None))
        self.assertEqual(a("texto", "   ".encode("cp1252")), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("decimal", decimal.Decimal("1.645")), (decimal.Decimal("1.645"), None))
        # documento da mesma coluna: CNPJ e CPF falsos válidos só na regra do seu tipo
        self.assertEqual(a("cnpj", l7_06.CNPJ_A), ("%014d" % l7_06.CNPJ_A, None))
        self.assertEqual(a("cpf", l7_06.CNPJ_A), (None, "documento_invalido"))
        self.assertEqual(a("cpf", l7_06.CPF_A), ("%011d" % l7_06.CPF_A, None))
        self.assertEqual(a("cnpj", l7_06.CPF_A), (None, "documento_invalido"))
        self.assertEqual(a("inteiro_zeros_esquerda:8", 1310100), ("01310100", None))
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "var_"), ("var_1", False))
        self.assertTrue(carga_mapa.codigo_derivado("Subgrupo de nome comprido demais ex", 30)[1])

    def test_literais_tipados_no_destino(self):
        self.assertEqual(carga_mapa.tipar("0", "tinyint"), 0)
        self.assertEqual(carga_mapa.tipar(decimal.Decimal("95.00"), "varchar"), "95.00")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            pref = ("restricao_destino_", "pai_pendente") + (("pai_inexistente",) if t in COMPLEMENTA else ())
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(pref))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
            presumidas = sum(1 for c in mapa.carregar_execucao()["colunas_decl"]
                             if c["tabela"] == t and c["destino"] and c["coluna"].startswith("=~"))
            # valor_presumido: uma por coluna presumida em cada linha que chega à gravação (inclusive a recusada)
            # a linha recusada por pai_pendente não chega aos valores: sem valor_presumido
            self.assertEqual(e["pendencias"].get("valor_presumido", 0),
                             (cont[t] - e["pendencias"].get("pai_pendente", 0)) * presumidas, t)
        for t in l7_06.DESCARTADAS:
            self.assertEqual(cont[t], 3 if t == "TBDISPON" else 2, t)

    def test_linhas_com_o_numero_de_colunas_do_ddl(self):
        def conferir(t, v):
            self.assertEqual(len(v), len(l7_06.colunas(t)), t)
        l7_06.linhas(random.Random(1), conferir)

    def test_ddl_so_das_tabelas_da_fatia(self):
        import re
        criadas = set(re.findall(r"CREATE TABLE (\w+) \(", l7_06.DDL))
        self.assertEqual(criadas, NA_IMAGEM)


if __name__ == "__main__":
    unittest.main()
