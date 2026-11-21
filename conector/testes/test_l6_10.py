"""Fatia F4 L6-10 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo
mapa. Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_10

FATIA = "colunas.d/L6-10.tsv"


class L6_10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_10.CARREGADAS) | set(l6_10.DESCARTADAS) | set(l6_10.BLOQUEADAS)
        cls.esp = l6_10.linhas(random.Random(1), lambda t, v: None)
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, cls.todas)}

    def test_fatia_tem_as_23_tabelas_e_a_imagem_tambem(self):
        # PRRESPOSTA passou à L6-11 (carrega lá): nem declaração comentada nem imagem aqui
        self.assertEqual(len(self.todas), 23)
        self.assertNotIn("PRRESPOSTA", self.todas)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_10.DDL)), self.todas)
        self.assertEqual(l6_10.REQUER, ["L6-08"])  # gravidade lida na origem pela referência encadeada

    def test_bloqueadas_com_causa_e_declaracao_pronta(self):
        sem = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv")}
        self.assertEqual(l6_10.BLOQUEADAS, ())
        causas = {t: (sem[t]["situacao"], sem[t]["causa"]) for t in l6_10.DESCARTADAS}
        self.assertEqual(causas, {"PRPERGUNTA": ("descarte", "duplicado")})
        # PRRESPOSTA é da L6-11 (a linha dela em sem_carga.tsv é de lá); as carregadas daqui não têm linha
        for t in ("TBTPSITUACAOMP", "PRPARAMSUMARIOALTA"):
            self.assertNotIn(t, sem)
        texto = (mapa.DIR_PACOTE / "declarado" / FATIA).read_text(encoding="utf-8")
        self.assertNotIn("PRRESPOSTA\t", texto)  # obsoleta aqui: a declaração vale na L6-11

    def test_toda_coluna_da_origem_declarada(self):
        geradas = {(c["tabela"], c["coluna"]) for c in self.m["colunas"] if c["tabela"] in self.todas}
        declaradas = {(c["tabela"], c["coluna"]) for c in self.decl}
        declaradas |= {(c["tabela"], carga_mapa.fonte_especial(c["coluna"])) for c in self.decl
                       if c["coluna"].startswith("#codigo_derivado:")}  # a chave lida pelo código com prefixo
        self.assertEqual(geradas - declaradas, set())

    def test_plano_so_com_as_carregadas_e_destinos(self):
        self.assertEqual(set(self.plano), set(l6_10.CARREGADAS))
        self.assertEqual(self.plano["TBUNIDADEMEDIDA"]["destinos"], ["unidade_prescricao", "unidade_resultado"])
        # a resposta pontuada é opção da variável, não escala nem variável nova
        self.assertEqual(self.plano["PRGLASGOW"]["destinos"], ["escala_clinica_opcao"])
        self.assertEqual(self.plano["PRINDICEPONTUACAO"]["destinos"], ["escala_clinica_opcao"])

    def test_bloqueada_sem_destino(self):
        for c in self.decl:
            if c["tabela"] in l6_10.BLOQUEADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertIn("bloqueada", c["motivo"], c["tabela"])

    def test_literal_sempre_presumido(self):
        # valor que a origem não tem (classificação ou rótulo) só entra com pendência de revisão (=~): nenhum fixo
        # única exceção: a marca "qualquer origem" da regra de situação, que é o significado da própria linha da origem
        fixos = [(c["destino"], c["coluna"]) for c in self.decl
                 if c["coluna"].startswith("=") and not c["coluna"].startswith("=~")]
        self.assertEqual(fixos, [("regra_transicao_situacao_prescricao.qualquer_origem", "=1")])

    def test_regra_de_situacao_vale_vinda_de_qualquer_origem(self):
        dest = {c["destino"]: c for c in self.decl if c["tabela"] == "TBTPSITUACAOMP" and c["destino"]}
        self.assertEqual(self.plano["TBTPSITUACAOMP"]["destinos"], ["regra_transicao_situacao_prescricao"])
        # a origem nunca é declarada: nula com qualquer_origem verdadeiro (CHECK do modelo); nula sem a marca = criação
        self.assertNotIn("regra_transicao_situacao_prescricao.origem_situacao_prescricao_id", dest)
        self.assertEqual(dest["regra_transicao_situacao_prescricao.destino_situacao_prescricao_id"]["coluna"],
                         "ID_TBSITUACAOMP")
        # senha mestra compartilhada nunca é gravada; a exigência vira reautenticação do próprio usuário
        self.assertFalse([c for c in self.decl if c["tabela"] == "TBTPSITUACAOMP"
                          and c["coluna"].startswith("SENHA") and c["destino"]])
        self.assertEqual(dest["regra_transicao_situacao_prescricao.exige_reautenticacao"]["coluna"], "NEC_SENHA")

    def test_pergunta_duplicada_so_se_a_ligacao_a_le(self):
        # PRPERGUNTA só pode ser descarte 'duplicado' se o campo do modelo (PRPADEVOL, L6-11) ler na origem, pela
        # encadeada terminada em coluna, TODO o conteúdo da pergunta: título, tipo, unidade, texto padrão e situação.
        sem = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv")}
        pad = [c for c in self.m["colunas_decl"] if c["tabela"] == "PRPADEVOL" and c["destino"]]
        lidas = {x.split(">", 1)[1] for c in pad for x in (c.get("via") or "").split(";")
                 if x.startswith("ref:PRPERGUNTA>")}
        completa = ({"DESCRICAO", "TIPOPERG", "CONTEVOL", "ATIVO"} <= lidas
                    and bool({"UNIDPERG", "ID_TBUNIDADEMEDIDA"} & lidas))
        if sem["PRPERGUNTA"]["situacao"] == "descarte":
            self.assertTrue(completa, "descarte duplicado de PRPERGUNTA sem a PRPADEVOL ler: %s" % sorted(lidas))
        else:
            self.assertEqual(sem["PRPERGUNTA"]["situacao"], "bloqueada")
        if pad:  # o título vem sempre pela encadeada (não há coluna TITULO)
            tit = [c for c in pad if c["destino"] == "modelo_campo.titulo"]
            self.assertEqual([c["via"].split(";")[0] for c in tit], ["ref:PRPERGUNTA>DESCRICAO"])

    def test_presumido_de_seguranca_no_padrao_mais_seguro(self):
        lit = {c["destino"]: c["coluna"] for c in self.decl if c["coluna"].startswith("=~")}
        # o presumido nunca enfraquece um alerta da origem: o mais restritivo
        self.assertEqual(lit["acao_alerta_alergia.comportamento"], "=~bloquear")
        # campo de segurança presumido (pendência ainda baixa no motor): o cadastro entra inativo até a revisão
        self.assertEqual(lit["tipo_parto.ativo"], "=~0")
        self.assertEqual(lit["condicao_recem_nascido.ativo"], "=~0")

    def test_copia_da_grade_por_bloco(self):
        # o bloco grava uma CÓPIA da grade (linha nova), nunca UPDATE da grade do pai: dois blocos na mesma grade
        # não se sobrescrevem e nenhum bloco perde a grade
        p = self.plano["TBHORMED_RIBLOCOS"]
        self.assertEqual(p["destinos"], ["grade_horario_unidade"])
        self.assertFalse((p.get("opcoes") or {}).get("grade_horario_unidade", {}).get("complementa"))
        via = {c["destino"]: c["via"] for c in self.decl if c["tabela"] == "TBHORMED_RIBLOCOS" and c["destino"]}
        self.assertNotIn("grade_horario_unidade.id", via)
        self.assertEqual(via.pop("grade_horario_unidade.bloco_internacao_id"), "ref:RIBLOCOS")
        self.assertEqual(via, {"grade_horario_unidade." + k: "ref:TBHORMED@" + k for k in (
            "estabelecimento_id", "tipo_atendimento", "hora_inicio_dia", "considera_vigencia",
            "permite_liberar_fora_vigencia")})
        # a imagem tem dois blocos na mesma grade e o esperado conta as duas cópias gravadas
        ins = []
        l6_10.linhas(random.Random(1), lambda t, v: ins.append((t, v)))
        grades = [v[1] for t, v in ins if t == "TBHORMED_RIBLOCOS" and v[0] in ("A", "B")]
        self.assertEqual(grades, [1, 1])
        self.assertEqual(self.esp["TBHORMED_RIBLOCOS"]["gravados"], 3)

    def test_complemento_da_linha_do_pai(self):
        # a gravidade completa a ação: UPDATE da linha do pai, nunca linha nova
        for t, dt in (("TBCBARANOTIFICACAO", "acao_alerta_alergia"),):
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
        # a unidade de prescrição do tipo de item: adotada ou criada pelo código de TBUNICON (como na L6-11)
        self.assertNotIn(("PRUNITPLAN", "tipo_item_prescricao_unidade.unidade_prescricao_id"), via)
        self.assertEqual(via[("PRUNITPLAN", "unidade_prescricao.codigo")], "unidade_prescricao;antes;adotar:codigo")
        self.assertEqual(via[("PRUNITPLAN", "unidade_prescricao.unidade_medida_id")], "unidade_prescricao;ref:TBUNICON")
        self.assertIn(("@id:unidade_prescricao", "tipo_item_prescricao_unidade.unidade_prescricao_id"),
                      {(c["coluna"], c["destino"]) for c in self.decl if c["tabela"] == "PRUNITPLAN"})
        self.assertEqual(self.plano["PRUNITPLAN"]["destinos"][0], "tipo_item_prescricao_unidade")
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

    def test_carga_parcial_da_unidade_declarada(self):
        # a unidade casa pela sigla de integração só em parte das linhas: o motivo traz a medição e o pedido
        for t, c in (("TBUNIDMEDIDA_PRINC_VALID", "ID_TBUNIDADEMEDIDA"),
                     ("PRPARAMSUMARIOALTA", "ID_PROPCAOPERIODO_PROC"), ("PRPARAMSUMARIOALTA", "ID_PRPERGUNTA_PLANO")):
            m = next(x["motivo"] for x in self.decl if (x["tabela"], x["coluna"]) == (t, c))
            self.assertIn("CARGA PARCIAL", m, t)
            self.assertIn("pedido", m, t)

    def test_sumario_de_alta_uma_secao_por_coluna(self):
        p = self.plano["PRPARAMSUMARIOALTA"]
        self.assertEqual(p["destinos"], ["componente_sumario_alta"])
        rot = [r.split("|") for _, r in p["opcoes"]["componente_sumario_alta"]["desdobrar"]]
        self.assertEqual([r[1] for r in rot], ["procedimentos", "exames", "evolucao_clinica", "plano_terapeutico"])
        self.assertEqual([r[3] for r in rot], ["1", "2", "3", "4"])
        par = {(v["coluna"], v["valor_origem"]): v["valor_destino"] for v in self.m["valores"]
               if v["tabela"] == "PRPARAMSUMARIOALTA"}
        # domínios fixos do sistema anterior: 4 'nenhum' e os recortes 0 e 3 ficam sem par (pendência, nunca chute)
        self.assertEqual(par, {("ID_PRTPATEND", "1"): "ambulatorio", ("ID_PRTPATEND", "2"): "internacao",
                               ("ID_PRTPATEND", "3"): "todos",
                               ("ID_PROPCAOPERIODO_PROC", "1"): "atendimento_inteiro",
                               ("ID_PROPCAOPERIODO_PROC", "2"): "ultimas_24_horas"})

    def test_esperado_da_imagem_so_nas_carregadas(self):
        self.assertEqual(set(self.esp), set(l6_10.CARREGADAS))
        for t in l6_10.BLOQUEADAS:
            self.assertNotIn(t, self.esp)
        self.assertEqual(self.esp["TBUNIDADEMEDIDA"]["gravados"], 4)


if __name__ == "__main__":
    unittest.main()
