"""Regras genéricas acrescentadas na integração do L8 (sentinela). Só dados falsos."""
import datetime
import decimal
import unittest

from sante_conector import sentinela

D = decimal.Decimal
FORA = "valor_fora_do_dominio"


class DecimalNaoNegativo(unittest.TestCase):
    def test_zero_fica_e_negativo_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", D("0.00")), (D("0.00"), None))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", D("12.50")), (D("12.50"), None))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", D("-0.01")), (None, FORA))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", None), (None, None))


class CompetenciaAaaamm(unittest.TestCase):
    def test_inteiro_e_texto(self):
        self.assertEqual(sentinela.aplicar("competencia_aaaamm", 202501), (datetime.date(2025, 1, 1), None))
        self.assertEqual(sentinela.aplicar("competencia_aaaamm", " 202612 "), (datetime.date(2026, 12, 1), None))
        self.assertEqual(sentinela.aplicar("competencia_aaaamm", D("202603")), (datetime.date(2026, 3, 1), None))

    def test_invalido_vira_nulo_com_pendencia(self):
        for v in (202513, 202500, 12, 99999999, "2025-01", "abcdef", D("202501.5")):
            self.assertEqual(sentinela.aplicar("competencia_aaaamm", v), (None, FORA), v)

    def test_vazio_e_zero_sem_pendencia(self):
        for v in (None, 0, "", "  "):
            self.assertEqual(sentinela.aplicar("competencia_aaaamm", v), (None, None), v)


class DataPrimeiroDiaMes(unittest.TestCase):
    def test_data_e_timestamp(self):
        self.assertEqual(sentinela.aplicar("data_primeiro_dia_mes", datetime.date(2026, 5, 17)),
                         (datetime.date(2026, 5, 1), None))
        self.assertEqual(sentinela.aplicar("data_primeiro_dia_mes", datetime.datetime(2026, 5, 17, 10, 30)),
                         (datetime.date(2026, 5, 1), None))

    def test_sentinela(self):
        self.assertEqual(sentinela.aplicar("data_primeiro_dia_mes", datetime.date(1899, 12, 30)),
                         (None, "data_sentinela"))


class Conhecidas(unittest.TestCase):
    def test_regras_novas_reconhecidas_pelo_verificador(self):
        for r in ("decimal_nao_negativo", "competencia_aaaamm", "data_primeiro_dia_mes"):
            self.assertTrue(sentinela.regra_conhecida(r), r)


if __name__ == "__main__":
    unittest.main()
