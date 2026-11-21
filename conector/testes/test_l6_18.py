"""Fatia L6-18 (prontuário, assinatura e assistência, módulo HOT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-18`."""
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_18

TABELAS = set(l6_18.CARREGADAS)
BLOQUEADAS = set(l6_18.NAO_CARREGADAS)
DESCARTADAS = set(l6_18.DESCARTADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS | DESCARTADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        esperado = {"PRTPREFEIC": ["refeicao_do_dia"], "RISETOR": ["setor_tramite"], "PRVIAADMIN": ["via_dieta"],
                    "TBDIETAS": ["modalidade_dieta"], "PRCARACT_TBDIETAS": ["modalidade_dieta_caracteristica"],
                    "CHTPLIMPEZA_GEITENS": ["material_modalidade_limpeza"], "PRHORPAD": ["horario_refeicao"],
                    "TBLEITO_CHPROFISLIMP": ["leito_profissional_higienizacao"],
                    "CHSOLICITLIMP": ["solicitacao_limpeza"], "CHEXECLIMPEZA": ["execucao_limpeza"],
                    "CHSOLICITLIMP_TBLEITO": ["solicitacao_limpeza_local"]}
        for t, d in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], d, t)

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "descricao", "ordem"} <= set(self.cols("PRTPREFEIC", "refeicao_do_dia")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("RISETOR", "setor_tramite")))
        self.assertTrue({"codigo", "descricao", "modalidade"} <= set(self.cols("PRVIAADMIN", "via_dieta")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBDIETAS", "modalidade_dieta")))
        self.assertTrue({"modalidade_dieta_id", "caracteristica_dieta_id"}
                        <= set(self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica")))
        self.assertTrue({"modalidade_limpeza_id", "insumo_id", "quantidade"}
                        <= set(self.cols("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza")))
        self.assertTrue({"estabelecimento_id", "refeicao_do_dia_id", "horario_inicio", "horario_fim",
                         "horario_corte_mapa"} <= set(self.cols("PRHORPAD", "horario_refeicao")))
        self.assertTrue({"leito_hospitalar_id", "profissional_higienizacao_id", "vigencia_inicio"}
                        <= set(self.cols("TBLEITO_CHPROFISLIMP", "leito_profissional_higienizacao")))
        self.assertTrue({"estabelecimento_id", "numero", "motivo_geracao", "modalidade_limpeza_id",
                         "situacao_limpeza_id", "solicitante_usuario_id", "solicitada_em"}
                        <= set(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")))
        self.assertTrue({"estabelecimento_id", "solicitacao_limpeza_id", "situacao_limpeza_id"}
                        <= set(self.cols("CHEXECLIMPEZA", "execucao_limpeza")))
        self.assertTrue({"solicitacao_limpeza_id", "sequencia", "leito_hospitalar_id"}
                        <= set(self.cols("CHSOLICITLIMP_TBLEITO", "solicitacao_limpeza_local")))

    def test_presumidos(self):
        self.assertEqual(self.cols("RISETOR", "setor_tramite")["tipo"]["coluna"], "=~unidade")

    def test_tipo_de_dieta_pelas_consumidoras(self):
        # modalidade e classe vêm do nome do tipo de dieta (TBTPDIETA lida pela ref encadeada), nunca presumidas
        for t, dt, dc, col in [("PRVIAADMIN", "via_dieta", "modalidade", "ID_TBTPDIETA"),
                               ("TBDIETAS", "modalidade_dieta", "classe", "TPDIETA")]:
            c = self.cols(t, dt)[dc]
            self.assertEqual((c["coluna"], c["referencia"], c["depara"]), (col, "TBTPDIETA>NOME", "valores"), t)
            self.assertEqual(c["valores"].get("ENTERAL"), "enteral", t)
            self.assertEqual(c["valores"].get("Parenteral"), "parenteral", t)
            self.assertNotIn("Especial exemplo", c["valores"], t)
        self.assertNotIn("ativo", self.cols("PRVIAADMIN", "via_dieta"))
        self.assertEqual(self.cols("TBDIETAS", "modalidade_dieta")["ativo"]["coluna"], "SITUACAO")

    def test_ordem_em_texto(self):
        # ORDEM é VARCHAR na origem: texto não numérico vira NULL com valor_fora_do_dominio (tipar), sem exceção
        self.assertEqual(self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica")["ordem"]["regra"], "texto")
        self.assertIs(carga_mapa.tipar("2º", "smallint"), carga_mapa.NAO_NUMERICO)
        self.assertIs(carga_mapa.tipar("1.0", "smallint"), carga_mapa.NAO_NUMERICO)

    def test_horario_padrao(self):
        c = self.cols("PRHORPAD", "horario_refeicao")
        self.assertEqual(c["horario_inicio"]["regra"], "hora_hhmm")
        self.assertEqual(c["horario_corte_mapa"]["coluna"], "HORARIO")
        self.assertEqual(c["horario_fim"]["coluna"], "=~23:59:59")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(c["refeicao_do_dia_id"]["referencia"], "PRTPREFEIC")

    def test_vigencia_sem_fonte(self):
        c = self.cols("TBLEITO_CHPROFISLIMP", "leito_profissional_higienizacao")
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")

    def test_limpeza_referencias_declaradas(self):
        sit = self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["situacao_limpeza_id"]
        self.assertEqual(sit["referencia"], "CHEXECLIMPEZA.ID_CHSOLICITLIMP>ID_CHSITUACAO>CHSITUACAO")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in sit["passos"]],
                         ["CHEXECLIMPEZA", "ID_CHSITUACAO", "CHSITUACAO"])
        self.assertEqual(sit["passos"][0]["modo"], "alt")
        self.assertEqual(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["solicitante_usuario_id"]["referencia"],
                         "TBUSERS")
        self.assertEqual(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["motivo_geracao"]["coluna"], "=~manual")
        mod = self.cols("CHEXECLIMPEZA", "execucao_limpeza")["modalidade_limpeza_id"]
        self.assertEqual(mod["referencia"], "CHSOLICITLIMP>ID_CHTPLIMPEZA>CHTPLIMPEZA")
        self.assertEqual(self.cols("CHSOLICITLIMP_TBLEITO", "solicitacao_limpeza_local")["sequencia"]["coluna"],
                         "#seq:ID_CHSOLICITLIMP")

    def test_descartes_com_motivo_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        causa = {"TBTPDIETA": "duplicado", "CHPARAM": "mecanismo_do_produto", "CVPARAM": "mecanismo_do_produto"}
        for t in DESCARTADAS:
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa[t]), t)
            self.assertTrue(sc[t]["motivo"], t)

    def test_referencias(self):
        refs = {("TBDIETAS", "modalidade_dieta", "local_estoque_id"): "GELOCARM",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "modalidade_dieta_id"): "TBDIETAS",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "caracteristica_dieta_id"): "PRCARACTDIE",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "modalidade_limpeza_id"): "CHTPLIMPEZA",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "insumo_id"): "GEITENS"}
        for (t, dt, dc), pai in refs.items():
            self.assertEqual(self.cols(t, dt)[dc]["referencia"], pai, (t, dc))

    def test_unica_alimentadora(self):
        for t, dt in [("PRTPREFEIC", "refeicao_do_dia"), ("RISETOR", "setor_tramite"), ("PRVIAADMIN", "via_dieta"),
                      ("TBDIETAS", "modalidade_dieta")]:
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_bloqueadas_e_descartadas_sem_destino(self):
        # GDPRONTMOVIM espera a mudança do modelo (saida/L6-18.json); descartadas em declarado/sem_carga.tsv
        fora = BLOQUEADAS | DESCARTADAS
        self.assertFalse(fora & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in fora and c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Almoço   principal ".encode("cp1252")), ("Almoço principal", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"I"), (False, None))
        self.assertEqual(a("booleano_ai", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(carga_mapa.tipar("3", "smallint"), 3)
        self.assertEqual(a("hora_hhmm", "0700")[0], datetime.time(7, 0))
        self.assertEqual(a("hora_hhmm", "2575")[1], "hora_invalida")
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_18.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS | DESCARTADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)


if __name__ == "__main__":
    unittest.main()
