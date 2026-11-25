"""Hierarquia da CID-10 do carregador oficial (capítulos, grupos e subgrupos), com amostra sintética no formato do arquivo
do DATASUS (CSV ';', latin-1, cabeçalho na 1ª linha). Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

CID10 = Path(__file__).resolve().parents[1] / "carregadores/cid10.py"


def _cid10():
    esp = importlib.util.spec_from_file_location("carregador_cid10_teste", CID10)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


CAPITULOS = (
    "NUMCAP;CATINIC;CATFIM;DESCRICAO;DESCRABREV\n"
    "1;A00;B99;Capítulo I - Algumas doenças infecciosas e parasitárias;I. Algumas doenças infecciosas\n"
    "9;I00;I99;Capítulo IX - Doenças do aparelho circulatório;IX. Doenças do aparelho circulatório\n"
)
# I20-I25 é grupo; I21-I22 é subgrupo dentro dele (faixa mais estreita), e I21-I21 subgrupo do subgrupo.
GRUPOS = (
    "CATINIC;CATFIM;DESCRICAO;DESCRABREV\n"
    "A00;A09;Doenças infecciosas intestinais;\n"
    "A15;A19;Tuberculose;\n"
    "I20;I25;Doenças isquêmicas do coração;\n"
    "I21;I22;Infarto agudo do miocárdio;IAM\n"
    "I21;I21;Infarto agudo do miocárdio, primeiro episódio;\n"
)


def _zip(caminho):
    with zipfile.ZipFile(caminho, "w") as z:
        z.writestr("CID-10-CAPITULOS.CSV", CAPITULOS.replace("\n", "\r\n").encode("latin-1"))
        z.writestr("CID-10-GRUPOS.CSV", GRUPOS.encode("latin-1"))


class HierarquiaCid10(unittest.TestCase):
    def setUp(self):
        self.mod = _cid10()
        self.tmp = tempfile.TemporaryDirectory()
        arq = Path(self.tmp.name) / "CID10CSV.zip"
        _zip(arq)
        with zipfile.ZipFile(arq) as z:
            self.caps = self.mod._ler(z, "CID-10-CAPITULOS.CSV")
            self.grps = self.mod._ler(z, "CID-10-GRUPOS.CSV")
        self.h = self.mod.hierarquia(self.caps, self.grps)

    def tearDown(self):
        self.tmp.cleanup()

    def test_leitura_latin1_sem_cabecalho_e_sem_cr(self):
        self.assertEqual(len(self.caps), 2)
        self.assertEqual(self.caps[1][3], "Capítulo IX - Doenças do aparelho circulatório")
        self.assertEqual(self.caps[1][4], "IX. Doenças do aparelho circulatório")
        self.assertEqual(len(self.grps), 5)

    def test_capitulos_com_numero_romano_e_faixa(self):
        capitulos = self.h[0]
        self.assertEqual([(c[0], c[1], c[2], c[3]) for c in capitulos], [("I", 1, "A00", "B99"), ("IX", 9, "I00", "I99")])
        self.assertEqual(capitulos[1][4], "Doenças do aparelho circulatório")

    def test_pai_e_nivel_pela_faixa_mais_estreita(self):
        _, faixas, pai, prof = self.h
        nivel = {f"{g[0]}-{g[1]}": self.mod.nivel_agrupamento(pai, g) for g in faixas}
        self.assertEqual(nivel, {"A00-A09": "grupo", "A15-A19": "grupo", "I20-I25": "grupo",
                                 "I21-I22": "subgrupo", "I21-I21": "subgrupo"})
        self.assertEqual(pai[("I21", "I22")], ("I20", "I25"))
        self.assertEqual(pai[("I21", "I21")], ("I21", "I22"))
        self.assertIsNone(pai[("I20", "I25")])
        self.assertEqual((prof[("I20", "I25")], prof[("I21", "I22")], prof[("I21", "I21")]), (0, 1, 2))
        # sem abreviatura na fonte: None (coluna descricao_abreviada nula)
        self.assertIsNone([g for g in faixas if g[:2] == ("A00", "A09")][0][3])

    def test_codigo_no_capitulo_e_no_agrupamento_mais_estreito(self):
        capitulos, faixas, _, _ = self.h
        self.assertEqual(self.mod.capitulo_de(capitulos, "I219")[0], "IX")
        self.assertEqual(self.mod.capitulo_de(capitulos, "A01")[0], "I")
        self.assertEqual(self.mod.grupo_de(faixas, "I219"), ("I21", "I21"))
        self.assertEqual(self.mod.grupo_de(faixas, "I220"), ("I21", "I22"))
        self.assertEqual(self.mod.grupo_de(faixas, "I250"), ("I20", "I25"))
        self.assertIsNone(self.mod.grupo_de(faixas, "B20"))
        with self.assertRaisesRegex(RuntimeError, "fora de capítulo"):
            self.mod.capitulo_de(capitulos, "Z00")

    def test_recusa_capitulo_sem_romano_e_grupo_entre_capitulos(self):
        ruim = [["2", "C00", "D48", "Neoplasias", ""]]
        with self.assertRaisesRegex(RuntimeError, "sem número romano"):
            self.mod.hierarquia(ruim, [])
        with self.assertRaisesRegex(RuntimeError, "atravessa capítulos"):
            self.mod.hierarquia(self.caps, [["A90", "I05", "Faixa inválida", ""]])

    def test_largura_escolhe_a_faixa_mais_estreita(self):
        self.assertEqual(self.mod._largura(("A00", "B99")), 199)
        self.assertEqual(self.mod._largura(("I21", "I21")), 0)


if __name__ == "__main__":
    unittest.main()


class TopografiaCidO(unittest.TestCase):
    """09-AREA L69: a topografia da CID-O-3 derivada das categorias C00-C80 da CID-10."""

    def test_deriva_sitios_com_ponto_e_sem_prefixo(self):
        m = _cid10()
        cats = [["C01", "", "Neoplasia maligna da base da língua"], ["C50", "", "Neoplasia maligna da mama"],
                ["C43", "", "Melanoma maligno da pele"], ["C79", "", "Neoplasia maligna secundária de outras localizações"],
                ["C91", "", "Leucemia linfóide"], ["C77", "", "Neoplasia maligna secundária e não especificada dos gânglios linfáticos"]]
        subs4 = [["C504", "", "", "", "Neoplasia maligna do quadrante superior externo da mama"],
                 ["C509", "", "", "", "Neoplasia maligna da mama, não especificada"],
                 ["C430", "", "", "", "Melanoma maligno do lábio"],
                 ["C910", "", "", "", "Leucemia linfoblástica aguda"]]
        t = {c: (d, cat) for c, d, cat in m.topografias(cats, subs4)}
        self.assertEqual(t["C50.4"], ("Quadrante superior externo da mama", "C50"))
        self.assertEqual(t["C01.9"], ("Base da língua", "C01"))
        self.assertEqual(t["C77.9"], ("Linfonodo, SOE", "C77"))
        self.assertEqual(t["C77.3"], ("Linfonodos da axila ou do membro superior", "C77"))
        self.assertIn("C42.1", t)
        for fora in ("C43.0", "C79.9", "C91.0", "C43.9"):
            self.assertNotIn(fora, t)

    def test_fonte_rotulada_como_derivada_e_nao_cid_o3(self):
        m = _cid10()
        v = m.versao_topografia("2008")
        self.assertTrue(v.startswith("derivada CID-10"))
        self.assertNotIn("CID-O", v)
        self.assertLessEqual(len(v), 30)
