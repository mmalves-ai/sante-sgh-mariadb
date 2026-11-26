"""Motor de colunas, recusas-fase2 (C1a): valores e plano. M1 (dependência não carregada adia a tabela), M3
(`#seq_livre`), R10 (`#seq_faixa`), M4 (ordem dos secundários `antes` pelo `@id:`), M11 (`sufixo_colisao`), R8
(`percentual_delta`), `presumida` na primeira declaração e `pendencia_se_nulo`. Só dados falsos."""
import decimal
import random
import unittest
from unittest import mock

from sante_conector import carga_mapa, mapa, sentinela
try:  # descoberta pelo pacote (conector.sh testes) ou direta
    from testes._motor_recusas_falso import motor
except ImportError:
    from _motor_recusas_falso import motor

D = decimal.Decimal


class PercentualDelta(unittest.TestCase):
    def test_cem_mais_o_ajuste(self):
        self.assertTrue(sentinela.regra_conhecida("percentual_delta"))
        for v, x in ((0, D(100)), (5, D(105)), (D("-12.5"), D("87.5")), ("7,5", D("107.5"))):
            self.assertEqual(sentinela.aplicar("percentual_delta", v), (x, None))
        self.assertEqual(sentinela.aplicar("percentual_delta", None), (None, None))
        self.assertEqual(sentinela.aplicar("percentual_delta", " "), (None, None))
        self.assertEqual(sentinela.aplicar("percentual_delta", "x"), (None, "valor_fora_do_dominio"))


class OrdemDosSecundarios(unittest.TestCase):
    def test_antes_pela_dependencia_de_id(self):
        dts = ["principal", "b", "c", "d"]
        ops = {"b": {"antes": True}, "c": {"antes": True}}
        ordem, erro = mapa.ordem_gravacao(dts, {"b": ["@id:c"], "c": [], "d": ["@id:b"]}, ops)
        self.assertEqual((ordem, erro), ([2, 1, 0, 3], None))
        self.assertEqual(mapa.ordem_gravacao(dts, {}, ops), ([1, 2, 0, 3], None))  # sem @id: como antes
        ordem, erro = mapa.ordem_gravacao(dts, {"b": ["@id:c"], "c": ["@id:b"]}, ops)
        self.assertIsNone(ordem)
        self.assertIn("ciclo", erro)

    def test_validador_aceita_id_de_destino_gravado_antes(self):
        tabs = [{"tabela": "T", "tabelas_destino": "principal;exame;faixa"}]
        base = [{"tabela": "T", "coluna": "A", "destino": "principal.a", "via": ""},
                {"tabela": "T", "coluna": "B", "destino": "exame.b", "via": ""}]
        ok = base + [{"tabela": "T", "coluna": "@id:exame", "destino": "faixa.exame_id", "via": ""}]
        self.assertFalse([e for e in mapa.erros_especiais_e_opcoes(ok, tabs, {}) if "@id" in e])
        ruim = [{"tabela": "T", "coluna": "@id:faixa", "destino": "exame.faixa_id", "via": ""}] + base[:1] + \
            [{"tabela": "T", "coluna": "C", "destino": "faixa.c", "via": ""}]
        self.assertTrue([e for e in mapa.erros_especiais_e_opcoes(ruim, tabs, {}) if "@id:faixa" in e])
        ciclo = base[:1] + [{"tabela": "T", "coluna": "@id:faixa", "destino": "exame.f", "via": "antes"},
                            {"tabela": "T", "coluna": "@id:exame", "destino": "faixa.e", "via": "antes"}]
        self.assertTrue([e for e in mapa.erros_especiais_e_opcoes(ciclo, tabs, {}) if "ciclo" in e])


class SeqLivre(unittest.TestCase):
    LINHAS = [(1, 1, 1), (2, 1, 2), (3, 1, 2), (4, 1, 3), (5, 1, None), (6, 1, 2), (7, 2, 1), (8, 2, 9)]

    def _plano(self):
        c = {"coluna": "#seq_livre:DOC:SEQ", "destino": "sequencia"}
        return {"tabela": "T", "chave": ["ID"], "destinos": ["item"], "colunas": {"item": [c]}}

    def test_unicos_preservados_repetidos_sem_salto(self):
        cm = motor({"T": (["ID", "DOC", "SEQ"], list(self.LINHAS))})
        cm._seq_livre = cm._preparar_seq_livre(self._plano())
        m = cm._seq_livre["#seq_livre:DOC:SEQ"]
        self.assertEqual({k: v[0] for k, v in m.items()}, {"3": 4, "5": 5, "6": 6})  # ordem da chave
        pend = []
        self.assertEqual(cm._seq_livre_valor("#seq_livre:DOC:SEQ", {"SEQ": 2}, "2", pend), 2)
        self.assertEqual(cm._seq_livre_valor("#seq_livre:DOC:SEQ", {"SEQ": 2}, "6", pend), 6)
        self.assertEqual(pend, [("sequencia_renumerada", "baixa", "original=2")])
        self.assertEqual(cm._seq_livre_valor("#seq_livre:DOC:SEQ", {"SEQ": 9}, "8", []), 9)

    def test_reexecucao_nao_renumera(self):
        linhas = list(self.LINHAS)
        random.Random(7).shuffle(linhas)  # outra ordem de leitura: o mesmo número
        a = motor({"T": (["ID", "DOC", "SEQ"], list(self.LINHAS))})._preparar_seq_livre(self._plano())
        b = motor({"T": (["ID", "DOC", "SEQ"], linhas)})._preparar_seq_livre(self._plano())
        self.assertEqual(a, b)


