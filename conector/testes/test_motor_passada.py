"""Conferidor F4 (achado do commit c5d7494c): CONECTOR_ADIAR e CONECTOR_SO eram ignorados pela CargaMapa.executar (o
motor entregava `set(tabelas)` e o executar() refaz o plano com tudo): a trilha TBCABTRILHA (32,9 M), adiada, entrou na
execução 7. A causa fica coberta por dois lados: o conjunto da passada (função pura) e a invariante no motor — o plano,
a carga L3 e a CargaMapa.executar recebem o MESMO conjunto `carregar` (com a linha antiga, `set(tabelas)` na
CargaMapa.executar, o segundo teste falha)."""
import ast
import inspect
import unittest

from sante_conector import motor

TABS = ["A", "B", "TRILHA", "C"]


class ConjuntoDaPassada(unittest.TestCase):
    def test_adiar_tira_a_tabela(self):
        adiar, so, carregar = motor.tabelas_da_passada(TABS, {"CONECTOR_ADIAR": "TRILHA, X"})
        self.assertEqual((adiar, so, carregar), ({"TRILHA", "X"}, set(), {"A", "B", "C"}))

    def test_so_carrega_so_as_listadas(self):
        adiar, so, carregar = motor.tabelas_da_passada(TABS, {"CONECTOR_SO": "B,C", "CONECTOR_ADIAR": "C"})
        self.assertEqual((adiar, so, carregar), ({"C"}, {"B", "C"}, {"B"}))

    def test_sem_variaveis_carrega_todas(self):
        self.assertEqual(motor.tabelas_da_passada(TABS, {})[2], set(TABS))


class MotorUsaOMesmoConjunto(unittest.TestCase):
    def _chamadas(self):
        arv = ast.parse(inspect.getsource(motor.executar))
        out = {}
        for n in ast.walk(arv):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("executar", "planejar"):
                dono = n.func.value
                nome = (dono.func.attr if isinstance(dono, ast.Call) and isinstance(dono.func, ast.Attribute)
                        else getattr(dono, "id", getattr(dono, "attr", "?")))
                arg = n.args[1] if n.func.attr == "planejar" else n.args[0]
                out.setdefault(nome, []).append(ast.unparse(arg))
        return out

    def test_plano_carga_e_carga_mapa_recebem_carregar(self):
        ch = self._chamadas()
        self.assertEqual(ch.get("carga_mapa"), ["carregar"])   # planejar
        self.assertEqual(ch.get("Carga"), ["carregar"])        # carga L3
        self.assertEqual(ch.get("CargaMapa"), ["carregar"])    # executar() refaz o plano: nunca set(tabelas)


if __name__ == "__main__":
    unittest.main()
