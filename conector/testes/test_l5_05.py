"""Fatia L5-05 (cadastros e administração): plano da carga dirigida pelo mapa, cobertura das colunas obrigatórias do
destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l5_05.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_05

CARREGADAS = ["TBGENERO_SOCIAL", "TBGRAU_INST", "TBGRUCONVEN", "TBPARENTE", "TBPESQUIPLANO", "TBRELIG",
              "TBTIPOATEUNIDADE", "TBVULNERABILIDADE_SOCIAL"]
# aguardam regra genérica do motor (pedidos em docs/obra/fatias/f4/saida/L5-05.json)
AGUARDAM = ["TBGERSEQ", "TBMEDSOL", "TBMUIBGE", "TBPESSOA", "TBUNIDAD", "TBCBOPRO_TBUNIDAD", "TBUNID_IDADE",
            "TBEMPHOS",
            # sem adoção pela chave natural, duplicariam (ou recusariam por 1062) o que o L3 já criou
            "TBSEXO", "TBTIPOTELEFONE", "TBTPDOCUMENTO",
            # a sigla do órgão (NOT NULL, 10) não tem fonte na origem: derivar do nome recusaria o cadastro
            "TBORGAOEMIS"]


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

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela_e_literal_fora_da_leitura(self):
        por = {p["tabela"]: p for p in self.plano}
        for p in self.plano:
            self.assertEqual(len(p["destinos"]), 1, p["tabela"])
        perfil = por["TBTIPOATEUNIDADE"]
        self.assertNotIn("=outro", perfil["lidas"])
        self.assertIn({"coluna": "=outro", "destino": "categoria", "regra": "", "depara": "", "referencia": "",
                       "valores": None},
                      perfil["colunas"]["perfil_unidade"])

    def test_codigo_numerico_vira_texto(self):
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
        self.assertEqual(a("texto", 5), ("5", None))
        self.assertEqual(a("texto_nome", "Convênios   privados".encode("cp1252")), ("Convênios privados", None))
        self.assertEqual(a("texto", b" Fundamental\r\nincompleto "), ("Fundamental\r\nincompleto", None))
        self.assertEqual(a("codigo_char", b"a"), ("a", None))
        self.assertEqual(a("codigo_char", b"A"), ("A", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.colisoes_caixa(["A", "a", "1"]), [["A", "a"]])


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_05.linhas(None, lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(sorted(esp), sorted(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r == "codigo_colisao_caixa")
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM:
            self.assertNotIn("CREATE TABLE %s " % t, l5_05.DDL)

    def test_destino_do_l3_preparado(self):
        """As linhas que o L3 cria estão guardadas para a conferência da adoção pela chave natural."""
        for x in ("'M'", "'F'", "'I'", "'residencial'", "'celular'", "'rg'"):
            self.assertIn(x, l5_05.DESTINO_L3)


if __name__ == "__main__":
    unittest.main()
