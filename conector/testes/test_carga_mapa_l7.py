"""Regras genéricas acrescentadas na integração do L7 (sentinela e verificador do mapa). Só dados falsos: os CNPJ e
CPF abaixo são números fictícios de exemplo, com o dígito verificador calculado."""
import decimal
import unittest

from sante_conector import sentinela

D = decimal.Decimal
FORA = "valor_fora_do_dominio"


class Documento(unittest.TestCase):
    def test_cnpj_volta_aos_14_digitos_e_confere_o_verificador(self):
        self.assertEqual(sentinela.aplicar("cnpj", 11222333000181), ("11222333000181", None))
        self.assertEqual(sentinela.aplicar("cnpj", "11.222.333/0001-81"), ("11222333000181", None))
        # zeros à esquerda: o inteiro perdeu os dígitos iniciais e o verificador continua certo
        self.assertEqual(sentinela.aplicar("cnpj", 123456000149), ("00123456000149", None))

    def test_cnpj_invalido_nao_expoe_valor(self):
        for v in (12345678000199, 11111111111111, 123456789012345, "12a", -5):
            self.assertEqual(sentinela.aplicar("cnpj", v), (None, "documento_invalido"), v)

    def test_zero_e_vazio_sao_sem_documento(self):
        for v in (0, "", "   ", None):
            self.assertEqual(sentinela.aplicar("cnpj", v), (None, None))

    def test_cpf_e_cpf_cnpj(self):
        self.assertEqual(sentinela.aplicar("cpf", 52998224725), ("52998224725", None))
        self.assertEqual(sentinela.aplicar("cpf", 52998224726), (None, "documento_invalido"))
        self.assertEqual(sentinela.aplicar("cpf_cnpj", 52998224725), ("52998224725", None))
        self.assertEqual(sentinela.aplicar("cpf_cnpj", 11222333000181), ("11222333000181", None))
        self.assertEqual(sentinela.aplicar("cpf", 11222333000181), (None, "documento_invalido"))


class Parametro(unittest.TestCase):
    def test_inteiro_zeros_esquerda(self):
        r = "inteiro_zeros_esquerda:8"
        self.assertEqual([sentinela.aplicar(r, v) for v in (1000000, "01000-000", 123456789, 0, None)],
                         [("01000000", None), ("01000000", None), (None, FORA), (None, FORA), (None, None)])

    def test_inteiro_faixa(self):
        r = "inteiro_faixa:0,365"
        self.assertEqual([sentinela.aplicar(r, v) for v in (0, 365, 400, -5, D("10"), D("1.5"), "x", None)],
                         [(0, None), (365, None), (None, FORA), (None, FORA), (10, None), (None, FORA), (None, FORA),
                          (None, None)])

    def test_regra_conhecida(self):
        for r in ("texto", "cnpj", "cpf", "cpf_cnpj", "preenchido", "decimal_positivo", "inteiro_faixa:0,365",
                  "inteiro_faixa:-1,1", "inteiro_zeros_esquerda:8"):
            self.assertTrue(sentinela.regra_conhecida(r), r)
        for r in ("inteiro_faixa:5,1", "inteiro_faixa:a,b", "inteiro_faixa", "inteiro_zeros_esquerda:0",
                  "texto:1", "inexistente", ""):
            self.assertFalse(sentinela.regra_conhecida(r), r)
        with self.assertRaises(KeyError):
            sentinela.aplicar("inteiro_faixa:5,1", 3)


class Simples(unittest.TestCase):
    def test_preenchido(self):
        self.assertEqual([sentinela.aplicar("preenchido", v) for v in ("Equipamento", "   ", b"x", 7, None)],
                         [(True, None), (False, None), (True, None), (True, None), (None, None)])

    def test_decimal_positivo(self):
        self.assertEqual([sentinela.aplicar("decimal_positivo", v) for v in (D("1.000"), 0, D("-2"), 0.5, None)],
                         [(D("1.000"), None), (None, FORA), (None, FORA), (D("0.5"), None), (None, None)])


if __name__ == "__main__":
    unittest.main()
