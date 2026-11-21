"""Fatia L8-01 (faturamento e restantes, módulo FAT): declarações, plano da carga dirigida pelo mapa e regras das
colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L8-01`)."""
import csv
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_01

FATIA = ["FAPARUSU", "FCCODCON", "FCCPSCON", "FCCRECUN", "FCDIAEXT", "FCDIAINT", "FCEMPAUDPLANSERV", "FCFECMES",
         "FCGUIAS", "FCHORATE", "FCORCAME", "FCORCPAD", "FCORLAME", "FCPARUSU", "FCPORANE", "FCPROCUNIBHMED",
         "FCREFUND", "FCTPMOTGLOSA", "FCTPPGTONFSE", "FIPARUSU", "RECONTAS", "RICGUIAS", "RPDEDUTIVEL"]
CARREGADAS = {"FCTPMOTGLOSA": "grupo_motivo_glosa", "RPDEDUTIVEL": "tipo_deducao_irrf"}
BLOQUEADAS = set(FATIA) - set(CARREGADAS)


def _decl():
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L8-01.tsv", encoding="utf-8") as f:
        return list(f)


class L801(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_fatia_tem_23_tabelas(self):
        self.assertEqual(len(FATIA), 23)

    def test_so_as_carregaveis_entram_com_o_destino_certo(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_bloqueadas_tem_motivo_e_pedido(self):
        linhas = _decl()
        for t in BLOQUEADAS:
            self.assertTrue(any(l.startswith("#--- %s: bloqueada: " % t) and "L8-01.json" in l for l in linhas), t)

    def test_codigos_e_descricoes(self):
        g = self.cols("FCTPMOTGLOSA")
        self.assertEqual((g["codigo"]["coluna"], g["codigo"]["regra"]), ("ID", "inteiro"))
        self.assertEqual(g["descricao"]["regra"], "texto_nome")
        self.assertNotIn("codigo_tiss", g)  # sem evidência do domínio: nada presumido
        d = self.cols("RPDEDUTIVEL")
        self.assertEqual((d["codigo"]["coluna"], d["descricao"]["regra"]), ("ID", "texto_nome"))
        self.assertEqual(carga_mapa.tipar(sentinela.aplicar("inteiro", 7)[0], "varchar"), "7")

    def test_natureza_da_deducao_presumida_com_rastro(self):
        d = self.cols("RPDEDUTIVEL")
        self.assertEqual(d["natureza"]["coluna"], "=~outra")
        self.assertNotIn("exige_comprovante", d)

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Guia   exemplo  ")[0], "Guia exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertIsNone(sentinela.aplicar("texto_nome", None)[0])

    def test_declaracoes_com_motivo_e_so_da_fatia(self):
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t") if not r["tabela"].startswith("#")]
        for r in rows:
            self.assertIn(r["tabela"], CARREGADAS)
            self.assertTrue(r["motivo"].startswith("L8-01: "))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l8_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(e["gravados"] + recusas, lidas.count(t), t)
        self.assertEqual(esp["RPDEDUTIVEL"]["pendencias"]["valor_presumido"], lidas.count("RPDEDUTIVEL"))
        self.assertEqual(l8_01.PAIS_EXTERNOS, {})


if __name__ == "__main__":
    unittest.main()
