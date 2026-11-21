"""Fatia L8-17 (faturamento e restantes, módulo INTG): declarações planejadas, regras das colunas, de-para de valores
do tipo de transação TISS e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação
rodam em `conector.sh conferir-fatia L8-17`."""
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_17

NA_IMAGEM = set(re.findall(r"CREATE TABLE (\w+) \(", l8_17.DDL))
DESTINOS = {"TBSMSTPERRO": "codigo_retorno_mensageria", "TBSMSTPRETMSG": "codigo_retorno_mensageria",
            "TBTISSSCHEMA": "transacao_tiss_webservice", "TBTPWEBSERV": "padrao_troca",
            "TBTISSURLWSSGH": "transacao_tiss_webservice"}
COMPLEMENTA = {"TBTISSURLWSSGH"}  # UPDATE da linha do pai: as obrigatórias são do pai
CAUSAS_DESCARTE = {"sem_valor", "duplicado", "licenciado", "catalogo_oficial", "mecanismo_do_produto"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {"codigo_retorno_mensageria": {"codigo", "descricao", "tipo", "situacao_resultante"},
                "transacao_tiss_webservice": {"versao_tiss", "codigo_transacao", "nome", "tipo_transacao"},
                "padrao_troca": {"codigo", "descricao", "familia"}}
# domínios dos CHECK do destino (db/migracoes/17_INTG)
DOMINIO = {
    ("codigo_retorno_mensageria", "tipo"): {"situacao", "erro"},
    ("codigo_retorno_mensageria", "situacao_resultante"): {"pendente", "enviada", "entregue", "lida",
                                                          "falha_temporaria", "falha_definitiva"},
    ("transacao_tiss_webservice", "tipo_transacao"): {
        "envio_lote", "solicitacao_procedimento", "status_protocolo", "status_autorizacao", "cancelamento_guia",
        "elegibilidade", "recurso_glosa", "demonstrativo", "comunicacao_beneficiario", "envio_documentos", "outro"},
    ("padrao_troca", "familia"): {"tiss", "hl7v2", "fhir", "dicom", "proprio", "arquivo", "api"}}
PRESUMIDOS = {"TBSMSTPERRO": {"situacao_resultante": "=~falha_definitiva"},
              "TBSMSTPRETMSG": {},
              "TBTISSSCHEMA": {"versao_tiss": "=~indefinida"}, "TBTPWEBSERV": {"familia": "=~api"}, "TBTISSURLWSSGH": {}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}
        cls.decl = [c for c in cls.mapa["colunas_decl"] if c["tabela"] in NA_IMAGEM]

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_so_as_carregadas_entram_no_plano(self):
        self.assertEqual(set(self.plano), set(l8_17.CARREGADAS))
        self.assertEqual(set(DESTINOS), set(l8_17.CARREGADAS))
        for t, dt in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_toda_coluna_da_imagem_declarada(self):
        declaradas = {(c["tabela"], c["coluna"]) for c in self.decl}
        for t in NA_IMAGEM:
            corpo = re.search(r"CREATE TABLE %s \((.*?)\);" % t, l8_17.DDL, re.S).group(1)
            for col in re.findall(r'"(\w+)" [A-Z]', corpo):
                self.assertIn((t, col), declaradas, (t, col))

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            if t not in COMPLEMENTA:
                self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)

    def test_literais_no_dominio_e_presumidos(self):
        for t, dt in DESTINOS.items():
            for dc, c in self.cols(t).items():
                if c["coluna"].startswith("="):
                    lit = c["coluna"].lstrip("=~")
                    if (dt, dc) in DOMINIO:
                        self.assertIn(lit, DOMINIO[(dt, dc)], (t, dc))
            for dc, lit in PRESUMIDOS[t].items():
                self.assertEqual(self.cols(t)[dc]["coluna"], lit, (t, dc))
        self.assertEqual(self.cols("TBSMSTPERRO")["tipo"]["coluna"], "=erro")
        self.assertEqual(self.cols("TBSMSTPRETMSG")["tipo"]["coluna"], "=situacao")

    def test_depara_tipo_transacao_no_dominio(self):
        pares = [v for v in self.mapa["valores"] if v["tabela"] == "TBTISSSCHEMA"]
        self.assertGreaterEqual(len(pares), 30)
        dom = DOMINIO[("transacao_tiss_webservice", "tipo_transacao")]
        for v in pares:
            self.assertEqual(v["destino"], "transacao_tiss_webservice.tipo_transacao")
            self.assertIn(v["valor_destino"], dom, v["valor_origem"])
            self.assertEqual(v["valor_origem"], v["valor_origem"].strip().upper())
        c = self.cols("TBTISSSCHEMA")["tipo_transacao"]
        self.assertEqual(c["valores"]["ENVIO_LOTE_GUIAS"], "envio_lote")
        self.assertEqual(c["valores"]["VERIFICA_ELEGIBILIDADE"], "elegibilidade")
        self.assertNotIn("TRANSACAO_FALSA_EX", c["valores"])
        # grafias do esquema oficial da ANS
        for v, d in (("SOLICITA_STATUS_AUTORIZACAO", "status_autorizacao"), ("SITUACAO_AUTORIZACAO", "status_autorizacao"),
                     ("AUTORIZACAO_ODONTOLOGIA", "solicitacao_procedimento"), ("RESPOSTA_RECURSO_GLOSA", "recurso_glosa")):
            self.assertEqual(c["valores"][v], d, v)
        # o motor ainda não tem curinga (pedido em saida/L8-17.json): par '*' seria letra morta
        self.assertNotIn("*", c["valores"])
        # o ID interno da situação não é código do provedor (sem evidência): codigo_provedor fica sem fonte
        self.assertNotIn("codigo_provedor", self.cols("TBSMSTPRETMSG"))

    def test_codigo_transacao_e_o_nome_no_padrao(self):
        c = self.cols("TBTISSSCHEMA")
        self.assertEqual(c["codigo_transacao"]["coluna"], "NOME")
        self.assertNotIn("ID", {x["coluna"] for x in c.values()})

    def test_situacao_resultante_por_nome_lado_seguro(self):
        c = self.cols("TBSMSTPRETMSG")["situacao_resultante"]
        self.assertEqual(c["coluna"], "NOME")
        dom = DOMINIO[("codigo_retorno_mensageria", "situacao_resultante")]
        self.assertTrue(set(c["valores"].values()) <= dom)
        self.assertNotIn("*", c["valores"])  # sem curinga no motor: nome sem par é recusado, nunca 'enviada'
        for v, d in (("Enviada", "enviada"), ("ENTREGUE", "entregue"), ("Lida", "lida"), ("Erro", "falha_definitiva"),
                     ("Falha", "falha_definitiva")):
            self.assertEqual(c["valores"][v], d, v)
        # nenhuma situação de falha ou pendência cai em 'enviada'
        for v, d in c["valores"].items():
            if any(x in v.lower() for x in ("erro", "falha", "rejeit", "cancel", "expir", "não", "nao", "pend", "aguard")):
                self.assertNotIn(d, ("enviada", "entregue", "lida"), v)

    def test_nao_carregadas_tem_motivo(self):
        for c in self.decl:
            if c["tabela"] not in l8_17.CARREGADAS:
                self.assertEqual(c["destino"], "", (c["tabela"], c["coluna"]))
                self.assertIn("não carregada", c["motivo"], (c["tabela"], c["coluna"]))

    def test_complemento_da_transacao(self):
        c = self.cols("TBTISSURLWSSGH")
        self.assertEqual(set(c), {"id", "caminho_padrao"})
        d = next(x for x in self.decl if x["tabela"] == "TBTISSURLWSSGH" and x["destino"].endswith(".id"))
        via = d["via"].split(";")
        self.assertIn("complementa", via)
        self.assertIn("ref:TBTISSSCHEMA", via)
        self.assertEqual(c["id"]["coluna"], "ID_TBTISSSCHEMA")
        self.assertEqual(c["caminho_padrao"]["coluna"], "URL_SERVICO")

    def test_cobertura_toda_tabela_carrega_ou_descarte_de_produto(self):
        arq = mapa.DIR_PACOTE / "declarado/sem_carga.tsv"
        sc = {r["tabela"]: r for r in mapa.ler_tsv(arq)}
        for t in NA_IMAGEM - set(l8_17.CARREGADAS):
            self.assertIn(t, sc, t)
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], CAUSAS_DESCARTE, t)
            self.assertTrue(sc[t]["motivo"].strip(), t)
        for t in l8_17.CARREGADAS:
            self.assertNotIn(t, sc, t)


