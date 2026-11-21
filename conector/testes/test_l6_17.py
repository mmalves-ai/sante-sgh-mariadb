"""Fatia L6-17 (prontuário, assinatura e assistência, módulo HOT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-17`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_17

TABELAS = set(l6_17.CARREGADAS)
BLOQUEADAS = set(l6_17.NAO_CARREGADAS)
DESTINO = {"CHCRITICIDADE": "criticidade_area", "CHAREA": "area_higienizavel", "CHOCORRENCIA": "tipo_ocorrencia_limpeza",
           "CHSITUACAO": "situacao_limpeza", "CVTERMINALFAB": "fabricante_terminal_acesso",
           "CVTPIDENTIFIC": "forma_identificacao_visitante", "CVTPSITACESSO": "situacao_acesso_visitante",
           "CVTPTERMINAL": "modelo_terminal_acesso", "CVTPVISITADO": "tipo_visitado", "CVTPVISITANTE": "tipo_visitante",
           "GDPRONTCADOPER": "operacao_movimento_prontuario", "PRCARACTDIE": "caracteristica_dieta"}
PRESUMIDOS = {("CHCRITICIDADE", "classificacao_sanitaria"): "=~critica",
              ("CHOCORRENCIA", "modalidade"): "=~emergencial", ("CHSITUACAO", "etapa"): "=~aguardando",
              ("CVTPSITACESSO", "permite_entrada"): "=~0", ("CVTPTERMINAL", "tipo"): "=~terminal",
              ("CVTPVISITADO", "alvo"): "=~outro", ("CVTPVISITANTE", "categoria"): "=~outro",
              ("GDPRONTCADOPER", "tipo"): "=~registro", ("GDPRONTCADOPER", "sentido"): "=~neutro",
              ("PRCARACTDIE", "categoria"): "=~outra", ("PRCARACTDIE", "tipo_resposta"): "=~nenhuma"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINO[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_codigo_e_descricao_cobertos(self):
        for t in DESTINO:
            if t == "CHAREA":
                continue
            cs = self.cols(t)
            self.assertEqual(cs["codigo"]["regra"], "texto", t)
            self.assertIn("descricao", cs, t)
        self.assertTrue({"estabelecimento_id", "sigla", "nome", "criticidade_area_id"} <= set(self.cols("CHAREA")))
        self.assertIn("ordem", self.cols("CHSITUACAO"))
        self.assertIn("fabricante_terminal_acesso_id", self.cols("CVTPTERMINAL"))

    def test_presumidos_e_estabelecimento(self):
        for (t, dc), lit in PRESUMIDOS.items():
            self.assertEqual(self.cols(t)[dc]["coluna"], lit, (t, dc))
        self.assertEqual(self.cols("CHAREA")["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_referencias(self):
        self.assertEqual(self.cols("CHAREA")["criticidade_area_id"]["referencia"], "CHCRITICIDADE")
        self.assertEqual(self.cols("CVTPTERMINAL")["fabricante_terminal_acesso_id"]["referencia"], "CVTERMINALFAB")
        anterior = self.cols("CHSITUACAO")["anterior_situacao_limpeza_id"]
        self.assertEqual(anterior["referencia"], "CHSITUACAO")
        self.assertIn("CHSITUACAO", self.plano["CHSITUACAO"]["duas_fases"])

    def test_colunas_pendentes_de_pedido_nao_declaradas(self):
        # unidade (aponta unidade_resposta, não unidade_medida), respostas (texto, não JSON) e códigos internos
        decl = {(c["tabela"], c["coluna"]) for c in self.mapa["colunas_decl"]}
        for x in [("PRCARACTDIE", "ID_PRUNIDRESPOSTA"), ("PRCARACTDIE", "POSSIVEIS_RESPOSTAS"), ("PRCARACTDIE", "TIPO"),
                  ("PRCARACTDIE", "TPRESP"), ("CVTPVISITADO", "COD_TP_VISITADO"),
                  ("CVTPVISITANTE", "COD_TP_VISITANTE")]:
            self.assertNotIn(x, decl)

    def test_unica_alimentadora(self):
        for t, dt in DESTINO.items():
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_presuncao_do_lado_restritivo(self):
        # situação de acesso sem classificação nunca libera a entrada por presunção (Bloqueado/Restrito na imagem)
        self.assertEqual(self.cols("CVTPSITACESSO")["permite_entrada"]["coluna"], "=~0")
        self.assertNotIn("exige_autorizacao", self.cols("CVTPSITACESSO"))
        self.assertEqual(self.cols("CHCRITICIDADE")["classificacao_sanitaria"]["coluna"], "=~critica")

    def test_bloqueadas_viram_pendencia_de_tabela(self):
        # pedido 8 do L6-17.json: tabela do mapa com destino, presente e sem coluna declarada vira pendência de tabela
        # (tabela_sem_declaracao, alta), nunca pulada em silêncio. Vale quando o integrador aplicar a regra no motor.
        f = getattr(carga_mapa, "tabelas_sem_declaracao", None)
        if f is None:
            self.skipTest("regra genérica tabela_sem_declaracao ainda não aplicada no motor (pedido do L6-17.json)")
        self.assertTrue(BLOQUEADAS <= set(f(self.mapa, TABELAS | BLOQUEADAS)))
        self.assertEqual(carga_mapa.GRAVIDADE_REGRA.get("tabela_sem_declaracao"), "alta")

    def test_bloqueadas_sem_declaracao(self):
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Quarto  101".encode("cp1252")), ("Quarto 101", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", "  Diabética  ".encode("cp1252")), ("Diabética", None))
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_17.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
