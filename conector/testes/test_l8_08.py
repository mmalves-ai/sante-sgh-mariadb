"""Fatia L8-08 (faturamento e restantes, módulo SUS): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-08`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_08

TABELAS = set(l8_08.CARREGADAS)
BLOQUEADAS = set(l8_08.BLOQUEADAS)
LISTA = {"TBALTSUS": "motivo_saida", "TBASSOCI": "associacao_quimioterapia", "TBCARATERATEND": "carater_atendimento",
         "TBDRS": "regional_saude", "TBFONTE_ORCAMENTARIA_SUS": "fonte_orcamentaria", "TBGRUATE": "grupo_atendimento",
         "TBTIPATE": "tipo_atendimento", "TBTPAPAC": "tipo_apac"}
# catálogo oficial da tabela unificada (regra 7): nunca lista própria, só de-para para dominio_sigtap
OFICIAIS = {"TBLOCSUS", "TBNIVSUS", "TBPRESUS", "TBNIVEL", "TBPRESSE"}
# código = código do leiaute (único na lista); o id da origem só no conector_origem
CODIGO = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
          "TBFONTE_ORCAMENTARIA_SUS": "CODIGO", "TBGRUATE": "COD", "TBTIPATE": "COD", "TBTPAPAC": "ID"}
# listas aceitas pelo CHECK do destino (db/migracoes/13_SUS/01_tabelas.sql), conferidas no DDL lido pelo mapa
OFICIAL = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
           "TBFONTE_ORCAMENTARIA_SUS": "CODIGO", "TBGRUATE": "COD", "TBTIPATE": "COD"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"]["dominio_sus"]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t in TABELAS:
            self.assertEqual(self.plano[t]["destinos"], ["dominio_sus"], t)

    def test_lista_codigo_e_descricao(self):
        for t, lista in LISTA.items():
            cs = self.cols(t)
            self.assertEqual(cs["lista"]["coluna"], "=" + lista, t)
            self.assertEqual(cs["codigo"]["regra"], "texto", t)
            self.assertEqual(cs["codigo"]["coluna"], CODIGO[t], t)
            self.assertEqual(cs["descricao"]["regra"], "texto_nome", t)
            if t in OFICIAL:
                self.assertEqual(cs["codigo_oficial"]["coluna"], OFICIAL[t], t)
            else:
                self.assertNotIn("codigo_oficial", cs, t)

    def test_listas_distintas_e_sem_outra_alimentadora(self):
        self.assertEqual(len(set(LISTA.values())), len(LISTA))
        outras = {c["coluna"] for c in self.mapa["colunas_decl"]
                  if c.get("destino") == "dominio_sus.lista" and c["tabela"] not in LISTA}
        self.assertFalse(outras & {"=" + x for x in LISTA.values()})

    def test_bloqueadas_sem_destino(self):
        self.assertFalse(BLOQUEADAS & set(self.plano))
        for c in self.mapa["colunas_decl"]:
            if c["tabela"] in BLOQUEADAS:
                self.assertEqual(c.get("destino") or "", "", (c["tabela"], c["coluna"]))
                self.assertTrue(c.get("motivo"), (c["tabela"], c["coluna"]))


    def test_catalogo_oficial_nunca_lista_propria(self):
        self.assertTrue(OFICIAIS <= BLOQUEADAS)
        for c in self.mapa["colunas_decl"]:
            if c["tabela"] in OFICIAIS:
                self.assertFalse(c.get("destino"), (c["tabela"], c["coluna"]))

    def test_toda_coluna_da_fatia_declarada(self):
        """Nenhuma coluna some sem registro: fora a chave da origem, toda coluna tem declaração com motivo."""
        decl = {(c["tabela"], c["coluna"]) for c in self.mapa["colunas_decl"] if c.get("motivo")}
        chaves = {(t, ch) for t, (ch, _) in l8_08.FORMAS.items() if ch}
        for t, cols in l8_08.COLUNAS.items():
            for c, _, _ in cols:
                if (t, c) not in chaves:
                    self.assertIn((t, c), decl, (t, c))


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Alta   melhorado ".encode("cp1252")), ("Alta melhorado", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("texto", 202501), ("202501", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_08.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertEqual(set(cont), TABELAS | BLOQUEADAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_forma_igual_ao_mapa(self):
        m = mapa.carregar_execucao()
        for t, cols in l8_08.COLUNAS.items():
            do_mapa = [c["coluna"] for c in m["colunas"] if c["tabela"] == t]
            self.assertEqual([c for c, _, _ in cols], do_mapa, t)