class Regras(unittest.TestCase):
    def test_textos(self):
        self.assertEqual(sentinela.aplicar("texto", " EX04 ")[0], "EX04")
        self.assertEqual(sentinela.aplicar("texto_nome", " Lida  ex ")[0], "Lida ex")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(sentinela.aplicar("texto", " VERIFICA_ELEGIBILIDADE ")[0], "VERIFICA_ELEGIBILIDADE")


class ImagemSintetica(unittest.TestCase):
    def test_esperado_coerente(self):
        linhas = {}
        esp = l8_17.linhas(None, lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l8_17.CARREGADAS))
        self.assertEqual(set(linhas), NA_IMAGEM)
        recusas = ("restricao_destino_1048", "restricao_destino_1062", "pai_pendente", "pai_inexistente")
        for t, e in esp.items():
            n = len(linhas[t])
            recusadas = sum(e["pendencias"].get(r, 0) for r in recusas)
            self.assertEqual(e["gravados"] + recusadas, n, t)
            self.assertEqual(e["pendencias"].get("valor_presumido", 0), n * len(PRESUMIDOS[t]), t)

    def test_colunas_da_linha_casam_com_ddl(self):
        linhas = {}
        l8_17.linhas(None, lambda t, v: linhas.setdefault(t, []).append(v))
        for t, ls in linhas.items():
            corpo = re.search(r"CREATE TABLE %s \((.*?)\);" % t, l8_17.DDL, re.S).group(1)
            n = len(re.findall(r'"(\w+)" [A-Z]', corpo))
            for v in ls:
                self.assertEqual(len(v), n, t)


if __name__ == "__main__":
    unittest.main()
