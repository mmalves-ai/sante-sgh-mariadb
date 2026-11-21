"""Fatia L5-01 (cadastros e administração): declarações sobre o mapa real e carga na imagem SINTÉTICA (dados 100%
falsos, sintetica_d/l5_01.py). Só contagens e regras; nenhum dado real."""
import unittest

from sante_conector import carga_mapa, mapa, sentinela

CARREGADAS = ["TBGRUUSU", "PREMAILMODULO", "PRTIPO_JUSTIF_EXPORTACAO", "RPMATRIZ_GUT_TIPO",
              "RPMATRIZ_GUT_DESCRICAO", "TBCENARIO"]
# aguardam regra genérica do motor (pedidos em docs/obra/fatias/f4/saida/L5-01.json): sem coluna declarada
AGUARDAM = ["CCCADCIR_EXCLUSAO", "DIPERMPS", "FPCON", "PREMAILCFG", "PRLOCPACDEFAULT", "PRTERMOCAD", "PRTERMOACEITE",
            "SIPACAGD_EXCLUSAO", "TBAGEUSE", "TBCTRPRTUSU", "TBDICIONARIO_TBUSERS", "TBDIGITAR", "TBDIGITAR_CNSCADPAC",
            "PRTPNOTIFEMAIL", "TBCFGLOGIN"]


class PlanoL501(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + AGUARDAM))}

    def test_so_as_carregaveis_entram_e_na_ordem_do_mapa(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if r["tabela"] in CARREGADAS}
        self.assertEqual([p for p in self.plano], sorted(CARREGADAS, key=ordem.get))
        # dimensão antes do grau (referência na mesma fatia)
        lista = list(self.plano)
        self.assertLess(lista.index("RPMATRIZ_GUT_TIPO"), lista.index("RPMATRIZ_GUT_DESCRICAO"))

    def test_destinos_e_regras_declaradas(self):
        perfil = {c["destino"]: c["regra"] for c in self.plano["TBGRUUSU"]["colunas"]["perfil_acesso"]}
        self.assertEqual((perfil["codigo"], perfil["nome"]), ("texto", "texto_nome"))  # chave preservada
        cols = {c["destino"]: c for c in self.plano["PREMAILMODULO"]["colunas"]["finalidade_email"]}
        self.assertEqual(cols["codigo"]["regra"], "texto")  # id em texto: mesma soma dos dois lados
        g = {c["destino"]: c for c in self.plano["RPMATRIZ_GUT_DESCRICAO"]["colunas"]["grau_priorizacao_gut"]}
        self.assertEqual((g["dimensao_priorizacao_gut_id"]["regra"], g["dimensao_priorizacao_gut_id"]["referencia"]),
                         ("chave_origem", "RPMATRIZ_GUT_TIPO"))

    def test_nenhuma_credencial_declarada(self):
        decl = [c for c in self.m["colunas_decl"] if c.get("_arquivo", "").endswith("L5-01.tsv")]
        self.assertTrue(decl)
        self.assertFalse([c for c in decl if "SENHA_AUTENTICACAO" in c["coluna"]])

    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", b"Enfermagem   plantao "), ("Enfermagem plantao", None))
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(carga_mapa.canon(a("texto", 7)[0]), carga_mapa.canon("7"))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", b""), (None, None))
        self.assertEqual(a("texto", b" Enfermagem   plantao "), ("Enfermagem   plantao", None))


class ConferenciaL501(unittest.TestCase):
    def test_carga_concilia_reexecuta_e_mostra_edicao(self):
        from sante_conector import conferencia

        def editar(cc):
            with cc.cursor() as c:
                c.execute("UPDATE cenario_alerta SET descricao='editado', versao=versao+1 ORDER BY id LIMIT 1")
        r = conferencia.conferir("L5-01", depois_da_primeira=editar)
        self.assertEqual(r["erros"], [])
        e = r["entidades"]
        self.assertEqual((e["perfil_acesso"]["registros_destino"], e["perfil_acesso"]["recusados"]), (7, 2))
        self.assertEqual((e["grau_priorizacao_gut"]["registros_destino"], e["grau_priorizacao_gut"]["recusados"]),
                         (15, 4))
        self.assertNotIn("politica_senha", e)
        self.assertNotIn("canal_notificacao", e)
        self.assertEqual(r["segunda"]["pendencias_por_regra"].get("cenario_alerta:edicao_no_destino:media"), 1)
        self.assertEqual(r["segunda"]["puladas_iguais"], 9 + 4 + 5 + 4 + 19 + 2)


if __name__ == "__main__":
    unittest.main()
