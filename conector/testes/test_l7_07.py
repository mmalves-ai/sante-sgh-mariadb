"""Fatia L7-07 (SADT e suprimentos, módulo SUP): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L7-07`.
"""
import datetime
import decimal
import os
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_07

FATIA = set(l7_07.CARREGADAS) | set(l7_07.NAO_CARREGADAS)
MAPA_DIR = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)


class PlanoL707(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_carregaveis_entram_na_carga(self):
        self.assertEqual(len(FATIA), 25)
        self.assertEqual(len(l7_07.CARREGADAS) + len(l7_07.DESCARTADAS) + len(l7_07.BLOQUEADAS), 25)
        self.assertEqual(set(self.plano), set(l7_07.CARREGADAS))

    def test_ordem_do_mapa(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        # pai antes do filho (inclusive o complemento: saldo final antes do inicial, item do kit antes do saldo)
        for pai, filho in [("TBUNICON", "GEITENS"), ("GEITENS", "GEKITITE"), ("GEITEMKITRAS", "GESALDOKITRAS"),
                           ("GEVALMEM", "GERASVALESTINI"), ("GEITENS", "GEVIASITEM")]:
            self.assertLess(ordem.index(pai), ordem.index(filho), (pai, filho))

    def test_destinos(self):
        esperado = {"TBTP_ENV_LISTA_AVAL_FARM": ["regra_envio_avaliacao_farmaceutica"], "TBUNICON": ["unidade_medida"],
                    "GEITENS": ["insumo"], "GENOMCOM": ["apresentacao_comercial"], "GEUNIPRESC": ["insumo_unidade"],
                    "GEVALMEM": ["lote_insumo"], "GEITEMKITRAS": ["kit_rastreavel_item"],
                    "GERASVALESTINI": ["inventario_estoque_lote"], "GEVIASITEM": ["insumo_via"],
                    "GEKITITE": ["kit_material_item"], "GESALDOKITRAS": ["kit_rastreavel_item"]}
        for t, dts in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_referencias_pelo_conector_origem(self):
        for t, dt, dc, ref in [("GEITENS", "insumo", "grupo_insumo_id", "GEGRUPOS"),
                               ("GEITENS", "insumo", "estoque_unidade_medida_id", "TBUNICON"),
                               ("GEITENS", "insumo", "compra_unidade_medida_id", "TBUNICON"),
                               ("GEITENS", "insumo", "consumo_unidade_medida_id", "TBUNICON"),
                               ("GEITENS", "insumo", "prescricao_unidade_medida_id", "TBUNICON"),
                               ("GENOMCOM", "apresentacao_comercial", "insumo_id", "GEITENS"),
                               ("GENOMCOM", "apresentacao_comercial", "fabricante_id", "TBLABORA"),
                               ("GEUNIPRESC", "insumo_unidade", "insumo_id", "GEITENS"),
                               ("GEUNIPRESC", "insumo_unidade", "unidade_medida_id", "TBUNICON"),
                               ("GEVALMEM", "lote_insumo", "insumo_id", "GEITENS"),
                               ("GEVALMEM", "lote_insumo", "fabricante_id", "TBLABORA"),
                               ("GEITEMKITRAS", "kit_rastreavel_item", "kit_rastreavel_id", "GEKITRAS"),
                               ("GEITEMKITRAS", "kit_rastreavel_item", "insumo_id", "GEITENS"),
                               ("GEITEMKITRAS", "kit_rastreavel_item", "unidade_medida_id", "TBUNICON"),
                               ("GERASVALESTINI", "inventario_estoque_lote", "inventario_estoque_item_id", "GELANESI"),
                               ("GERASVALESTINI", "inventario_estoque_lote", "lote_insumo_id", "GEVALMEM"),
                               ("GEVIASITEM", "insumo_via", "insumo_id", "GEITENS"),
                               ("GEVIASITEM", "insumo_via", "via_de_uso_id", "GETABVIA"),
                               ("GEKITITE", "kit_material_item", "kit_material_id", "GEKITS"),
                               ("GEKITITE", "kit_material_item", "insumo_id", "GEITENS")]:
            c = self.cols(t, dt)[dc]
            self.assertEqual((c["regra"], c["referencia"]), ("chave_origem", ref), (t, dc))

    def test_estabelecimento_nunca_fixo(self):
        for t, dt in [("TBTP_ENV_LISTA_AVAL_FARM", "regra_envio_avaliacao_farmaceutica"), ("GEVALMEM", "lote_insumo")]:
            self.assertEqual(self.cols(t, dt)["estabelecimento_id"]["coluna"], "@estabelecimento", t)

    def test_presumidos_nunca_silenciosos(self):
        self.assertEqual(self.cols("GEITENS", "insumo")["tipo"]["coluna"], "=~outro")
        r = self.cols("TBTP_ENV_LISTA_AVAL_FARM", "regra_envio_avaliacao_farmaceutica")
        self.assertEqual(r["momento_envio"]["coluna"], "=~nao_enviar")
        # situação da origem: com o momento presumido nao_enviar a regra não põe item na fila
        self.assertEqual((r["ativo"]["coluna"], r["ativo"]["regra"]), ("ATIVO", "booleano_sn"))

    def test_referencias_encadeadas(self):
        u = self.cols("GEKITITE", "kit_material_item")["unidade_medida_id"]
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in u["passos"]], ["GEITENS", "UNI_ARM", "TBUNICON"])

    def test_complementos_sem_linha_nova(self):
        for t, dt, ref in [("GESALDOKITRAS", "kit_rastreavel_item", "GEITEMKITRAS")]:
            self.assertTrue(self.plano[t]["opcoes"][dt]["complementa"], t)
            self.assertEqual(self.cols(t, dt)["id"]["referencia"], ref, t)
        self.assertEqual(self.cols("GESALDOKITRAS", "kit_rastreavel_item")["saldo_atual"]["regra"],
                         "decimal_nao_negativo")

    def test_lote_por_local_adota_o_lote_fisico(self):
        # GEVALMEM é o lote POR LOCAL: o mesmo lote em outro local adota a linha pela identificação do lote
        self.assertEqual(self.plano["GEVALMEM"]["opcoes"]["lote_insumo"]["adotar"],
                         ["estabelecimento_id", "insumo_id", "numero_lote", "validade"])

    def test_saldo_atual_do_lote_pronto_e_fotografias_descartadas(self):
        txt = (MAPA_DIR / mapa.COLUNAS_D / "L7-07.tsv").read_text(encoding="utf-8")
        for dc in ("quantidade", "quantidade_em_kit", "competencia", "local_estoque_id", "lote_insumo_id"):
            self.assertIn("\tsaldo_lote.%s\t" % dc, txt, dc)
        self.assertNotIn("\nGERASVALFINAL\t", txt)
        self.assertNotIn("\nGERASVALINICIAL\t", txt)

    def test_toda_coluna_da_origem_declarada_nas_carregadas(self):
        lidas = {(c["tabela"], c["coluna"]) for c in self.m["colunas_decl"]}
        chave = {r["tabela"]: r["chave"].split(",") for r in self.m["tabelas"]}
        for t in self.plano:
            for c in [x for x in self.m["colunas"] if x["tabela"] == t]:
                if c["coluna"] in chave[t] or c["coluna"] == "BRASIN":
                    continue
                self.assertIn((t, c["coluna"]), lidas, (t, c["coluna"]))

    def test_curvas_por_de_para_de_valores(self):
        i = self.cols("GEITENS", "insumo")
        for dc in ("curva_abc", "curva_xyz"):
            self.assertEqual((i[dc]["regra"], i[dc]["depara"]), ("codigo_char", "valores"), dc)


    def test_fatores_de_conversao_nunca_no_padrao_silencioso(self):
        i = self.cols("GEITENS", "insumo")
        # compra -> consumo da origem (0 = sem conversão); estoque -> consumo presumido; consumo -> prescrição
        self.assertEqual((i["fator_compra_estoque"]["coluna"], i["fator_compra_estoque"]["regra"]),
                         ("CONVER", "decimal_zero_nulo"))
        self.assertEqual(i["fator_estoque_consumo"]["coluna"], "=~1")
        self.assertEqual((i["fator_consumo_prescricao"]["coluna"], i["fator_consumo_prescricao"]["regra"]),
                         ("FATOR_CONV", "decimal_positivo"))

    def test_rastreio_por_lote(self):
        i = self.cols("GEITENS", "insumo")
        for dc in ("controla_lote", "controla_validade"):  # ck_insumo_lote_validade: os dois juntos
            self.assertEqual((i[dc]["coluna"], i[dc]["regra"]), ("RASTREAR", "booleano_01"), dc)

    def test_sequencia_no_grupo(self):
        self.assertEqual(self.cols("GEITEMKITRAS", "kit_rastreavel_item")["sequencia"]["coluna"], "#seq:ID_GEKITRAS")
        self.assertEqual(self.cols("GERASVALESTINI", "inventario_estoque_lote")["sequencia"]["coluna"],
                         "#seq:ID_GELANESI")
        self.assertEqual(self.cols("GEKITITE", "kit_material_item")["sequencia"]["coluna"], "#seq:KIT")

    def test_regras(self):
        u = self.cols("TBUNICON", "unidade_medida")
        self.assertEqual((u["codigo"]["regra"], u["sigla"]["regra"], u["ativo"]["regra"]),
                         ("codigo_char", "codigo_char", "booleano_ai"))
        i = self.cols("GEITENS", "insumo")
        self.assertEqual(i["informacao_complementar"]["regra"], "texto_longo")
        for dc in ("cobravel", "padronizado", "controlado", "antimicrobiano", "uso_dieta_oral", "fracionavel"):
            self.assertEqual(i[dc]["regra"], "booleano_sn", dc)
        self.assertEqual(self.cols("GEVALMEM", "lote_insumo")["validade"]["regra"], "data")

    def test_licenciado_nunca_migrado(self):
        for c in self.m["colunas_decl"]:
            if c["tabela"] in FATIA and c["coluna"] == "BRASIN":
                self.assertEqual(c.get("destino") or "", "", c["tabela"])

    def test_nada_de_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)

    def test_descartadas_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(MAPA_DIR / "declarado/sem_carga.tsv")}
        for t in l7_07.DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], ("sem_valor", "duplicado", "licenciado", "catalogo_oficial",
                                           "mecanismo_do_produto"), t)
            self.assertTrue(sc[t]["motivo"].startswith("L7-07:"), t)

    def test_bloqueadas_com_declaracao_pronta_e_comentada(self):
        decl = {c["tabela"] for c in self.m["colunas_decl"] if c.get("destino")}
        txt = (MAPA_DIR / mapa.COLUNAS_D / "L7-07.tsv").read_text(encoding="utf-8")
        for t in l7_07.BLOQUEADAS:
            self.assertNotIn(t, decl, t)
            self.assertIn("\n#%s\t" % t, txt, t)


