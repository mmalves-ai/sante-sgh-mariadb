"""Fatia L8-11 (financeiro: bancos, borderô, centro de custo, cliente, tipos de ajuste, módulo FIN): declarações
planejadas, regras das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a
conciliação rodam em `conector.sh conferir-fatia L8-11`."""
import datetime
import decimal
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_11

TABELAS = set(l8_11.CARREGADAS)
BLOQUEADAS = set(l8_11.NAO_CARREGADAS)
DESTINO = {"TBAGEBAN": "agencia_bancaria", "TBCTABAN": "conta_bancaria", "MFBORDER": "bordero_pagamento",
           "MFCTAUSU": "permissao_conta_bancaria", "TBCENCUS": "centro_custo", "TBCLIENT": "cliente_financeiro",
           "MFREFDES": "tipo_ajuste_titulo", "TBGRUDES": "grupo_natureza_financeira", "MFADIFOR": "adiantamento",
           "MFLANCTO": "movimento_bancario", "MFSALATU": "saldo_diario_conta", "MFSALDOS": "saldo_diario_conta"}
# obrigatórias do destino (NOT NULL sem padrão, fora id/criado_em/origem), conferidas contra o DDL da fatia
OBRIGATORIAS = {"agencia_bancaria": {"banco_id", "codigo_agencia"},
                "conta_bancaria": {"estabelecimento_id", "codigo", "descricao", "tipo"},
                "bordero_pagamento": {"estabelecimento_id", "numero", "conta_bancaria_id", "data_pagamento",
                                      "data_emissao"},
                "permissao_conta_bancaria": {"usuario_id", "conta_bancaria_id", "estabelecimento_id"},
                "centro_custo": {"estabelecimento_id", "codigo", "nome", "vigencia_inicio"},
                "cliente_financeiro": {"tipo_pessoa", "nome"},
                "tipo_ajuste_titulo": {"codigo", "descricao", "natureza"},
                "grupo_natureza_financeira": {"codigo", "nome", "tipo"},
                "adiantamento": {"estabelecimento_id", "numero", "tipo_credor", "data_emissao", "valor"},
                "movimento_bancario": {"estabelecimento_id", "conta_bancaria_id", "tipo_lancamento_bancario_id",
                                       "natureza", "data_movimento", "historico", "valor"},
                "saldo_diario_conta": {"conta_bancaria_id", "data_saldo", "operacao", "ocorrido_em"}}


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
            self.assertEqual(self.plano[t]["destinos"], [dt] + (["tipo_lancamento_bancario"] if t == "MFLANCTO" else []),
                             t)

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

    def test_adiantamento_credor_pelo_tipo(self):
        a = self.cols("MFADIFOR")
        self.assertEqual(self.pares("MFADIFOR", "TIPO_CREDOR"), {("F", "fornecedor"), ("M", "profissional")})
        self.assertEqual((a["empresa_fornecedora_id"]["coluna"], a["empresa_fornecedora_id"]["referencia"]),
                         ("COD", "TBFORNEC"))
        # profissional pela inscrição ligada ao adiantamento, e dela o profissional (encadeada)
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in a["profissional_id"]["passos"]],
                         ["MFADIFOR_TBCBOPRO", "ID_TBCBOPRO", "TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"])
        self.assertEqual(a["conta_bancaria_id"]["passos"], [{"tabela": "TBCTABAN", "modo": "alt", "arg": "ID_CTABAN"}])
        # a conta vem primeiro: conta recusada recusa a linha antes das outras colunas
        self.assertEqual(self.plano["MFADIFOR"]["colunas"]["adiantamento"][0]["destino"], "conta_bancaria_id")
        self.assertEqual((a["numero"]["coluna"], a["valor_pago"]["regra"]), ("ID_MFADIFOR", "decimal_nao_negativo"))
        # rodada 5 (ADR 0006): o vínculo com a inscrição carrega como complemento do adiantamento
        v = self.plano["MFADIFOR_TBCBOPRO"]["colunas"]["adiantamento"]
        self.assertEqual({c["destino"] for c in v}, {"id", "profissional_id"})
        # pago com data de pagamento; saldo a compensar = pago até a compensação carregar
        self.assertEqual(self.pares("MFADIFOR", "DT_PGTO"), {("1", "pago")})
        self.assertEqual((a["situacao"]["coluna"], a["situacao"]["regra"]), ("DT_PGTO", "preenchido"))
        self.assertEqual((a["saldo_compensar"]["coluna"], a["saldo_compensar"]["regra"]),
                         ("PAGO", "decimal_nao_negativo"))

    def test_lancamento_um_movimento_por_lado(self):
        p = self.plano["MFLANCTO"]
        op = p["opcoes"]["movimento_bancario"]
        self.assertEqual([r for _, r in op["desdobrar"]], ["credito", "debito"])
        self.assertEqual([x for x, _ in op["desdobrar"]], ["ID_TBCTABAN_CRE+CDC_CRE", "ID_TBCTABAN_DEV+CDC_DEB"])
        c = {x["coluna"]: x for x in p["colunas"]["movimento_bancario"]}
        self.assertEqual((c["#item"]["regra"], c["#item"]["referencia"]), ("chave_origem", "TBCTABAN"))
        self.assertEqual(c["#item2"]["referencia"], "TBCENCUS")
        self.assertEqual(c["#rotulo"]["destino"], "natureza")
        m = {x["destino"]: x["coluna"] for x in p["colunas"]["movimento_bancario"]}
        self.assertEqual((m["compensado"], m["data_compensacao"]), ("=1", "DATA"))  # histórico realizado
        # histórico vazio: texto fixo concorrente (vale a primeira coluna com valor)
        self.assertEqual([x["coluna"][:1] or x["coluna"] for x in p["colunas"]["movimento_bancario"]
                          if x["destino"] == "historico"], ["H", "="])
        # tipo de migração por empresa, gravado antes e usado pelas outras linhas do grupo
        t = p["opcoes"]["tipo_lancamento_bancario"]
        self.assertEqual(t["agrupar"], ["EMPRESA"])
        self.assertTrue(t["antes"])
        tc = {x["destino"]: x["coluna"] for x in p["colunas"]["tipo_lancamento_bancario"]}
        self.assertEqual((tc["sentido"], tc["transferencia"], tc["ativo"]), ("=transferencia", "=1", "=0"))
        self.assertEqual(c["@id:tipo_lancamento_bancario"]["destino"], "tipo_lancamento_bancario_id")
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "migracao_"), ("migracao_1", False))

    def test_saldos(self):
        for t in ("MFSALDOS", "MFSALATU"):
            c = {x["destino"]: x for x in self.plano[t]["colunas"]["saldo_diario_conta"]}
            self.assertEqual(c["operacao"]["coluna"], "=inclusao", t)
            self.assertEqual(c["conta_bancaria_id"]["referencia"], "TBCTABAN", t)
        c = {x["destino"]: x["coluna"] for x in self.plano["MFSALATU"]["colunas"]["saldo_diario_conta"]}
        self.assertEqual((c["data_saldo"], c["ocorrido_em"]), ("=@data_carga", "=@data_carga"))
        self.assertEqual(c["saldo_anterior"], "=~0")
        self.assertNotIn("fechado", c)  # o dia da carga continua aberto
        c = {x["destino"]: x["coluna"] for x in self.plano["MFSALDOS"]["colunas"]["saldo_diario_conta"]}
        self.assertEqual((c["fechado"], c["saldo_anterior"]), ("=1", "=~0"))  # dia histórico fechado

    def test_titulo_a_receber_ativo(self):
        p = self.plano["MFCTAREC"]
        self.assertEqual(p["destinos"][0], "parcela_receber")
        self.assertTrue({"titulo_receber", "tipo_documento_financeiro"} <= set(p["destinos"]))
        self.assertIn("agrupar", (p.get("opcoes") or {}).get("titulo_receber") or {})

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
                          if k.startswith(("restricao_destino_", "pai_pendente", "codigo_colisao_caixa",
                                           "sem_item_a_gravar")))
            recusas += l8_11.RECUSAS_POR_DOMINIO.get(t, 0)
            # principal desdobrado: "gravados" conta itens; a linha conta uma vez
            self.assertEqual(cont[t], l8_11.LINHAS_COM_ITEM.get(t, e["gravados"]) + recusas, t)

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



