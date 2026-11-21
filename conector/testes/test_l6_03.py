"""Fatia L6-03 (agenda: cadastros, grade, horários e cancelamentos): declarações, plano e imagem sintética. Sem banco;
só valores inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L6-03`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_03

FATIA = ("AGCADMOTIVO", "AGCOMPLEXIDADE", "AGDURACAO", "AGGRPFASEEVOL", "AGTPAGENDA", "CDTPRETCONS", "PSTPRETORNO",
         "REAGECRI", "RECANAGE", "RECTRAGE", "REPACAGI", "RESITAGE", "RETIPAGE",
         "RETP_INTEG_AGENDA_ONLINE", "REAGENDA", "SIAGECRI")
BLOQUEADAS = set(FATIA) - set(l6_03.CARREGADAS)


class FatiaL603(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def test_so_as_carregaveis_tem_destino_e_toda_coluna_tem_motivo(self):
        com_destino = {c["tabela"] for c in self.decl if c["destino"]}
        self.assertEqual(com_destino, set(l6_03.CARREGADAS))
        self.assertEqual({c["tabela"] for c in self.decl}, set(FATIA))
        for c in self.decl:
            self.assertTrue(c["motivo"], (c["tabela"], c["coluna"]))
        for t in BLOQUEADAS:  # toda coluna da origem declarada sem destino, com o motivo do bloqueio
            self.assertEqual({c["coluna"] for c in self.decl if c["tabela"] == t},
                             {n for n, _, _ in l6_03.COLUNAS[t]})

    def test_plano_em_ordem_do_mapa(self):
        p = carga_mapa.planejar(self.m, set(FATIA))
        self.assertEqual([x["tabela"] for x in p], list(l6_03.CARREGADAS))
        for t in BLOQUEADAS:
            self.assertNotIn(t, self.plano)

    def test_destinos_e_regras(self):
        def dest(t, dt):
            return {c["destino"]: (c["coluna"], c["regra"]) for c in self.plano[t]["colunas"][dt]}
        self.assertEqual(dest("AGTPAGENDA", "categoria_agenda")["codigo"], ("ID", "codigo_char"))
        self.assertEqual(dest("RESITAGE", "situacao_marcacao")["codigo"], ("COD", "codigo_char"))
        self.assertEqual(dest("AGTPAGENDA", "categoria_agenda")["natureza"][0], "=~consulta")
        self.assertEqual(dest("RESITAGE", "situacao_marcacao")["significado"][0], "=~aguardando")
        self.assertEqual(dest("RETIPAGE", "canal_marcacao")["ativo"], ("SITUACAO", "booleano_ai"))
        modo = dest("RETP_INTEG_AGENDA_ONLINE", "modo_agendamento_online")
        self.assertEqual((modo["permite_central"][0], modo["permite_portal"][0]), ("=~0", "=~0"))
        self.assertEqual(dest("AGCOMPLEXIDADE", "complexidade_sessao")["codigo"], ("ID_COMPLEXIDADE", "texto"))
        for t, c in [("RESITAGE", "ICONE"), ("RETIPAGE", "COR"), ("AGCADMOTIVO", "ID_RETPAGEN")]:
            self.assertNotIn(c, self.plano[t]["lidas"])

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Alta   complexa ")[0], "Alta complexa")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("codigo_char", "c")[0], "c")
        self.assertEqual(sentinela.aplicar("texto", 3), ("3", None))

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l6_03.COLUNAS), set(FATIA))
        linhas = {}
        esp = l6_03.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l6_03.CARREGADAS))
        self.assertEqual(set(l6_03.NAO_CARREGADAS), BLOQUEADAS)  # a cobertura parcial fica explícita
        for t, n in l6_03.NAO_CARREGADAS.items():
            self.assertEqual(len(linhas[t]), n, t)
        for t, cols in l6_03.COLUNAS.items():
            for v in linhas[t]:
                self.assertEqual(len(v), len(cols))
        for t, e in esp.items():  # lidas = gravadas + recusadas
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k in ("pai_pendente", "codigo_colisao_caixa"))
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]), t)


    def test_descarte_de_produto_dos_dominios_de_retorno(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        for t in l6_03.DESCARTADAS:
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", "mecanismo_do_produto"), t)
            self.assertTrue(sc[t]["motivo"], t)
            self.assertFalse([c for c in self.decl if c["tabela"] == t and c["destino"]], t)

    def test_siagecri_declarada_sem_destino_com_motivo(self):
        cols = [c for c in self.decl if c["tabela"] == "SIAGECRI"]
        self.assertEqual({c["coluna"] for c in cols}, {n for n, _, _ in l6_03.COLUNAS["SIAGECRI"]})
        self.assertTrue(all(not c["destino"] and "SIAGENDA" in c["motivo"] for c in cols))

    def test_exclusao_de_marcacao_e_da_l6_04(self):
        # REPACAGD_EXCLUSAO é da L6-04 (ordem 1016): nenhuma linha dela na declaração nem na imagem da L6-03
        self.assertFalse([c for c in self.m["colunas_decl"] if c["tabela"] == "REPACAGD_EXCLUSAO"
                          and c.get("_arquivo", "").endswith("L6-03.tsv")])
        self.assertNotIn("REPACAGD_EXCLUSAO", l6_03.COLUNAS)

    def test_restricao_por_tipo_de_agenda_tem_o_significado_certo(self):
        # ID_RETPAGEN e TPAGEN apontam o tipo de agenda da recepção (duplicado de categoria_agenda), não o tipo de
        # marcação: não podem ir para tipo_marcacao_id e o motivo diz o conceito certo
        for t, c in [("AGCADMOTIVO", "ID_RETPAGEN"), ("RETIPAGE", "TPAGEN")]:
            d = next(x for x in self.decl if (x["tabela"], x["coluna"]) == (t, c))
            self.assertFalse(d["destino"], (t, c))
            self.assertIn("tipo de agenda da recepção", d["motivo"].lower())
            self.assertIn("categoria", d["motivo"])

    def test_bloqueadas_dizem_o_mecanismo_que_falta(self):
        for t in BLOQUEADAS - set(l6_03.DESCARTADAS):
            ms = {c["motivo"] for c in self.decl if c["tabela"] == t}
            self.assertEqual(len(ms), 1, t)
            m = ms.pop()
            self.assertIn("pedidos", m)
            self.assertIn("declaração pronta em saida/L6-03.json", m)

    def test_colisao_de_caixa_na_situacao(self):
        linhas = {}
        l6_03.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        cods = [sentinela.aplicar("codigo_char", v[0])[0] for v in linhas["RESITAGE"]]
        self.assertIn("AG", cods)
        self.assertIn("ag", cods)


if __name__ == "__main__":
    unittest.main()