class RegrasL707(unittest.TestCase):
    def test_colisao_de_caixa_na_unidade(self):
        self.assertEqual(sentinela.colisoes_caixa(["CX", "cp", "CP", "ML"]), [["CP", "cp"]])

    def test_situacao_ai(self):
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z"), (None, "valor_fora_do_dominio"))

    def test_marca_sn(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_rastrear_01(self):
        self.assertEqual(sentinela.aplicar("booleano_01", 1), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_01", 0), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_01", 2)[1], "valor_fora_do_dominio")

    def test_conver_zero_e_sem_conversao(self):
        self.assertEqual(sentinela.aplicar("decimal_zero_nulo", decimal.Decimal("0.000")), (None, None))
        self.assertEqual(sentinela.aplicar("decimal_zero_nulo", decimal.Decimal("10.000"))[0], decimal.Decimal("10"))

    def test_validade_sentinela(self):
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30))[1], "data_sentinela")
        self.assertEqual(sentinela.aplicar("data", datetime.date(2027, 5, 1)), (datetime.date(2027, 5, 1), None))

    def test_texto_longo_preserva_quebra_e_espacos(self):
        v, p = sentinela.aplicar("texto_longo", "uso\r\n  segunda linha  ".encode("cp1252"))
        self.assertIsNone(p)
        self.assertIn("\n  segunda linha", v)


class ImagemL707(unittest.TestCase):
    def test_esperado_cobre_as_carregadas_e_so_dados_falsos(self):
        linhas = []
        esp = l7_07.linhas(random.Random(1), lambda t, v: linhas.append((t, v)))
        self.assertEqual(set(esp), set(l7_07.CARREGADAS))
        self.assertEqual({t for t, _ in linhas}, set(l7_07.CARREGADAS))
        for t, e in esp.items():
            n = sum(1 for x, _ in linhas if x == t)
            self.assertLessEqual(e["gravados"], n, t)

    def test_pais_externos_cobrem_as_referencias_de_fora(self):
        self.assertEqual(set(l7_07.PAIS_EXTERNOS), {"GEGRUPOS", "TBLABORA", "GEKITRAS", "GETABVIA", "GELANESI",
                                                    "GEKITS", "GELOCARM"})


if __name__ == "__main__":
    unittest.main()
