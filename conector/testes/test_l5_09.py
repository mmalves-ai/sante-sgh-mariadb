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
            self.assertEqual(cols[dc]["depara"], "")
        for dc in ("codigo", "codigo_sefip", "codigo_saque_fgts", "codigo_causa_afastamento"):
            self.assertEqual(cols[dc]["regra"], "texto")
        self.assertEqual(cols["descricao"]["regra"], "texto_nome")

    def test_situacao_presumida_e_marcada(self):
        """Nenhuma coluna de regra da situação fica no padrão do destino em silêncio: categoria e booleanos vão
        como literal presumido (valor_presumido)."""
        sit = {c["destino"]: c for c in self.plano["FPSIT_FUNC"]["colunas"]["situacao_colaborador"]}
        self.assertEqual(sit["categoria"]["coluna"], "=~outro")
        self.assertEqual(sit["considera_ativo_folha"]["coluna"], "=~0")
        self.assertEqual(sit["permite_marcacao_ponto"]["coluna"], "=~0")

    def test_tipo_de_rescisao_derivado_do_codigo_rais(self):
        """Iniciativa e consequências legais pelo código RAIS (evidência legal), nunca pelo padrão do destino."""
        cols = {}
        for c in self.plano["FPTIPORESC"]["colunas"]["tipo_rescisao"]:
            cols[c["destino"]] = c
        derivadas = ("iniciativa", "exige_aviso_previo", "paga_multa_fgts", "percentual_multa_fgts",
                     "permite_saque_fgts", "paga_ferias_proporcionais", "paga_decimo_proporcional",
                     "da_direito_seguro_desemprego")
        for dc in derivadas:
            self.assertEqual((cols[dc]["coluna"], cols[dc]["depara"]), ("ID_FPRESC_RAIS", "valores"), dc)
        v = {dc: cols[dc]["valores"] for dc in derivadas}
        codigos = set(v["iniciativa"])
        self.assertEqual(len(codigos), 28)                          # tabela legal da RAIS (27) + acordo (90)
        for dc in derivadas:
            self.assertEqual(set(v[dc]), codigos, dc)               # todo código tem todas as consequências
        dominio = {"empregador", "empregado", "acordo", "termino_contrato", "falecimento", "aposentadoria", "outro"}
        self.assertTrue(set(v["iniciativa"].values()) <= dominio)
        for k in codigos:                                            # CHECK ck_tipo_rescisao_multa
            self.assertEqual(v["paga_multa_fgts"][k] == "1", bool(v["percentual_multa_fgts"][k]), k)
        ini = v["iniciativa"]
        self.assertEqual((ini["10"], ini["11"], ini["12"], ini["21"], ini["60"], ini["70"], ini["90"]),
                         ("empregador", "empregador", "termino_contrato", "empregado", "falecimento",
                          "aposentadoria", "acordo"))
        self.assertEqual((v["paga_ferias_proporcionais"]["10"], v["paga_decimo_proporcional"]["10"]), ("0", "0"))
        self.assertEqual((v["paga_multa_fgts"]["11"], v["percentual_multa_fgts"]["11"],
                          v["da_direito_seguro_desemprego"]["11"]), ("1", "40", "1"))
        self.assertEqual((v["percentual_multa_fgts"]["90"], v["da_direito_seguro_desemprego"]["90"]), ("20", "0"))
        self.assertEqual((v["permite_saque_fgts"]["21"], v["exige_aviso_previo"]["21"]), ("0", "1"))
        self.assertNotIn("=~outro", [c["coluna"] for c in cols.values()])

    def test_motivo_de_desligamento_pelo_depara_oficial_da_tabela_19(self):
        from sante_conector import depara
        cols = {c["destino"]: c for c in self.plano["FPTIPORESC"]["colunas"]["tipo_rescisao"]}
        c = cols["motivo_desligamento_codigo_esocial_id"]
        self.assertEqual((c["coluna"], c["depara"]), ("ID_FPMOTDESLIG", "codigo_esocial:19"))
        self.assertIn("'19'", depara.catalogo("codigo_esocial:19")["filtro"])
        d = depara.Depara("codigo_esocial:19", [("02", 7), ("04", 9)])
        self.assertEqual(d.resolver("2"), (7, None))      # zeros à esquerda não contam
        self.assertEqual(d.resolver("04"), (9, None))
        self.assertEqual(d.resolver("08"), (None, "catalogo_codigo_inexistente"))
        self.assertEqual(d.resolver(None), (None, None))

    def test_descartes_pedidos_cobrem_o_resto_da_fatia(self):
        self.assertEqual(set(l5_09.SEM_CARGA) | set(l5_09.BLOQUEADAS) | set(self.plano), set(FATIA))
        self.assertFalse(set(l5_09.SEM_CARGA) & set(self.plano))
        self.assertFalse(set(l5_09.SEM_CARGA) & set(l5_09.BLOQUEADAS))
        for t, (causa, motivo) in l5_09.SEM_CARGA.items():
            # sem carregador de catálogo trabalhista, nenhum descarte pode depender dele
            # rodada 5 (ADR 0006, item 4): listas legais como catálogo oficial ligado pelo código no consumidor
            self.assertIn(causa, ("catalogo_oficial", "mecanismo_do_produto", "duplicado"), t)
            self.assertNotIn("carregador oficial", motivo, t)
            self.assertNotIn("de-para codigo_esocial", motivo, t)
        self.assertEqual(l5_09.BLOQUEADAS["FPMOTDESLIG"][0], "mecanismo_pedido")
        # rodada 5, revisão: o que a sintética diz é o que sem_carga.tsv diz (bloqueada até r5-1 ou r5-2)
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv")}
        for t, (causa, pedido) in l5_09.BLOQUEADAS.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("BLOQUEADA até o pedido %s (saida/L5-09.json)" % pedido), t)
        self.assertIn("causa_demissao_id", sc["FPRESC_CAUSA"]["motivo"])
        self.assertIn("RETIRADA", sc["FPRESC_CAUSA"]["motivo"])

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

    def test_causa_de_demissao_aguarda_r5_2_com_motivo(self):
        import csv
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L5-09.tsv", encoding="utf-8") as f:
            decl = [r for r in csv.DictReader(f, delimiter="\t")]
        causa = [r for r in decl if (r["tabela"], r["coluna"]) == ("FPTIPORESC", "ID_FPRESC_CAUSA")]
        self.assertEqual(len(causa), 1)
        self.assertEqual(causa[0]["destino"], "")
        self.assertIn("NÃO carregada até o pedido r5-2", causa[0]["motivo"])
        self.assertIn("causa_demissao_id", causa[0]["motivo"])

    @unittest.expectedFailure
    def test_depara_codigo_esocial_filtra_fonte_e_versao(self):
        """Pedido 3 de saida/L5-09.json (motor compartilhado): '19' pode existir em outra fonte (rais, caged...) e
        em várias versões; o filtro precisa da fonte 'esocial' e de ordem por versão/vigência. Falha até o motor
        mudar; quando passar, retire o expectedFailure."""
        from sante_conector import depara
        sql = depara.consulta("codigo_esocial:19")
        self.assertIn("fonte = 'esocial'", sql)
        self.assertIn("ORDER BY", sql.upper())

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
        self.assertEqual(len(vistos), len(FATIA))                 # toda tabela da fatia está na imagem
        self.assertEqual(esp["FPSIT_FUNC"]["gravados"], 5 if l5_09.condicao_sem_prefixo() else 6)


if __name__ == "__main__":
    unittest.main()
