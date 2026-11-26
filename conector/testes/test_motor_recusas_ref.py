"""Motor de colunas, recusas-fase2 (C1a): referências. M2 (componente encadeado na chave alternativa composta, a
trinca do campo do modelo e a corrente reversa), M5 (`zero_e_chave`), M6 (secundário de pai recusado), M7 (corrente de
dois saltos), M12 (chave composta aninhada no componente) e M15 (texto vazio é sem pai; coluna anulável com pai
recusado grava NULL). Só dados falsos."""
import unittest

from sante_conector import mapa
try:  # descoberta pelo pacote (conector.sh testes) ou direta
    from testes._motor_recusas_falso import gravada, motor, recusada
except ImportError:
    from _motor_recusas_falso import gravada, motor, recusada

TRINCA = "PRPADEVOL.(ID_EVOLUCAO,ID_PRPERGUNTA,ORDEM)=(ID_CABEVOL>PRCABEVOL>ID_EVOLUCAO,ID_RESPOSTA>PRRESPOSTA>ID_PRPERGUNTA,ORDEM)"
LOTE = "GEVALMEM.(ITEM,LOTE,LOCAL)=(ITEM,LOTE,DOC>GECADSAI.(ANO,MES,DOC)=(ANO,MES,DOC)>ARM)>min:DATA"
REVERSA = ("RPRPA.(ID_RPRPA,EMPRESA)=(ID_RPRPA,EMPRESA)>ID_RPRPA>RPLANRPA.ID_RPRPA>ID_RPLANEVE>"
           "RPLANEVE_TBCBOPRO.ID_RPLANEVE>ID_TBCBOPRO>TBCBOPRO>ID_TBPROFIS>TBPROFIS")


class Formas(unittest.TestCase):
    def test_trinca_com_componentes_encadeados(self):
        p = mapa.passos_ref(TRINCA)
        self.assertEqual(len(p), 1)
        self.assertEqual((p[0]["modo"], p[0]["arg"], p[0]["cols"]), (
            "alt_composta", ["ID_EVOLUCAO", "ID_PRPERGUNTA", "ORDEM"], ["ID_CABEVOL", "ID_RESPOSTA", "ORDEM"]))
        self.assertEqual(sorted(p[0]["cadeias"]), [0, 1])
        self.assertEqual(mapa.colunas_da_linha(p[0]), ["ID_CABEVOL", "ID_RESPOSTA", "ORDEM"])
        self.assertEqual(mapa.tabelas_dos_passos(p), ["PRPADEVOL", "PRCABEVOL", "PRRESPOSTA"])

    def test_composta_aninhada_no_componente(self):
        p = mapa.passos_ref(LOTE)
        self.assertEqual(p[0]["escolha"], ("min", "DATA"))
        self.assertEqual(p[0]["cadeias"][2][0]["modo"], "alt_composta")
        self.assertEqual(mapa.colunas_da_linha(p[0]), ["ITEM", "LOTE", "DOC", "ANO", "MES"])

    def test_formas_mal_formadas_e_antigas(self):
        self.assertIsNone(mapa.passos_ref("T.(A,B)=(X>U)"))          # aridade diferente
        self.assertIsNone(mapa.passos_ref("T.(A,B)=(X>U,Y)"))        # componente encadeado tem de terminar em coluna
        self.assertIsNone(mapa.passos_ref("T.(A,B)=(X>U>C,Y)/d>Z"))  # /destino só no último passo
        self.assertEqual(mapa.passos_ref("T.(A,B)=(X,=1)")[0]["cols"], ["X", "=1"])
        self.assertEqual(len(mapa.passos_ref(REVERSA)), 9)

    def test_m7_dois_saltos(self):
        p = mapa.passos_ref("TBTISS>VERSAO_TISS>TBVERSAOTISS>COD_VERSAO_TISS")
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in p],
                         ["TBTISS", "VERSAO_TISS", "TBVERSAOTISS", "COD_VERSAO_TISS"])
        cm = motor({"TBTISS": (["ID", "VERSAO_TISS"], [(1, 30)]),
                    "TBVERSAOTISS": (["ID", "COD_VERSAO_TISS"], [(30, "4.01.00")])})
        self.assertEqual(cm._seguir({"V": 1}, "V", p), ("4.01.00", None, None))


