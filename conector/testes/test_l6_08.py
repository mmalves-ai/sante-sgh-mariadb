"""Fatia L6-08 (prontuário, assinatura e assistência, PEP): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L6-08`."""
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
    "TBCLASSINTMED": "classificacao_interacao"}
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

    def test_nao_carregadas_sem_declaracao(self):
        decl = {c["tabela"] for c in self.mapa["colunas_decl"]}
        for t in l6_08.NAO_CARREGADAS:
            self.assertNotIn(t, decl, t)

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
        presumidos = {"PRTPPERGUNTA": "tipo_dado", "PRTPPROT": "categoria", "PRTPTCLE": "etapa",
                      "PRVALIDARMEDDUPLICPRESC": "criterio", "TBCBARAAGENTE": "natureza",
                      "TBCBARACLASSIFREACAO": "classificacao", "PRUNIDINFUSAO": "por_peso",
                      "TBCBARASEVERIDADE": "codigo_terminologia"}
        for t, dc in presumidos.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)

    def test_nivel_da_gravidade_presumido(self):
        # a chave da origem NÃO prova a ordem de gravidade: o nível pela chave exige pendência valor_presumido na linha
        g = self.cols("TBCBARASEVERIDADE")
        self.assertEqual(g["nivel"]["coluna"], "ID")
        self.assertTrue(any(c["coluna"].startswith("=~") for c in g.values()))
        motivo = " ".join(c["motivo"] for c in self.mapa["colunas_decl"] if c["tabela"] == "TBCBARASEVERIDADE")
        self.assertIn("PRESUMIDA", motivo)

    def test_codigos_pela_chave(self):
        # o código da terminologia não é o código do produto (cabe 30): a chave evita recusa em cadeia dos alergenos
        self.assertEqual(self.cols("TBCBARACATEGORIA")["codigo"]["coluna"], "ID")
        self.assertEqual(self.cols("TBCBARAAGENTE")["codigo"]["coluna"], "ID")
        self.assertEqual(self.cols("TBCBARAAGENTE")["codigo_cbara"]["coluna"], "CODIGO")

    def test_tipo_da_pergunta_presumido_ate_o_depara(self):
        # o NOME é o tipo de pergunta: sem de-para de valores por fatia, 'texto' presumido com o pedido no motivo
        c = self.cols("PRTPPERGUNTA")["tipo_dado"]
        self.assertEqual(c["coluna"], "=~texto")
        motivo = [d["motivo"] for d in self.mapa["colunas_decl"]
                  if d["tabela"] == "PRTPPERGUNTA" and d["destino"] == "tipo_campo_modelo.tipo_dado"]
        self.assertIn("L6-08.json", motivo[0])

    def test_colunas_fora_com_motivo(self):
        # cor sem regra para #RRGGBB, velocidade com zero como 'sem valor' e tipo sem de-para (L6-08.json)
        self.assertNotIn("cor", self.cols("PRTPPROT"))
        self.assertNotIn("velocidade_infusao", self.cols("PRKITSOL"))
        motivos = " ".join(c["motivo"] for c in self.mapa["colunas_decl"] if c["tabela"] in ("PRTPPROT", "PRKITSOL"))
        self.assertIn("COR", motivos)
        self.assertIn("VELOCIDADE_INFUSAO", motivos)

    def test_categoria_alergeno_uma_so_alimentadora(self):
        outras = sorted({c["tabela"] for c in self.mapa["colunas_decl"]
                         if (c.get("destino") or "").startswith("categoria_alergeno.")} - {"TBCBARACATEGORIA"})
        self.assertEqual(outras, [], "combinar o espaço de código de categoria_alergeno (L6-08.json)")


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_01", 2), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", "  Agente   oito  ".encode("cp1252")), ("Agente oito", None))
        self.assertEqual(a("texto", " cm ".encode("cp1252")), ("cm", None))
        self.assertEqual(a("texto", 12), ("12", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_08.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l6_08.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, NA_IMAGEM)


if __name__ == "__main__":
    unittest.main()
