"""Fatia L8-12 (faturamento e restantes, módulo FIN): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l8_12.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_12

CARREGADAS = ["TBOBSREC", "TBORGAOPUBLICO", "TBORIGEMRECEBIMENTO", "TBCADPAG", "TBTIPOLANCVLR", "TBTIPOPAGFOR",
              "TBTPCONTA", "TBBANCOS", "TBNATOPE", "SDGECADNFS", "TBTPOCORBANCOPGTO", "TBUNIMEN", "TBITEDES", "MFCONPAG",
              "MFCONPAG_TBCBOPRO", "MFCCCONV", "MFPAGADF", "MFPARAM_MFTIPOLANC", "MFDESACR", "SDMFCONPAG"]
# títulos a pagar (rodada 4): vários destinos por linha (parcela principal, título agrupado, tipo de documento, baixa)
VARIOS_DESTINOS = {"MFCONPAG": {"parcela_pagar", "titulo_pagar", "tipo_documento_financeiro", "baixa_titulo"}}
# nenhuma tabela da fatia fica sem mecanismo nem esperando decisão (rodada de cobertura total)
AGUARDAM = []
# descartes de produto (declarado/sem_carga.tsv): domínio fixo do produto, parâmetros do software antigo ou duplicado
# (MFPARAM e TBINTIMP são da L8-11, que os revisou na rodada 3: não são mais conferidos aqui)
DESCARTES = {"TBTIPOCARTAO": "mecanismo_do_produto", "TBTIPOTAXACARTAO": "mecanismo_do_produto",
             "TBTIPOPERMISSAO": "mecanismo_do_produto", "TBTPNATOPENF": "mecanismo_do_produto"}
# NOT NULL sem padrão e sem fonte na origem, de propósito (nenhuma desde a rodada de cobertura)
SEM_FONTE = set()
# destino complementado (UPDATE da linha do pai): as obrigatórias são do pai
COMPLEMENTA = {("SDGECADNFS", "nota_entrada")}
DECL = Path(__file__).resolve().parents[1] / "mapa/declarado/colunas.d/L8-12.tsv"
VALORES = Path(__file__).resolve().parents[1] / "mapa/declarado/valores.d/L8-12.tsv"
SEM_CARGA = Path(__file__).resolve().parents[1] / "mapa/declarado/sem_carga.tsv"


def l8_12_esperado():
    return l8_12.linhas(None, lambda t, v: None)


def _mapa():
    try:
        return mapa.carregar_execucao()
    except FileNotFoundError:
        return None


def _raiz_ddl():
    for r in (Path(__file__).resolve().parents[2], Path("/app")):
        if (r / "db/migracoes").is_dir():
            return r
    return None


class Plano(unittest.TestCase):
    def setUp(self):
        self.m = _mapa()
        if self.m is None:
            self.skipTest("mapa do conector ausente")
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + AGUARDAM + list(DESCARTES)))
        self.por = {p["tabela"]: p for p in self.plano}

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela(self):
        """Destinos transacionais (meio_recebimento_particular, retorno_bancario_item) não recebem catálogo."""
        for p in self.plano:
            if p["tabela"] in VARIOS_DESTINOS:
                self.assertEqual(set(p["destinos"]), VARIOS_DESTINOS[p["tabela"]], p["tabela"])
                continue
            self.assertEqual(len(p["destinos"]), 1, p["tabela"])
        self.assertEqual(self.por["MFCONPAG"]["destinos"][0], "parcela_pagar")
        self.assertEqual(self.por["MFDESACR"]["destinos"], ["ajuste_titulo"])
        self.assertEqual(self.por["TBCADPAG"]["destinos"], ["forma_recebimento"])
        self.assertEqual(self.por["TBTPOCORBANCOPGTO"]["destinos"], ["ocorrencia_bancaria"])
        self.assertEqual(self.por["MFCCCONV"]["destinos"], ["credito_fonte_pagadora"])
        self.assertEqual(self.por["SDGECADNFS"]["destinos"], ["nota_entrada"])
        self.assertTrue(self.por["SDGECADNFS"]["opcoes"]["nota_entrada"]["complementa"])

    @staticmethod
    def _arquivo(rel):
        for r in (Path(__file__).resolve().parents[1] / "mapa", Path("/app/mapa")):
            if (r / rel).is_file():
                return (r / rel).read_text().splitlines()
        raise unittest.SkipTest("declarações ausentes")

    def _decl(self, tab, destino):
        """Linhas declaradas (coluna, regra, via) para tabela.destino, na ordem do arquivo da fatia."""
        return [(x[1], x[3], x[5]) for x in (l.split("\t") for l in self._arquivo("declarado/colunas.d/L8-12.tsv"))
                if len(x) > 5 and x[0] == tab and x[2] == destino]

    def test_contas_a_pagar_pela_medicao(self):
        """Rodada 4 (medição só de contagens): TP_LAN 0 = a pagar; DT_PGTO sentinela = aberta; a compensação liga à
        baixa da própria parcela (sem baixa em dobro); a natureza do ajuste é o próprio TPDES_ACR."""
        nat = self._decl("MFCONPAG", "titulo_pagar.natureza_financeira_id")
        self.assertEqual(len(nat), 1)
        self.assertIn("=0)>max:VALOR", nat[0][2])
        sit = self._decl("MFCONPAG", "parcela_pagar.situacao")
        self.assertEqual([c[0] for c in sit], ["=aberta", "=paga"])
        self.assertIn("se:DT_PGTO=1899-12-30", sit[0][2])
        self.assertTrue(self.por["MFCONPAG"]["opcoes"]["baixa_titulo"]["opcional"])
        self.assertEqual([c[1] for c in self._decl("MFCONPAG", "baixa_titulo.valor_pago")], ["decimal_zero_nulo"])
        self.assertEqual(self.por["MFPAGADF"]["destinos"], ["compensacao_adiantamento"])
        self.assertEqual(self._decl("MFPAGADF", "compensacao_adiantamento.baixa_titulo_id")[0][2],
                         "ref:MFCONPAG/baixa_titulo")
        pag = self._decl("MFDESACR", "ajuste_titulo.parcela_pagar_id")[0][2]
        rec = self._decl("MFDESACR", "ajuste_titulo.parcela_receber_id")[0][2]
        self.assertTrue(pag.endswith(";se:TP_LAN=0"))
        self.assertTrue(rec.startswith("ref:MFCTAREC.") and rec.endswith(";se:TP_LAN=1"))
        self.assertEqual(self._decl("MFDESACR", "ajuste_titulo.tipo_ajuste_titulo_id"), [])

    def test_natureza_do_ajuste_cobre_0_a_13(self):
        pares = {l.split("\t")[3]: l.split("\t")[4] for l in self._arquivo("declarado/valores.d/L8-12.tsv")
                 if l.startswith("MFDESACR\tTPDES_ACR\tajuste_titulo.tipo\t")}
        self.assertEqual(set(pares), {str(k) for k in range(14)})
        self.assertEqual((pares["0"], pares["1"]), ("desconto", "acrescimo"))
        self.assertEqual({pares[str(k)] for k in range(2, 14)}, {"abatimento"})

    def test_codigo_numerico_vira_texto(self):
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                if c["destino"] == "codigo":
                    self.assertIn(c["regra"], ("texto", "codigo_char"), p["tabela"])

    def test_banco_pelo_catalogo_oficial(self):
        c = [x for x in self.por["TBTPOCORBANCOPGTO"]["colunas"]["ocorrencia_bancaria"] if x["destino"] == "banco_id"]
        self.assertEqual(c[0]["depara"], "banco")

    def test_presumidos_marcados(self):
        """Onde a origem tem o valor mas não há de-para, o padrão do destino nunca fica em silêncio: o literal é
        presumido (=~), e cada linha leva valor_presumido para o cliente revisar no painel."""
        for t, dt, dest, lit in (("TBTPCONTA", "tipo_conta_bancaria", "natureza", "=~corrente"),
                                 ("TBTPOCORBANCOPGTO", "ocorrencia_bancaria", "efeito", "=~informativo"),
                                 ("TBNATOPE", "natureza_operacao", "tipo_nota", "=~ambos"),
                                 ("TBCADPAG", "forma_recebimento", "uso", "=~ambos"),
                                 ("TBUNIMEN", "unidade_mensuracao_custo", "categoria", "=~outro"),
                                 ("TBORGAOPUBLICO", "orgao_arrecadador", "esfera", "=~federal"),
                                 ("MFCCCONV", "credito_fonte_pagadora", "situacao", "=~aplicado")):
            cs = [c for c in self.por[t]["colunas"][dt] if c["destino"] == dest]
            # TBTPCONTA: a descrição pelo de-para vem antes; o literal presumido é a sobra (coluna concorrente)
            self.assertEqual([c["coluna"] for c in cs], ["DESCRICAO", lit] if t == "TBTPCONTA" else [lit], t)
            pend = l8_12_esperado()[t]["pendencias"]
            n = len([d for d in l8_12.DADOS if d[0] == t][0][1])
            # toda linha, salvo as recusadas antes por pai_pendente
            if t == "TBTPCONTA":  # rodada 4 (pedido 25): o literal concorrente só presume onde a descrição não casou
                self.assertEqual(pend.get("valor_presumido"), 1, t)
                continue
            self.assertEqual(pend.get("valor_presumido"), n - pend.get("pai_pendente", 0), t)

    def test_empresa_do_financeiro_e_a_mantenedora(self):
        """A EMPRESA do financeiro é a mantenedora (medição da L8-11): o estabelecimento é o único do cliente
        (@estabelecimento; vários: estabelecimento_indefinido), nunca a referência ao cadastro de estabelecimentos."""
        decl = mapa.ler_tsv(DECL)
        for t, col in (("MFPARAM_MFTIPOLANC", "EMPRESA_MFPARAM"), ("MFCCCONV", "EMPRESA"), ("TBBANCOS", "EMPRESA")):
            c = [x for x in decl if x["tabela"] == t and x["coluna"] == col][0]
            self.assertEqual(c["destino"], "", t)
            e = [x for x in decl if x["tabela"] == t and x["coluna"] == "@estabelecimento"]
            self.assertEqual(len(e), 1, t)
            self.assertTrue(e[0]["destino"].endswith(".estabelecimento_id"), t)
        self.assertFalse([x for x in decl if "ref:TBHOSPIT" in x["via"]])
        self.assertEqual(self.por["MFPARAM_MFTIPOLANC"]["opcoes"]["tipo_lancamento_estabelecimento"]["adotar"],
                         ["estabelecimento_id", "tipo_credor_id"])

    def test_contrato_de_cobranca(self):
        """TBBANCOS carrega o contrato de cobrança: um por código de beneficiário (cobrança registrada e débito
        automático), ligado à conta pela chave alternativa composta (empresa, banco, agência, número)."""
        p = self.por["TBBANCOS"]
        self.assertEqual(p["destinos"], ["contrato_cobranca_bancaria"])
        op = p["opcoes"]["contrato_cobranca_bancaria"]
        self.assertTrue(op.get("desdobrar"))
        cs = {c["destino"]: c for c in p["colunas"]["contrato_cobranca_bancaria"]}
        self.assertEqual(cs["conta_bancaria_id"]["passos"][0]["tabela"], "TBCTABAN")
        self.assertEqual(cs["conta_bancaria_id"]["passos"][0]["arg"], ["EMPRESA", "BANCO", "AGENCIA", "COD"])
        self.assertEqual(cs["situacao"]["depara"], "valores")
        pares = {(r["tabela"], r["coluna"], r["valor_origem"]): r["valor_destino"] for r in mapa.ler_tsv(VALORES)}
        self.assertEqual(pares[("TBBANCOS", "SITUACAO", "I")], "suspenso")
        for w, nat in (("Corrente", "corrente"), ("APLICAÇÃO", "aplicacao"), ("Poupança", "poupanca")):
            self.assertEqual(pares[("TBTPCONTA", "DESCRICAO", w)], nat)

    def test_subgrupo_pela_chave_composta(self):
        c = [x for x in self.por["TBITEDES"]["colunas"]["natureza_financeira"]
             if x["destino"] == "subgrupo_natureza_financeira_id"][0]
        self.assertEqual(c["passos"][0]["modo"], "composta")
        self.assertEqual(c["passos"][0]["arg"], ["GRUPO", "SUBGRUPO"])

    def test_credito_historico_sem_saldo(self):
        """O crédito histórico (sem identificação na origem) entra aplicado e coerente: valor_aplicado = valor e
        situação 'aplicado' PRESUMIDA (valor_presumido por linha); o código DEV não vai a destino nenhum."""
        cs = {x["destino"]: x for x in self.por["MFCCCONV"]["colunas"]["credito_fonte_pagadora"]}
        self.assertEqual(cs["valor"]["coluna"], "VALOR")
        self.assertEqual(cs["valor_aplicado"]["coluna"], "VALOR")
        self.assertEqual(cs["situacao"]["coluna"], "=~aplicado")
        self.assertNotIn("DEV", {x["coluna"] for x in cs.values()})
        decl = {(c["tabela"], c["coluna"]): c for c in mapa.ler_tsv(DECL)}
        self.assertEqual(mapa.referencia_declarada(decl[("MFCCCONV", "COD")]), "TBCONVEN")

    def test_tipo_da_natureza_pelo_grupo(self):
        """O tipo (receita ou despesa) vem da classificação do grupo (TBGRUDES.CLASSIF) pela referência encadeada;
        DESPESA (nulo, E, P na referência) não é S/N e fica sem destino."""
        cs = self.por["TBITEDES"]["colunas"]["natureza_financeira"]
        tipo = [c for c in cs if c["destino"] == "tipo"][0]
        self.assertEqual(tipo["coluna"], "GRUPO")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in tipo["passos"]], ["TBGRUDES", "CLASSIF"])
        self.assertEqual(tipo["valores"], {"D": "despesa", "R": "receita"})
        self.assertNotIn("DESPESA", {c["coluna"] for c in cs})
        decl = {(c["tabela"], c["coluna"]): c for c in mapa.ler_tsv(DECL)}
        self.assertEqual(decl[("TBITEDES", "CDC")]["destino"], "natureza_financeira.centro_custo_id")
        self.assertEqual(mapa.referencia_declarada(decl[("TBITEDES", "CDC")]), "TBCENCUS")
        prov = [c for c in cs if c["destino"] == "provisiona"][0]
        self.assertEqual(prov["valores"], {"F": "0", "N": "0"})  # provisão ligada: padrão falso com pendência
        self.assertNotIn("tipo_provisao", {c["destino"] for c in cs})

    def test_modelo_da_nota_pelo_codigo_oficial(self):
        cs = self.por["SDGECADNFS"]["colunas"]["nota_entrada"]
        mod = [c for c in cs if c["destino"] == "modelo_documento"][0]
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in mod["passos"]], ["SDTIPODOCTO", "CODIGO"])
        self.assertEqual(mod["valores"]["55"], "nfe")
        self.assertEqual(mod["valores"]["2D"], "cupom_fiscal")
        self.assertEqual(mod["valores"]["01"], "nf_papel")

    def test_complemento_da_nota_depende_da_l7_08(self):
        """A nota (GECADNFS) não é pai externo da sintética enquanto a L7-08 não a declara: a conferência mostra o
        efeito real (toda linha do complemento recusada por pai_inexistente)."""
        self.assertNotIn("GECADNFS", l8_12.PAIS_EXTERNOS)
        esp = l8_12_esperado()["SDGECADNFS"]
        n = len([d for d in l8_12.DADOS if d[0] == "SDGECADNFS"][0][1])
        self.assertEqual(esp, {"gravados": 0, "pendencias": {"pai_inexistente": n}})

    def test_de_para_de_valores(self):
        pares = {(v["tabela"], v["coluna"], v["valor_origem"]): v["valor_destino"] for v in mapa.ler_tsv(VALORES)}
        self.assertEqual(pares[("TBITEDES", "GRUPO", "D")], "despesa")
        self.assertEqual(pares[("TBITEDES", "GRUPO", "R")], "receita")
        self.assertEqual(pares[("TBITEDES", "REC_NAO_OPER", "S")], "0")
        self.assertEqual(pares[("TBITEDES", "TIPO_CUSTO", "V")], "variavel")
        self.assertEqual(pares[("TBNATOPE", "ID_TBTPNATOPENF", "")], "outra")
        self.assertEqual(pares[("TBNATOPE", "ID_TBTPNATOPENF", "2")], "simples_remessa")
        self.assertEqual(pares[("TBNATOPE", "ID_TBTPNATOPENF", "3")], "venda")
        self.assertNotIn(("MFCCCONV", "DEV", "S"), pares)
        self.assertNotIn(("TBITEDES", "DESPESA", "S"), pares)

    def test_obrigatorias_do_destino_cobertas(self):
        """Toda coluna NOT NULL sem padrão do destino é declarada, salvo as sem fonte registradas (SEM_FONTE)."""
        raiz = _raiz_ddl()
        if raiz is None:
            self.skipTest("DDL do modelo ausente")
        ddl = mapa.ler_ddl(raiz)
        livres = {"id", "criado_em"}
        for p in self.plano:
            dt = p["destinos"][0]
            if (p["tabela"], dt) in COMPLEMENTA:
                continue
            decl = {c["destino"] for c in p["colunas"][dt]}
            for linha in ddl[dt]["create"].splitlines()[1:]:
                x = linha.strip().split()
                if len(x) < 2 or not re.fullmatch(r"[a-z_0-9]+", x[0]) or x[0] in livres:
                    continue
                corpo = linha.upper()
                if "NOT NULL" in corpo and "DEFAULT" not in corpo and "AUTO_INCREMENT" not in corpo:
                    if (dt, x[0]) in SEM_FONTE:
                        self.assertNotIn(x[0], decl)
                    else:
                        self.assertIn(x[0], decl, "%s.%s" % (dt, x[0]))

    def test_toda_coluna_bloqueada_tem_motivo(self):
        decl = mapa.ler_tsv(DECL)
        for t in AGUARDAM:
            cs = [c for c in decl if c["tabela"] == t]
            self.assertTrue(cs, t)
            for c in cs:
                self.assertEqual(c["destino"], "", "%s.%s" % (t, c["coluna"]))
                self.assertTrue(c["motivo"].startswith("L8-12: "), t)
        for c in decl:
            self.assertTrue(c["motivo"].startswith("L8-12: "), "%s.%s" % (c["tabela"], c["coluna"]))
        for c in decl:
            self.assertNotIn("por ora", c["motivo"], "%s.%s" % (c["tabela"], c["coluna"]))
            self.assertNotIn("sem mecanismo", c["motivo"], "%s.%s" % (c["tabela"], c["coluna"]))

    def test_descartes_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(SEM_CARGA)}
        decl = {c["tabela"] for c in mapa.ler_tsv(DECL)}
        self.assertFalse([r for r in mapa.ler_tsv(Path(__file__).resolve().parents[1] / "mapa/declarado/colunas.tsv")
                          if r["tabela"] == "TBBANCOS"])
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L8-12: "), t)
            self.assertNotIn(t, decl)
            self.assertNotIn(t, self.por)


class Regras(unittest.TestCase):
    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("texto_nome", "Cartão  débito".encode("cp1252")), ("Cartão débito", None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", b"N"), (False, None))
        v, regra = a("cnpj", l8_12.cnpj_falso(123456780001))
        self.assertIsNone(regra)
        self.assertEqual(len(v), 14)
        self.assertEqual(a("cnpj", 12345678000100)[1], "documento_invalido")

    def test_cnpj_falso_valido(self):
        for b in (123456780001, 987654320001, 111222330001):
            self.assertEqual(str(l8_12.cnpj_falso(b)).zfill(14)[:12], "%012d" % b)


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_12.linhas(None, lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(sorted(esp), sorted(CARREGADAS))
        compl = {t for t, _ in COMPLEMENTA}
        itens_a_mais = {"TBBANCOS": 1}  # desdobrado: o cadastro 1 grava dois contratos (gravados = itens)
        for t, e in esp.items():
            # no complemento, o pai não carregado recusa a linha (pai_inexistente)
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r in ("codigo_colisao_caixa", "pai_pendente",
                                                                         "sem_item_a_gravar")
                          or (t in compl and r == "pai_inexistente"))
            self.assertEqual(cont[t], e["gravados"] - itens_a_mais.get(t, 0) + recusas, t)
        for t in AGUARDAM + list(DESCARTES):
            if t in PROVADAS_R5:  # rodada 5: lista provada entra na imagem para a prova rodar
                self.assertIn("CREATE TABLE %s " % t, l8_12.DDL)
                continue
            self.assertNotIn("CREATE TABLE %s " % t, l8_12.DDL)



# ---- rodada 5 (ADR 0006, item 1): prova de "não copiar" das listas fixas ----
PROVADAS_R5 = ['TBTIPOCARTAO', 'TBTIPOTAXACARTAO', 'TBTIPOPERMISSAO', 'TBTPNATOPENF']


class ProvaListaFixaR5(unittest.TestCase):
    """Cada lista fixa provada tem a linha em declarado/provas.tsv e o SQL em provas.d/<T>.sql; cada valor do produto
    pareado com um item existe no domínio do modelo (CHECK da coluna, ou a coluna, quando não há CHECK)."""

    @classmethod
    def setUpClass(cls):
        import re as _re
        base = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado"
        cls.provas = {p["tabela"]: p for p in mapa.ler_provas(base.parent)}
        cls.sem_carga = {r["tabela"]: r for r in mapa.ler_tsv(base / "sem_carga.tsv")}
        ddl = ""
        for r in (Path(mapa.__file__).resolve().parents[2], Path("/app")):
            if (r / "db" / "migracoes").is_dir():
                ddl = "\n".join(p.read_text(encoding="utf-8") for p in sorted((r / "db" / "migracoes").rglob("*.sql")))
                break
        cls.ddl, cls.re = ddl, _re

    def _bloco(self, tabela):
        m = self.re.search(r"CREATE TABLE %s \((.*?)\n\)" % tabela, self.ddl, self.re.S)
        self.assertIsNotNone(m, tabela)
        return m.group(1)

    def test_prova_declarada_e_dominio_do_produto(self):
        for t in PROVADAS_R5:
            pv = self.provas.get(t)
            self.assertIsNotNone(pv, t)
            self.assertEqual((pv["tipo"], pv["chave"], [c for c, _ in pv["valores"]][:1], len(pv["valores"])),
                             ("derivado", ["ID"], ["ID"], 2), t)
            self.assertEqual(pv["valores"][1][1], "texto_nome", t)  # rodada 5 (revisão): código E rótulo
            self.assertTrue(self.re.findall(r"AS valor_produto, '[^']+' AS rotulo", pv["sql"]), t)
            self.assertEqual(self.sem_carga[t]["situacao"], "descarte", t)
            m = self.re.search(r"domínio do produto \((\w+)\.(\w+),", pv["sql"])
            self.assertIsNotNone(m, t)
            tabela, coluna = m.groups()
            pares = self.re.findall(r"SELECT (\d+) AS item, '([^']*)' AS valor_produto", pv["sql"])
            self.assertTrue(pares, t)
            self.assertEqual([int(k) for k, _ in pares], list(range(1, len(pares) + 1)), t)
            bloco = self._bloco(tabela)
            self.assertRegex(bloco, r"\n\s+%s\s" % coluna, (t, coluna))
            checks = [c for c in self.re.findall(r"CONSTRAINT \w+ CHECK \((.*)\),?\n", bloco)
                      if self.re.search(r"\b%s\b" % coluna, c) and "'" in c]
            for _, v in pares:
                if checks:
                    self.assertTrue(any("'%s'" % v in c for c in checks), (t, v))
                else:
                    self.assertRegex(v, r"^\d+$", (t, v))  # coluna numérica ou booleana sem CHECK de lista

if __name__ == "__main__":
    unittest.main()