class Trinca(unittest.TestCase):
    def setUp(self):
        self.cm = motor({
            "PRCABEVOL": (["ID", "ID_EVOLUCAO"], [(10, 1), (11, 2)]),
            "PRRESPOSTA": (["ID", "ID_PRPERGUNTA"], [(100, 7), (101, 8)]),
            # a mesma pergunta 7 nos modelos 1 e 2; ORDEM distingue o campo repetido no modelo 1
            "PRPADEVOL": (["ID", "ID_EVOLUCAO", "ID_PRPERGUNTA", "ORDEM"],
                          [(500, 1, 7, 1), (501, 1, 7, 2), (502, 2, 7, 1), (503, 2, 8, 1), (504, 2, 8, 1)])})
        self.p = mapa.passos_ref(TRINCA)

    def test_campo_do_modelo_do_registro(self):
        for linha, esperado in (({"ID_CABEVOL": 10, "ID_RESPOSTA": 100, "ORDEM": 2}, "501"),
                                ({"ID_CABEVOL": 11, "ID_RESPOSTA": 100, "ORDEM": 1}, "502")):
            self.assertEqual(self.cm._seguir(linha, "ID_CABEVOL", self.p)[1:], (("PRPADEVOL", esperado), None))

    def test_trinca_repetida_e_sem_par(self):
        self.assertEqual(self.cm._seguir({"ID_CABEVOL": 11, "ID_RESPOSTA": 101, "ORDEM": 1}, "ID_CABEVOL",
                                         self.p)[2], "pai_ambiguo")
        self.assertEqual(self.cm._seguir({"ID_CABEVOL": 10, "ID_RESPOSTA": 101, "ORDEM": 1}, "ID_CABEVOL",
                                         self.p)[2], "pai_inexistente")


class LoteDoLocal(unittest.TestCase):
    def test_m12_lote_do_local_do_movimento(self):
        cm = motor({"GECADSAI": (["ID", "ANO", "MES", "DOC", "ARM"], [(1, 2026, 1, 9, 3)]),
                    "GEVALMEM": (["ID", "ITEM", "LOTE", "LOCAL", "DATA"],
                                 [(70, 5, "L1", 3, 20270101), (71, 5, "L1", 4, 20260101),
                                  (72, 6, "L2", 3, 20280101), (73, 6, "L2", 3, 20270601)])})
        p = mapa.passos_ref(LOTE)
        pend = []
        r = cm._seguir({"ITEM": 5, "LOTE": "L1", "DOC": 9, "ANO": 2026, "MES": 1}, "LOTE", p, pend)
        self.assertEqual(r[1:], (("GEVALMEM", "70"), None))  # o do local 3, não o de validade menor no local 4
        r = cm._seguir({"ITEM": 6, "LOTE": "L2", "DOC": 9, "ANO": 2026, "MES": 1}, "LOTE", p, pend)
        self.assertEqual(r[1:], (("GEVALMEM", "73"), None))  # empate no local: a validade mais próxima
        self.assertIn(("escolha_pelo_menor", "baixa"), pend)


class CorrenteReversa(unittest.TestCase):
    def setUp(self):
        self.cm = motor({
            "RPRPA": (["ID_RPRPA", "EMPRESA"], [(1, 1), (2, 1)]),
            "RPLANRPA": (["ID", "ID_RPRPA", "ID_RPLANEVE"], [(10, 1, 20), (11, 1, 21), (12, 2, 20), (13, 2, 22)]),
            "RPLANEVE_TBCBOPRO": (["ID", "ID_RPLANEVE", "ID_TBCBOPRO"], [(30, 20, 40), (31, 21, 40), (32, 22, 41)]),
            "TBCBOPRO": (["ID", "ID_TBPROFIS"], [(40, 5), (41, 6)]),
            "TBPROFIS": (["ID"], [(5,), (6,)])}, chaves={"RPRPA": ["ID_RPRPA", "EMPRESA"], "RPLANRPA": ["ID"],
                                                       "RPLANEVE_TBCBOPRO": ["ID"], "TBCBOPRO": ["ID"],
                                                       "TBPROFIS": ["ID"]})
        self.p = mapa.passos_ref(REVERSA)

    def test_todos_os_lancamentos_no_mesmo_profissional(self):
        self.assertEqual(self.cm._seguir({"ID_RPRPA": 1, "EMPRESA": 1, "COD_PRESTADOR": 0}, "COD_PRESTADOR",
                                         self.p)[1:], (("TBPROFIS", "5"), None))

    def test_profissionais_diferentes_e_ambiguo(self):
        self.assertEqual(self.cm._seguir({"ID_RPRPA": 2, "EMPRESA": 1}, "COD_PRESTADOR", self.p)[2], "pai_ambiguo")


class ZeroEChave(unittest.TestCase):
    def setUp(self):
        self.cm = motor({"TBCONVEN": (["ID", "NOME"], [(0, "PARTICULAR"), (1, "PLANO")]),
                         "TBSEMZERO": (["ID", "NOME"], [(1, "X")])},
                        existente={"TBCONVEN": {"0": gravada(900), "1": gravada(901)}, "TBSEMZERO": {"1": gravada(5)}})

    def test_referencia_simples(self):
        self.assertEqual(self.cm._referencia("F", "1", "CONV", "TBCONVEN", 0, zero=True), (900, None, None))
        self.assertEqual(self.cm._referencia("F", "1", "CONV", "TBCONVEN", 0), (None, None, None))  # sem a opção
        self.assertEqual(self.cm._referencia("F", "1", "CONV", "TBSEMZERO", 0, zero=True), (None, None, None))
        self.assertEqual(self.cm._referencia("F", "1", "CONV", "TBCONVEN", 1, zero=True), (901, None, None))

    def test_encadeada_e_duas_fases(self):
        p = mapa.passos_ref("TBCONVEN>NOME")
        self.assertEqual(self.cm._seguir({"C": 0}, "C", p, zero=True)[0], "PARTICULAR")
        self.assertEqual(self.cm._seguir({"C": 0}, "C", p), (None, None, None))
        c = {"coluna": "C", "destino": "x", "regra": "chave_origem", "depara": "", "referencia": "TBCONVEN",
             "valores": None, "zero_e_chave": True}
        pl = {"duas_fases": {"TBCONVEN"}}
        self.assertEqual(self.cm._converter("F", "1", pl, {"C": 0}, c, 0, [], pode_adiar=True), (None, None, "0"))
        self.assertEqual(self.cm._converter("F", "1", pl, {"C": 0}, dict(c, zero_e_chave=False), 0, [],
                                            pode_adiar=True), (None, None, ""))


