"""Fatia L6-14 (prontuário, assinatura e assistência, módulo INT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-14`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_14

TABELAS = set(l6_14.CARREGADAS)
BLOQUEADAS = {"RIALTA_EXCLUSAO", "RICONFIC", "RIESPFIC", "RIEXCINT", "RILEITOS", "RIPARAM", "RITITFIC", "RIMODFIC",
              "RITRANSF", "RITRFCLI", "RITRFCON", "RITRFESP", "RITRFMED"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["RETPLEITO"]["destinos"], ["tipo_leito_observacao"])
        self.assertEqual(self.plano["RIBLOCOS"]["destinos"], ["bloco_internacao"])
        self.assertEqual(self.plano["RISITREGLEITO"]["destinos"], ["situacao_pedido_leito"])
        self.assertEqual(self.plano["TBALTARN"]["destinos"], ["desfecho_recem_nascido"])

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "descricao", "categoria"} <= set(self.cols("RETPLEITO", "tipo_leito_observacao")))
        self.assertTrue({"estabelecimento_id", "codigo", "nome"} <= set(self.cols("RIBLOCOS", "bloco_internacao")))
        self.assertTrue({"codigo", "descricao", "estado"} <= set(self.cols("RISITREGLEITO", "situacao_pedido_leito")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBALTARN", "desfecho_recem_nascido")))

    def test_literais_presumidos_e_estabelecimento(self):
        self.assertEqual(self.cols("RETPLEITO", "tipo_leito_observacao")["categoria"]["coluna"], "=~outro")
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["estado"]["coluna"], "=~solicitado")
        self.assertEqual(self.cols("TBALTARN", "desfecho_recem_nascido")["obito"]["coluna"], "=~0")
        # estado e óbito presumidos: a linha entra inativa até o de-para de valores (o NIR só usa situação ativa)
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["ativo"]["coluna"], "=0")
        self.assertEqual(self.cols("TBALTARN", "desfecho_recem_nascido")["ativo"]["coluna"], "=0")
        # nunca um estabelecimento fixo: o único do cliente, ou recusa
        self.assertEqual(self.cols("RIBLOCOS", "bloco_internacao")["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_codigos_como_texto(self):
        for t, dt in [("RETPLEITO", "tipo_leito_observacao"), ("RISITREGLEITO", "situacao_pedido_leito"),
                      ("TBALTARN", "desfecho_recem_nascido")]:
            self.assertEqual(self.cols(t, dt)["codigo"]["regra"], "texto", t)
        self.assertEqual(self.cols("RISITREGLEITO", "situacao_pedido_leito")["codigo_central"]["regra"], "texto")
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))

    def test_bloco_preserva_caixa_e_sem_inteiro_que_recusa(self):
        cs = self.cols("RIBLOCOS", "bloco_internacao")
        self.assertEqual(cs["codigo"]["regra"], "codigo_char")
        # atributos opcionais UNSIGNED: negativo recusaria o bloco e os leitos em cascata (pedido 12)
        self.assertFalse({"quantidade_andares", "ordem_exibicao"} & set(cs))

    def test_unica_alimentadora_dos_codigos(self):
        for t, dt in [("RETPLEITO", "tipo_leito_observacao"), ("RISITREGLEITO", "situacao_pedido_leito"),
                      ("TBALTARN", "desfecho_recem_nascido"), ("RIBLOCOS", "bloco_internacao")]:
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_bloqueadas_sem_declaracao(self):
        # dependem de regra genérica, de ordem do mapa ou de decisão do dono (docs/obra/fatias/f4/saida/L6-14.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  UTI   adulto ".encode("cp1252")), ("UTI adulto", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", b" A "), ("A", None))
        self.assertEqual(a("codigo_char", b"a  "), ("a", None))
        self.assertEqual(a("codigo_char", b" A"), (" A", None))
        self.assertEqual(sentinela.colisoes_caixa(["A", "a", "B", "UTI"]), [["A", "a"]])


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_14.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(set(l6_14.NAO_CARREGADAS) <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
