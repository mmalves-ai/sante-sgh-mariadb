"""Fatia L5-07 (cadastros do RH), rodada 5: listas legais do RH como listas do hospital (ADR 0006, decisão r5-1/r5-2).
Só declarações e a imagem SINTÉTICA; a carga e a conciliação ficam na autoconferência (conferir-fatia-f4.sh)."""

import unittest

from sante_conector import mapa
from sante_conector.sintetica_d import l5_07

D = mapa.DIR_PACOTE / "declarado"


class TestL507(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.decl = list(mapa.ler_tsv(D / "colunas.d/L5-07.tsv"))
        cls.sem_carga = {r["tabela"]: r for r in mapa.ler_tsv(D / "sem_carga.tsv")}
        cls.valores = [v for v in mapa.ler_valores(mapa.DIR_PACOTE) if v["tabela"] in ("FPBR_PDH", "FPAFAST_COD")]

    def test_listas_saem_do_descarte_e_so_o_banco_do_pis_fica(self):
        for t in l5_07.LISTAS:
            self.assertNotIn(t, self.sem_carga, t)
        self.assertEqual(self.sem_carga["FPBANCOPIS"]["causa"], "catalogo_oficial")

    def test_cada_lista_grava_opcao_sob_definicao_adotada(self):
        por = {}
        for r in self.decl:
            por.setdefault(r["tabela"], {})[r["destino"]] = r
        for t in l5_07.LISTAS:
            d = por[t]
            for col in ("valor", "sequencia", "rotulo", "origem", "parametro_definicao_id"):
                self.assertIn("parametro_opcao." + col, d, (t, col))
            self.assertIn("antes;adotar:chave", d["parametro_definicao.chave"]["via"], t)
            self.assertIn("antes;adotar:codigo", d["modulo_sistema.codigo"]["via"], t)
            self.assertEqual(d["parametro_opcao.origem"]["coluna"], "=migracao")
            self.assertIn("rh.lista.", d["parametro_definicao.chave"]["coluna"], t)

    def test_rotulo_tem_o_codigo_como_concorrente(self):
        for t in set(l5_07.LISTAS) - {"FPALIQRATCNAE"}:  # sem descrição na origem: o rótulo é o CNAE
            rot = [r for r in self.decl if r["tabela"] == t and r["destino"] == "parametro_opcao.rotulo"]
            self.assertGreaterEqual(len(rot), 2, t)

    def test_chaves_de_lista_distintas(self):
        ch = [r["coluna"] for r in self.decl if r["destino"] == "parametro_definicao.chave"]
        self.assertEqual(len(ch), len(set(ch)))

    def test_pares_de_ordem_sao_injetivos_ordenados_e_preservam_caixa(self):
        for t in ("FPBR_PDH", "FPAFAST_COD"):
            vs = [v for v in self.valores if v["tabela"] == t]
            orig = [v["valor_origem"] for v in vs]
            dest = [int(v["valor_destino"]) for v in vs]
            self.assertEqual(len(orig), len(set(orig)), t)
            self.assertEqual(len(dest), len(set(dest)), t)
            self.assertTrue(all(1 <= x <= 65535 for x in dest), t)
            self.assertEqual(dest, sorted(dest))
            self.assertEqual(orig, sorted(orig))
        br = {v["valor_origem"]: v["valor_destino"] for v in self.valores if v["tabela"] == "FPBR_PDH"}
        self.assertNotEqual(br["a"], br["A"])

    def test_fpas_guarda_tudo_no_valor(self):
        v = [r for r in self.decl if r["tabela"] == "FPCODALIQFPAS" and r["destino"] == "parametro_opcao.valor"][0]
        for c in ("ID", "COD_FPCODALIQFPAS", "CODIGO_TERCEIRO", "PERCENTUAL_ALIQUOTA"):
            self.assertIn(c, v["coluna"])

    def test_condicao_continua_situacao_inativa(self):
        d = {r["destino"]: r for r in self.decl if r["tabela"] == "FPCONDFUNC"}
        self.assertEqual(d["situacao_colaborador.ativo"]["coluna"], "=0")
        self.assertEqual(d["situacao_colaborador.codigo"]["coluna"], "#codigo_derivado:ID:30:cond_")


if __name__ == "__main__":
    unittest.main()
