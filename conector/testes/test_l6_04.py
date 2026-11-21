"""Fatia L6-04 (agenda: situações, confirmação e vínculos da agenda): declarações, plano da carga dirigida pelo mapa
e regras das colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L6-04`)."""
import csv
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_04

FATIA = ["SIAGECRI", "SICANAGE", "SICTRAGE", "SIPACAGI", "TBESTADOCONFIRMACAO", "TBSITAGE", "AGPARAM", "SIAGENDA",
         "REAGENDA_TBCONVEN", "SIAGENDA_TBCONVEN", "AGCADAGENDA", "AGCADEIRA", "AGDIASINDISP", "REAGENDA_TBESPEC",
         "REPACAGD", "SIPACAGD"]
CARREGADAS = {"TBSITAGE": "situacao_marcacao",
              "REAGENDA_TBCONVEN": "agenda_fonte_pagadora", "REAGENDA_TBESPEC": "agenda_especialidade"}


class L604(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_so_as_quatro_tabelas_carregaveis_entram(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt])

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("TBSITAGE")["significado"]["coluna"], "=~aguardando")
        # a origem não diz se o convênio vale na marcação online nem qual especialidade é a principal:
        # FALSE presumido (nunca o padrão TRUE do destino em silêncio)
        self.assertEqual(self.cols("REAGENDA_TBCONVEN")["aceita_marcacao_online"]["coluna"], "=~0")
        self.assertEqual(self.cols("REAGENDA_TBESPEC")["principal"]["coluna"], "=~0")

    def test_estado_de_confirmacao_de_alergia_nao_vai_para_a_agenda(self):
        self.assertNotIn("TBESTADOCONFIRMACAO", self.plano)
        for p in self.plano.values():
            self.assertNotIn("situacao_confirmacao", p["destinos"])

    def test_referencias_pelos_pais_da_origem(self):
        c = self.cols("REAGENDA_TBCONVEN")
        self.assertEqual(c["agenda_servico_id"]["referencia"], "REAGENDA")
        self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        self.assertEqual(c["observacao_marcacao_online"]["regra"], "texto_longo")
        c = self.cols("REAGENDA_TBESPEC")
        self.assertEqual(c["agenda_servico_id"]["referencia"], "REAGENDA")
        self.assertEqual(c["especialidade_medica_id"]["referencia"], "TBESPEC")

    def test_codigo_da_situacao_preserva_caixa_e_colisao_e_detectada(self):
        self.assertEqual(self.cols("TBSITAGE")["codigo"]["regra"], "codigo_char")
        self.assertEqual(sentinela.aplicar("codigo_char", "CF"), ("CF", None))
        self.assertEqual(sentinela.aplicar("codigo_char", "a "), ("a", None))
        self.assertTrue(sentinela.colisoes_caixa(["A", "a", "CF"]))

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "N"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Confirmada   exemplo  ")[0], "Confirmada exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        txt = sentinela.aplicar("texto_longo", "Aviso\r\n  linha  ".encode("cp1252"))[0]
        self.assertEqual(txt, "Aviso\r\n  linha  ")

    def test_icone_declarado_sem_destino(self):
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-04.tsv", encoding="utf-8") as f:
            decl = {(r["tabela"], r["coluna"]): r for r in csv.DictReader(f, delimiter="\t")}
        self.assertEqual(decl[("TBSITAGE", "ICONE")]["destino"], "")
        self.assertTrue(decl[("TBSITAGE", "ICONE")]["motivo"])
        for (t, _), r in decl.items():
            self.assertIn(t, set(CARREGADAS) | {"TBESTADOCONFIRMACAO"})
            self.assertTrue(r["motivo"])
            if t == "TBESTADOCONFIRMACAO":
                self.assertEqual(r["destino"], "")

    def test_imagem_sintetica_cobre_as_carregadas(self):
        linhas = []
        esp = l6_04.linhas(__import__("random").Random(1), lambda t, v: linhas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            lidas = linhas.count(t)
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r == "codigo_colisao_caixa")
            self.assertEqual(e["gravados"] + recusas, lidas, t)
        self.assertEqual(set(l6_04.PAIS_EXTERNOS), {"REAGENDA", "TBCONVEN", "TBESPEC"})


if __name__ == "__main__":
    unittest.main()
