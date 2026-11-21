"""Fatia L8-16 (faturamento e restantes, módulo INTG): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, literal presumido, segredo nunca migrado, declarações das tabelas que aguardam e coerência da
imagem sintética. Só dados inventados (sintetica_d/l8_16.py)."""
import csv
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_16

CARREGADAS = ["RETPPROTOLIFE", "TBIDENTIFICACAOENDPOINT"]
# aguardam regra genérica do motor, pai carregável ou decisão (pedidos em docs/obra/fatias/f4/saida/L8-16.json)
AGUARDAM = ["FPESOCTPAMB", "GEINTAPOIOCOT", "PRCABEARQINTEGRAQT", "SIMATHP", "SIMODULO_SIWEBATOS", "SITBELHP",
            "SITBEXEQ", "TBCID10", "TBDIGITAL_ESPECIALIDADE", "TBDIGITAL_INTEG_TYPE", "TBDIGITAL_INTEG_FIELD",
            "TBFORMA_ASSINATURA_ICP", "TBENDPOINT", "TBENDPOINTURI", "TBINFBANCO", "TBMEDSOLWEBCAD", "TBOPERSCHEMA",
            "TBREGUL_ENDPOINT", "TBREGUL_TABELAS", "TBREGUL_VLR_TABELAS"]
OBRIGATORIAS = {"perfil_prioridade_externa": {"codigo", "descricao"},
                "sistema_externo": {"codigo", "nome", "categoria", "finalidade"}}


def _raiz():
    for r in (Path(__file__).resolve().parents[2], Path("/app")):
        if (r / "conector/mapa/declarado/colunas.d").is_dir():
            return r
    return None


def _mapa():
    try:
        return mapa.carregar_execucao()
    except FileNotFoundError:
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
        self.assertEqual(self.por["RETPPROTOLIFE"]["destinos"], ["perfil_prioridade_externa"])
        self.assertEqual(self.por["TBIDENTIFICACAOENDPOINT"]["destinos"], ["sistema_externo"])

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            dt = p["destinos"][0]
            self.assertFalse(OBRIGATORIAS[dt] - {c["destino"] for c in p["colunas"][dt]}, dt)

    def test_categoria_presumida_para_revisao(self):
        self.assertEqual(self._col("TBIDENTIFICACAOENDPOINT", "categoria")[0]["coluna"], "=~outro")

    def test_codigos_em_texto_e_nomes_colapsados(self):
        self.assertEqual(self._col("RETPPROTOLIFE", "codigo")[0]["regra"], "texto")
        self.assertEqual(self._col("TBIDENTIFICACAOENDPOINT", "codigo")[0]["regra"], "texto")
        self.assertEqual(self._col("RETPPROTOLIFE", "descricao")[0]["regra"], "texto_nome")
        for d in ("nome", "finalidade"):
            self.assertEqual(self._col("TBIDENTIFICACAOENDPOINT", d)[0]["coluna"], "DESCRICAO", d)

    def test_sem_de_para_oficial_nas_carregadas(self):
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                self.assertEqual(c["depara"], "", (p["tabela"], c["destino"]))


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r / "conector/mapa/declarado/colunas.d/L8-16.tsv", newline="") as f:
            self.linhas = list(csv.DictReader(f, delimiter="\t"))

    def test_toda_tabela_da_fatia_declarada(self):
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS + AGUARDAM))

    def test_aguardam_sem_destino_e_com_motivo(self):
        for l in self.linhas:
            if l["tabela"] in AGUARDAM:
                self.assertEqual(l["destino"], "", l["tabela"])
                self.assertTrue(l["motivo"].startswith("L8-16: não carregada: "), l["tabela"])

    def test_segredo_e_porta_nunca_migram(self):
        for t, c in (("TBINFBANCO", "SENHA"), ("TBIDENTIFICACAOENDPOINT", "PORTA_DOCKER_INTERNO")):
            ls = [l for l in self.linhas if (l["tabela"], l["coluna"]) == (t, c)]
            self.assertEqual([l["destino"] for l in ls], [""], (t, c))

    def test_regras_validas(self):
        for l in self.linhas:
            if l["regra"]:
                self.assertIn(l["regra"], sentinela.REGRAS, (l["tabela"], l["coluna"]))

    def test_sem_nome_da_origem_no_destino(self):
        for l in self.linhas:
            if l["destino"]:
                self.assertRegex(l["destino"], r"^[a-z_]+\.[a-z_]+$")


class Sintetica(unittest.TestCase):
    def test_so_tabelas_carregaveis_no_ddl(self):
        self.assertEqual(re.findall(r"CREATE TABLE (\w+)", l8_16.DDL), CARREGADAS)

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l8_16.linhas(None, lambda t, v: ins.append(t))
        for t, e in esp.items():
            recusas = sum(n for rg, n in e["pendencias"].items()
                          if rg.startswith("restricao_destino_") or rg == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, ins.count(t), t)

    def test_codigo_repetido_na_imagem(self):
        cods = [v[1] for t, ls, _ in l8_16.DADOS if t == "TBIDENTIFICACAOENDPOINT" for v in ls]
        self.assertEqual(len(cods) - len(set(cods)), 1)


if __name__ == "__main__":
    unittest.main()
