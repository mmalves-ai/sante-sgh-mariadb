"""Fatia L8-08 (faturamento e restantes, módulo SUS): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-08`."""
import os
import random
import unittest

from sante_conector import carga_mapa, conferencia, depara, mapa, sentinela
from sante_conector.sintetica_d import l8_08

TABELAS = set(l8_08.CARREGADAS)
DOMINIO = TABELAS - {"FHLEITOUTI", "FCCTRLANCIHA", "FIPARAM", "FAPARAM", "FAPARAMA"}
BLOQUEADAS = set(l8_08.BLOQUEADAS)
LISTA = {"TBALTSUS": "motivo_saida", "TBASSOCI": "associacao_quimioterapia", "TBCARATERATEND": "carater_atendimento",
         "TBDRS": "regional_saude", "TBFONTE_ORCAMENTARIA_SUS": "fonte_orcamentaria", "TBGRUATE": "grupo_atendimento",
         "TBTIPATE": "tipo_atendimento", "TBTPAPAC": "tipo_apac", "TBLOCPRI": "localizacao_tumor",
         "TBPRESUS": "tipo_prestador", "TBNIVSUS": "nivel_atencao"}
# versão antiga sem id que carrega na MESMA lista da versão com id (adoção pelo código)
MESMA_LISTA = {"TBNIVEL": "TBNIVSUS"}
# versão antiga da lista que carrega ANTES da atual (ordem do mapa) e se mescla com ela (adotar:lista,codigo nas duas;
# ADR 0007, 20); a dependência que inverteria a ordem é pedido em saida/L8-08.json
MESMA_LISTA_MESCLA = {"TBPRESSE": "TBPRESUS"}
# catálogo oficial da tabela unificada (regra 7): nunca lista própria, só de-para para dominio_sigtap. Só a modalidade:
# tipo de prestador e nível NÃO vêm no pacote oficial (catalogos/carregadores/sigtap.py não os grava)
OFICIAIS = {"TBLOCSUS"}
# código = código do leiaute (único na lista); o id da origem só no conector_origem. A fonte orçamentária é
# versionada por competência: código = id da origem, código do leiaute em codigo_oficial
CODIGO = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
          "TBFONTE_ORCAMENTARIA_SUS": "ID", "TBGRUATE": "COD", "TBTIPATE": "COD", "TBTPAPAC": "ID", "TBLOCPRI": "COD",
          "TBPRESUS": "COD", "TBNIVSUS": "COD", "TBNIVEL": "COD"}
