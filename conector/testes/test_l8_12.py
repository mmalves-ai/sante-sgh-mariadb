"""Fatia L8-12 (faturamento e restantes, módulo FIN): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l8_12.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_12

CARREGADAS = ["TBITEDES", "MFPARAM_MFTIPOLANC", "TBOBSREC", "TBORGAOPUBLICO", "TBORIGEMRECEBIMENTO", "TBCADPAG",
              "MFCCCONV", "TBTIPOLANCVLR", "TBTIPOPAGFOR", "TBTPCONTA", "TBNATOPE", "SDGECADNFS", "TBTPOCORBANCOPGTO",
              "TBUNIMEN"]
# nenhuma tabela da fatia fica sem mecanismo nem esperando decisão (rodada de cobertura total)
AGUARDAM = []
# descartes de produto (declarado/sem_carga.tsv): domínio fixo do produto, parâmetros do software antigo ou duplicado
DESCARTES = {"MFPARAM": "mecanismo_do_produto", "TBTIPOCARTAO": "mecanismo_do_produto",
             "TBTIPOTAXACARTAO": "mecanismo_do_produto", "TBTIPOPERMISSAO": "mecanismo_do_produto",
             "TBTPNATOPENF": "mecanismo_do_produto", "TBINTIMP": "mecanismo_do_produto", "TBBANCOS": "duplicado"}
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
            self.assertEqual(len(p["destinos"]), 1, p["tabela"])
        self.assertEqual(self.por["TBCADPAG"]["destinos"], ["forma_recebimento"])
        self.assertEqual(self.por["TBTPOCORBANCOPGTO"]["destinos"], ["ocorrencia_bancaria"])
        self.assertEqual(self.por["MFCCCONV"]["destinos"], ["credito_fonte_pagadora"])
        self.assertEqual(self.por["SDGECADNFS"]["destinos"], ["nota_entrada"])
        self.assertTrue(self.por["SDGECADNFS"]["opcoes"]["nota_entrada"]["complementa"])

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
            self.assertEqual([c["coluna"] for c in cs], [lit], t)
            pend = l8_12_esperado()[t]["pendencias"]
            n = len([d for d in l8_12.DADOS if d[0] == t][0][1])
            # toda linha, salvo as recusadas antes por pai_pendente
            self.assertEqual(pend.get("valor_presumido"), n - pend.get("pai_pendente", 0), t)

    def test_empresa_pela_referencia_ao_estabelecimento(self):
        """A empresa da origem vira o estabelecimento pela referência (TBHOSPIT), nunca o estabelecimento único em
        silêncio: empresa sem estabelecimento recusa a linha (pai_inexistente no NOT NULL)."""
        decl = mapa.ler_tsv(DECL)
        for t, col in (("MFPARAM_MFTIPOLANC", "EMPRESA_MFPARAM"), ("MFCCCONV", "EMPRESA")):
            c = [x for x in decl if x["tabela"] == t and x["coluna"] == col][0]
            self.assertTrue(c["destino"].endswith(".estabelecimento_id"), t)
            self.assertEqual(mapa.referencia_declarada(c), "TBHOSPIT", t)
            self.assertNotIn("@estabelecimento", {x["coluna"] for x in decl if x["tabela"] == t})

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
        self.assertNotIn("TBBANCOS", {c["tabela"] for c in decl})  # descarte duplicado (sem_carga.tsv)
        self.assertNotIn("TBINTIMP", {c["tabela"] for c in decl})  # descarte de produto (sem_carga.tsv)
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
        for t, e in esp.items():
            # no complemento, o pai não carregado recusa a linha (pai_inexistente)
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r in ("codigo_colisao_caixa", "pai_pendente")
                          or (t in compl and r == "pai_inexistente"))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM + list(DESCARTES):
            self.assertNotIn("CREATE TABLE %s " % t, l8_12.DDL)


if __name__ == "__main__":
    unittest.main()