class SeqFaixa(unittest.TestCase):
    def test_um_numero_por_chave_acima_do_piso(self):
        cm = motor({"GECADSAI": (["ID", "ANO"], [(70, 1), (65, 2)])}, um=lambda *a: 50)
        conc = {"coluna": "DOC", "destino": "numero", "passos": mapa.passos_ref("GECADSAI>ID")}
        p = {"tabela": "REQ", "colunas": {"req": [conc, {"coluna": "#seq_faixa:ANO+DOC", "destino": "numero"}]}}
        n = "#seq_faixa:ANO+DOC"
        self.assertEqual(cm._seq_faixa_valor(p, "req", "numero", n, {"ANO": 2026, "DOC": 3}), 71)
        self.assertEqual(cm._seq_faixa_valor(p, "req", "numero", n, {"ANO": 2026, "DOC": 3}), 71)
        self.assertEqual(cm._seq_faixa_valor(p, "req", "numero", n, {"ANO": 2026, "DOC": 4}), 72)


class SufixoColisao(unittest.TestCase):
    def test_colisao_ganha_a_chave_da_origem(self):
        cm = motor(um=lambda sql, a: 1 if a == [1, "Agenda A"] else 0)
        cm._unicos_dc = {("agenda", "nome"): [["estabelecimento_id", "nome"]]}
        pend = []
        self.assertEqual(cm._sufixo_colisao("agenda", "nome", {"estabelecimento_id": 1, "nome": "Agenda A"}, "12",
                                            pend), "Agenda A (12)")
        self.assertEqual(cm._sufixo_colisao("agenda", "nome", {"estabelecimento_id": 1, "nome": "Agenda B"}, "13",
                                            pend), "Agenda B")
        self.assertEqual(cm._sufixo_colisao("agenda", "nome", {"estabelecimento_id": 1, "nome": "agenda b "}, "14",
                                            pend), "agenda b  (14)")  # a mesma desta execução, sem caixa
        self.assertEqual([r for r, _ in pend], ["sufixo_na_colisao", "sufixo_na_colisao"])


def _col(coluna, destino, **kw):
    return dict({"coluna": coluna, "destino": destino, "regra": "texto", "depara": "", "referencia": "",
                 "valores": None}, **kw)


class PresumidaESeNulo(unittest.TestCase):
    def _valores(self, cols, linha):
        cm = motor()
        cm.info = {"d": {c: (True, "varchar", None, False, None) for c in ("a", "b", "c")}}
        p = {"tabela": "T", "destinos": ["d"], "opcoes": {"d": {}}, "colunas": {"d": cols}, "duas_fases": {"T"}}
        vals, _, pend, recusa, _ = cm._valores(p, linha, "1")
        return vals["d"][0][1], pend, recusa, cm._presumidas

    def test_presumida_na_unica_declaracao(self):
        v, pend, recusa, pres = self._valores([_col("A", "a", presumida=True)], {"A": "x"})
        self.assertEqual((v["a"], recusa, pend, pres), ("x", None, [("valor_presumido", "baixa")], {("d", "a")}))
        v, pend, _, _ = self._valores([_col("A", "a", presumida=True)], {"A": None})
        self.assertEqual(pend, [])

    def test_pendencia_se_nulo_pelo_valor_final(self):
        cols = [_col("A", "a", pendencia_se_nulo="carteira_ausente_migrada"), _col("B", "a")]
        v, pend, _, _ = self._valores(cols, {"A": None, "B": None})
        self.assertEqual((v["a"], pend), (None, [("carteira_ausente_migrada", "media")]))
        v, pend, _, _ = self._valores(cols, {"A": None, "B": "y"})  # a concorrente deu o valor: sem pendência
        self.assertEqual((v["a"], pend), ("y", []))


class DependenciaNaoCarregada(unittest.TestCase):
    def _cm(self, concluidas=()):
        cm = motor(todas=lambda sql, *a: [(t,) for t in concluidas])
        cm.mapa_exec = {"deps": [{"tabela": "FILHO", "depende_de": "PAI"}, {"tabela": "NETO", "depende_de": "FILHO"},
                                 {"tabela": "CICLO", "depende_de": "PAI", "quebra": "1"}]}
        cm.plano = [{"tabela": t} for t in ("FILHO", "NETO", "CICLO", "OUTRA")]
        return cm

    def test_filho_e_neto_adiados_com_uma_pendencia_cada(self):
        cm = self._cm()
        todas = [{"tabela": t} for t in ("PAI", "FILHO", "NETO", "CICLO", "OUTRA")]
        with mock.patch.object(carga_mapa, "planejar", return_value=todas):
            self.assertEqual(cm._adiar_dependentes({"FILHO", "NETO", "CICLO", "OUTRA"}, {"PAI": 10}),
                             {"FILHO": "PAI", "NETO": "FILHO"})
        self.assertEqual(cm.tabelas, ["CICLO", "OUTRA"])  # nunca entram no plano: nenhuma linha recusada
        self.assertEqual([(t, k, r) for t, k, r, _, _ in cm.pendencias],
                         [("FILHO", "*", "dependencia_nao_carregada"), ("NETO", "*", "dependencia_nao_carregada")])

    def test_dependencia_concluida_antes_nao_adia(self):
        cm = self._cm(concluidas=("PAI",))
        todas = [{"tabela": t} for t in ("PAI", "FILHO", "NETO", "CICLO", "OUTRA")]
        with mock.patch.object(carga_mapa, "planejar", return_value=todas):
            self.assertEqual(cm._adiar_dependentes({"FILHO", "NETO", "CICLO", "OUTRA"}, {"PAI": 10}), {})
        self.assertEqual(len(cm.plano), 4)


if __name__ == "__main__":
    unittest.main()
