"""Fatia L5-09 (cadastros do RH): declarações, plano da carga dirigida pelo mapa e regras das colunas. Sem banco;
só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L5-09`)."""
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_09

FATIA = ["FPMOTDESLIG", "FPMOTESTABILI", "FPMTCANCELAVI", "FPNIVELESTAG", "FPOCOR_SEFIP", "FPPROCESSOTEOR",
         "FPPROCTRAB_ESOCIAL_CR", "FPRESC_CAGED", "FPRESC_CAUSA", "FPRESC_RAIS", "FPRESC_SEFIP", "FPSAQUE",
         "FPSIT_FUNC", "FPTEMPO_RESID_TRAB_IMIGRANTE", "FPTIPOAVISO", "FPTIPORESC", "FPTIPO_CONTRATO",
         "FPTPACESSORIA", "FPTPACIDTRANS", "FPTPAVISORESC", "FPTPDEFICIEN"]


class L509(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def test_so_situacao_e_tipo_de_rescisao_sao_carregados(self):
        self.assertEqual(set(self.plano), {"FPSIT_FUNC", "FPTIPORESC"})
        self.assertEqual(self.plano["FPSIT_FUNC"]["destinos"], ["situacao_colaborador"])
        self.assertEqual(self.plano["FPTIPORESC"]["destinos"], ["tipo_rescisao"])

    def test_nada_grava_em_catalogo_oficial(self):
        for p in self.plano.values():
            for dt in p["destinos"]:
                self.assertNotEqual(dt, "codigo_esocial")

    def test_codigos_oficiais_guardados_como_codigo_e_nao_como_referencia(self):
        cols = {c["destino"]: c for c in self.plano["FPTIPORESC"]["colunas"]["tipo_rescisao"]}
        for dc in ("codigo_rais", "codigo_caged"):
            self.assertEqual(cols[dc]["regra"], "inteiro")
        for dc in ("codigo", "codigo_sefip", "codigo_saque_fgts", "codigo_causa_afastamento"):
            self.assertEqual(cols[dc]["regra"], "texto")
        self.assertEqual(cols["iniciativa"]["coluna"], "=outro")
        self.assertEqual(cols["descricao"]["regra"], "texto_nome")

    def test_codigo_da_situacao_preserva_caixa(self):
        cols = {c["destino"]: c for c in self.plano["FPSIT_FUNC"]["colunas"]["situacao_colaborador"]}
        self.assertEqual(cols["codigo"]["regra"], "codigo_char")
        self.assertEqual(sentinela.aplicar("codigo_char", "a"), ("a", None))
        self.assertEqual(sentinela.aplicar("codigo_char", "A "), ("A", None))
        self.assertTrue(sentinela.colisoes_caixa(["A", "a", "F"]))
        self.assertFalse(sentinela.colisoes_caixa(["A", "F"]))

    def test_regras_de_texto(self):
        self.assertEqual(sentinela.aplicar("texto", "  um  dois  ")[0], "um  dois")
        self.assertEqual(sentinela.aplicar("texto", "   ")[0], None)
        self.assertEqual(sentinela.aplicar("texto_nome", "  Tipo   com  espaços  ")[0], "Tipo com espaços")

    def test_pistas_da_origem_declaradas_sem_destino(self):
        import csv
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L5-09.tsv", encoding="utf-8") as f:
            decl = {(r["tabela"], r["coluna"]): r for r in csv.DictReader(f, delimiter="\t")}
        for col in ("ID_FPRESC_CAUSA", "ID_FPMOTDESLIG"):
            self.assertEqual(decl[("FPTIPORESC", col)]["destino"], "")
            self.assertTrue(decl[("FPTIPORESC", col)]["motivo"])

    def test_imagem_sintetica_carrega_junto_a_condicao(self):
        self.assertIn("L5-07", l5_09.REQUER)

    def test_esperado_da_imagem_sintetica(self):
        import random
        vistos = {}
        esp = l5_09.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        self.assertEqual(set(esp), {"FPSIT_FUNC", "FPTIPORESC"})
        for t, e in esp.items():
            self.assertEqual(e["gravados"] + sum(v for k, v in e["pendencias"].items()
                                                 if k.startswith("restricao_destino_")
                                                 or k == "codigo_colisao_caixa"), len(vistos[t]))


if __name__ == "__main__":
    unittest.main()
