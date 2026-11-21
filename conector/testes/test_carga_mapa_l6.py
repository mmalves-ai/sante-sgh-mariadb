"""Recursos genéricos do motor acrescentados na integração do L6 (carga_mapa, sentinela, mapa, conferência). Só
dados falsos."""
import datetime
import decimal
import tempfile
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela


class Regras(unittest.TestCase):
    def test_hora_hhmm_em_texto(self):
        h = datetime.time
        self.assertEqual([sentinela.aplicar("hora_hhmm", v) for v in ("0830", "08:30", " 930", "", "2460", "ab", 1415)],
                         [(h(8, 30), None), (h(8, 30), None), (h(9, 30), None), (None, None),
                          (None, "hora_invalida"), (None, "hora_invalida"), (h(14, 15), None)])

    def test_inteiro_nao_negativo(self):
        self.assertEqual([sentinela.aplicar("inteiro_nao_negativo", v) for v in (3, 0, -1, None)],
                         [(3, None), (0, None), (None, "valor_fora_do_dominio"), (None, None)])

    def test_decimal_zero_nulo(self):
        self.assertEqual([sentinela.aplicar("decimal_zero_nulo", v) for v in (decimal.Decimal("0.00"), 2.5, None)],
                         [(None, None), (decimal.Decimal("2.5"), None), (None, None)])

    def test_regras_novas_sao_validas(self):
        for r in ("inteiro_nao_negativo", "decimal_zero_nulo"):
            self.assertIn(r, sentinela.REGRAS)


class Tipar(unittest.TestCase):
    def test_texto_nao_numerico_em_destino_numerico(self):
        self.assertIs(carga_mapa.tipar("abc", "int"), carga_mapa.NAO_NUMERICO)
        self.assertIs(carga_mapa.tipar("1,5x", "decimal"), carga_mapa.NAO_NUMERICO)
        self.assertEqual(carga_mapa.tipar(" 12 ", "int"), 12)


class Ddl(unittest.TestCase):
    def test_ponto_e_virgula_em_literal_e_check_redefinido(self):
        with tempfile.TemporaryDirectory() as d:
            m = Path(d) / "db/migracoes/99_X"
            m.mkdir(parents=True)
            (m / "01_tabelas.sql").write_text(
                "CREATE TABLE exemplo_x (\n  id INT,\n  situacao VARCHAR(10)\n) COMMENT='a; b';\n"
                "ALTER TABLE exemplo_x DROP CONSTRAINT ck_x, ADD CONSTRAINT ck_x CHECK (situacao IN ('a;b','c'));\n"
                "ALTER TABLE exemplo_x ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES exemplo_y (id);\n",
                encoding="utf-8")
            ddl = mapa.ler_ddl(Path(d))
        t = ddl["exemplo_x"]
        self.assertTrue(t["create"].endswith("COMMENT='a; b';"))
        self.assertEqual(len(t["alter"]), 1)
        self.assertIn("'a;b'", t["alter"][0])
        self.assertEqual(len(t["fks"]), 1)


class ValoresPorFatia(unittest.TestCase):
    def test_valores_d_lido_junto(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "declarado/valores.d"
            p.mkdir(parents=True)
            cab = "\t".join(mapa.CAMPOS_VALORES) + "\n"
            (Path(d) / "declarado/valores.tsv").write_text(cab + "TA\tC\tx.y\t1\tum\tm\n", encoding="utf-8")
            (p / "L9-01.tsv").write_text(cab + "TB\tC\tx.z\t\tnulo\tm\n", encoding="utf-8")
            v = mapa.ler_valores(Path(d))
        self.assertEqual([(r["tabela"], r["valor_origem"], r["valor_destino"]) for r in v],
                         [("TA", "1", "um"), ("TB", "", "nulo")])


if __name__ == "__main__":
    unittest.main()
