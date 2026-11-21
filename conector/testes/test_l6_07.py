"""Fatia L6-07 (prontuário, assinatura e assistência do PEP): declarações, plano da carga dirigida pelo mapa e regras
das colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L6-07`)."""
import csv
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_07

FATIA = ["PRSITDOCUMENTO", "PRSITDOCUMENTOASSINADO", "PRSITEXAME", "PRSITUACAOCHECAGEM", "PRSUMARIO_ALTA_COMP",
         "PRTIPODOCANEXO", "PRTIPONOTIFICACAO", "PRTIPOPERGPAR", "PRTIPOPRESENTEADMISSAO", "PRTPALERTA",
         "PRTPASSINATURA", "PRINDICEAGRUPAMENTO", "PRPARAMORIGEMCABIMP", "PRTPASSINATURA_PRSITDOC",
         "PRTPASSINATURA_TBOID", "PRTPCOMP", "PRTPDOCUMENTO", "PRTPINFOPERGOPERADORA", "PRINFOPERGOPERADORA",
         "PRTPINFUSAO", "PRTPLAN", "PRMODOVENT", "PRTPLAN_GETABVIA"]
RECUSAS = ("restricao_destino_", "codigo_colisao_caixa", "pai_pendente")


class L607(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-07.tsv", encoding="utf-8") as f:
            cls.decl = list(csv.DictReader(f, delimiter="\t"))

    def cols(self, t):
        p = self.plano[t]
        return {c["destino"]: c for c in p["colunas"][p["destinos"][0]]}

    def test_carregadas_e_nao_carregadas(self):
        self.assertEqual(set(self.plano), set(FATIA) - set(l6_07.NAO_CARREGADAS))
        for t in l6_07.NAO_CARREGADAS:
            linhas = [d for d in self.decl if d["tabela"] == t]
            self.assertTrue(linhas)
            for d in linhas:
                self.assertEqual(d["destino"], "")
                self.assertTrue(d["motivo"])

    def test_tipo_documento_de_duas_fontes_sem_choque(self):
        origem = {t for t, p in self.plano.items() if "tipo_documento_clinico" in p["destinos"]}
        self.assertEqual(origem, {"PRTPASSINATURA", "PRTPCOMP"})
        self.assertEqual(self.cols("PRTPASSINATURA")["codigo"]["coluna"], "ID")
        self.assertEqual(self.cols("PRTPCOMP")["codigo"]["coluna"], "#codigo_derivado:ID:30:evolucao_")
        self.assertEqual(carga_mapa.codigo_derivado("7", 30, "evolucao_"), ("evolucao_7", False))
        self.assertEqual(self.cols("PRTPCOMP")["categoria"]["coluna"], "=evolucao")  # evidência: evoluções
        self.assertEqual(self.cols("PRTPASSINATURA")["categoria"]["coluna"], "=~outro")

    def test_descartadas_com_motivo_de_produto(self):
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t in l6_07.NAO_CARREGADAS:
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", "mecanismo_do_produto"), t)
            self.assertTrue(sc[t]["motivo"], t)

    def test_situacao_permitida_por_tipo_inativa_presumida(self):
        c = self.cols("PRTPASSINATURA_PRSITDOC")
        self.assertNotIn("situacao_origem_id", c)  # a origem não tem a transição
        self.assertEqual(c["ativo"]["coluna"], "=~0")
        self.assertEqual(c["ordem"]["regra"], "piso:0")
        self.assertEqual(c["tipo_documento_clinico_id"]["regra"], "chave_origem")
        self.assertEqual(c["situacao_destino_id"]["regra"], "chave_origem")

    def test_codigo_da_chave_e_descricao(self):
        for t, p in self.plano.items():
            c = self.cols(t)
            if "codigo" in c:
                self.assertIn(c["codigo"]["coluna"], ("ID", "#codigo_derivado:ID:30:anexo_",
                                                     "#codigo_derivado:ID:30:evolucao_"))
                self.assertIn(c["codigo"]["regra"], ("texto", "texto_char"))
        c = self.cols("PRSITUACAOCHECAGEM")["codigo"]
        self.assertEqual((c["regra"], c["depara"]), ("texto_char", "valores"))

    def test_literais_presumidos_e_neutros(self):
        presumidos = {"PRSITDOCUMENTO": "categoria", "PRSITDOCUMENTOASSINADO": "categoria", "PRSITEXAME": "etapa",
                      "PRSITUACAOCHECAGEM": "categoria", "PRSUMARIO_ALTA_COMP": "tipo_conteudo",
                      "PRTIPOPRESENTEADMISSAO": "significado", "PRTPDOCUMENTO": "nivel",
                      "PRTPALERTA": "categoria", "PRTPASSINATURA": "categoria", "PRTPINFUSAO": "modo",
                      "PRTPLAN": "categoria"}
        for t, dc in presumidos.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)
        # domínio com CHECK que a origem traz em coluna própria: de-para de valores, nunca constante presumida
        for t, dc, col in [("PRSITUACAOCHECAGEM", "processo_enfermagem", "NOME_PROCESSO_ENFERMAGEM"),
                           ("PRMODOVENT", "tipo_ventilacao", "ID_PRTPLAN"),
                           ("PRPARAMORIGEMCABIMP", "fonte_dados", "ORIGEM_DADOS")]:
            self.assertEqual((self.cols(t)[dc]["coluna"], self.cols(t)[dc]["depara"]), (col, "valores"), t)
            self.assertTrue(self.cols(t)[dc]["valores"], t)
        # nenhuma constante silenciosa ('=' sem '~') além da categoria com evidência
        fixos = [(d["tabela"], d["coluna"]) for d in self.decl
                 if d["coluna"].startswith("=") and not d["coluna"].startswith("=~")]
        self.assertEqual(fixos, [("PRTPCOMP", "=evolucao")])

    def test_valores_no_dominio(self):
        dom = {"situacao_checagem.processo_enfermagem": {"administracao", "cuidado", "afericao", "coleta", "conferencia"},
               "modo_ventilacao_mecanica.tipo_ventilacao": {"invasiva", "nao_invasiva", "ambas"},
               "cabecalho_impressao_documento.fonte_dados": {"estabelecimento", "mantenedora"}}
        pares = [v for v in self.m["valores"] if v["tabela"] in FATIA]
        for v in pares:
            if v["destino"] in dom:
                self.assertIn(v["valor_destino"], dom[v["destino"]], v["valor_origem"])
        vent = {v["valor_origem"]: v["valor_destino"] for v in pares if v["coluna"] == "ID_PRTPLAN"}
        self.assertEqual(vent, {"11": "nao_invasiva", "12": "invasiva"})
        cod = {v["valor_origem"]: v["valor_destino"] for v in pares if v["destino"] == "situacao_checagem.codigo"}
        self.assertEqual(len(cod), 62)
        self.assertEqual(len({x.lower() for x in cod.values()}), 62)  # distintos sem caixa (código único)
        self.assertTrue(all(len(x) <= 30 and x.startswith("checagem_") for x in cod.values()))
        self.assertNotEqual(cod["a"].lower(), cod["A"].lower())

    def test_choque_de_codigo_com_outra_fonte_provado(self):
        # PROFTTPARQUIV e PRSITCHECAGEM (L6-06) gravam antes em tipo_anexo e situacao_checagem com código numérico
        self.assertIn("INSERT INTO tipo_anexo", l6_07.PREPARO_DESTINO)
        self.assertIn("INSERT INTO situacao_checagem", l6_07.PREPARO_DESTINO)
        esp = l6_07.linhas(random.Random(1), lambda t, v: None)
        # prefixo de domínio nas duas: nenhuma choca; 'a' e 'A' gravam as duas (sem colisão de caixa)
        self.assertEqual(self.cols("PRTIPODOCANEXO")["codigo"]["coluna"], "#codigo_derivado:ID:30:anexo_")
        for t in ("PRTIPODOCANEXO", "PRSITUACAOCHECAGEM"):
            self.assertNotIn("restricao_destino_1062", esp[t]["pendencias"], t)
            self.assertNotIn("codigo_colisao_caixa", esp[t]["pendencias"], t)

    def test_referencias(self):
        self.assertEqual(self.cols("PRINDICEAGRUPAMENTO")["tipo_documento_clinico_id"]["regra"], "chave_origem")
        self.assertEqual(self.cols("PRINFOPERGOPERADORA")["grupo_informacao_clinica_operadora_id"]["regra"],
                         "chave_origem")
        via = self.cols("PRTPLAN_GETABVIA")["via_de_uso_id"]
        self.assertEqual(via["regra"], "chave_origem")
        d = [x for x in self.decl if x["tabela"] == "PRTPLAN_GETABVIA" and x["coluna"] == "ID_GETABVIA"][0]
        self.assertEqual(mapa.referencia_declarada(d), "GETABVIA")
        self.assertIn("GETABVIA", l6_07.PAIS_EXTERNOS)

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S")[0], True)
        self.assertEqual(sentinela.aplicar("booleano_sn", "N")[0], False)
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_ai", "A")[0], True)
        self.assertEqual(sentinela.aplicar("booleano_ai", "I")[0], False)
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Situação   com  espaços ")[0], "Situação com espaços")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(sentinela.aplicar("codigo_char", "a"), ("a", None))
        self.assertTrue(sentinela.colisoes_caixa(["A", "a", "B"]))
        self.assertEqual(sentinela.aplicar("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("inteiro_nao_negativo", 3)[0], 3)
        self.assertEqual(self.cols("PRTPLAN")["ordem_exibicao"]["regra"], "inteiro_nao_negativo")

    def test_esperado_da_imagem_sintetica(self):
        vistos = {}
        esp = l6_07.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(FATIA) - set(l6_07.NAO_CARREGADAS))
        for t, e in esp.items():
            recusas = sum(v for k, v in e["pendencias"].items() if k.startswith(RECUSAS))
            self.assertEqual(e["gravados"] + recusas, len(vistos[t]), t)


if __name__ == "__main__":
    unittest.main()
