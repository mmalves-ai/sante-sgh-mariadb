"""Fatia F4 L6-10 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo
mapa. Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_10

FATIA = "colunas.d/L6-10.tsv"
COMENTADAS = {"TBTPSITUACAOMP", "PRRESPOSTA"}  # bloqueadas com a declaração pronta comentada


class L6_10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_10.CARREGADAS) | set(l6_10.DESCARTADAS) | set(l6_10.BLOQUEADAS)
        cls.esp = l6_10.linhas(random.Random(1), lambda t, v: None)
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, cls.todas)}

    def test_fatia_tem_as_24_tabelas_e_a_imagem_tambem(self):
        self.assertEqual(len(self.todas), 24)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas - COMENTADAS)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_10.DDL)), self.todas)
        self.assertEqual(l6_10.REQUER, ["L6-08"])  # gravidade lida na origem pela referência encadeada

    def test_bloqueadas_com_causa_e_declaracao_pronta(self):
        sem = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv")}
        for t in l6_10.DESCARTADAS:
            self.assertEqual(sem[t]["situacao"], "descarte")
        self.assertEqual(sem["PRPARAMSUMARIOALTA"]["causa"], "sem_valor")
        causas = {t: (sem[t]["situacao"], sem[t]["causa"]) for t in l6_10.BLOQUEADAS}
        self.assertEqual(causas, {"PRPERGUNTA": ("bloqueada", "depende_de_fatia:L6-11"),
                                  "TBTPSITUACAOMP": ("bloqueada", "destino_decidido"),
                                  "PRRESPOSTA": ("bloqueada", "pai_nao_carregado:PRPADEVOL")})
        texto = (mapa.DIR_PACOTE / "declarado" / FATIA).read_text(encoding="utf-8")
        for t in COMENTADAS:
            self.assertIn("\n#%s\t" % t, texto, t)

    def test_toda_coluna_da_origem_declarada(self):
        geradas = {(c["tabela"], c["coluna"]) for c in self.m["colunas"] if c["tabela"] in self.todas}
        declaradas = {(c["tabela"], c["coluna"]) for c in self.decl}
        declaradas |= {(c["tabela"], carga_mapa.fonte_especial(c["coluna"])) for c in self.decl
                       if c["coluna"].startswith("#codigo_derivado:")}  # a chave lida pelo código com prefixo
        self.assertEqual({x for x in geradas - declaradas if x[0] not in COMENTADAS}, set())

    def test_plano_so_com_as_carregadas_e_destinos(self):
        self.assertEqual(set(self.plano), set(l6_10.CARREGADAS))
        self.assertEqual(self.plano["TBUNIDADEMEDIDA"]["destinos"], ["unidade_prescricao", "unidade_resultado"])
        # a resposta pontuada é opção da variável, não escala nem variável nova
        self.assertEqual(self.plano["PRGLASGOW"]["destinos"], ["escala_clinica_opcao"])
        self.assertEqual(self.plano["PRINDICEPONTUACAO"]["destinos"], ["escala_clinica_opcao"])

    def test_descartada_sem_destino(self):
        for c in self.decl:
            if c["tabela"] in l6_10.DESCARTADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertIn("descarte", c["motivo"], c["tabela"])

    def test_literal_sempre_presumido(self):
        # valor que a origem não tem (classificação ou rótulo) só entra com pendência de revisão (=~): nenhum fixo
        fixos = [c for c in self.decl if c["coluna"].startswith("=") and not c["coluna"].startswith("=~")]
        self.assertEqual(fixos, [])

    def test_presumido_de_seguranca_no_padrao_mais_seguro(self):
        lit = {c["destino"]: c["coluna"] for c in self.decl if c["coluna"].startswith("=~")}
        # o presumido nunca enfraquece um alerta da origem: o mais restritivo
        self.assertEqual(lit["acao_alerta_alergia.comportamento"], "=~bloquear")
        # campo de segurança presumido (pendência ainda baixa no motor): o cadastro entra inativo até a revisão
        self.assertEqual(lit["tipo_parto.ativo"], "=~0")
        self.assertEqual(lit["condicao_recem_nascido.ativo"], "=~0")

    def test_complemento_da_linha_do_pai(self):
        # a gravidade completa a ação e o bloco completa a grade: UPDATE da linha do pai, nunca linha nova
        for t, dt in (("TBCBARANOTIFICACAO", "acao_alerta_alergia"), ("TBHORMED_RIBLOCOS", "grade_horario_unidade")):
            self.assertEqual(self.plano[t]["destinos"], [dt])
            self.assertTrue(self.plano[t]["opcoes"][dt]["complementa"], t)
            ids = [c for c in self.decl if c["tabela"] == t and c["destino"] == dt + ".id"]
            self.assertEqual(len(ids), 1)
            self.assertIn("ref:", ids[0]["via"])

    def test_gravidade_pelo_nome_nunca_pela_chave(self):
        c = next(c for c in self.decl if c["destino"] == "acao_alerta_alergia.gravidade_aplicavel")
        self.assertEqual(c["via"], "ref:TBCBARASEVERIDADE>NOME")
        par = {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
               if (v["tabela"], v["destino"]) == ("TBCBARANOTIFICACAO", "acao_alerta_alergia.gravidade_aplicavel")}
        self.assertFalse([k for k in par if k.isdigit()])
        self.assertEqual(set(par.values()), {"leve", "moderada", "grave", "fatal"})
        # o mesmo de-para de nomes da L6-08 (nivel da gravidade)
        l608 = {v["valor_origem"] for v in self.m["valores"] if v["tabela"] == "TBCBARASEVERIDADE"
                and v["destino"] == "gravidade_reacao_adversa.nivel"}
        self.assertEqual(set(par), l608)

    def test_referencias_no_dominio_certo(self):
        via = {(c["tabela"], c["destino"]): c["via"] for c in self.decl if c["destino"]}
        # unidade de medida pela sigla casada com o código da unidade (TBUNICON), nunca o id da unidade de prescrição
        self.assertEqual(via[("TBUNIDMEDIDA_PRINC_VALID", "tipo_validacao_dose_unidade.unidade_medida_id")],
                         "ref:TBUNIDADEMEDIDA>SIGLA_API>TBUNICON")
        self.assertEqual(via[("PRUNITPLAN", "tipo_item_prescricao_unidade.unidade_prescricao_id")],
                         "ref:TBUNIDADEMEDIDA.SIGLA_API")
        # o pai da FK é do domínio que ela espera: TBPRINC_VALIDACAO carrega em tipo_validacao_dose (L6-09)
        pv = carga_mapa.planejar(self.m, {"TBPRINC_VALIDACAO"})
        self.assertEqual([p["destinos"][0] for p in pv], ["tipo_validacao_dose"])
        self.assertNotIn(("PRINDICEVARIAVEL", "escala_clinica_variavel.unidade_medida_id"), via)
        for spec in set(via.values()):
            for x in spec.split(";"):
                if x.startswith("ref:"):
                    self.assertIsNotNone(mapa.passos_ref(x[4:]), x)

    def test_sigla_de_formula_derivada(self):
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "var_"), ("var_1", False))

    def test_sequencia_por_pai(self):
        seq = {(c["tabela"], c["coluna"]) for c in self.decl if c["coluna"].startswith("#seq:")}
        self.assertEqual(seq, {("PRINDICEVARIAVEL", "#seq:ID_PRINDICEAGRUPAMENTO"),
                               ("PRGLASGOW", "#seq:ID_PRINDICEVARIAVEL"),
                               ("PRINDICEPONTUACAO", "#seq:ID_PRINDICEVARIAVEL")})

    def test_regras_da_fatia(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Externo   ao  hospital ")[0], "Externo ao hospital")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_esperado_da_imagem_so_nas_carregadas(self):
        self.assertEqual(set(self.esp), set(l6_10.CARREGADAS))
        self.assertNotIn("PRPARAMSUMARIOALTA", self.esp)
        self.assertEqual(self.esp["TBUNIDADEMEDIDA"]["gravados"], 4)


if __name__ == "__main__":
    unittest.main()