# listas aceitas pelo CHECK do destino (db/migracoes/13_SUS/01_tabelas.sql), conferidas no DDL lido pelo mapa
OFICIAL = {"TBALTSUS": "COD", "TBASSOCI": "COD", "TBCARATERATEND": "COD_CARATERATEND", "TBDRS": "COD",
           "TBFONTE_ORCAMENTARIA_SUS": "CODIGO", "TBGRUATE": "COD", "TBTIPATE": "COD", "TBLOCPRI": "COD",
           "TBPRESUS": "COD", "TBNIVSUS": "COD", "TBNIVEL": "COD"}


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
        # o registro CIHA não tem fonte na origem: só a equivalência item x procedimento
        self.assertEqual(self.plano["FCCTRLANCIHA"]["destinos"], ["equivalencia_sigtap_item"])

    def test_equivalencia_ciha(self):
        decl = {c["destino"].split(".")[1]: c for c in self.mapa["colunas_decl"]
                if c["tabela"] == "FCCTRLANCIHA" and c.get("destino")}
        self.assertEqual(set(decl), {"item_faturavel_id", "procedimento_sigtap_id", "instrumento", "vigencia_inicio"})
        via = decl["item_faturavel_id"]["via"].split(";")
        self.assertIn("ref:FCLANEXT@item_faturavel_id", via)
        # UMA equivalência vigente por item e instrumento (regra do produto, porta-propria.registrarEquivalencia): a
        # adoção é pelo item e instrumento, nunca pelo procedimento (senão o item ambíguo teria duas vigentes)
        self.assertIn("adotar:item_faturavel_id,instrumento", via)
        self.assertFalse(any("procedimento_sigtap_id" in x for x in via if x.startswith("adotar:")))
        p = decl["procedimento_sigtap_id"]
        self.assertEqual((p["coluna"], p["depara"], p["via"]), ("ID_TBPROSUS", "sigtap", "ref:TBPROSUS>COD"))
        self.assertEqual(decl["instrumento"]["coluna"], "=ciha")
        self.assertEqual(decl["vigencia_inicio"]["coluna"], "@vigencia_carga")
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)["equivalencia_sigtap_item"]["create"]
        self.assertIn("'ciha'", ddl)

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
        """A imagem espera recusa pelo CHECK enquanto a lista falta no modelo (LOCALIZACAO_NO_CHECK é lido do DDL)."""
        d = mapa.ler_ddl(conferencia.RAIZ_APP)["dominio_sus"]
        ddl = d["create"] + " ".join(d["alter"])
        self.assertEqual("'localizacao_tumor'" in ddl, l8_08.LOCALIZACAO_NO_CHECK)

    def test_listas_novas_no_check(self):
        """Tipo de prestador e nível: listas que o CHECK de dominio_sus já aceita."""
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)["dominio_sus"]["create"]
        for lista in ("tipo_prestador", "nivel_atencao"):
            self.assertIn("'%s'" % lista, ddl)

    def test_versoes_da_mesma_lista_adotam_pelo_codigo(self):
        for t in ("TBPRESUS", "TBNIVSUS", "TBNIVEL"):
            via = [c.get("via") or "" for c in self.mapa["colunas_decl"]
                   if c["tabela"] == t and c.get("destino") == "dominio_sus.codigo"]
            self.assertEqual(len(via), 1, t)
            self.assertIn("adotar:lista,codigo", via[0].split(";"), t)
        for antiga, atual in MESMA_LISTA.items():
            self.assertEqual(self.cols(antiga)["lista"]["coluna"], self.cols(atual)["lista"]["coluna"])

    def test_versao_com_id_carrega_antes_da_antiga(self):
        """A versão com id cria os códigos comuns (descrição dela); a antiga só adota e cria o que só ela tem."""
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.mapa["tabelas"] if (r.get("ordem") or "").isdigit()}
        for antiga, atual in MESMA_LISTA.items():
            self.assertLess(ordem[atual], ordem[antiga], (atual, antiga))
            self.assertIn((antiga, atual), {(d["tabela"], d["depende_de"]) for d in self.mapa["deps"]})
        e = l8_08.linhas(random.Random(1), lambda t, v: None)
        self.assertEqual(e["TBNIVEL"]["pendencias"].get("adotado_existente"), 2)
        self.assertNotIn("adotado_existente", e["TBNIVSUS"]["pendencias"])

    def test_descartes_e_sem_mecanismo(self):
        self.assertEqual(set(l8_08.DESCARTADAS.values()), {"catalogo_oficial"})
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

    def test_parametros_sus_carregam_em_json(self):
        """r5 (ADR 0006): opções e competência aberta do faturamento SUS (AIH, BPA, APAC) carregam num parâmetro JSON
        do estabelecimento com o retrato da linha inteira; vigência pela competência aberta; nada em sem_carga."""
        with open(os.path.join(os.path.dirname(__file__), "..", "mapa", "declarado", "sem_carga.tsv"),
                  encoding="utf-8") as f:
            sc = {l.split("\t")[0] for l in f}
        chaves = set()
        for t in ("FIPARAM", "FAPARAM", "FAPARAMA"):
            self.assertIn(t, TABELAS)
            self.assertNotIn(t, sc)
            d = {}
            for c in self.mapa["colunas_decl"]:
                if c["tabela"] == t:
                    d.setdefault(c["destino"], []).append(c["coluna"])
                    self.assertNotRegex(c["motivo"].lower(), r"bloquead|por ora|sem mecanismo|descartad", c["coluna"])
            self.assertEqual(d["parametro_valor.valor"], ["#retrato:*"], t)
            self.assertEqual(d["parametro_valor.vigencia_inicio"], ["#data:ANOPRO,MESPRO", "@vigencia_carga"], t)
            self.assertEqual(d["parametro_valor.nivel"], ["=estabelecimento"], t)
            chaves.add(d["parametro_definicao.chave"][0])
        self.assertEqual(len(chaves), 3)

    def test_listas_distintas_e_sem_outra_alimentadora(self):
        self.assertEqual(len(set(LISTA.values())), len(LISTA))
        outras = {c["coluna"] for c in self.mapa["colunas_decl"]
                  if c.get("destino") == "dominio_sus.lista" and c["tabela"] not in set(LISTA) | set(MESMA_LISTA) | set(MESMA_LISTA_MESCLA)}
        self.assertFalse(outras & {"=" + x for x in LISTA.values()})

    def test_versao_antiga_mescla_na_mesma_lista(self):
        for antiga, atual in MESMA_LISTA_MESCLA.items():
            a = {c["destino"]: c for c in self.plano[antiga]["colunas"]["dominio_sus"]}
            b = {c["destino"]: c for c in self.plano[atual]["colunas"]["dominio_sus"]}
            self.assertEqual(a["lista"]["coluna"], b["lista"]["coluna"], antiga)
            for tab in (antiga, atual):
                vias = [c.get("via") or "" for c in self.mapa["colunas_decl"]
                        if c["tabela"] == tab and c.get("destino") == "dominio_sus.codigo"]
                self.assertTrue(any("adotar:lista,codigo" in v for v in vias), tab)
        e = l8_08.linhas(random.Random(1), lambda t, v: None)
        self.assertEqual(e["TBPRESUS"]["pendencias"].get("adotado_existente"), 2)

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
    def test_sigtap_da_ciha(self):
        n = depara.norm_sigtap
        self.assertEqual(n("202010503"), "0202010503")
        self.assertEqual(n(301010072), "0301010072")
        self.assertIsNone(n("ABC"))
        self.assertIsNone(n("0"))
        self.assertTrue(set(l8_08.SIGTAP_NO_CATALOGO) <= {n(x) for x in ("0301010072", "202010503")})

    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Alta   melhorado ".encode("cp1252")), ("Alta melhorado", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("texto", 202501), ("202501", None))