class PaiRecusado(unittest.TestCase):
    def test_m6_secundario_de_pai_recusado_e_pendente(self):
        cm = motor(existente={"PAI": {"1": recusada(), "2": gravada(7), "2/lote": gravada(8)}})
        self.assertEqual(cm._referencia_chave("F", "9", "C", "PAI", "1/lote")[1], "pai_pendente")
        self.assertEqual(cm._referencia_chave("F", "9", "C", "PAI", "2/lote"), (8, None, None))
        self.assertEqual(cm._referencia_chave("F", "9", "C", "PAI", "3/lote")[1], "pai_inexistente")
        cm.existente["PAI"]["1"], cm.existente["PAI"]["1/lote"] = gravada(3), gravada(4)  # recarregar destrava
        self.assertEqual(cm._referencia_chave("F", "9", "C", "PAI", "1/lote"), (4, None, None))

    def test_m15_texto_vazio_e_anulavel(self):
        cm = motor(existente={"PAI": {"1": recusada()}})
        self.assertEqual(cm._referencia("F", "9", "C", "PAI", "   "), (None, None, None))
        c = {"coluna": "C", "destino": "x", "regra": "chave_origem", "depara": "", "referencia": "PAI",
             "valores": None}
        pend = []
        x, recusa, _ = cm._converter("F", "9", {"duas_fases": set()}, {"C": 1}, c, 1, pend)
        self.assertEqual((x, recusa[0]), (None, "pai_pendente"))           # NOT NULL: recusa como antes
        pend = []
        x, recusa, _ = cm._converter("F", "9", {"duas_fases": set()}, {"C": 1}, c, 1, pend, anulavel=True)
        self.assertEqual((x, recusa, [r for r, _ in pend]), (None, None, ["pai_pendente"]))

    def _filho_gravado_nulo(self, pai):
        cm = motor(existente={"PAI": {"1": pai}, "F": {"9": gravada(50)}})
        cm.info = {"d": {"x": (True, "bigint", None, False, None)}}
        reemitida = ("F", "9", "pai_pendente", "alta", None)  # aviso aberto da execução anterior, já reemitido
        cm._avisos_ant, cm._buf, cm.pend = {"F": {"9": {("pai_pendente", "alta")}}}, [reemitida], [reemitida]
        cm._reemitidas, cm.adiadas = {("F", "9", "pai_pendente"): 1}, []
        c = {"coluna": "C", "destino": "x", "regra": "chave_origem", "depara": "", "referencia": "PAI",
             "valores": None}
        p = {"tabela": "F", "destinos": ["d"], "opcoes": {}, "colunas": {"d": [c]}, "duas_fases": set()}
        cm._readiar_anulaveis(p, {"C": 1}, "9", gravada(50))
        return cm

    def test_m15_pai_corrigido_preenche_a_coluna_anulavel(self):
        cm = self._filho_gravado_nulo(gravada(7))  # o pai foi corrigido e recarregado
        self.assertEqual(cm.adiadas, [("d", "x", 50, None, 7, "F", "9", True)])
        self.assertEqual((cm._buf, cm.pend, cm.pendencias), ([], [], []))  # a pai_pendente sai

        class Cursor:
            feitos, rowcount = [], 1

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, sql, args):
                self.feitos.append((sql, args))
        cur = Cursor()
        cm._c, cm._commit = (lambda: cur), (lambda: None)
        cm.cont.update(fase2_pendentes=0, fase2_gravadas=0)
        cm._fase2()
        self.assertEqual(cur.feitos, [("UPDATE `d` SET `x`=%s WHERE id=%s AND `x` IS NULL", (7, 50))])
        self.assertEqual((cm.cont["fase2_gravadas"], cm.cont["fase2_refeitas"]), (1, 1))

    def test_m15_pai_ainda_recusado_segue_pendente(self):
        cm = self._filho_gravado_nulo(recusada())
        self.assertEqual(cm.adiadas, [])
        self.assertEqual([x[2] for x in cm.pendencias], ["pai_pendente"])  # recalculada, uma só
        self.assertEqual(cm._buf, [])


if __name__ == "__main__":
    unittest.main()
