"""Carregador do cadastro nacional (C3-011): leitura do pacote oficial com dados sintéticos, filtro e script."""
import importlib.util
import io
import unittest
import zipfile
from pathlib import Path

CNES = Path(__file__).resolve().parents[1] / "carregadores/cnes.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_cnes_teste", CNES)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _pacote(sem_habilitacao=False):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as zf:
        zf.writestr("tbEstabelecimento202610.csv",
                    '"CO_UNIDADE";"CO_CNES";"NU_CNPJ";"NO_RAZAO_SOCIAL";"NO_FANTASIA";"TP_UNIDADE";"CO_MUNICIPIO_GESTOR"\n'
                    '"3500009999991";"9999991";"00000000000191";"HOSPITAL SINTETICO A";"SINTETICO A";"05";"350000"\n'
                    '"3300009999992";"9999992";"";"HOSPITAL SINTETICO B";"";"05";"330000"\n'.encode("latin-1"))
        if not sem_habilitacao:
            zf.writestr("rlEstabHabilitacao202610.csv",
                        "CO_UNIDADE;CO_CODIGO_GRUPO;NU_COMPETENCIA_INICIAL;NU_COMPETENCIA_FINAL;NU_PORTARIA;QT_LEITOS\n"
                        "3500009999991;2601;201501;;123/2015;10\n3300009999992;0801;202001;;;\n")
        zf.writestr("rlEstabServClass202610.csv", "CO_UNIDADE;CO_SERVICO;CO_CLASSIFICACAO\n3500009999991;121;1\n")
        zf.writestr("rlEstabComplementar202610.csv",
                    "CO_UNIDADE;CO_LEITO;CO_TIPO_LEITO;QT_EXIST;QT_CONTR;QT_SUS\n3500009999991;74;3;10;0;12\n")
    b.seek(0)
    return zipfile.ZipFile(b)


class TesteCnes(unittest.TestCase):
    def test_competencia_do_nome(self):
        m = _mod()
        self.assertEqual(m.competencia_do_pacote("BASE_DE_DADOS_CNES_202610.ZIP"), "202610")
        with self.assertRaises(ValueError):
            m.competencia_do_pacote("BASE_DE_DADOS_CNES.ZIP")

    def test_filtra_pelos_numeros_aceitos(self):
        m = _mod()
        d = m.ler_pacote(_pacote(), lambda cnes, unidade: cnes == "9999991")
        self.assertEqual([x["cnes"] for x in d["estabelecimento"]], ["9999991"])
        self.assertEqual([x["codigo"] for x in d["habilitacao"]], ["2601"])
        self.assertEqual(len(d["servico"]), 1)
        self.assertEqual(len(d["leito"]), 1)

    def test_filtro_por_uf_pelo_codigo_da_unidade(self):
        m = _mod()
        d = m.ler_pacote(_pacote(), lambda cnes, unidade: unidade[:2] == "33")
        self.assertEqual([x["cnes"] for x in d["estabelecimento"]], ["9999992"])

    def test_script_normaliza_codigos_e_limita_sus(self):
        m = _mod()
        script, n = m.montar_script(m.ler_pacote(_pacote(), lambda c, u: True), "202610")
        self.assertEqual(n, {"estabelecimento_cadastro_nacional": 2, "habilitacao_cadastro_nacional": 2,
                             "servico_cadastro_nacional": 1, "leito_cadastro_nacional": 1})
        self.assertIn("'2026-10-01', '9999991', '2601', '2015-01-01', NULL, '123/2015', '10'", script)
        self.assertIn("'121', '001'", script)
        self.assertIn("'3', '74', '10', '10'", script)
        self.assertIn("ON DUPLICATE KEY UPDATE", script)

    def test_pacote_sem_tabela_opcional_avisa(self):
        m = _mod()
        d = m.ler_pacote(_pacote(sem_habilitacao=True), lambda c, u: True)
        self.assertEqual(d["habilitacao"], [])
        self.assertTrue(any("habilitacao" in a for a in m.AVISOS))

    def test_coluna_obrigatoria_ausente_para_a_carga(self):
        m = _mod()
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as zf:
            zf.writestr("tbEstabelecimento202610.csv", "CO_UNIDADE;CO_CNES\n3500009999991;9999991\n")
        b.seek(0)
        with self.assertRaises(ValueError):
            m.ler_pacote(zipfile.ZipFile(b), lambda c, u: True)


if __name__ == "__main__":
    unittest.main()
