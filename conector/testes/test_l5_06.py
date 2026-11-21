"""Fatia L5-06 (cadastros e administração, módulo CAD): plano dirigido pelo mapa real, regras declaradas e imagem
sintética. Sem banco e só com valores inventados; a carga e a conciliação na imagem SINTÉTICA rodam em
`tools/obra/conferir-fatia-f4.sh L5-06`."""
import datetime
import os
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import l5_06

CARREGADAS = l5_06.CARREGADAS
# dependem de regra genérica que o motor ainda não tem (pedidos em docs/obra/fatias/f4/saida/L5-06.json): as do
# primeiro grupo têm as declarações prontas, comentadas em colunas.d/L5-06.tsv
ADIADAS = l5_06.ADIADAS + ["TBEMPHOSLOGO", "ATPARAMGERAL", "TBCBOPRO_TBCONVEN", "TBMEDESP", "RICADPAC_TBCONVEN",
                           "HTATENDRESP", "HTPACTELEFONE", "HTPROFISTEL", "HTPRONTUNIF"]
DECL = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE) / "declarado" / "colunas.d" / "L5-06.tsv"


class PlanoL506(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + ADIADAS))}

    def test_so_as_tabelas_declaradas_entram_em_ordem(self):
        self.assertEqual(list(self.plano), CARREGADAS)

    def test_destinos_principais(self):
        for t in ["HTTBCBOPRO", "HTTBCBOPRO_TBUNIDAD", "HTTBHOSPIT"]:
            self.assertEqual(self.plano[t]["destinos"], ["trilha_auditoria"], t)
        self.assertEqual(self.plano["TBESPEC"]["destinos"], ["especialidade_medica"])

    def test_regras_e_referencias(self):
        def col(t, c):
            return next(x for dt in self.plano[t]["destinos"] for x in self.plano[t]["colunas"][dt] if x["coluna"] == c)
        self.assertEqual(col("TBESPEC", "COD")["regra"], "texto")  # número gravado como texto (soma igual)
        self.assertEqual(col("HTTBCBOPRO", "ID_TBCBOPRO")["referencia"], "TBCBOPRO")

    def test_nenhuma_coluna_ativa_aplica_cbo_ao_id_substituto(self):
        # ID_TBCBOSUS é a chave substituta de TBCBOSUS: o de-para cbo sobre ele ligaria a ocupação errada
        for c in self.m["colunas_decl"]:
            if c["tabela"] == "TBCBOSUS_TBESPEC" and c["coluna"] == "ID_TBCBOSUS":
                self.assertNotEqual(c.get("depara"), "cbo")

    def test_nenhum_hash_ou_retrato_constante(self):
        # retrato '{}' e hash literal não provam nada: tabela de versão só com a montagem genérica do JSON
        for c in self.m["colunas_decl"]:
            if c["tabela"] in ("HTCONVEN", "HTPACIENTE", "HTPROFIS") or (c.get("destino") or "").endswith(
                    (".hash_dados", ".dados")):
                self.fail("declaração ativa de retrato sem montagem genérica: %s.%s" % (c["tabela"], c["coluna"]))

    def test_situacao_nunca_fica_com_o_padrao_do_destino(self):
        # sem de-para de valores, fonte encerrada e profissional desligado entrariam ativos: a tabela fica sem carga
        for t in ("TBCONVEN", "TBPROFIS"):
            self.assertNotIn(t, self.plano)

    def test_declaracoes_adiadas_prontas_e_comentadas(self):
        linhas = [x.split("\t") for x in DECL.read_text(encoding="utf-8").splitlines() if x.startswith("#")]
        tabelas = {x[0][1:] for x in linhas}
        self.assertEqual(tabelas, set(l5_06.ADIADAS))
        cols = {(x[0][1:], x[1]) for x in linhas}
        for k in [("TBCONVEN", "SITUACAO"), ("TBPROFIS", "SITUACAO"), ("TBCONVEN", "CLASSE"),
                  ("HTCONVEN", "CLASSIFICACAO"), ("TBCONVEN", "REG_ANS")]:
            self.assertIn(k, cols)
        self.assertFalse([x for x in linhas if x[1] == "ID_TBCBOSUS" and x[4] == "cbo"])


class RegrasL506(unittest.TestCase):
    def test_sentinelas_das_colunas_declaradas(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 300001), ("300001", None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("texto_nome", "  Dr.  Exemplo   1 "), ("Dr. Exemplo 1", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30, 10, 15)), (None, "hora_sem_data"))
        self.assertEqual(a("texto_longo", "a\r\n  b "), ("a\r\n  b ", None))

    def test_id_do_cbo_nunca_e_o_codigo(self):
        # na sintética o ID substituto nunca coincide com um código CBO válido (falharia se o ID fosse tratado como código)
        d = depara.Depara("cbo", [(c, i) for i, c in l5_06.CBO_POR_ID.items() if len(c) == 6])
        for i, cod in l5_06.CBO_POR_ID.items():
            self.assertNotEqual(str(i), cod)
            self.assertIsNone(d.resolver(i)[0])
        self.assertEqual(d.resolver(l5_06.CBO_POR_ID[1])[0], 1)


class SinteticaL506(unittest.TestCase):
    def test_tabelas_e_colunas_da_imagem_cobrem_o_plano(self):
        plano = carga_mapa.planejar(mapa.carregar_execucao(), set(l5_06.COLUNAS))
        self.assertEqual([p["tabela"] for p in plano], CARREGADAS)
        for p in plano:
            self.assertFalse(set(p["lidas"]) - set(l5_06.COLUNAS[p["tabela"]]), p["tabela"])

    def test_esperado_bate_com_as_linhas(self):
        import random
        cont = {}
        esp = l5_06._todas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(CARREGADAS + l5_06.ADIADAS))
        gravadas = {}
        self.assertEqual(set(l5_06.linhas(random.Random(1), lambda t, v: gravadas.__setitem__(t, 1))), set(CARREGADAS))
        self.assertEqual(set(gravadas), set(CARREGADAS))
        for t, e in esp.items():
            self.assertLessEqual(e["gravados"], cont[t], t)
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino") or r == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, cont[t], t)


if __name__ == "__main__":
    unittest.main()
