"""Fatia L6-05 (prontuário, assinatura e assistência, PEP): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l6_05.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_05

CARREGADAS = ["GETABVIA", "PRAGRAVOTPARQUETIPO", "PRAGRAVOPERGUNTA", "PRBHINTENSIDADE", "PRBHTPELIMINA",
              "PRCAB_IDENTIFIC_PAC", "PRCAMPOSLOCALIZACAOPACIENTE", "PRFA_UTILIZACAO", "PRFILTROCLASSIF",
              "PRFILTROUSUARIO", "PRFINALIDADETRAT", "PRFORMULA"]
# aguardam regra genérica do motor ou decisão (pedidos em docs/obra/fatias/f4/saida/L6-05.json)
AGUARDAM = ["GECADANTIMI", "PRCADRESP", "PRDADOSENVIOOPERADORA", "PREMAILOPCAO", "PRFAVORITO_EXIBIR", "PRFICHAREL",
            "PRLAYIMPPRESC",
            # coluna clínica sem fonte na origem: presumir mudaria o sentido (sinal do balanço, papel de quem assina,
            # período do fechamento, aprazamento do medicamento); aguardam de-para de valores revisado
            "PRAGRUPBALANCO", "PRASSINANTE", "PRBHTIPOFECHAMENTO", "PRFREQUENCIA", "PRHRRELATIVA"]
PRESUMIDOS = {"PRFORMULA": ["=~peso", "=~0"]}


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

    def _col(self, t, destino):
        p = self.por[t]
        return [c for c in p["colunas"][p["destinos"][0]] if c["destino"] == destino]

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela(self):
        for p in self.plano:
            self.assertEqual(len(p["destinos"]), 1, p["tabela"])

    def test_referencias(self):
        self.assertEqual(self._col("PRAGRAVOPERGUNTA", "agravo_notificavel_id")[0]["referencia"], "PRAGRAVOTPARQUETIPO")
        u = self._col("PRFILTROUSUARIO", "usuario_id")[0]
        self.assertEqual((u["referencia"], u["regra"]), ("TBUSERS", "chave_origem"))

    def test_sequencia_pela_chave_da_origem(self):
        """A posição da pergunta é o id da origem (nunca muda): apagar uma pergunta e criar outra no diferencial não
        reusa a posição de ninguém (sem 1062) nem desloca as que ficaram. Nada de `#seq` contado na leitura."""
        s = self._col("PRAGRAVOPERGUNTA", "sequencia")[0]
        self.assertEqual((s["coluna"], s["regra"]), ("ID", "inteiro"))
        for p in self.plano:
            self.assertFalse([c for c in p["colunas"][p["destinos"][0]] if c["coluna"].startswith("#seq:")], p["tabela"])
        # diferencial simulado sobre as chaves: o valor de cada linha depende só dela
        antes = {1: 1, 2: 2, 3: 3}
        depois = {k: k for k in (1, 3, 4)}
        self.assertTrue(all(depois[k] == antes[k] for k in (1, 3)))
        self.assertNotIn(depois[4], [antes[k] for k in (1, 3)])

    def test_literais_fora_da_leitura_e_formula_inativa(self):
        self.assertNotIn("=texto", self.por["PRAGRAVOPERGUNTA"]["lidas"])
        for t, lits in PRESUMIDOS.items():
            cols = [c["coluna"] for c in self.por[t]["colunas"][self.por[t]["destinos"][0]]]
            for lit in lits:
                self.assertNotIn(lit, self.por[t]["lidas"], t)
                self.assertIn(lit, cols, t)
        # fórmula migrada sem validação da expressão: entra inativa, com pendência, nunca com o ATIVO da origem
        self.assertEqual(self._col("PRFORMULA", "ativo")[0]["coluna"], "=~0")
        self.assertNotIn("ATIVO", self.por["PRFORMULA"]["lidas"])

    def test_sem_presumido_que_muda_o_sentido_clinico(self):
        for t in ("PRAGRUPBALANCO", "PRASSINANTE", "PRBHTIPOFECHAMENTO", "PRFREQUENCIA"):
            self.assertNotIn(t, self.por)
        self.assertEqual(self._col("PRBHTPELIMINA", "natureza")[0]["coluna"], "=perda")

    def test_regras_declaradas(self):
        self.assertEqual(self._col("GETABVIA", "codigo")[0]["regra"], "codigo_char")
        for d in ("exige_volume_medido", "exige_volume_estimado", "exige_intensidade", "exige_aspecto",
                  "exige_item_prescrito"):
            self.assertEqual(self._col("PRBHTPELIMINA", d)[0]["regra"], "booleano_sn", d)
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                if c["destino"] == "codigo":
                    self.assertIn(c["regra"], ("texto", "codigo_char"), p["tabela"])

    def test_obrigatorias_do_destino_cobertas(self):
        """Toda coluna NOT NULL sem padrão do destino é declarada (senão a inserção falha com 1364 e para a carga)."""
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
                    self.assertIn(x[0], decl, "%s.%s" % (dt, x[0]))


class Regras(unittest.TestCase):
    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("texto_nome", "Agravo  exemplo   dois".encode("cp1252")), ("Agravo exemplo dois", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("codigo_char", b"Ab"), ("Ab", None))
        self.assertEqual([sorted(g) for g in sentinela.colisoes_caixa(["Ab", "AB", "VO"])], [["AB", "Ab"]])
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro", 8), (8, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_05.linhas(None, lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(sorted(esp), sorted(CARREGADAS))
        recusa = ("restricao_destino_", "codigo_colisao_caixa", "pai_pendente")
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith(recusa))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM:
            self.assertNotIn("CREATE TABLE %s " % t, l6_05.DDL)

    def test_so_dados_inventados(self):
        self.assertTrue(all(u.startswith("usuario.exemplo.") for u in l6_05.PAIS_EXTERNOS["TBUSERS"]))


if __name__ == "__main__":
    unittest.main()
