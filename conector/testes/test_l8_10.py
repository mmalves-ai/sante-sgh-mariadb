"""Fatia L8-10 (patrimônio, financeiro, nota de serviço e escrituração; módulo FIN): declarações, plano, de-para de
valores e imagem sintética, na rodada de cobertura total. Sem banco; só valores inventados. 9 tabelas carregam, 10
são descartadas com causa de produto (declarado/sem_carga.tsv) e 2 esperam regra nova do motor (pedidos A e B em
saida/L8-10.json). A conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L8-10`."""
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_10

FATIA = tuple(l8_10.FORMAS)
CTX = "contexto_trabalho_usuario"
DESTINO = {"GPORIGEM": ["origem_bem"], "GPTP_RESPONSAVEL": ["tipo_responsavel_bem"], "MFTIPOLANC": ["tipo_credor"],
           "MFTPCOBRANCA": ["tipo_cobranca"], "GPPARAMU": [CTX],
           "MFPARUSU": [CTX], "NFSEPARUSU": [CTX], "PEPARAM_USUARIO": [CTX],
           "SDGEITENS": ["dado_fiscal_item"]}
MODULO = {"GPPARAMU": "=patrimonio", "MFPARUSU": "=financeiro", "NFSEPARUSU": "=nota_servico",
          "PEPARAM_USUARIO": "=ponto"}


