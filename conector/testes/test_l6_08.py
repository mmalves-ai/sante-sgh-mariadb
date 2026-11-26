"""Fatia L6-08 (prontuário, assinatura e assistência, PEP): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L6-08`."""
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_08

TABELAS = set(l6_08.CARREGADAS)
NA_IMAGEM = TABELAS | set(l6_08.NAO_CARREGADAS)
DESTINOS = {
    "PRTPLAN_PRFREQUENCIA": "tipo_item_prescricao_frequencia", "PRTPLAN_PRTPINFUSAO": "tipo_item_prescricao_infusao",
    "PRTPNOTALEMB": "tipo_nota_paciente", "PRTPPERGUNTA": "tipo_campo_modelo", "PRTPPROT": "tipo_protocolo_oncologico",
    "PRTPRECMED": "tipo_receita", "PRTPTCLE": "situacao_termo_consentimento", "PRUNIDINFUSAO": "unidade_infusao",
    "PRKITSOL": "kit_prescricao", "PRUNIDRESPOSTA": "unidade_resposta",
    "PRVALIDARMEDDUPLICPRESC": "regra_duplicidade_terapeutica", "PRVIAAEREA": "via_aerea",
    "TBCBARACATEGORIA": "categoria_alergeno", "TBCBARAAGENTE": "alergeno", "TBCBARACLASSIFREACAO": "tipo_alergia",
    "TBCBARAORIGEMINFO": "origem_informacao_alergia", "TBCBARASEVERIDADE": "gravidade_reacao_adversa",
    "TBCLASSINTMED": "classificacao_interacao", "TBCLASSIFALERGIA": "categoria_alergeno"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "tipo_item_prescricao_frequencia": {"tipo_item_prescricao_id", "frequencia_administracao_id"},
    "tipo_item_prescricao_infusao": {"tipo_item_prescricao_id", "tipo_infusao_id"},
    "tipo_nota_paciente": {"codigo", "descricao"}, "tipo_campo_modelo": {"codigo", "descricao", "tipo_dado"},
    "tipo_protocolo_oncologico": {"codigo", "descricao"}, "tipo_receita": {"codigo", "descricao"},
    "situacao_termo_consentimento": {"codigo", "descricao", "etapa"},
    "unidade_infusao": {"codigo", "descricao", "sigla"}, "kit_prescricao": {"codigo", "nome", "tipo_kit"},
    "unidade_resposta": {"codigo", "descricao", "sigla"},
    "regra_duplicidade_terapeutica": {"codigo", "descricao", "criterio"}, "via_aerea": {"codigo", "descricao"},
    "categoria_alergeno": {"codigo", "descricao"}, "alergeno": {"codigo", "descricao", "natureza"},
    "tipo_alergia": {"codigo", "descricao", "classificacao"}, "origem_informacao_alergia": {"codigo", "descricao"},
    "gravidade_reacao_adversa": {"codigo", "descricao", "nivel"}, "classificacao_interacao": {"codigo", "descricao"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)

    def test_nao_carregadas_descartadas_com_causa_de_produto(self):
        decl = {c["tabela"] for c in self.mapa["colunas_decl"] if c.get("destino")}
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        for t in l6_08.NAO_CARREGADAS:
            self.assertNotIn(t, decl, t)
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], ("mecanismo_do_produto", "duplicado", "sem_valor"), t)

    def test_pais_externos_carregados_pelo_mapa(self):
        # pai dado como já carregado na imagem tem de ser carregado de verdade pelo mapa (nunca descartado)
        sc = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        decl = {c["tabela"] for c in self.mapa["colunas_decl"] if c.get("destino")}
        for t in l6_08.PAIS_EXTERNOS:
            self.assertNotIn(t, sc, t)
            self.assertIn(t, decl, t)

    def test_cobertura_categoria_com_prefixo(self):
        self.assertEqual(self.cols("TBCLASSIFALERGIA")["codigo"]["coluna"], "#codigo_derivado:ID:30:cl_")
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "cl_"), ("cl_1", False))

    def test_referencias(self):
        f = self.cols("PRTPLAN_PRFREQUENCIA")
        self.assertEqual((f["tipo_item_prescricao_id"]["referencia"], f["frequencia_administracao_id"]["referencia"]),
                         ("PRTPLAN", "PRFREQUENCIA"))
        k = self.cols("PRKITSOL")
        self.assertEqual(k["via_de_uso_id"]["referencia"], "GETABVIA")  # chave texto do pai, declarada na via
        self.assertEqual(k["via_de_uso_id"]["regra"], "chave_origem")
        self.assertEqual(k["unidade_infusao_id"]["referencia"], "PRUNIDINFUSAO")
        self.assertEqual(self.cols("TBCBARAAGENTE")["categoria_alergeno_id"]["referencia"], "TBCBARACATEGORIA")

    def test_booleanos_e_literais(self):
        self.assertEqual(self.cols("PRTPLAN_PRFREQUENCIA")["visivel"]["regra"], "booleano_sn")
        self.assertEqual(self.cols("PRTPPROT")["separa_documento_gerado"]["regra"], "booleano_01")
        self.assertEqual(self.cols("PRKITSOL")["tipo_kit"]["coluna"], "=solucao")
        presumidos = {"PRVALIDARMEDDUPLICPRESC": "criterio", "TBCBARAAGENTE": "natureza",
                      "TBCBARACLASSIFREACAO": "classificacao", "PRUNIDINFUSAO": "por_peso"}
        for t, dc in presumidos.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)

    def test_etapa_do_termo_pelo_nome_e_nunca_pendente_presumida(self):
        # pedido 67: a etapa vem do nome (de-para); sem par, 'cancelado' presumido (terminal, não acionável, sem neutro
        # no CHECK), nunca 'pendente' (geraria coleta de assinatura de termo antigo)
        self.assertEqual([(c["coluna"], c["depara"]) for c in self.plano["PRTPTCLE"]["colunas"]["situacao_termo_consentimento"]
                          if c["destino"] == "etapa"], [("NOME", "valores"), ("=~cancelado", "")])
        v = self.valores("PRTPTCLE", "NOME", "situacao_termo_consentimento.etapa")
        self.assertEqual((v["Pendente"], v["ASSINADO"], v["Recusado"], v["Cancelado"]),
                         ("pendente", "assinado", "recusado", "cancelado"))
        self.assertEqual(set(v.values()), {"pendente", "emitido", "assinado", "recusado", "revogado", "cancelado"})

    def valores(self, t, col, dest):
        return {v["valor_origem"]: v["valor_destino"] for v in mapa.ler_valores(mapa.DIR_PACOTE)
                if (v["tabela"], v["coluna"], v["destino"]) == (t, col, dest)}

    def test_nivel_da_gravidade_pelo_nome(self):
        # a chave da origem NÃO prova a ordem de gravidade: o nível vem do nome (1 = menor), nunca da chave
        g = self.cols("TBCBARASEVERIDADE")
        self.assertEqual((g["nivel"]["coluna"], g["nivel"]["depara"]), ("NOME", "valores"))
        self.assertNotIn("codigo_terminologia", g)
        v = self.valores("TBCBARASEVERIDADE", "NOME", "gravidade_reacao_adversa.nivel")
        self.assertEqual([v["Leve"], v["Moderada"], v["Grave"], v["Fatal"], v["GRAVE"]], ["1", "2", "3", "4", "3"])

    def test_tipo_da_pergunta_e_categoria_pelo_depara(self):
        # recusas-fase2 P3a (pedido 67): o tipo sem par cai na concorrente texto presumida (valor_presumido)
        self.assertEqual([(c["coluna"], c["depara"]) for c in self.plano["PRTPPERGUNTA"]["colunas"][DESTINOS["PRTPPERGUNTA"]]
                          if c["destino"] == "tipo_dado"], [("NOME", "valores"), ("=~texto", "")])
        v = self.valores("PRTPPERGUNTA", "NOME", "tipo_campo_modelo.tipo_dado")
        self.assertEqual((v["Texto"], v["DATA"], v["Número"]), ("texto", "data", "numero"))
        ck = {'titulo', 'texto', 'texto_longo', 'numero', 'data', 'hora', 'data_hora', 'booleano', 'lista',
              'lista_multipla', 'tabela', 'desenho', 'assinatura', 'componente', 'calculado', 'arquivo'}
        self.assertTrue(set(v.values()) <= ck)
        p = self.cols("PRTPPROT")["categoria"]
        self.assertEqual((p["coluna"], p["depara"]), ("TIPO", "valores"))
        self.assertEqual(self.valores("PRTPPROT", "TIPO", "tipo_protocolo_oncologico.categoria")["Q"], "quimioterapia")

    def test_codigos_pela_chave(self):
        # o código da terminologia não é o código do produto (cabe 30): a chave evita recusa em cadeia dos alergenos
        self.assertEqual(self.cols("TBCBARACATEGORIA")["codigo"]["coluna"], "ID")
        self.assertEqual(self.cols("TBCBARAAGENTE")["codigo"]["coluna"], "ID")
        self.assertEqual(self.cols("TBCBARAAGENTE")["codigo_cbara"]["coluna"], "CODIGO")

    def test_colunas_fora_com_motivo_e_regras_novas(self):
        # cor sem regra para #RRGGBB (L6-08.json); sigla resumida; velocidade só positiva
        self.assertNotIn("cor", self.cols("PRTPPROT"))
        self.assertIn("COR", " ".join(c["motivo"] for c in self.mapa["colunas_decl"] if c["tabela"] == "PRTPPROT"))
        self.assertEqual(self.cols("PRUNIDINFUSAO")["sigla"]["regra"], "texto_resumo:20")
        self.assertEqual(self.cols("PRUNIDRESPOSTA")["sigla"]["regra"], "texto_resumo:20")
        self.assertEqual(self.cols("PRKITSOL")["velocidade_infusao"]["regra"], "decimal_positivo")

    def test_categoria_alergeno_duas_alimentadoras_com_prefixo(self):
        alim = sorted({c["tabela"] for c in self.mapa["colunas_decl"]
                       if (c.get("destino") or "").startswith("categoria_alergeno.")})
        self.assertEqual(alim, ["TBCBARACATEGORIA", "TBCLASSIFALERGIA"])
        self.assertEqual(self.cols("TBCBARACATEGORIA")["codigo"]["coluna"], "ID")  # sem prefixo: "1" e "cl_1"


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_01", 2), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", "  Agente   oito  ".encode("cp1252")), ("Agente oito", None))
        self.assertEqual(a("texto", " cm ".encode("cp1252")), ("cm", None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("texto_resumo:20", "unidade exemplo longa demais".encode("cp1252"))[0], "unidade exemplo")
        self.assertEqual(a("decimal_positivo", decimal.Decimal("0"))[1], "valor_fora_do_dominio")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_08.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            pref = ("restricao_destino_", "pai_pendente")
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(pref))
            recusas += l6_08.RECUSA_PAI_INEXISTENTE.get(t, 0)  # complementa sem o pai: a linha é recusada
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l6_08.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, NA_IMAGEM | set(l6_08.PAIS_NA_IMAGEM))


