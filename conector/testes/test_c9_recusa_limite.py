"""Conciliação com recusa em entidade principal (2026-11-22): a carga real recusou 100% dos atendimentos e a execução
saiu "concluída". Entidade principal com recusa acima de 5% ou de 1.000 linhas (configurável) fica NÃO conferida, a
execução falha (estado vermelho do painel) com o motivo e o relatório L10 destaca a decisão. Só dados sintéticos."""
import unittest

from sante_conector import carga, motor, relatorio

PADRAO = carga.limites_recusa({})


class Limite(unittest.TestCase):
    def test_padrao_e_configuracao(self):
        self.assertEqual(PADRAO, (carga.ENTIDADES_PRINCIPAIS, 5.0, 1000))
        ents, pct, lin = carga.limites_recusa({"CONECTOR_ENTIDADES_PRINCIPAIS": "paciente, conta_hospitalar",
                                               "CONECTOR_RECUSA_LIMITE_PERCENTUAL": "10",
                                               "CONECTOR_RECUSA_LIMITE_LINHAS": "50"})
        self.assertEqual((ents, pct, lin), (("paciente", "conta_hospitalar"), 10.0, 50))
        self.assertEqual(carga.limites_recusa({"CONECTOR_RECUSA_LIMITE_PERCENTUAL": "x",
                                               "CONECTOR_RECUSA_LIMITE_LINHAS": "y"}), PADRAO)

    def test_percentual_e_linhas(self):
        f = carga.recusa_acima_do_limite
        self.assertTrue(f("atendimento", 209147, 209147, PADRAO))   # o caso medido: tudo recusado
        self.assertFalse(f("atendimento", 1000, 50, PADRAO))        # 5% exato: no limite
        self.assertTrue(f("atendimento", 1000, 51, PADRAO))         # acima de 5%
        self.assertFalse(f("paciente", 100000, 1000, PADRAO))       # 1% e 1.000 linhas exatas
        self.assertTrue(f("paciente", 100000, 1001, PADRAO))        # 1% mas acima de 1.000 linhas
        self.assertTrue(f("conta_hospitalar#2", 10, 5, PADRAO))     # nome com sufixo do mapa
        self.assertFalse(f("atendimento", 10, 0, PADRAO))
        self.assertFalse(f("atendimento_alta", 10, 10, PADRAO))     # não principal: segue a conciliação comum
        self.assertTrue(f("atendimento_alta", 10, 10, (("atendimento_alta",), 5.0, 1000)))

    def test_aplicar_marca_e_tira_conferido(self):
        res = {"atendimento": {"registros_origem": 20, "recusados": 20, "conferido": True},
               "paciente": {"registros_origem": 1000, "recusados": 10, "conferido": True},
               "atendimento_ficha": {"registros_origem": 20, "recusados": 20, "conferido": True}}
        self.assertEqual(carga.aplicar_limite_recusa(res, PADRAO), ["atendimento"])
        self.assertFalse(res["atendimento"]["conferido"])
        self.assertTrue(res["atendimento"]["recusa_acima_do_limite"])
        self.assertTrue(res["paciente"]["conferido"])
        self.assertNotIn("recusa_acima_do_limite", res["paciente"])
        self.assertTrue(res["atendimento_ficha"]["conferido"])


class Execucao(unittest.TestCase):
    def test_motivo_da_falha_poe_a_decisao_primeiro(self):
        ents = {"atendimento": {"registros_origem": 20, "recusados": 20, "conferido": False,
                                "recusa_acima_do_limite": True},
                "conta_hospitalar": {"registros_origem": 5, "recusados": 0, "conferido": False}}
        m = motor.motivo_conciliacao(ents, ["atendimento", "conta_hospitalar"])
        self.assertTrue(m.startswith("recusa acima do limite em entidade principal"), m)
        self.assertIn("atendimento 20 de 20", m)
        self.assertIn("divergiu: conta_hospitalar", m)
        self.assertEqual(motor.motivo_conciliacao(ents, ["conta_hospitalar"]),
                         "conciliação por entidade divergiu: conta_hospitalar")


class RelatorioL10(unittest.TestCase):
    def test_decisao_critica_destacada_no_topo(self):
        ents = {"atendimento": {"tabela_origem": "TA", "registros_origem": 20, "registros_destino": 0,
                                "recusados": 20, "conferido": False, "recusa_acima_do_limite": True},
                "paciente": {"tabela_origem": "TB", "registros_origem": 10, "registros_destino": 10,
                             "recusados": 0, "conferido": True}}
        r = relatorio.montar([("TA", "estabelecimento_ausente", "alta", 20), ("TB", "edicao_no_destino", "media", 3)],
                             [], ents)
        self.assertEqual(r["totais"]["conferidas"], 1)
        self.assertEqual(r["totais"]["abertas"], 23)  # a decisão por entidade não soma às pendências por linha
        d = r["decisoesCliente"][0]
        self.assertEqual((d["regra"], d["gravidade"], d["entidades"]), ("recusa_acima_do_limite", "critica", 1))
        self.assertIn("atendimento com 20 de 20 linhas recusadas (100.0%)", d["acao"])
        g = [x for x in r["porRegra"] if x["regra"] == "recusa_acima_do_limite"]
        self.assertEqual([(x["entidade"], x["decisao"], x["unidade"]) for x in g], [("atendimento", "cliente", "tabela")])
        self.assertEqual(r["porRegra"][0]["regra"], "recusa_acima_do_limite")
        self.assertEqual(r["entidadesAcimaDoLimite"], [{"entidade": "atendimento", "recusados": 20,
                                                         "registrosOrigem": 20}])

    def test_sem_recusa_acima_do_limite_nada_muda(self):
        ents = {"paciente": {"tabela_origem": "TB", "registros_origem": 10, "registros_destino": 10,
                             "recusados": 0, "conferido": True}}
        r = relatorio.montar([], [], ents)
        self.assertEqual(r["decisoesCliente"], [])
        self.assertEqual(r["entidadesAcimaDoLimite"], [])


if __name__ == "__main__":
    unittest.main()
