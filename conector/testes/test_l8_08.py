"""Fatia L8-08 (faturamento e restantes, módulo SUS): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-08`."""
import random
import unittest

from sante_conector import carga_mapa, conferencia, mapa, sentinela
from sante_conector.sintetica_d import l8_08

TABELAS = set(l8_08.CARREGADAS)
DOMINIO = TABELAS - {"FHLEITOUTI"}
BLOQUEADAS = set(l8_08.BLOQUEADAS)
LISTA = {"TBALTSUS": "motivo_saida", "TBASSOCI": "associacao_quimioterapia", "TBCARATERATEND": "carater_atendimento",
         "TBDRS": "regional_saude", "TBFONTE_ORCAMENTARIA_SUS": "fonte_orcamentaria", "TBGRUATE": "grupo_atendimento",
         "TBTIPATE": "tipo_atendimento", "TBTPAPAC": "tipo_apac", "TBLOCPRI": "localizacao_tumor"}
# catálogo oficial da tabela unificada (regra 7): nunca lista própria, só de-para para dominio_sigtap
OFICIAIS = {"TBLOCSUS", "TBNIVSUS", "TBPRESUS", "TBNIVEL", "TBPRESSE"}
# código = código do leiaute (único na lista); o id da origem só no conector_origem. A fonte orçamentária é
# versionada por competência: código = id da origem, código do leiaute em codigo_oficial
CODIGO = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
          "TBFONTE_ORCAMENTARIA_SUS": "ID", "TBGRUATE": "COD", "TBTIPATE": "COD", "TBTPAPAC": "ID", "TBLOCPRI": "COD"}
# listas aceitas pelo CHECK do destino (db/migracoes/13_SUS/01_tabelas.sql), conferidas no DDL lido pelo mapa
OFICIAL = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
           "TBFONTE_ORCAMENTARIA_SUS": "CODIGO", "TBGRUATE": "COD", "TBTIPATE": "COD", "TBLOCPRI": "COD"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"]["dominio_sus"]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t in DOMINIO:
            self.assertEqual(self.plano[t]["destinos"], ["dominio_sus"], t)
        self.assertEqual(self.plano["FHLEITOUTI"]["destinos"], ["leito_uti_habilitado"])

    def test_uti_habilitada(self):
        cs = {c["destino"]: c for c in self.plano["FHLEITOUTI"]["colunas"]["leito_uti_habilitado"]}
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(cs["tipo_uti_dominio_sus_id"]["coluna"], "ID_FHLEITOUTITP")
        self.assertEqual(cs["tipo_uti_dominio_sus_id"]["referencia"], "FHLEITOUTITP")
        self.assertEqual((cs["quantidade_leitos"]["coluna"], cs["quantidade_leitos"]["regra"]), ("QTDE_LEITO", "inteiro"))
        self.assertEqual(cs["vigencia_inicio"]["coluna"], "@vigencia_carga")
        # a unidade da origem é a assistencial; a de internação não tem alimentadora: nula (habilitação do estabelecimento)
        self.assertNotIn("unidade_internacao_id", cs)

    def test_localizacao_tumor_no_check_trava_o_estado(self):
        """A imagem espera recusa pelo CHECK enquanto a lista falta no modelo; ao migrar, trocar LOCALIZACAO_NO_CHECK."""
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)["dominio_sus"]["create"]
        self.assertEqual("'localizacao_tumor'" in ddl, l8_08.LOCALIZACAO_NO_CHECK)

    def test_descartes_e_sem_mecanismo(self):
        self.assertEqual(set(l8_08.DESCARTADAS.values()), {"mecanismo_do_produto", "catalogo_oficial"})
        self.assertEqual(set(l8_08.BLOQUEADAS), set(l8_08.DESCARTADAS) | set(l8_08.SEM_MECANISMO))
        self.assertFalse(set(l8_08.BLOQUEADAS) & TABELAS)

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

    def test_fonte_orcamentaria_versionada_pela_competencia(self):
        cs = self.cols("TBFONTE_ORCAMENTARIA_SUS")
        self.assertEqual((cs["vigencia_inicio"]["coluna"], cs["vigencia_inicio"]["regra"]),
                         ("ANO_MES_COMPETENCIA", "competencia_aaaamm"))
        self.assertEqual(cs["codigo"]["coluna"], "ID")
        self.assertEqual(cs["codigo_oficial"]["coluna"], "CODIGO")

    def test_parametros_descartados_sem_texto_de_bloqueio(self):
        for c in self.mapa["colunas_decl"]:
            if c["tabela"] in ("FIPARAM", "FAPARAM", "FAPARAMA"):
                self.assertNotRegex(c["motivo"].lower(), r"bloquead|por ora|sem mecanismo", c["coluna"])

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
        self.assertEqual(OFICIAIS, {t for t, c in l8_08.DESCARTADAS.items() if c == "catalogo_oficial"})
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