class Complementos(unittest.TestCase):  # revisão 2: o complemento é provado com sucesso e o N:1 fica na imagem
    def test_imagem_traz_o_leiaute_e_o_tipo_repetido(self):
        vistos = {}
        l6_08.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(list(v)))
        cods = {r[1] for r in vistos["PRFICHAREL"]}
        self.assertTrue([r for r in vistos["PRPARRECMED"] if r[0] in cods])  # ao menos um leiaute complementado
        por_dado = {}
        for r in vistos["PRTPRESPOSTA"]:
            por_dado.setdefault(r[2], []).append(r[1])
        self.assertTrue([d for d, ts in por_dado.items() if len(set(ts)) > 1])  # dado de envio com dois tipos


class ViaDigital(unittest.TestCase):  # rodada 5 (ADR 0006): o catálogo de vias do parceiro carrega
    def test_via_digital_no_mapeamento_externo(self):
        import csv
        from sante_conector import mapa
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-08.tsv", encoding="utf-8") as f:
            d = {r["destino"]: r for r in csv.DictReader(f, delimiter="\t") if r["tabela"] == "TBDIGITAL_VIAACESSO"}
        self.assertEqual(d["mapeamento_codigo_externo.entidade_id"]["via"],
                         "cod:via_de_uso.codigo_interoperabilidade;mapeamento_codigo_externo;principal")
        self.assertEqual(d["mapeamento_codigo_externo.entidade"]["coluna"], "=via_de_uso")
        self.assertEqual(d["mapeamento_codigo_externo.codigo_externo"]["coluna"], "CODIGO")
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            self.assertNotIn("TBDIGITAL_VIAACESSO", {r["tabela"] for r in csv.DictReader(f, delimiter="\t")})


if __name__ == "__main__":
    unittest.main()
