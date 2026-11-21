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

    def test_tipo_documento_so_pelo_tipo_de_assinatura(self):
        origem = {t for t, p in self.plano.items() if "tipo_documento_clinico" in p["destinos"]}
        self.assertEqual(origem, {"PRTPASSINATURA"})

    def test_codigo_da_chave_e_descricao(self):
        for t, p in self.plano.items():
            c = self.cols(t)
            if "codigo" in c:
                self.assertIn(c["codigo"]["coluna"], ("ID",))
                self.assertIn(c["codigo"]["regra"], ("texto", "codigo_char"))
        self.assertEqual(self.cols("PRSITUACAOCHECAGEM")["codigo"]["regra"], "codigo_char")

    def test_literais_presumidos_e_neutros(self):
        presumidos = {"PRSITDOCUMENTO": "categoria", "PRSITDOCUMENTOASSINADO": "categoria", "PRSITEXAME": "etapa",
                      "PRSITUACAOCHECAGEM": "categoria", "PRSUMARIO_ALTA_COMP": "tipo_conteudo",
                      "PRTIPOPRESENTEADMISSAO": "significado", "PRTPDOCUMENTO": "nivel",
                      "PRPARAMORIGEMCABIMP": "fonte_dados"}
        for t, dc in presumidos.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)
        # domínio com CHECK que a origem traz só em coluna sem de-para: presumido, nunca o padrão em silêncio
        for t, dc in {"PRSITUACAOCHECAGEM": "processo_enfermagem", "PRMODOVENT": "tipo_ventilacao"}.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)
        for t, dc in {"PRTPALERTA": "categoria", "PRTPASSINATURA": "categoria", "PRTPINFUSAO": "modo",
                      "PRTPLAN": "categoria"}.items():
            self.assertEqual(self.cols(t)[dc]["coluna"], "=outro", t)

    def test_choque_de_codigo_com_outra_fonte_provado(self):
        # PROFTTPARQUIV e PRSITCHECAGEM (L6-06) gravam antes em tipo_anexo e situacao_checagem com código numérico
        self.assertIn("INSERT INTO tipo_anexo", l6_07.PREPARO_DESTINO)
        self.assertIn("INSERT INTO situacao_checagem", l6_07.PREPARO_DESTINO)
        esp = l6_07.linhas(random.Random(1), lambda t, v: None)
        for t in ("PRTIPODOCANEXO", "PRSITUACAOCHECAGEM"):
            self.assertEqual(esp[t]["pendencias"].get("restricao_destino_1062"), 1, t)

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

    def test_esperado_da_imagem_sintetica(self):
        vistos = {}
        esp = l6_07.linhas(random.Random(1), lambda t, v: vistos.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(FATIA) - set(l6_07.NAO_CARREGADAS))
        for t, e in esp.items():
            recusas = sum(v for k, v in e["pendencias"].items() if k.startswith(RECUSAS))
            self.assertEqual(e["gravados"] + recusas, len(vistos[t]), t)


if __name__ == "__main__":
    unittest.main()
