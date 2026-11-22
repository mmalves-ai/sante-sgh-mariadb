"""Mecanismos genéricos da rodada 3 de cobertura do conector (F4), regras de data e hora: recorrência pelo ano-marca,
período com a unidade em outra coluna (`#dias`), data + hora HHMM com virada da meia-noite e `desdobrar` em pares no
destino principal. Só dados falsos (imagem sintética `exemplo_r3`)."""
import datetime
import os
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import exemplo_r3

FORA = "valor_fora_do_dominio"
D = datetime.date


class Recorrencia(unittest.TestCase):
    def test_regras_de_recorrencia(self):
        f = sentinela.aplicar
        for r in ("ano_recorrente:9999", "data_nao_recorrente:9999", "dia_recorrente:9999", "mes_recorrente:9999"):
            self.assertTrue(sentinela.regra_conhecida(r), r)
        self.assertFalse(sentinela.regra_conhecida("ano_recorrente:x"))
        self.assertEqual(f("ano_recorrente:9999", D(9999, 12, 25)), (True, None))
        self.assertEqual(f("ano_recorrente:9999", D(2026, 4, 3)), (False, None))
        self.assertEqual(f("data_nao_recorrente:9999", D(9999, 12, 25)), (None, None))
        self.assertEqual(f("data_nao_recorrente:9999", D(2026, 4, 3)), (D(2026, 4, 3), None))
        self.assertEqual(f("dia_recorrente:9999", D(9999, 12, 25)), (25, None))
        self.assertEqual(f("mes_recorrente:9999", D(9999, 12, 25)), (12, None))
        self.assertEqual(f("dia_recorrente:9999", D(2026, 4, 3)), (None, None))
        self.assertEqual(f("ano_recorrente:9999", D(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(f("mes_recorrente:9999", datetime.datetime(9999, 1, 6, 0, 0)), (1, None))
        self.assertEqual(f("dia_recorrente:9999", "x"), (None, FORA))


class Periodo(unittest.TestCase):
    def test_periodo_em_dias(self):
        f = sentinela.periodo_em_dias
        self.assertEqual(f(0, "dia"), (0, None))
        self.assertEqual(f(2, "Semanas"), (14, None))
        self.assertEqual(f(6, "M"), (180, "periodo_aproximado"))
        self.assertEqual(f(12.0, "ano"), (4380, "periodo_aproximado"))
        self.assertEqual(f(1.5, "anos"), (547, "periodo_aproximado"))
        self.assertEqual(f(48, "horas"), (2, None))
        self.assertEqual(f(36, "h"), (1, "periodo_aproximado"))
        self.assertEqual(f(b"3", "D"), (3, None))
        self.assertEqual(f(None, "dia"), (None, None))
        self.assertEqual(f("  ", "dia"), (None, None))
        self.assertEqual(f(-1, "dia"), (None, FORA))
        self.assertEqual(f("abc", "dia"), (None, FORA))
        self.assertEqual(f(3, "quinzena"), (None, FORA))
        self.assertEqual(f(3, None), (None, "unidade_ausente"))
        self.assertIsNone(sentinela.unidade_periodo("xx"))


class DataHoraVirada(unittest.TestCase):
    def test_virada_da_meia_noite(self):
        f, d = carga_mapa.data_hora_composta, D(2026, 4, 2)
        self.assertEqual(f(d, "0130", "2200", com_ref=True), (datetime.datetime(2026, 4, 3, 1, 30), "virada_de_dia"))
        self.assertEqual(f(d, "1000", "0800", com_ref=True), (datetime.datetime(2026, 4, 2, 10, 0), None))
        self.assertEqual(f(d, "0900", "2575", com_ref=True), (datetime.datetime(2026, 4, 2, 9, 0), None))
        self.assertEqual(f(d, "0900", None, com_ref=True), (datetime.datetime(2026, 4, 2, 9, 0), None))
        self.assertEqual(f(d, None, "2200", com_ref=True), (datetime.datetime(2026, 4, 2), None))
        self.assertEqual(f(d, "0130", "2200"), (datetime.datetime(2026, 4, 2, 1, 30), None))  # sem a 3ª coluna


class Plano(unittest.TestCase):
    def setUp(self):
        self.plano = {p["tabela"]: p for p in carga_mapa.planejar(
            exemplo_r3.MAPA_TESTE, {"EX3_FER", "EX3_HOR", "EX3_UNI", "EX3_IDA", "EX3_ATO"})}

    def test_le_as_colunas_dos_pares_do_dias_e_da_hora_de_referencia(self):
        self.assertTrue({"SEG_I", "SEG_F", "FER_I", "FER_F"} <= set(self.plano["EX3_HOR"]["lidas"]))
        self.assertTrue({"IDADE_MIN", "UN_MIN", "PRAZO_UN", "ANOS"} <= set(self.plano["EX3_IDA"]["lidas"]))
        self.assertNotIn("=ano", self.plano["EX3_IDA"]["lidas"])
        self.assertIn("HORA_I", self.plano["EX3_ATO"]["lidas"])
        self.assertNotIn("EX3_UNI", self.plano)
        dias = {c["coluna"]: c for c in self.plano["EX3_IDA"]["colunas"]["ex3_faixa"]}
        self.assertEqual(dias["#dias:ANOS,=ano"]["regra"], "inteiro_zero_nulo")
        self.assertEqual(dias["#dias:IDADE_MIN,UN_MIN"]["regra"], "")
        self.assertEqual(dias["#dias:IDADE_MIN,UN_MIN"]["passos"][-1], {"coluna": "CALCULO"})
        self.assertEqual(dias["#dias:PRAZO,PRAZO_UN"]["valores"], {"D": "dia", "S": "semana"})

    def test_marcas_de_item(self):
        self.assertEqual([mapa.posicao_item(x) for x in ("#item", "#item2", "#rotulo", "#rotulo3")], [0, 1, 0, 2])
        self.assertIsNone(mapa.posicao_item("#retrato"))


class Verificador(unittest.TestCase):
    DDL = {t: {"colunas": cs} for t, cs in (
        ("ex3_horario", ["id", "grade", "dia_semana", "dia_nao_util", "hora_inicio", "hora_fim"]),
        ("ex3_faixa", ["id", "codigo", "idade_minima_dias", "idade_maxima_dias", "prazo_dias", "limite_dias"]),
        ("ex3_ato", ["id", "numero", "inicio_em", "fim_em"]))}

    def _decl(self, t):
        return [dict(c, _arquivo="x") for c in exemplo_r3.MAPA_TESTE["colunas_decl"] if c["tabela"] == t]

    def test_exemplo_sem_erros(self):
        tabs = exemplo_r3.MAPA_TESTE["tabelas"]
        for t in ("EX3_HOR", "EX3_IDA", "EX3_ATO"):
            self.assertEqual(mapa.erros_especiais_e_opcoes(self._decl(t), tabs, self.DDL), [], t)

    def test_recusas(self):
        tabs = exemplo_r3.MAPA_TESTE["tabelas"]
        hor = self._decl("EX3_HOR")
        sem_item2 = [c for c in hor if c["coluna"] != "#item2"]
        self.assertTrue(any("sem #item correspondente" in e for e in mapa.erros_especiais_e_opcoes(
            sem_item2, tabs, self.DDL)))
        rot_rep = [dict(c, via="desdobrar:SEG_I+SEG_F=2|0,TER_I+TER_F=2|0") if c["coluna"] == "#item" else c
                   for c in hor]
        self.assertTrue(any("rótulo repetido" in e for e in mapa.erros_especiais_e_opcoes(rot_rep, tabs, self.DDL)))
        compl = hor + [dict(hor[0], coluna="ID", destino="ex3_horario.id", via="ref:EX3_FER;complementa")]
        self.assertTrue(any("não pode ser complementa" in e for e in mapa.erros_especiais_e_opcoes(
            compl, tabs, self.DDL)))
        ida = self._decl("EX3_IDA")
        ruins = [dict(ida[1], via="ref:EX3_UNI"), dict(ida[4], coluna="#dias:ANOS,=quinzena")]
        self.assertEqual(len(mapa.erros_especiais_e_opcoes(ruins, tabs, self.DDL)), 2)
        self.assertTrue(mapa._ESPECIAIS.fullmatch("#data_hora:DATA,HORA_F,HORA_I"))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR3(unittest.TestCase):
    def test_mecanismos_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT descricao, recorrencia, dia, mes, DATE_FORMAT(data, '%Y-%m-%d') FROM ex3_dia"
                          " ORDER BY id")
                lidos["dia"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT grade, dia_semana, dia_nao_util, TIME_FORMAT(hora_inicio, '%H:%i'),"
                          " TIME_FORMAT(hora_fim, '%H:%i') FROM ex3_horario ORDER BY id")
                lidos["horario"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT codigo, idade_minima_dias, idade_maxima_dias, prazo_dias, limite_dias FROM ex3_faixa"
                          " ORDER BY codigo")
                lidos["faixa"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT numero, DATE_FORMAT(inicio_em, '%Y-%m-%d %H:%i'), DATE_FORMAT(fim_em,"
                          " '%Y-%m-%d %H:%i') FROM ex3_ato ORDER BY numero")
                lidos["ato"] = [list(x) for x in c.fetchall()]
        r = conferencia.conferir("exemplo_r3", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertTrue(all(e["conferido"] for e in r["entidades"].values()))
        self.assertEqual(lidos["dia"], [["Natal de exemplo", "anual", 25, 12, None],
                                        ["Feriado de exemplo", "data_unica", None, None, "2026-04-03"]])
        self.assertEqual(lidos["horario"], [[1, 2, 0, "08:00", "12:00"], [1, 3, 0, "08:00", "18:00"],
                                            [1, None, 1, "09:00", "12:00"], [4, 3, 0, "07:00", "11:00"]])
        self.assertEqual(lidos["faixa"], [[1, 0, 4380, 14, 365], [2, 180, 2, None, None],
                                          [3, None, 547, None, None], [4, None, None, None, 730]])
        self.assertEqual(lidos["ato"], [[1, "2026-04-02 22:00", "2026-04-03 01:30"],
                                        [2, "2026-04-02 08:00", "2026-04-02 10:00"],
                                        [3, None, "2026-04-04 09:00"]])
        ent = r["entidades"]
        self.assertEqual((ent["ex3_horario"]["registros_origem"], ent["ex3_horario"]["registros_destino"],
                          ent["ex3_horario"]["recusados"]), (4, 4, 2))
        self.assertEqual(r["segunda"]["puladas_iguais"], 3 + 4 + 4 + 3)


if __name__ == "__main__":
    unittest.main()
