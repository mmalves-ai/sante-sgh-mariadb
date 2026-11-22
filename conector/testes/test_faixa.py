"""Tabela grande dividida por faixa de chave entre gravadores (paralelo.py): critério de divisão e junção do estado
de cada parte no coordenador (só as chaves da faixa do gravador voltam; medida e blocos somados). Sem banco."""
import copy
import os
import unittest
from unittest import mock

from sante_conector import paralelo


class _Prop:
    def __init__(self):
        self._pend, self._filhos = {}, {}


class _Cm:
    def __init__(self):
        self.prop = _Prop()
        self.existente, self.vistas, self.origem = {}, {}, {}
        self.por_tabela, self.sinc_res, self.cont = {}, {"blocos": {}}, {}


def _spec(colunas=None, opcoes=None, chave=("ID",), tabela="TGRANDE"):
    return {"tabela": tabela, "chave": list(chave), "destinos": ["destino_a"], "opcoes": opcoes or {},
            "colunas": {"destino_a": colunas or [{"coluna": "NOME", "destino": "nome"}]}}


class TestDivisivel(unittest.TestCase):
    def test_criterio(self):
        with mock.patch.dict(os.environ, {"CONECTOR_FAIXA": "", "CONECTOR_FAIXA_MIN": "1000"}):
            self.assertTrue(paralelo.divisivel_spec(_spec(), 5000))
            self.assertFalse(paralelo.divisivel_spec(_spec(), 999))  # pequena
            self.assertFalse(paralelo.divisivel_spec(_spec(chave=("A", "B")), 5000))  # chave composta
            self.assertFalse(paralelo.divisivel_spec(_spec([{"coluna": "#seq:PAI", "destino": "seq"}]), 5000))
            self.assertFalse(paralelo.divisivel_spec(_spec([{"coluna": "#grupo_json:X", "destino": "j"}]), 5000))
            self.assertFalse(paralelo.divisivel_spec(_spec([{"coluna": "ID", "destino": "id"}]), 5000))
            self.assertFalse(paralelo.divisivel_spec(_spec(opcoes={"destino_a": {"adotar": ["codigo"]}}), 5000))
            self.assertFalse(paralelo.divisivel_spec(_spec(opcoes={"destino_a": {"agrupar": ["X"]}}), 5000))
            # autorreferência: a coluna aponta para a própria tabela
            self.assertFalse(paralelo.divisivel_spec(_spec([{"coluna": "PAI", "destino": "pai_id",
                                                             "ref": "TGRANDE"}]), 5000))
        with mock.patch.dict(os.environ, {"CONECTOR_FAIXA": "0"}):
            self.assertFalse(paralelo.divisivel_spec(_spec(), 10 ** 9))  # desligada

    def test_so_primeira_carga(self):
        cm = _Cm()
        self.assertTrue(paralelo.primeira_carga(cm, "TGRANDE"))
        cm.existente["TGRANDE"] = {}
        self.assertTrue(paralelo.primeira_carga(cm, "TGRANDE"))  # nada gravado ainda
        cm.existente["TGRANDE"] = {"1": (10, None, None, None)}
        self.assertFalse(paralelo.primeira_carga(cm, "TGRANDE"))  # reexecução: estado herdado da tabela inteira
        cm.existente["TGRANDE"] = {}
        cm.sinc = True
        self.assertFalse(paralelo.primeira_carga(cm, "TGRANDE"))  # Sincronizar: produto em uso, linhas existentes

    def test_na_faixa(self):
        self.assertTrue(paralelo._na_faixa("5", [(None, 10)]))
        self.assertFalse(paralelo._na_faixa("10", [(None, 10)]))
        self.assertTrue(paralelo._na_faixa("10/destino_a/7", [(None, 5), (10, 20)]))
        self.assertTrue(paralelo._na_faixa("99", [(20, None)]))


class TestJuncao(unittest.TestCase):
    def _gravador(self, base_cm, lo, hi, chaves, seg):
        """Simula o fork: cópia do coordenador, grava as chaves (inclusive fora da faixa, que não podem voltar)."""
        cm = copy.deepcopy(base_cm)
        paralelo._rastrear(cm)  # a cópia profunda devolve dicionários comuns; o fork guardaria os rastreados
        paralelo._FILTRO.clear()
        paralelo._ATIVO[0] = True
        try:
            for chave in [("existente", "TGRANDE"), ("vistas", "TGRANDE"), ("origem", "TGRANDE.destino_a")]:
                paralelo._FILTRO.setdefault(chave, []).append((lo, hi))
            base = paralelo._base(cm)
            paralelo._pre_tocar(cm, frozenset(["TGRANDE", "TGRANDE.destino_a", "blocos"]))
            for k in chaves:
                cm.existente.setdefault("TGRANDE", {})[str(k)] = (k * 10, None, None, None)
                cm.vistas.setdefault("TGRANDE", set()).add(str(k))
                cm.origem.setdefault("TGRANDE.destino_a", {})[str(k)] = "h%d" % k
                cm.cont["inseridas"] = cm.cont.get("inseridas", 0) + 1
            cm.por_tabela["TGRANDE"] = {"linhas": len(chaves), "segundos": seg, "linhas_por_segundo": None}
            cm.sinc_res["blocos"]["TGRANDE"] = {"total": 1, "iguais": 0, "alterados": 1}
            return paralelo._delta(cm, base)
        finally:
            paralelo._FILTRO.clear()
            paralelo._ATIVO[0] = False

    def test_partes_juntadas(self):
        for antes in ({}, {"0": (0, None, None, None)}):  # 1ª passada (vazio) e 2ª (já carregada)
            cm = _Cm()
            if antes:
                cm.existente["TGRANDE"] = dict(antes)
            paralelo._rastrear(cm)
            # cada gravador vê também a chave 25 (fora da faixa do primeiro): só o dono da faixa a devolve
            d1 = self._gravador(cm, None, 20, [1, 2, 25], 4.0)
            d2 = self._gravador(cm, 20, None, [20, 21, 25], 6.0)
            somar = frozenset(["TGRANDE"])
            paralelo._juntar(cm, d1, somar)
            paralelo._juntar(cm, d2, somar)
            esperado = {str(k) for k in (1, 2, 20, 21, 25)} | set(antes)
            self.assertEqual(set(cm.existente["TGRANDE"]), esperado)
            self.assertEqual(cm.vistas["TGRANDE"], {str(k) for k in (1, 2, 20, 21, 25)})
            self.assertEqual(set(cm.origem["TGRANDE.destino_a"]), {str(k) for k in (1, 2, 20, 21, 25)})
            self.assertEqual(cm.cont["inseridas"], 6)  # contadores somados
            self.assertEqual(cm.por_tabela["TGRANDE"]["linhas"], 6)
            self.assertEqual(cm.por_tabela["TGRANDE"]["segundos"], 6.0)
            self.assertEqual(cm.sinc_res["blocos"]["TGRANDE"], {"total": 2, "iguais": 0, "alterados": 2})


if __name__ == "__main__":
    unittest.main()
