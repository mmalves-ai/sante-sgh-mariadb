"""Fatia L7-04 (SADT e suprimentos, módulo SADT): plano da carga dirigida pelo mapa, cobertura das colunas obrigatórias
do destino, declarações das tabelas que aguardam e coerência da imagem sintética. Só dados inventados
(sintetica_d/l7_04.py)."""
import csv
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_04

CARREGADAS = ["TBTPSANGUINEO", "SIRES01_DELETE", "SIKITHISTEXA"]
# aguardam regra genérica do motor ou decisão (pedidos em docs/obra/fatias/f4/saida/L7-04.json)
AGUARDAM = ["SIWSETIQUETA", "TBFATORRH", "PREXAMEASSINATURA", "SICADATE", "SIHISTVLREF", "SIHISTVLREFELEMENTO",
            "SIHISTVLREFEXAME", "SILANEXA", "SIASSLAUDO_IMP_SILANEXA", "SILIBERACAOEXAME", "SIRES01",
            "SIRESOBS", "SIRESVAR", "HTNOTEXAMESEXO", "SHBOLSAHIST", "SIKITHISTITE"]
OBRIGATORIAS = {"grupo_sanguineo": {"codigo", "descricao", "sigla"},
                "trilha_auditoria": {"ocorrido_em", "acao", "entidade"},
                "kit_exame_versao": {"kit_exame_id", "ocorrido_em", "numero_versao", "nome", "vigencia_inicio"}}


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
        self.assertEqual(self.por["TBTPSANGUINEO"]["destinos"], ["grupo_sanguineo"])
        self.assertEqual(self.por["SIKITHISTEXA"]["destinos"], ["kit_exame_versao"])
        self.assertEqual(self.por["SIRES01_DELETE"]["destinos"][0], "trilha_auditoria")

    def test_exclusao_de_resultado_na_trilha(self):
        self.assertEqual(self._col("SIRES01_DELETE", "acao")[0]["coluna"], "=exclusao")
        self.assertEqual(self._col("SIRES01_DELETE", "entidade")[0]["coluna"], "=resultado_exame")
        self.assertEqual(self._col("SIRES01_DELETE", "ocorrido_em")[0]["regra"], "data_hora")
        u = self._col("SIRES01_DELETE", "usuario_id")[0]
        self.assertEqual((u["regra"], u["referencia"]), ("chave_origem", "TBUSERS"))
        self.assertFalse(self._col("SIRES01_DELETE", "entidade_id"))

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            dt = p["destinos"][0]
            cobertas = {c["destino"] for c in p["colunas"][dt]}
            self.assertFalse(OBRIGATORIAS[dt] - cobertas, dt)

    def test_kit_pela_referencia_e_versao_por_kit(self):
        k = self._col("SIKITHISTEXA", "kit_exame_id")[0]
        self.assertEqual((k["regra"], k["referencia"]), ("chave_origem", "SIKITEXA"))
        self.assertEqual(self._col("SIKITHISTEXA", "numero_versao")[0]["coluna"], "#seq:ID_SIKITEXA")

    def test_regras_de_coluna(self):
        self.assertEqual(self._col("SIKITHISTEXA", "hora_sugerida_coleta")[0]["regra"], "hora_em_timestamp")
        self.assertEqual(self._col("SIKITHISTEXA", "gera_bateria")[0]["regra"], "booleano_sn")
        for d in ("ocorrido_em", "vigencia_inicio", "vigencia_fim"):
            self.assertEqual(self._col("SIKITHISTEXA", d)[0]["regra"], "data_hora", d)
        self.assertEqual(self._col("TBTPSANGUINEO", "sigla")[0]["regra"], "texto_nome")


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r / "conector/mapa/declarado/colunas.d/L7-04.tsv", newline="") as f:
            self.linhas = list(csv.DictReader(f, delimiter="\t"))

    def test_toda_tabela_da_fatia_declarada(self):
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS + AGUARDAM))

    def test_aguardam_sem_destino_e_com_motivo(self):
        for l in self.linhas:
            if l["tabela"] in AGUARDAM:
                self.assertEqual(l["destino"], "", l["tabela"])
                self.assertTrue(l["motivo"].startswith("L7-04: não carregada: "), l["tabela"])

    def test_exclusao_de_resultado_declarada(self):
        d = {l["coluna"]: l for l in self.linhas if l["tabela"] == "SIRES01_DELETE"}
        self.assertEqual(d["USUARIO"]["via"], "ref:TBUSERS")
        self.assertEqual(d["ID_SIRES01"]["destino"], "")
        self.assertEqual(sum(1 for l in d.values() if l["destino"]), 4)

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
        self.assertEqual(re.findall(r"CREATE TABLE (\w+)", l7_04.DDL), CARREGADAS)

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l7_04.linhas(None, lambda t, v: ins.append(t))
        for t, e in esp.items():
            recusas = sum(n for rg, n in e["pendencias"].items()
                          if rg.startswith("restricao_destino_") or rg == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, ins.count(t), t)

    def test_kit_externo_e_inexistente(self):
        kits = {v[6] for t, ls, _ in l7_04.DADOS if t == "SIKITHISTEXA" for v in ls}
        self.assertEqual(kits - {int(k) for k in l7_04.PAIS_EXTERNOS["SIKITEXA"]}, {9})


if __name__ == "__main__":
    unittest.main()
