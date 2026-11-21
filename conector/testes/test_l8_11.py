"""Fatia L8-11 (faturamento e restantes, módulo FIN): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-11`."""
import datetime
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_11

TABELAS = set(l8_11.CARREGADAS)
BLOQUEADAS = set(l8_11.NAO_CARREGADAS)


def _decl(m, t):
    return {c["coluna"]: c for c in m["colunas_decl"] if c["tabela"] == t}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self):
        return {c["destino"]: c for c in self.plano["TBGRUDES"]["colunas"]["grupo_natureza_financeira"]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), {"TBGRUDES"})
        # subgrupo e centro de custo ficam de fora (sem origem obrigatória)
        self.assertEqual(self.plano["TBGRUDES"]["destinos"], ["grupo_natureza_financeira"])

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "nome", "tipo"} <= set(self.cols()))

    def test_tipo_do_grupo_pelo_de_para(self):
        c = self.cols()
        self.assertEqual((c["tipo"]["coluna"], c["tipo"]["depara"]), ("CLASSIF", "valores"))
        self.assertEqual(c["ativo"]["regra"], "booleano_ai")
        self.assertNotIn("compoe_custo", c)  # domínio da origem não é S/N: fica o padrão (pedido 2)
        pares = {(v["valor_origem"], v["valor_destino"]) for v in self.mapa["valores"]
                 if v["tabela"] == "TBGRUDES" and v["coluna"] == "CLASSIF"}
        self.assertEqual(pares, {("D", "despesa"), ("R", "receita")})

    def test_bloqueadas_sem_destino(self):
        # dependem de regra genérica, de ordem do mapa ou de decisão do dono (docs/obra/fatias/f4/saida/L8-11.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])

    def test_declaracoes_prontas_das_bloqueadas(self):
        # campo secundário ruim não recusa a linha: inteiro não negativo nas colunas INT UNSIGNED do destino
        d = _decl(self.mapa, "TBCTABAN")
        for c in ("ULTIMO_CHEQUE", "NUMERO_SEQ_REMESSA_COBRANCA"):
            self.assertEqual(d[c]["regra"], "inteiro_nao_negativo", c)
        self.assertNotIn("=~corrente", d)  # tipo pelo de-para de TP_CONTA, não por literal presumido
        self.assertIn("código interno", _decl(self.mapa, "TBAGEBAN")["BANCO"]["motivo"])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"I"), (False, None))
        self.assertEqual(a("booleano_ai", b"Z")[1], "valor_fora_do_dominio")
        self.assertEqual(a("texto", 1234), ("1234", None))
        self.assertEqual(a("texto_nome", "Despesas  com pessoal".encode("cp1252")), ("Despesas com pessoal", None))
        self.assertEqual(a("codigo_char", b"D")[0], "D")
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", 0), (0, None))
        self.assertEqual(a("inteiro_zeros_esquerda:8", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("decimal", decimal.Decimal("-320.10"))[0], decimal.Decimal("-320.10"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_11.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith(("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        f = l8_11.formas()
        self.assertEqual(set(f), TABELAS | BLOQUEADAS)
        vistos = []
        l8_11.linhas(random.Random(2), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(f[t]), t)

    def test_cheque_e_remessa_negativos_na_imagem(self):
        f = [c for c, _, _ in l8_11.formas()["TBCTABAN"]]
        contas = []
        l8_11.linhas(random.Random(4), lambda t, v: contas.append(dict(zip(f, v))) if t == "TBCTABAN" else None)
        self.assertTrue(any(c["ULTIMO_CHEQUE"] < 0 for c in contas))
        self.assertTrue(any(c["NUMERO_SEQ_REMESSA_COBRANCA"] < 0 for c in contas))


if __name__ == "__main__":
    unittest.main()
