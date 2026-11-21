"""Fatia L8-12 (faturamento e restantes, módulo FIN): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l8_12.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_12

CARREGADAS = ["TBOBSREC", "TBORGAOPUBLICO", "TBORIGEMRECEBIMENTO", "TBCADPAG", "TBTIPOLANCVLR",
              "TBTPCONTA", "TBNATOPE", "TBTPOCORBANCOPGTO", "TBUNIMEN"]
# bloqueadas ou que não viram linha (pedidos em docs/obra/fatias/f4/saida/L8-12.json)
AGUARDAM = ["MFPARAM_MFTIPOLANC", "TBINTIMP", "TBITEDES", "MFPARAM", "MFCCCONV", "TBTIPOCARTAO", "TBTIPOPAGFOR", "TBTIPOPERMISSAO",
            "TBTIPOTAXACARTAO", "TBTPNATOPENF", "SDGECADNFS"]
# NOT NULL sem padrão e sem fonte na origem, de propósito: a linha é recusada (1364) até o de-para do cliente
SEM_FONTE = {("orgao_arrecadador", "esfera")}
DECL = Path(__file__).resolve().parents[1] / "mapa/declarado/colunas.d/L8-12.tsv"


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
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + AGUARDAM))
        self.por = {p["tabela"]: p for p in self.plano}

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela(self):
        """Destinos transacionais (meio_recebimento_particular, retorno_bancario_item) não recebem catálogo."""
        for p in self.plano:
            self.assertEqual(len(p["destinos"]), 1, p["tabela"])
        self.assertEqual(self.por["TBCADPAG"]["destinos"], ["forma_recebimento"])
        self.assertEqual(self.por["TBTPOCORBANCOPGTO"]["destinos"], ["ocorrencia_bancaria"])

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
                                 ("TBUNIMEN", "unidade_mensuracao_custo", "categoria", "=~outro")):
            cs = [c for c in self.por[t]["colunas"][dt] if c["destino"] == dest]
            self.assertEqual([c["coluna"] for c in cs], [lit], t)
            pend = l8_12_esperado()[t]["pendencias"]
            n = len([d for d in l8_12.DADOS if d[0] == t][0][1])
            # toda linha, salvo as recusadas antes por pai_pendente
            self.assertEqual(pend.get("valor_presumido"), n - pend.get("pai_pendente", 0), t)

    def test_empresa_sem_referencia_bloqueia(self):
        """Sem a referência EMPRESA -> estabelecimento (pedido 1), as habilitações por empresa não entram: nunca no
        estabelecimento errado."""
        self.assertNotIn("MFPARAM_MFTIPOLANC", self.por)
        self.assertNotIn("@estabelecimento", {c["coluna"] for c in mapa.ler_tsv(DECL)
                                              if c["tabela"] == "MFPARAM_MFTIPOLANC"})

    def test_obrigatorias_do_destino_cobertas(self):
        """Toda coluna NOT NULL sem padrão do destino é declarada, salvo as sem fonte registradas (SEM_FONTE)."""
        raiz = _raiz_ddl()
        if raiz is None:
            self.skipTest("DDL do modelo ausente")
        ddl = mapa.ler_ddl(raiz)
        livres = {"id", "criado_em"}
        for p in self.plano:
            dt = p["destinos"][0]
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
        self.assertNotIn("TBBANCOS", {c["tabela"] for c in decl})  # já em declarado/colunas.tsv (pedido 13)


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
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r in ("codigo_colisao_caixa", "pai_pendente"))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM + ["TBBANCOS"]:
            self.assertNotIn("CREATE TABLE %s " % t, l8_12.DDL)


if __name__ == "__main__":
    unittest.main()