class ProvaIndicadorNifR5(unittest.TestCase):
    """Rodada 5 (revisão): TBINDNIF não é copiada (indicador oficial = domínio beneficiario_exterior.indicador_nif);
    a prova compara código E descrição, e cada valor pareado existe no CHECK do modelo."""

    def test_prova_codigo_e_rotulo_no_dominio(self):
        import re as _re
        base = Path(mapa.__file__).resolve().parents[1] / "mapa"
        pv = {p["tabela"]: p for p in mapa.ler_provas(base)}["TBINDNIF"]
        self.assertEqual((pv["tipo"], pv["chave"], pv["valores"]), ("derivado", ["ID"], [("ID", "inteiro"), ("DESCRICAO", "texto_nome")]))
        pares = _re.findall(r"SELECT (\d+) AS item, '([^']*)' AS valor_produto, '[^']+' AS rotulo", pv["sql"])
        self.assertEqual([int(k) for k, _ in pares], [1, 2, 3])
        ddl = ""
        for r in (Path(mapa.__file__).resolve().parents[2], Path("/app")):
            if (r / "db" / "migracoes").is_dir():
                ddl = "\n".join(p.read_text(encoding="utf-8") for p in sorted((r / "db" / "migracoes").rglob("*.sql")))
                break
        ck = _re.search(r"ck_beneficiario_exterior_indicador_nif CHECK \((.*)\)", ddl)
        self.assertIsNotNone(ck)
        for _, v in pares:
            self.assertIn("'%s'" % v, ck.group(1))

if __name__ == "__main__":
    unittest.main()
