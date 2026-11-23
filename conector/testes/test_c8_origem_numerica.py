"""C8: colunas numéricas da origem real (NUMERO, CEP, IBGE inteiros no Firebird) na nota de endereço sem município.
Achado na prova da cadeia em dado real (22/11): o NUMERO inteiro derrubava a carga própria inteira (TypeError)."""
import unittest

from sante_conector import carga


class NotaEnderecoOrigemNumerica(unittest.TestCase):
    def test_numero_cep_ibge_inteiros(self):
        l = {"ENDERECO": b"RUA A", "NUMERO": 120, "COMPL": None, "BAIRRO": b"CENTRO", "CEP": 1001000, "IBGE": None}
        nota = carga.nota_endereco(l)
        self.assertIn("120", nota)
        self.assertIn("CEP 1001000", nota)

    def test_numero_zero_ou_ausente_nao_entra(self):
        l = {"ENDERECO": b"RUA A", "NUMERO": None, "COMPL": None, "BAIRRO": None, "CEP": None, "IBGE": None}
        self.assertTrue(carga.nota_endereco(l).endswith("RUA A"))


if __name__ == "__main__":
    unittest.main()
