"""Fatia L7-06 (suprimentos, módulo SUP: cadastros de estoque, compras e fornecedores): declarações planejadas, regras
das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L7-06`."""
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_06

TABELAS = set(l7_06.CARREGADAS)
NA_IMAGEM = TABELAS | set(l7_06.NAO_CARREGADAS)
DESTINOS = {
    "GENIVELSERV": "nivel_servico", "GEPADRAO_DATAMATRIX_QRCODE": "padrao_leitura_codigo",
    "GEPORTALCOMPRAS": "portal_cotacao", "GEREFER": "categoria_contabil_insumo",
    "GESITUACAOPED": "situacao_pedido_compra", "GETPLANCTO": "tipo_movimento_estoque",
    "TBCATEGO": "categoria_fornecimento", "TBFABOPM": "fabricante", "TBGRUPOUNIDADEMEDIDA": "grupo_unidade_medida",
    "TBLABORA": "fabricante", "TBSITUACAOFARMACIA": "situacao_farmaceutica"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "nivel_servico": {"codigo", "descricao", "percentual_nivel_servico", "fator_seguranca"},
    "padrao_leitura_codigo": {"codigo", "descricao", "simbologia"}, "portal_cotacao": {"codigo", "descricao"},
    "categoria_contabil_insumo": {"codigo", "descricao"}, "situacao_pedido_compra": {"codigo", "descricao"},
    "tipo_movimento_estoque": {"codigo", "descricao", "natureza", "sentido"},
    "categoria_fornecimento": {"codigo", "descricao"}, "fabricante": {"nome"},
    "grupo_unidade_medida": {"codigo", "descricao", "grandeza"}, "situacao_farmaceutica": {"codigo", "descricao"}}


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
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)

    def test_toda_coluna_da_origem_declarada_com_motivo(self):
        por = {}
        for c in self.decl:
            por.setdefault(c["tabela"], set()).add(c["coluna"])
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
        for t in NA_IMAGEM:
            self.assertTrue({n for n, _, _ in l7_06.colunas(t)} <= por[t], t)

    def test_nao_carregadas_sem_destino(self):
        for c in self.decl:
            if c["tabela"] in l7_06.NAO_CARREGADAS:
                self.assertFalse(c["destino"], (c["tabela"], c["coluna"]))

    def test_credenciais_e_licenciado_nunca_carregados(self):
        fora = {("GEUSERS", "SENHA"), ("GEUSERS", "OLD_SENHA"), ("GEUSERS", "EMAIL_SERV"), ("GEUSERS", "PORTA_SMTP"),
                ("TBLABORA", "COD_LAB_BRASINDICE"), ("TBFORNEC", "CGC")}
        for c in self.decl:
            if (c["tabela"], c["coluna"]) in fora:
                self.assertFalse(c["destino"], c["coluna"])
        self.assertNotIn("codigo_tabela_referencia", self.cols("TBLABORA"))
        # integração L7: CNPJ do fabricante pela regra de documento (zeros à esquerda e dígito verificador)
        self.assertEqual(self.cols("TBFABOPM")["cnpj"]["regra"], "cnpj")

    def test_codigo_texto_e_booleanos(self):
        for t in DESTINOS:
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

    def test_literais_tipados_no_destino(self):
        self.assertEqual(carga_mapa.tipar("0", "tinyint"), 0)
        self.assertEqual(carga_mapa.tipar(decimal.Decimal("95.00"), "varchar"), "95.00")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
            presumidas = sum(1 for c in mapa.carregar_execucao()["colunas_decl"]
                             if c["tabela"] == t and c["destino"] and c["coluna"].startswith("=~"))
            # valor_presumido: uma por coluna presumida em cada linha que chega à gravação (inclusive a recusada)
            self.assertEqual(e["pendencias"].get("valor_presumido", 0), cont[t] * presumidas, t)
        for t in l7_06.NAO_CARREGADAS:
            self.assertEqual(cont[t], 2, t)

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