class FatiaL810(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        raiz = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado"
        cls.sem_carga = {r["tabela"]: r for r in mapa.ler_tsv(raiz / "sem_carga.tsv")}

    def _decl(self, t, col):
        return [c for c in self.decl if c["tabela"] == t and c["coluna"] == col]

    def test_fatia_tem_as_21_tabelas_e_todas_as_colunas_declaradas(self):
        self.assertEqual(len(FATIA), 21)
        grupos = (set(l8_10.CARREGADAS), set(l8_10.DESCARTADAS), set(l8_10.SEM_MECANISMO))
        self.assertEqual(set().union(*grupos), set(FATIA))
        self.assertEqual(sum(map(len, grupos)), 21)
        for t, (_, cols) in l8_10.FORMAS.items():
            for c, _, _ in cols:
                self.assertTrue(self._decl(t, c), (t, c))
        for c in self.decl:
            self.assertTrue(c.get("_arquivo", "").endswith("L8-10.tsv"), c["tabela"])
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
        # as tabelas que passaram à L8-11 não ficam declaradas aqui (uma tabela, um arquivo)
        self.assertFalse({c["tabela"] for c in self.decl} & {"MFCTAUSU", "MFADIFOR", "MFADIFOR_TBCBOPRO"})

    def test_plano_com_as_carregadas_e_os_destinos(self):
        self.assertEqual(set(self.plano), set(l8_10.CARREGADAS))
        for t, dts in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_descartes_com_causa_de_produto_e_sem_destino(self):
        for t, causa in l8_10.DESCARTADAS.items():
            sc = self.sem_carga.get(t)
            self.assertTrue(sc, t)
            self.assertEqual((sc["situacao"], sc["causa"]), ("descarte", causa), t)
            self.assertIn("L8-10", sc["motivo"])
            self.assertFalse([c for c in self.decl if c["tabela"] == t and c.get("destino")], t)

    def test_sem_mecanismo_tem_pedido_e_nenhum_destino(self):
        for t, letra in l8_10.SEM_MECANISMO.items():
            for c in self.decl:
                if c["tabela"] == t:
                    self.assertIn("pedido %s" % letra, c["motivo"], (t, c["coluna"]))
                    self.assertFalse(c.get("destino"), (t, c["coluna"]))

    def test_contexto_do_usuario_por_modulo(self):
        for t, mod in MODULO.items():
            (u,) = [c for c in self.decl if c["tabela"] == t and c["destino"] == CTX + ".usuario_id"]
            self.assertEqual((u["coluna"], u["via"]), ("USUARIO", "ref:TBUSERS;adotar:usuario_id,modulo"), t)
            dest = {c["destino"]: c["coluna"] for c in self.decl if c["tabela"] == t and c.get("destino")}
            self.assertEqual(dest[CTX + ".modulo"], mod, t)
            self.assertEqual(dest[CTX + ".estabelecimento_id"], "@estabelecimento", t)
            self.assertTrue(dest[CTX + ".competencia"].startswith("#data:"), t)
        self.assertEqual(carga_mapa.data_composta(2025, 13), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(None, None), (None, None))
        self.assertEqual(str(carga_mapa.data_composta(2025, 3)[0]), "2025-03-01")

    def test_dado_fiscal_do_item(self):
        dest = {c["destino"]: c for c in self.decl if c["tabela"] == "SDGEITENS" and c.get("destino")}
        self.assertEqual(dest["dado_fiscal_item.insumo_id"]["via"], "ref:GEITENS")
        self.assertEqual(dest["dado_fiscal_item.tipo_item_efd"]["coluna"], "=~07")
        self.assertEqual(dest["dado_fiscal_item.vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:8", 1012100), ("01012100", None))
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:8", 123456789)[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:2", 1), ("01", None))
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:2", 123)[1], "valor_fora_do_dominio")
        # códigos fiscais pela referência encadeada ao código do catálogo da origem (nunca o ID)
        for col, dt, pai in (("ID_SDCSTPIS", "codigo_cst_pis_entrada", "SDCSTPIS"),
                             ("ID_SDCSTCOFINS", "codigo_cst_cofins_entrada", "SDCSTCOFINS"),
                             ("ID_SDGENERO", "codigo_genero_item", "SDGENERO"),
                             ("ID_SDNATCREDITO", "codigo_natureza_credito", "SDNATCREDITO")):
            c = dest["dado_fiscal_item." + dt]
            self.assertEqual((c["coluna"], c["via"], c["regra"]), (col, "ref:%s>CODIGO" % pai, "inteiro_zeros_esquerda:2"))
            self.assertEqual(mapa.passos_ref(c["via"][4:]), [{"tabela": pai, "modo": "chave", "arg": None},
                                                             {"coluna": "CODIGO"}])

    def test_descartes_revistos_na_cobertura(self):
        # agrupador só com o ID e tipo de contribuição sindical: descarte, nenhuma linha gravada
        self.assertIn("só um ID", self.sem_carga["MFCABECLANC"]["motivo"])
        self.assertIn("SINDICAL", self.sem_carga["MFTPCONTRIBUICAO"]["motivo"])
        for t in ("NFSEEMPDESENT", "NFSEEMPDESENV", "SDNATRECEITA"):
            self.assertNotEqual(self.sem_carga[t]["causa"], "catalogo_oficial", t)

    def test_valores_presumidos_e_regras(self):
        lit = {(c["tabela"], c["destino"]): c["coluna"] for c in self.decl if c["coluna"].startswith("=")
               and c["tabela"] in l8_10.CARREGADAS[:4]}
        self.assertEqual(lit, {("GPORIGEM", "origem_bem.tipo_aquisicao"): "=~outra",
                               ("GPTP_RESPONSAVEL", "tipo_responsavel_bem.natureza"): "=~terceiro",
                               ("MFTIPOLANC", "tipo_credor.natureza"): "=~outro",
                               ("MFTPCOBRANCA", "tipo_cobranca.modalidade"): "=~carteira"})
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

    def test_sem_decisao_pendente_do_dono(self):
        for c in self.decl:
            self.assertNotIn("a confirmar pelo dono", c["motivo"], (c["tabela"], c["coluna"]))
        for v in self.m["valores"]:
            if v["tabela"] in FATIA:
                self.assertNotIn("a confirmar pelo dono", v.get("motivo", ""), v["tabela"])

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
        self.assertEqual(set(por), set(FATIA) | set(l8_10.CATALOGOS_ORIGEM))
        self.assertFalse(set(l8_10.CATALOGOS_ORIGEM) & set(FATIA))
        for t, e in esp.items():  # lidas = gravadas + recusadas (as recusas são de restrição do destino)
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(por[t], e["gravados"] + recusas, t)
        self.assertEqual(set(l8_10.PAIS_EXTERNOS), {"TBUSERS", "GEITENS"})
        self.assertIn("CREATE TABLE MOPARAM (ANO SMALLINT", l8_10.DDL)
        self.assertIn("CREATE TABLE SDPARAM (", l8_10.DDL)
        self.assertIn("PRIMARY KEY (EMPRESA,TP_LAN,FORN,DATA,DOC,TIPO,SERIE,GRUPO,SUBGRUPO,ITEM)", l8_10.DDL)


if __name__ == "__main__":
    unittest.main()
