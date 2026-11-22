"""Fatia F4 L6-13 (prontuário, assinatura e assistência, módulo PEP), rodada de cobertura total: declarações, plano da
carga dirigida pelo mapa e imagem SINTÉTICA (dados 100% falsos). Só metadado: nenhum valor da origem real."""
import re
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.sintetica_d import l6_13

FATIA = "colunas.d/L6-13.tsv"
SEM_CARGA = set()  # rodada 5 (ADR 0006): nenhum descarte


class L6_13(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(l6_13.FATIA))}

    def test_toda_tabela_da_fatia_declarada_e_na_imagem(self):
        self.assertEqual({c["tabela"] for c in self.decl}, set(l6_13.FATIA))
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_13.DDL)), set(l6_13.FATIA) | set(l6_13.PAIS_ORIGEM))

    def test_carregam_todas_menos_os_descartes(self):
        self.assertEqual(set(self.plano), set(l6_13.FATIA) - SEM_CARGA)

    def test_referencias_encadeadas_bem_formadas(self):
        for c in self.decl:
            for v in [x for x in (c.get("via") or "").split(";") if x.startswith("ref:")]:
                self.assertIsNotNone(mapa.passos_ref(v[4:]), (c["tabela"], c["coluna"], v))

    def test_profissional_sempre_pela_inscricao(self):
        for c in self.decl:
            if c["coluna"].startswith("ID_TBCBOPRO") and c.get("destino"):
                self.assertEqual(c["via"].split(";")[0], "ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS", c["coluna"])

    def test_item_prescritivel_pela_linha_de_parametros_do_insumo(self):
        refs = {c["via"] for c in self.decl if (c.get("destino") or "").endswith(".item_prescritivel_id")}
        self.assertEqual(refs, {"ref:PRITEM_GEITENS/item_prescritivel"})

    def test_evento_derivado_da_situacao(self):
        v = {(x["tabela"], x["coluna"], x["destino"], x["valor_origem"]): x["valor_destino"] for x in self.m["valores"]}
        for t in ("HTCHKGERAL", "PREXTRATOITEM_PRCHKGERAL"):
            k = (t, "ID_PRSITUACAOCHECAGEM", "horario_administracao_evento.evento")
            self.assertEqual([v[k + (s,)] for s in "ANSPO"], ["checagem", "nao_administrado", "suspensao", "geracao",
                                                               "checagem"], t)
        k = ("PRCHKGERAL", "SITUACAO_CHECAGEM", "horario_administracao_evento.evento")
        self.assertEqual([v[k + (s,)] for s in "ANSPO"], ["checagem", "nao_administrado", "suspensao", "", ""])
        self.assertFalse([c for c in self.decl if c["coluna"].startswith("=~") and c["tabela"].endswith("CHKGERAL")])
        self.assertTrue(self.plano["PRCHKGERAL"]["opcoes"]["horario_administracao_evento"]["opcional"])

    def test_pressao_em_mmhg_nao_vai_para_cmh2o(self):
        d = {c["destino"] for c in self.decl if c["tabela"] in ("PRPRESCVI", "PRPRESCVNI") and c.get("destino")}
        self.assertFalse([x for x in d if x.endswith("_cmh2o") and "peep" not in x])

    def test_situacao_derivada_por_valores(self):
        v = {(x["tabela"], x["destino"], x["valor_origem"]): x["valor_destino"] for x in self.m["valores"]}
        self.assertEqual(v[("PRRECEITA", "receita_medica.situacao", "1")], "suspensa")
        self.assertEqual(v[("PRRECEITA", "receita_medica.situacao", "")], "emitida")
        self.assertEqual(v[("HTATENDALTA", "alta_medica.situacao", "1")], "efetivada")
        self.assertEqual(v[("PREXTRATOITEM_PRCHKGERAL", "horario_administracao_evento.evento", "1")], "reaprazamento")
        self.assertEqual(v[("PRPRESC_AUTOPREENCHIDO", "prescricao_item.dose_autopreenchida", "QTDE_DOSE")], "1")

    def test_complemento_do_item_sem_linha_nova(self):
        self.assertTrue(self.plano["PRPRESC_AUTOPREENCHIDO"]["opcoes"]["prescricao_item"]["complementa"])

    def test_unidade_pela_mesma_chave_das_outras_fatias(self):
        refs = {c["via"] for c in self.decl if (c.get("destino") or "").endswith(".unidade_prescricao_id")}
        self.assertEqual(refs, {"ref:TBUNIDADEMEDIDA.SIGLA_API"})

    def test_alta_uma_por_atendimento_pelo_estado_vigente(self):
        self.assertEqual(self.plano["HTATENDALTA"]["opcoes"]["alta_medica"]["adotar"], ["atendimento_id"])
        d = {c["destino"]: c["via"] for c in self.decl if c["tabela"] == "HTATENDALTA" and c.get("destino")}
        for col in ("alta_medica_em", "situacao", "motivo_saida_hospitalar_id", "saida_leito_em", "profissional_id"):
            self.assertTrue(d["alta_medica." + col].startswith("ref:HTATENDIMENTO>ID_ATCABECATEND>ATCABECATEND>"), col)
        self.assertIn("ID_TBCBOPRO_ALTA_MEDICA", d["alta_medica.profissional_id"])

    def test_checagem_resultado_e_conferencia(self):
        d = {c["coluna"]: c["destino"] for c in self.decl if c["tabela"] == "PRCHKGERAL" and c.get("destino")}
        self.assertEqual(d["SINAIS_ALFA"], "horario_administracao.resultado_registrado")
        self.assertEqual(d["ID_TBPROFIS_ACOMP_RESP_CHK"], "horario_administracao.conferido_por_profissional_id")
        self.assertEqual(d["DATA_HORA_ACOMP_RESP_CHK"], "horario_administracao.conferido_em")

    def test_assinatura_do_horario_na_trilha_do_horario(self):
        d = {c["destino"]: c for c in self.decl if c["tabela"] == "PRASSINAT_DOC_PRCHKGERAL" and c.get("destino")}
        self.assertFalse([x for x in d if x.startswith("documento_prontuario.")])
        self.assertEqual(d["trilha_auditoria.entidade"]["coluna"], "=horario_administracao")
        self.assertEqual(d["trilha_auditoria.entidade_id"]["via"], "ref:PRCHKGERAL;trilha_auditoria")
        self.assertTrue(d["trilha_auditoria.correlacao"]["via"].startswith(
            "ref:PRASSINATURA_DOC>ID_PRASSINATURA_CAB>PRASSINATURA_CAB"))
        self.assertTrue(d["trilha_auditoria.ocorrido_em"]["via"].startswith("ref:PRASSINATURA_DOC>DATA_HORA_EVENTO"))

    def test_id_externo_e_preparo(self):
        self.assertEqual(l6_13.id_externo("ATCABECATEND", "1"), 1)
        self.assertIn("INSERT INTO prescricao_item (id", l6_13.PREPARO_DESTINO)

    def test_imagem_e_esperado(self):
        linhas = []
        esp = l6_13.linhas(None, lambda t, v: linhas.append((t, v)))
        self.assertEqual(set(esp), set(l6_13.FATIA) - SEM_CARGA)
        for t, v in linhas:
            self.assertEqual(len(v), len(l6_13.COLUNAS[t]), t)


if __name__ == "__main__":
    unittest.main()
