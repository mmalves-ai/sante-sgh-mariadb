"""Fatia L8-11 (financeiro: bancos, borderô, centro de custo, cliente, tipos de ajuste, módulo FIN): declarações
planejadas, regras das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a
conciliação rodam em `conector.sh conferir-fatia L8-11`."""
import datetime
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_11

TABELAS = set(l8_11.CARREGADAS)
BLOQUEADAS = set(l8_11.NAO_CARREGADAS)
DESTINO = {"TBAGEBAN": "agencia_bancaria", "TBCTABAN": "conta_bancaria", "MFBORDER": "bordero_pagamento",
           "MFCTAUSU": "permissao_conta_bancaria", "TBCENCUS": "centro_custo", "TBCLIENT": "cliente_financeiro",
           "MFREFDES": "tipo_ajuste_titulo", "TBGRUDES": "grupo_natureza_financeira"}
# obrigatórias do destino (NOT NULL sem padrão, fora id/criado_em/origem), conferidas contra o DDL da fatia
OBRIGATORIAS = {"agencia_bancaria": {"banco_id", "codigo_agencia"},
                "conta_bancaria": {"estabelecimento_id", "codigo", "descricao", "tipo"},
                "bordero_pagamento": {"estabelecimento_id", "numero", "conta_bancaria_id", "data_pagamento",
                                      "data_emissao"},
                "permissao_conta_bancaria": {"usuario_id", "conta_bancaria_id", "estabelecimento_id"},
                "centro_custo": {"estabelecimento_id", "codigo", "nome", "vigencia_inicio"},
                "cliente_financeiro": {"tipo_pessoa", "nome"},
                "tipo_ajuste_titulo": {"codigo", "descricao", "natureza"},
                "grupo_natureza_financeira": {"codigo", "nome", "tipo"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINO[t]]}

    def pares(self, t, coluna):
        return {(v["valor_origem"], v["valor_destino"]) for v in self.mapa["valores"]
                if v["tabela"] == t and v["coluna"] == coluna}

    def test_tabelas_e_destino_principal(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINO.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)

    def test_banco_pelo_codigo_de_compensacao_da_origem(self):
        for t in ("TBAGEBAN", "TBCTABAN"):
            c = self.cols(t)["banco_id"]
            self.assertEqual(c["depara"], "banco")
            self.assertEqual(c["passos"][0], {"tabela": "TBBANCOS", "modo": "composta", "arg": ["EMPRESA", "BANCO"]})
            self.assertEqual(c["passos"][-1], {"coluna": "CODBCOCENTRAL"})
        # a mesma agência (banco e número) em outra empresa é adotada, não duplicada
        self.assertEqual(self.plano["TBAGEBAN"]["opcoes"]["agencia_bancaria"]["adotar"], ["banco_id", "codigo_agencia"])
        self.assertEqual(self.cols("TBAGEBAN")["cep"]["regra"], "inteiro_zeros_esquerda:8")

    def test_conta(self):
        c = self.cols("TBCTABAN")
        self.assertEqual(c["agencia_bancaria_id"]["passos"][0]["arg"], ["EMPRESA", "BANCO", "AGENCIA"])
        self.assertEqual(c["limite_credito"]["regra"], "decimal_nao_negativo")
        for d in ("ultimo_cheque", "sequencia_remessa"):
            self.assertEqual(c[d]["regra"], "inteiro_nao_negativo", d)
        self.assertEqual(self.pares("TBCTABAN", "TP_CONTA"), {("C", "corrente"), ("A", "aplicacao")})
        self.assertEqual(self.pares("TBCTABAN", "SITUACAO"), {("A", "ativa"), ("I", "bloqueada")})
        self.assertNotIn("remessa_bancaria", self.plano["TBCTABAN"]["destinos"])

    def test_bordero_permissao_e_centro_de_custo(self):
        b = self.cols("MFBORDER")
        self.assertEqual(b["situacao"]["coluna"], "=~processado")
        self.assertEqual(b["valor_total"]["regra"], "decimal_nao_negativo")
        p = self.cols("MFCTAUSU")
        self.assertEqual(p["usuario_id"]["passos"], [{"tabela": "TBUSERS", "modo": "alt", "arg": "ID_TBUSERS"}])
        # a permissão aponta a conta pelo número interno ID_CTABAN (medido: 4628 de 4628), não pelo ID
        self.assertEqual(p["conta_bancaria_id"]["passos"], [{"tabela": "TBCTABAN", "modo": "alt", "arg": "ID_CTABAN"}])
        self.assertEqual(p["pode_movimentar"]["coluna"], "=~1")  # presumido: o cliente revisa
        self.assertEqual(b["conta_bancaria_id"]["coluna"], "ID_TBCTABAN")  # o borderô aponta pelo ID
        self.assertNotIn("passos", b["conta_bancaria_id"])
        for t in ("TBCTABAN", "MFBORDER", "MFCTAUSU", "TBCENCUS"):  # EMPRESA é a mantenedora, não o estabelecimento
            self.assertEqual(self.cols(t)["estabelecimento_id"]["coluna"], "@estabelecimento", t)
        cc = self.cols("TBCENCUS")
        self.assertEqual(cc["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(cc["ativo"]["regra"], "booleano_ai")
        self.assertEqual((cc["codigo"]["coluna"], cc["codigo_externo"]["coluna"]), ("COD", "COD_APURASUS"))
        self.assertEqual(cc["unidade_mensuracao_custo_id"]["referencia"], "TBUNIMEN")
        g = self.cols("TBGRUDES")
        self.assertEqual((g["centro_custo_id"]["coluna"], g["centro_custo_id"]["referencia"]), ("CDC", "TBCENCUS"))

    def test_cliente_e_tipo_de_ajuste(self):
        c = self.cols("TBCLIENT")
        self.assertEqual((c["cpf"]["regra"], c["cnpj"]["regra"]), ("cpf", "cnpj"))
        self.assertEqual(self.pares("TBCLIENT", "PESSOA"), {("F", "fisica"), ("J", "juridica")})
        self.assertEqual(c["municipio_ibge_id"]["depara"], "ibge_municipio")
        a = self.cols("MFREFDES")
        self.assertEqual((a["natureza"]["coluna"], a["natureza"]["depara"]), ("TIPO", "valores"))
        nat = self.pares("MFREFDES", "TIPO")
        self.assertEqual({d for _, d in nat}, {"desconto", "acrescimo", "retencao"})
        self.assertIn(("0", "desconto"), nat)
        self.assertIn(("1", "acrescimo"), nat)
        self.assertNotIn("16", {v for v, _ in nat})  # sem evidência: fica fora do domínio (visível)
        # o mesmo código em outra empresa é recusado pela chave única, nunca adotado em silêncio
        self.assertEqual(self.plano["MFREFDES"]["opcoes"]["tipo_ajuste_titulo"]["adotar"], [])
        self.assertEqual(a["codigo_receita"]["regra"], "inteiro_zeros_esquerda:4")
        self.assertEqual(a["natureza_financeira_id"]["passos"][0],
                         {"tabela": "TBITEDES", "modo": "composta", "arg": ["GRUPO", "SUBGRUPO", "ITEM"]})
        for d in ("aplica_pagar", "aplica_receber"):
            self.assertEqual(a[d]["coluna"], "=~1", d)

    def test_grupo_pelo_de_para(self):
        c = self.cols("TBGRUDES")
        self.assertEqual((c["tipo"]["coluna"], c["tipo"]["depara"]), ("CLASSIF", "valores"))
        self.assertNotIn("compoe_custo", c)  # domínio da origem não é S/N: fica o padrão
        self.assertEqual(self.pares("TBGRUDES", "CLASSIF"), {("D", "despesa"), ("R", "receita")})

    def test_bloqueadas_sem_destino(self):
        # dependem de regra genérica do motor (docs/obra/fatias/f4/saida/L8-11.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"Z")[1], "valor_fora_do_dominio")
        self.assertEqual(a("texto_nome", "Despesas  com pessoal".encode("cp1252")), ("Despesas com pessoal", None))
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", 0), (0, None))
        self.assertEqual(a("decimal_nao_negativo", decimal.Decimal("-50.00")), (None, "valor_fora_do_dominio"))
        self.assertIsNone(a("decimal_nao_negativo", decimal.Decimal("0.00"))[1])
        self.assertEqual(a("inteiro_zeros_esquerda:8", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zeros_esquerda:8", 1234567), ("01234567", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))

    def test_documento_pelo_tipo(self):
        cpf, cnpj = l8_11.documento_falso(123456789, 11), l8_11.documento_falso(112223330001, 14)
        a = sentinela.aplicar
        self.assertEqual(a("cpf", cpf), (str(cpf), None))
        self.assertEqual(a("cnpj", cnpj), (str(cnpj), None))
        self.assertEqual(a("cpf", cnpj), (None, "documento_invalido"))
        self.assertEqual(a("cnpj", cpf), (None, "documento_invalido"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_11.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith(("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        f = l8_11.formas()
        self.assertEqual(set(f), TABELAS | BLOQUEADAS | set(l8_11.SO_ORIGEM))
        vistos = []
        l8_11.linhas(random.Random(2), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(f[t]), t)

    def test_anomalias_na_imagem(self):
        f = {t: [c for c, _, _ in fs] for t, fs in l8_11.formas().items()}
        lin = {}
        l8_11.linhas(random.Random(4), lambda t, v: lin.setdefault(t, []).append(dict(zip(f[t], v))))
        self.assertTrue(any(c["ULTIMO_CHEQUE"] < 0 for c in lin["TBCTABAN"]))
        self.assertTrue(any(c["NUMERO_SEQ_REMESSA_COBRANCA"] < 0 for c in lin["TBCTABAN"]))
        ag = [(a["BANCO"], a["COD"]) for a in lin["TBAGEBAN"]]
        self.assertGreater(len(ag), len(set(ag)))  # a mesma agência em outra empresa
        self.assertTrue(any(b["CODBCOCENTRAL"] is None for b in lin["TBBANCOS"]))
        # chaves internas diferentes da chave do mapa, como na origem real (nenhuma referência por acaso)
        self.assertTrue(all(c["ID_CTABAN"] != c["ID"] for c in lin["TBCTABAN"]))
        self.assertTrue(all(c["ID"] != c["COD"] for c in lin["TBCENCUS"]))
        ids_ctaban = {c["ID"] for c in lin["TBCTABAN"]}
        self.assertFalse({u["ID_TBCTABAN"] for u in lin["MFCTAUSU"]} & ids_ctaban)


if __name__ == "__main__":
    unittest.main()
