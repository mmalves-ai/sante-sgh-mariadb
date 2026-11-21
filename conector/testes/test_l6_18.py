"""Fatia L6-18 (prontuário, assinatura e assistência, módulo HOT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-18`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_18

TABELAS = set(l6_18.CARREGADAS)
BLOQUEADAS = set(l6_18.NAO_CARREGADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        esperado = {"PRTPREFEIC": ["refeicao_do_dia"], "RISETOR": ["setor_tramite"], "PRVIAADMIN": ["via_dieta"],
                    "TBDIETAS": ["modalidade_dieta"], "PRCARACT_TBDIETAS": ["modalidade_dieta_caracteristica"],
                    "CHTPLIMPEZA_GEITENS": ["material_modalidade_limpeza"]}
        for t, d in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], d, t)

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "descricao", "ordem"} <= set(self.cols("PRTPREFEIC", "refeicao_do_dia")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("RISETOR", "setor_tramite")))
        self.assertTrue({"codigo", "descricao", "modalidade"} <= set(self.cols("PRVIAADMIN", "via_dieta")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBDIETAS", "modalidade_dieta")))
        self.assertTrue({"modalidade_dieta_id", "caracteristica_dieta_id"}
                        <= set(self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica")))
        self.assertTrue({"modalidade_limpeza_id", "insumo_id", "quantidade"}
                        <= set(self.cols("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza")))

    def test_presumidos(self):
        self.assertEqual(self.cols("RISETOR", "setor_tramite")["tipo"]["coluna"], "=~unidade")
        self.assertEqual(self.cols("PRVIAADMIN", "via_dieta")["modalidade"]["coluna"], "=~oral")
        self.assertEqual(self.cols("TBDIETAS", "modalidade_dieta")["classe"]["coluna"], "=~oral")

    def test_presumido_clinico_entra_inativo(self):
        # modalidade e classe presumidas 'oral': via e dieta migram inativas até o de-para do tipo de dieta
        self.assertEqual(self.cols("PRVIAADMIN", "via_dieta")["ativo"]["coluna"], "=0")
        self.assertEqual(self.cols("TBDIETAS", "modalidade_dieta")["ativo"]["coluna"], "=0")

    def test_ordem_em_texto_sem_destino(self):
        # ORDEM é VARCHAR na origem: sem destino até a regra inteiro_em_texto (tipar faria int() e derrubaria a carga)
        self.assertNotIn("ordem", self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica"))

    def test_referencias(self):
        refs = {("TBDIETAS", "modalidade_dieta", "local_estoque_id"): "GELOCARM",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "modalidade_dieta_id"): "TBDIETAS",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "caracteristica_dieta_id"): "PRCARACTDIE",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "modalidade_limpeza_id"): "CHTPLIMPEZA",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "insumo_id"): "GEITENS"}
        for (t, dt, dc), pai in refs.items():
            self.assertEqual(self.cols(t, dt)[dc]["referencia"], pai, (t, dc))

    def test_unica_alimentadora(self):
        for t, dt in [("PRTPREFEIC", "refeicao_do_dia"), ("RISETOR", "setor_tramite"), ("PRVIAADMIN", "via_dieta"),
                      ("TBDIETAS", "modalidade_dieta")]:
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_bloqueadas_sem_destino(self):
        # dependem de regra genérica, de mudança do modelo ou de decisão do dono (docs/obra/fatias/f4/saida/L6-18.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Almoço   principal ".encode("cp1252")), ("Almoço principal", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"I"), (False, None))
        self.assertEqual(a("booleano_ai", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(carga_mapa.tipar("3", "smallint"), 3)


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_18.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)


if __name__ == "__main__":
    unittest.main()