class Sintetica(unittest.TestCase):
    def esperado(self):
        return l8_08.linhas(random.Random(1), lambda t, v: None)

    @unittest.skipUnless(l8_08.LOCALIZACAO_NO_CHECK, "lista 'localizacao_tumor' fora do CHECK de dominio_sus: "
                         "pedido de migração aberto em saida/L8-08.json; TBLOCPRI grava 0 linhas")
    def test_localizacao_tumor_grava(self):
        self.assertGreater(self.esperado()["TBLOCPRI"]["gravados"], 0)

    def test_item_ambiguo_adota_uma_so_equivalencia(self):
        """9108 informou outro procedimento para o item de 9101: adota (2 adotadas = uma vigente por item)."""
        e = self.esperado()["FCCTRLANCIHA"]
        self.assertEqual(e["pendencias"]["adotado_existente"], 2)
        itens = l8_08.ITENS_DOS_LANCAMENTOS
        self.assertEqual(itens["9108"], itens["9101"])

    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_08.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertEqual(set(cont), TABELAS | BLOQUEADAS | {"TBPROSUS"})
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_forma_igual_ao_mapa(self):
        m = mapa.carregar_execucao()
        for t, cols in l8_08.COLUNAS.items():
            do_mapa = [c["coluna"] for c in m["colunas"] if c["tabela"] == t]
            self.assertEqual([c for c, _, _ in cols], do_mapa, t)


class TestProvaModalidadeL808(unittest.TestCase):
    def test_tblocsus_prova_de_conciliacao_com_a_lista_oficial(self):
        from pathlib import Path
        pv = {p["tabela"]: p for p in mapa.ler_provas(Path(mapa.DIR_PACOTE))}["TBLOCSUS"]
        self.assertEqual((pv["tipo"], pv["chave"], pv["valores"]), ("derivado", ["COD"], [("COD", "inteiro")]))
        self.assertIn("dominio_sigtap", pv["sql"])
        self.assertIn("'modalidade'", pv["sql"])
        self.assertEqual(mapa.erros_provas([pv], {"TBLOCSUS": ["ID", "COD", "NOME"]}), [])
        self.assertIn("dominio_sigtap", l8_08.PREPARO_DESTINO)

