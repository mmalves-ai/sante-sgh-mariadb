"""Fatia L8-10 (faturamento e restantes, módulo FIN): declarações, plano, de-para de valores e imagem sintética. Sem
banco; só valores inventados. Cinco cadastros simples são carregados; as outras 16 tabelas ficam bloqueadas ou fora
da carga, com pedido em saida/L8-10.json. A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L8-10`."""
import random
import unittest

from sante_conector import carga, carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_10

FATIA = tuple(l8_10.FORMAS)
DESTINO = {"GPORIGEM": "origem_bem", "GPTP_RESPONSAVEL": "tipo_responsavel_bem", "MFTIPOLANC": "tipo_credor",
           "MFTPCOBRANCA": "tipo_cobranca", "MFTPCONTRIBUICAO": "tributo"}


class FatiaL810(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        cls.carregadas_no_mapa = {c["tabela"] for c in cls.m["colunas_decl"] if c.get("destino")} | set(carga.ORDEM)

    def _decl(self, t, col):
        return [c for c in self.decl if c["tabela"] == t and c["coluna"] == col]

    def test_fatia_tem_as_21_tabelas_e_todas_as_colunas_declaradas(self):
        self.assertEqual(len(FATIA), 21)
        self.assertEqual(set(l8_10.CARREGADAS) | set(l8_10.BLOQUEADAS) | set(l8_10.FORA), set(FATIA))
        for t, (_, cols) in l8_10.FORMAS.items():
            for c, _, _ in cols:
                self.assertTrue(self._decl(t, c), (t, c))
        for c in self.decl:
            self.assertTrue(c.get("_arquivo", "").endswith("L8-10.tsv"), c["tabela"])
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))

    def test_plano_so_com_as_carregadas_e_um_destino(self):
        self.assertEqual(set(self.plano), set(l8_10.CARREGADAS))
        for t, dt in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l8_10.CARREGADAS))

    def test_bloqueadas_e_fora_tem_pedido_no_motivo(self):
        for grupo in (l8_10.BLOQUEADAS, l8_10.FORA):
            for t, n in grupo.items():
                for c in self.decl:
                    if c["tabela"] == t:
                        self.assertIn("pedido %d" % n, c["motivo"], (t, c["coluna"]))
        # TBCTABAN vem depois de MFCTAUSU na ordem do mapa: enquanto for assim, a permissão fica bloqueada
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if (r.get("ordem") or "").isdigit()}
        self.assertGreater(ordem["TBCTABAN"], ordem["MFCTAUSU"])

    def test_valores_presumidos_e_regras(self):
        lit = {(c["tabela"], c["destino"]): c["coluna"] for c in self.decl if c["coluna"].startswith("=")}
        self.assertEqual(lit, {("GPORIGEM", "origem_bem.tipo_aquisicao"): "=~outra",
                               ("GPTP_RESPONSAVEL", "tipo_responsavel_bem.natureza"): "=~terceiro",
                               ("MFTIPOLANC", "tipo_credor.natureza"): "=~outro",
                               ("MFTPCOBRANCA", "tipo_cobranca.modalidade"): "=~carteira",
                               ("MFTPCONTRIBUICAO", "tributo.esfera"): "=~federal",
                               ("MFTPCONTRIBUICAO", "tributo.forma_apuracao"): "=~mensal",
                               ("MFTPCONTRIBUICAO", "tributo.incidencia"): "=~retido"})
        for c in self.decl:
            if c["regra"]:
                self.assertTrue(sentinela.regra_conhecida(c["regra"]), c["regra"])

    def test_de_para_do_sentido(self):
        pares = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
                 if v["tabela"] == "MFTIPOLANC" and v["destino"] == "tipo_credor.sentido"}
        self.assertEqual(pares, {"P": "pagar", "R": "receber"})
        # codigo_char preserva a caixa: 'p' não casa com 'P' (fica o padrão, com pendência)
        self.assertEqual(sentinela.aplicar("codigo_char", "p "), ("p", None))
        self.assertNotIn("p", pares)
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Doação   recebida ")[0], "Doação recebida")

    def test_marcas_da_origem_do_bem_vazio_e_nao(self):
        # o sistema antigo testa a marca com = 'T': vazio é 'não' (FALSE), nunca o padrão TRUE do destino
        for col, dest in (("DEPRECIAR", "deprecia"), ("INTEGRAR_FINANCEIRO", "integra_financeiro"),
                          ("INTEGRAR_CONTABILIDADE", "integra_contabilidade")):
            (c,) = self._decl("GPORIGEM", col)
            self.assertEqual((c["destino"], c["regra"], c["depara"]), ("origem_bem." + dest, "booleano_sn", "valores"))
            pares = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
                     if v["tabela"] == "GPORIGEM" and v["coluna"] == col}
            self.assertEqual(pares, {"1": "1", "0": "0", "": "0"}, col)
        for bruto, booleano in (("T", True), ("F", False), ("S", True), ("N", False)):
            self.assertEqual(sentinela.aplicar("booleano_sn", bruto), (booleano, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", " "), (None, None))  # vazio: o de-para dá FALSE

    def test_codigo_do_tributo_provisorio_com_pedido(self):
        (c,) = self._decl("MFTPCONTRIBUICAO", "ID")
        self.assertEqual(c["destino"], "tributo.codigo")
        self.assertIn("NÃO é a sigla", c["motivo"])
        self.assertIn("pedido 13", c["motivo"])

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l8_10.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(set(esp), set(l8_10.CARREGADAS))
        por = {}
        for t, v in a:
            self.assertEqual(len(v), len(l8_10.COLUNAS[t]), t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA))
        for t, e in esp.items():  # lidas = gravadas + recusadas (as recusas são de restrição do destino)
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(por[t], e["gravados"] + recusas, t)
        self.assertEqual(l8_10.PAIS_EXTERNOS, {})
        self.assertIn("CREATE TABLE MOPARAM (ANO SMALLINT", l8_10.DDL)
        self.assertIn("PRIMARY KEY (EMPRESA,TP_LAN,FORN,DATA,DOC,TIPO,SERIE,GRUPO,SUBGRUPO,ITEM)", l8_10.DDL)


if __name__ == "__main__":
    unittest.main()
