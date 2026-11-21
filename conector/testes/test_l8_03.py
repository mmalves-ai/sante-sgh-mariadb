"""Fatia L8-03 (faturamento e restantes, módulo FAT): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, referências declaradas, literais presumidos, descartes e bloqueadas, coerência da imagem
sintética e valores relidos do destino. Só dados inventados (sintetica_d/l8_03.py)."""
import csv
import os
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_03

CARREGADAS = ["TBCOSPPROF", "TBCRECOO", "TBCREMED", "TBCREPRS", "TBCTRDTH", "TBCTRMEM", "TBCTRTHM", "TBDTHCDC",
              "TBINDICE", "FCPARAM", "TBIRREGULARID", "TBIRREGULARID_TBMODULO", "TBITEATE", "TBLOCCON", "TBPORMED",
              "TBPROCTO", "TBTIPPRO"]
# descarte de produto (linha em sem_carga.tsv pedida no L8-03.json; TBIRREGCTRCTA já está lá)
DESCARTE = ["TBIRREGCTRCTA", "TBCONVPERCTAPAC", "TBCTRTAT"]
# aguardam regra genérica do motor (pedidos em docs/obra/fatias/f4/saida/L8-03.json)
# TBPERTHM: declaração pronta comentada (as linhas sem destino dela estão em colunas.d/L8-04.tsv)
BLOQUEADAS = ["TBMATMED", "TBPACTHM", "TBPERTHM"]
DESTINOS = {"TBCOSPPROF": ["funcao_equipe_cobranca"], "TBCRECOO": ["membro_cooperativa"],
            "TBCREMED": ["credenciamento_cobranca"],
            "TBCREPRS": ["credenciamento_cobranca"], "TBCTRDTH": ["tabela_preco"], "TBCTRMEM": ["tabela_preco"],
            "TBCTRTHM": ["tabela_preco"], "TBDTHCDC": ["diaria_taxa_centro_custo"],
            "TBINDICE": ["indice_cobranca", "valor_indice"], "FCPARAM": ["competencia_faturamento", "sequencia_negocio"],
            "TBIRREGULARID": ["tipo_pendencia_conta"], "TBIRREGULARID_TBMODULO": ["tipo_pendencia_conta_modulo"],
            "TBITEATE": ["tipo_atendimento_tabela"], "TBLOCCON": ["local_cobranca"],
            "TBPROCTO": ["item_faturavel", "grupo_faturamento"], "TBPORMED": ["valor_porte_medico", "porte_procedimento"],
            "TBTIPPRO": ["tipo_servico_faturavel"]}
OBRIGATORIAS = {
    "funcao_equipe_cobranca": {"codigo", "descricao", "tipo_funcao"},
    "membro_cooperativa": {"cooperativa_medica_id", "profissional_id", "vigencia_inicio"},
    "credenciamento_cobranca": {"estabelecimento_id", "fonte_pagadora_id", "vigencia_inicio"},
    "tabela_preco": {"codigo", "descricao", "tipo_item", "referencia"},
    "diaria_taxa_centro_custo": {"preco_diaria_taxa_id", "centro_custo_id", "vigencia_inicio"},
    "indice_cobranca": {"codigo", "descricao", "tipo_indice"},
    "valor_indice": {"indice_cobranca_id", "ocorrido_em", "vigencia_inicio", "valor_indice"},
    "competencia_faturamento": {"estabelecimento_id", "modulo", "competencia", "aberta_em"},
    "tipo_pendencia_conta": {"codigo", "descricao", "categoria"},
    "tipo_pendencia_conta_modulo": {"tipo_pendencia_conta_id", "modulo_sistema_id"},
    "tipo_atendimento_tabela": {"codigo", "descricao", "padrao"},
    "local_cobranca": {"codigo", "descricao", "tipo_local"},
    "item_faturavel": {"codigo", "descricao", "tipo_item", "grupo_faturamento_id"},
    "grupo_faturamento": {"codigo", "descricao", "tipo_grupo"},
    "valor_porte_medico": {"porte_procedimento_id", "ocorrido_em", "vigencia_inicio", "valor"},
    "porte_procedimento": {"codigo", "descricao", "tipo_porte"},
    "tipo_servico_faturavel": {"codigo", "descricao"},
    "sequencia_negocio": {"tipo", "proximo_valor"}}
CADEIA_PROFISSIONAL = "TBCBOPRO>ID_TBPROFIS>TBPROFIS"


def _raiz():
    """Pasta declarado: no repositório (conector/mapa) ou no container (/app/mapa)."""
    for r in (Path(__file__).resolve().parents[1] / "mapa", Path("/app/mapa")):
        if (r / "declarado/colunas.d").is_dir():
            return r / "declarado"
    return None


def _mapa():
    try:
        return mapa.carregar_execucao()
    except FileNotFoundError:
        return None


class Plano(unittest.TestCase):
    def setUp(self):
        self.m = _mapa()
        if self.m is None:
            self.skipTest("mapa do conector ausente")
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + DESCARTE + BLOQUEADAS))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino, dt=None):
        p = self.por[t]
        return [c for c in p["colunas"][dt or p["destinos"][0]] if c["destino"] == destino]

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual(sorted(p["tabela"] for p in self.plano), sorted(CARREGADAS))  # ordem: a do mapa

    def test_destinos_e_principal(self):
        for t, ds in DESTINOS.items():
            self.assertEqual(self.por[t]["destinos"], ds, t)

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            for dt in p["destinos"]:
                cobertas = {c["destino"] for c in p["colunas"][dt]}
                self.assertFalse(OBRIGATORIAS[dt] - cobertas, (p["tabela"], dt))

    def test_profissional_pela_inscricao_no_conselho(self):
        for t, dt in (("TBCRECOO", "membro_cooperativa"), ("TBCREMED", "credenciamento_cobranca")):
            c = self._col(t, "profissional_id", dt)[0]
            self.assertEqual(c["referencia"], CADEIA_PROFISSIONAL, (t, dt))
            self.assertEqual([x.get("tabela") for x in c["passos"] if x.get("tabela")], ["TBCBOPRO", "TBPROFIS"])

    def test_chave_alternativa_onde_a_origem_nao_tem_id(self):
        # r3 (correção): chave alternativa COMPOSTA (o código e a operação repetem entre atos e tabelas)
        self.assertEqual(self._col("TBCREPRS", "prestador_terceiro_id")[0]["passos"],
                         [{"tabela": "TBPRESER", "modo": "alt_composta", "arg": ["ATO", "COD"], "cols": ["ATO", "PS"]}])
        self.assertEqual(self._col("TBDTHCDC", "preco_diaria_taxa_id")[0]["passos"],
                         [{"tabela": "TBTABDTH", "modo": "alt_composta", "arg": ["TAB", "OPE"], "cols": ["TAB", "DTH"]}])

    def test_tipo_de_conta_do_credenciamento_pelo_codigo(self):
        for t in ("TBCREMED", "TBCREPRS"):
            c = self._col(t, "tipo_conta_id")[0]
            self.assertEqual((c["coluna"], c["depara"]), ("CONTAS", "valores"), t)
            self.assertIn("cod:tipo_conta.codigo", self._via(t, "CONTAS"), t)

    def test_numeracao_fiscal_em_sequencia_de_negocio(self):
        ds = self.por["FCPARAM"]["destinos"]
        self.assertEqual(ds[0], "competencia_faturamento")
        self.assertIn("sequencia_negocio", ds)
        via = self._via("FCPARAM", "#item")
        for col in ("ULTNOTA_H", "ULTNOTA_C", "ULTNOTA_LOJA", "NUMERONOTANFS", "NUMEROLOTENFS", "NUMEROLOTERPS"):
            self.assertIn(col + "=origem_faturamento_", via)
        self.assertEqual(self._col("FCPARAM", "ativo", "sequencia_negocio")[0]["coluna"], "=~0")

    def test_tipo_de_servico_adotado_pelo_codigo(self):
        self.assertEqual(self.por["TBTIPPRO"]["opcoes"]["tipo_servico_faturavel"]["adotar"], ["codigo"])
        self.assertEqual(self._col("TBTIPPRO", "codigo")[0]["coluna"], "#codigo_derivado:TIPO:30:tipo_servico_")

    def _via(self, t, col):
        return next(c.get("via", "") for c in self.m["colunas_decl"] if c["tabela"] == t and c["coluna"] == col)

    def test_referencias_simples(self):
        for t, d, ref in (("TBCRECOO", "cooperativa_medica_id", "TBCOOPER"), ("TBCREMED", "fonte_pagadora_id", "TBCONVEN"),
                          ("TBCREPRS", "grupo_ato_id", "TBTABATO"), ("TBDTHCDC", "centro_custo_id", "TBCENCUS"),
                          ("TBIRREGULARID_TBMODULO", "modulo_sistema_id", "TBMODULO"),
                          ("TBIRREGULARID_TBMODULO", "tipo_pendencia_conta_id", "TBIRREGULARID"),
                          ("TBLOCCON", "centro_custo_id", "TBCENCUS")):
            c = self._col(t, d)[0]
            self.assertEqual((c["referencia"], c["regra"], c.get("passos")), (ref, "chave_origem", None), (t, d))

    def test_codigo_com_prefixo_de_dominio_nas_tabelas_de_preco(self):
        pre = {t: self._col(t, "codigo")[0]["coluna"] for t in ("TBCTRDTH", "TBCTRMEM", "TBCTRTHM")}
        self.assertEqual(pre, {"TBCTRDTH": "#codigo_derivado:COD:30:diaria_taxa_",
                               "TBCTRMEM": "#codigo_derivado:COD:30:matmed_",
                               "TBCTRTHM": "#codigo_derivado:COD:30:honorario_"})
        self.assertEqual(carga_mapa.codigo_derivado("1", 30, "matmed_"), ("matmed_1", False))

    def test_indice_unico_por_tipo_adotado(self):
        self.assertEqual(self.por["TBINDICE"]["opcoes"]["indice_cobranca"]["adotar"], ["codigo"])
        self.assertEqual(self._col("TBINDICE", "indice_cobranca_id", "valor_indice")[0]["coluna"], "@id")

    def test_presumidos_e_vigencia_sem_fonte(self):
        for t, d, lit in (("TBCTRDTH", "referencia", "=~propria"), ("TBCTRMEM", "tipo_item", "=~misto"),
                          ("TBCTRTHM", "tipo_item", "=~honorario"), ("TBCTRDTH", "tipo_item", "=diaria_taxa"),
                          ("TBITEATE", "padrao", "=~proprio"), ("FCPARAM", "modulo", "=~fonte_pagadora"),
                          ("FCPARAM", "aberta_em", "=~@data_carga"), ("TBINDICE", "tipo_indice", "=~outro"),
                          ("TBCRECOO", "vigencia_inicio", "@vigencia_carga"),
                          ("TBCREPRS", "vigencia_inicio", "@vigencia_carga"),
                          ("TBDTHCDC", "vigencia_inicio", "@vigencia_carga")):
            self.assertEqual(self._col(t, d)[0]["coluna"], lit, (t, d))

    def test_competencia_composta_de_ano_e_mes(self):
        self.assertEqual(self._col("FCPARAM", "competencia")[0]["coluna"], "#data:ANOPRO,MESPRO")
        self.assertIn("ANOPRO", self.por["FCPARAM"]["lidas"])

    def test_cabecalho_agrupado_antes_do_principal(self):
        # rodada 3: o grupo de migração (um por tabela de honorários) e o porte (um por código) são cabeçalhos
        # agrupados gravados antes, e o principal liga pelo @id do secundário
        for t, dt, grupo, col in (("TBPROCTO", "grupo_faturamento", ["ID_TBCTRTHM"], "grupo_faturamento_id"),
                                  ("TBPORMED", "porte_procedimento", ["PORTE"], "porte_procedimento_id")):
            op = self.por[t]["opcoes"][dt]
            self.assertEqual((op["antes"], op["agrupar"]), (True, grupo), t)
            self.assertEqual(self._col(t, col)[0]["coluna"], "@id:" + dt, t)
        self.assertEqual(self._col("TBPROCTO", "codigo")[0]["coluna"], "#codigo_derivado:ID:20:proc_")
        self.assertEqual(self._col("TBPROCTO", "descricao", "grupo_faturamento")[0]["passos"],
                         [{"tabela": "TBCTRTHM", "modo": "chave", "arg": None}, {"coluna": "NOME"}])

    def test_situacao_por_depara_de_valores(self):
        for t in ("TBCTRDTH", "TBCTRMEM", "TBCTRTHM"):
            self.assertEqual(self._col(t, "situacao")[0]["valores"], {"A": "ativa", "I": "inativa"}, t)


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r / "colunas.d/L8-03.tsv", newline="", encoding="utf-8") as f:
            self.linhas = list(csv.DictReader(f, delimiter="\t"))

    def test_toda_tabela_da_fatia_declarada(self):
        self.assertEqual({l["tabela"].lstrip("#") for l in self.linhas}, set(CARREGADAS + DESCARTE + BLOQUEADAS))

    def test_descarte_e_bloqueada_sem_destino_e_com_motivo(self):
        for l in self.linhas:
            if l["tabela"] in DESCARTE + BLOQUEADAS:
                self.assertEqual(l["destino"], "", l["tabela"])
                self.assertTrue(l["motivo"].startswith(("L8-03: ", "L8-03 r3")), l["tabela"])

    def test_cooperativa_e_indice_por_procedimento_na_l8_02(self):
        # rodada 3: TBCOOPER e TBINDPRO foram declaradas pela L8-02 (uma tabela, um arquivo)
        self.assertFalse([l for l in self.linhas if l["tabela"].lstrip("#") in ("TBCOOPER", "TBINDPRO")])

    def test_percentuais_prontos_e_comentados(self):
        pe = [l for l in self.linhas if l["tabela"] == "#TBPERTHM"]
        # CH_VALOR_CRED sem coluna no destino (pedido 1: usa_ch_credenciado à F2.2)
        self.assertEqual({l["destino"].split(".")[0] for l in pe if l["coluna"] != "CH_VALOR_CRED"},
                         {"regra_percentual_cobranca"})

    def test_catalogo_licenciado_nunca_carregado(self):
        self.assertFalse([l for l in self.linhas if l["tabela"] == "TBMATMED" and l["destino"]])

    def test_credenciamento_do_medico_num_so_cadastro(self):
        # profissional_fonte_pagadora vem de TBCBOPRO_TBCONVEN (L5-06): gravar TBCREMED nos dois duplicaria o fato
        ds = {l["destino"].split(".")[0] for l in self.linhas if l["tabela"] == "TBCREMED" and l["destino"]}
        self.assertEqual(ds, {"credenciamento_cobranca"})

    def test_matmed_bloqueada_com_decisao_por_tabela(self):
        ms = {l["motivo"] for l in self.linhas if l["tabela"] == "TBMATMED"}
        self.assertEqual(len(ms), 1)
        self.assertIn("PRÓPRIAS", ms.pop())

    def test_tipo_de_pendencia_so_na_conta(self):
        ds = {l["destino"].split(".")[0] for l in self.linhas if l["tabela"] == "TBIRREGULARID" and l["destino"]}
        self.assertEqual(ds, {"tipo_pendencia_conta"})

    def test_regras_validas(self):
        for l in self.linhas:
            if l["regra"]:
                self.assertTrue(sentinela.regra_conhecida(l["regra"]), (l["tabela"], l["coluna"]))

    def test_sem_nome_da_origem_no_destino(self):
        for l in self.linhas:
            if l["destino"]:
                self.assertRegex(l["destino"], r"^[a-z_]+\.[a-z_]+$")

    def test_pares_de_valores_da_fatia(self):
        with open(_raiz() / "valores.d/L8-03.tsv", newline="", encoding="utf-8") as f:
            pares = {(v["tabela"], v["valor_origem"], v["valor_destino"]) for v in csv.DictReader(f, delimiter="\t")}
        self.assertEqual(pares, {(t, a, b) for t in ("TBCTRDTH", "TBCTRMEM", "TBCTRTHM")
                                 for a, b in (("A", "ativa"), ("I", "inativa"))} |
                         {(t, a, b) for t in ("TBCREMED", "TBCREPRS")
                          for a, b in (("I", "internacao"), ("E", "externa"), ("A", "ambulatorial"), ("U", "urgencia"),
                                       ("T", ""))})

    def test_referencia_licenciada_bloqueada_nunca_descartada(self):
        # r3 (correção): equivalências do item de mat/med carregam nas tabelas PRÓPRIAS; só a licenciada espera licença
        with open(_raiz() / "sem_carga.tsv", newline="", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t in ("TBREFUNI", "TBREFMEMTUSS"):
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", "mecanismo_pedido"), t)
        self.assertNotIn("TBTIPPRO", sc)


# pedido 9 do saida/L8-03.json: arestas de ordem que faltam no mapa (o pai vem depois do filho na carga real)
ARESTAS_PEDIDAS = ("TBCRECOO->TBPROFIS", "TBINDICE->TBCONVEN", "TBPORMED->TBCONVEN", "TBLOCCON->TBCENCUS")


class OrdemDasReferencias(unittest.TestCase):
    """Todo pai referenciado pela fatia vem ANTES na ordem real do mapa, ou a aresta (ou o ciclo) está num pedido
    ABERTO do saida/L8-03.json. A imagem sintética dá alguns pais como externos (já carregados) e não pegaria isso."""

    def test_pai_antes_do_filho_ou_pedido_aberto(self):
        import json
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r.parent / "tabelas.tsv", newline="", encoding="utf-8") as f:
            ordem = {x["tabela"]: int(x["ordem"]) for x in csv.DictReader(f, delimiter="\t") if x["ordem"].isdigit()}
        with open(r / "colunas.d/L8-03.tsv", newline="", encoding="utf-8") as f:
            linhas = [x for x in csv.DictReader(f, delimiter="\t") if not x["tabela"].startswith("#")]
        saida = Path(__file__).resolve().parents[2] / "docs/obra/fatias/f4/saida/L8-03.json"
        if saida.exists():  # no repositório: a aresta tem de estar num pedido ABERTO
            d = json.loads(saida.read_text(encoding="utf-8"))
            abertos = " ".join(p["mudanca"] for k in d for p in d[k] if not p.get("atendido"))
        else:  # no container (sem docs/): as arestas do pedido 9
            abertos = " ".join(ARESTAS_PEDIDAS)
        fora = []
        for x in linhas:
            for parte in (x.get("via") or "").split(";"):
                if not parte.startswith("ref:"):
                    continue
                for pai in re.findall(r"(?:^|>)([A-Z][A-Z0-9_]+)(?=[.(/@>]|$)", parte[4:]):
                    if pai in ordem and x["tabela"] in ordem and ordem[pai] > ordem[x["tabela"]] \
                            and "%s->%s" % (x["tabela"], pai) not in abertos:
                        fora.append("%s->%s" % (x["tabela"], pai))
        self.assertEqual(sorted(set(fora)), [])


class Sintetica(unittest.TestCase):
    def test_so_tabelas_carregaveis_e_pais_lidos_no_ddl(self):
        self.assertEqual(re.findall(r"CREATE TABLE (\w+)", l8_03.DDL), CARREGADAS + l8_03.PAIS_ORIGEM)

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l8_03.linhas(None, lambda t, v: ins.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for rg, n in e["pendencias"].items()
                          if rg.startswith("restricao_destino_") or rg == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, ins.count(t), t)

    def test_bloqueadas_fora_da_imagem(self):
        for t in BLOQUEADAS + DESCARTE:
            self.assertNotIn("CREATE TABLE %s " % t, l8_03.DDL)


class ValoresDasRegras(unittest.TestCase):
    """O valor que cada regra declarada da fatia entrega (não só contagens)."""

    def test_ativo_sn(self):
        self.assertEqual([sentinela.aplicar("booleano_sn", v) for v in ("S", "N", "", None, "X")],
                         [(True, None), (False, None), (None, None), (None, None),
                          (None, "valor_fora_do_dominio")])

    def test_descricao_em_blob_preserva_quebra_e_espacos(self):
        self.assertEqual(sentinela.aplicar("texto_longo", "Pendência exemplo\r\n  de assinatura".encode("cp1252")),
                         ("Pendência exemplo\r\n  de assinatura", None))
        self.assertEqual(sentinela.aplicar("texto_longo", b"")[0], None)

    def test_nome_colapsa_espacos_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Local  exemplo   ação"), ("Local exemplo ação", None))
        self.assertEqual(sentinela.aplicar("texto_nome", "   "), (None, None))

    def test_codigo_tiss_dois_digitos(self):
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:2", 18), ("18", None))
        self.assertEqual(sentinela.aplicar("inteiro_zeros_esquerda:2", 0), (None, "valor_fora_do_dominio"))

    def test_competencia_primeiro_dia(self):
        import datetime
        self.assertEqual(carga_mapa.data_composta(2026, 11), (datetime.date(2026, 11, 1), None))
        self.assertEqual(carga_mapa.data_composta(2026, 13), (None, "valor_fora_do_dominio"))

    def test_valor_do_indice_nao_negativo(self):
        from decimal import Decimal
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", Decimal("0.5"))[0], Decimal("0.5"))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", Decimal("-1"))[1], "valor_fora_do_dominio")


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ValoresNoDestino(unittest.TestCase):
    """Carga da imagem sintética e releitura dos valores gravados."""

    @classmethod
    def setUpClass(cls):
        from sante_conector import conferencia
        lido = {}
        consultas = {
            "funcao_equipe_cobranca": "SELECT codigo, descricao, tipo_funcao FROM funcao_equipe_cobranca"
                                      " ORDER BY CAST(codigo AS UNSIGNED)",
            "tipo_pendencia_conta": "SELECT codigo, descricao, categoria, controle FROM tipo_pendencia_conta"
                                    " ORDER BY CAST(codigo AS UNSIGNED)",
            "local_cobranca": "SELECT codigo, descricao, tipo_local, ativo, centro_custo_id IS NOT NULL"
                              " FROM local_cobranca ORDER BY CAST(codigo AS UNSIGNED)",
            "tabela_preco": "SELECT codigo, descricao, tipo_item, referencia, situacao, codigo_tabela_tiss,"
                            " observacao FROM tabela_preco ORDER BY codigo",
            "indice_cobranca": "SELECT codigo, tipo_indice FROM indice_cobranca ORDER BY codigo",
            "valor_indice": "SELECT i.codigo, v.vigencia_inicio, v.valor_indice FROM valor_indice v"
                            " JOIN indice_cobranca i ON i.id = v.indice_cobranca_id ORDER BY i.codigo, v.vigencia_inicio",
            "competencia_faturamento": "SELECT modulo, competencia, situacao FROM competencia_faturamento",
            "tipo_atendimento_tabela": "SELECT codigo, descricao, padrao, codigo_externo FROM tipo_atendimento_tabela"
                                       " ORDER BY codigo",
            "item_faturavel": "SELECT i.codigo, i.descricao, i.tipo_item, g.codigo, g.descricao, g.tipo_grupo"
                              " FROM item_faturavel i JOIN grupo_faturamento g ON g.id = i.grupo_faturamento_id"
                              " ORDER BY i.codigo",
            "grupos": "SELECT COUNT(*) FROM grupo_faturamento",
            "valor_porte_medico": "SELECT p.codigo, p.descricao, p.tipo_porte, v.vigencia_inicio, v.ocorrido_em, v.valor,"
                                  " v.fonte_pagadora_id IS NOT NULL FROM valor_porte_medico v JOIN porte_procedimento p"
                                  " ON p.id = v.porte_procedimento_id ORDER BY p.codigo, v.vigencia_inicio",
            "portes": "SELECT codigo FROM porte_procedimento ORDER BY codigo",
            "sequencias": "SELECT tipo, proximo_valor, ativo FROM sequencia_negocio"
                          " WHERE tipo LIKE 'origem_faturamento_%' ORDER BY tipo",
            "tipo_conta_credenciamento": "SELECT t.codigo FROM credenciamento_cobranca c JOIN tipo_conta t"
                                         " ON t.id = c.tipo_conta_id",
            "tipos_servico": "SELECT codigo, descricao FROM tipo_servico_faturavel ORDER BY codigo",
            "contagens": "SELECT (SELECT COUNT(*) FROM membro_cooperativa), (SELECT COUNT(*) FROM"
                         " credenciamento_cobranca),"
                         " (SELECT COUNT(*) FROM diaria_taxa_centro_custo),"
                         " (SELECT COUNT(*) FROM tipo_pendencia_conta_modulo)"}

        def ler(cc):
            with cc.cursor() as cur:
                for k, s in consultas.items():
                    cur.execute(s)
                    lido[k] = [tuple(r) for r in cur.fetchall()]
        cls.r = conferencia.conferir("L8-03", depois_da_primeira=ler)
        cls.lido = lido

    def test_conferencia_ok(self):
        self.assertEqual(self.r["erros"], [])

    def test_item_faturavel_do_procedimento_com_grupo_por_tabela(self):
        self.assertEqual(self.lido["item_faturavel"], [
            ("proc_1", "Consulta exemplo em consultório", "procedimento", "tabela_honorario_1", "Tabela exemplo honorários",
             "honorario"),
            ("proc_2", "Procedimento exemplo cirúrgico", "procedimento", "tabela_honorario_1",
             "Tabela exemplo honorários", "honorario"),
            ("proc_3", "Consulta exemplo", "procedimento", "tabela_honorario_2", "Tabela exemplo inativa", "honorario")])
        self.assertEqual(self.lido["grupos"], [(2,)])  # o grupo da tabela inexistente foi desfeito com a linha

    def test_valor_do_porte_por_fonte_e_vigencia(self):
        import datetime
        from decimal import Decimal
        d = datetime.date
        self.assertEqual(self.lido["valor_porte_medico"], [
            ("1A", "1A", "honorario", d(2025, 1, 1), datetime.datetime(2025, 1, 1), Decimal("100.00"), 1),
            ("1A", "1A", "honorario", d(2026, 1, 1), datetime.datetime(2026, 1, 1), Decimal("110.00"), 1),
            ("2B", "2B", "honorario", d(2025, 1, 1), datetime.datetime(2025, 1, 1), Decimal("200.00"), 1)])
        self.assertEqual(self.lido["portes"], [("1A",), ("2B",)])  # 3C e 4A desfeitos com a linha recusada

    def test_funcao(self):
        self.assertEqual(self.lido["funcao_equipe_cobranca"],
                         [("1", "Função exemplo um", "outro"), ("2", "Função exemplo ação", "outro"),
                          ("3", "Anestesia exemplo", "outro")])

    def test_tipo_de_pendencia(self):
        self.assertEqual(self.lido["tipo_pendencia_conta"],
                         [("1", "Pendência exemplo de diagnóstico", "outra", "alerta"),
                          ("2", "Pendência exemplo\r\n  de assinatura", "outra", "alerta"),
                          ("5", "Guia exemplo não autorizada", "outra", "alerta")])

    def test_local_ativo_e_centro_de_custo(self):
        self.assertEqual([(c, d, t, int(a), int(cc)) for c, d, t, a, cc in self.lido["local_cobranca"]],
                         [("1", "Local exemplo internação", "outro", 1, 1), ("2", "Local exemplo ação", "outro", 0, 0),
                          ("4", "Local exemplo fora", "outro", 1, 0), ("5", "Local exemplo sem ativo", "outro", 1, 0)])

    def test_tabelas_de_preco_sem_colisao_de_codigo(self):
        self.assertEqual(self.lido["tabela_preco"], [
            ("diaria_taxa_1", "Tabela exemplo diárias", "diaria_taxa", "propria", "ativa", "18",
             "Observação exemplo\r\n  segunda linha"),
            ("diaria_taxa_2", "Tabela exemplo taxas", "diaria_taxa", "propria", "inativa", None, None),
            ("honorario_1", "Tabela exemplo honorários", "honorario", "propria", "ativa", None, None),
            ("honorario_2", "Tabela exemplo inativa", "honorario", "propria", "inativa", None, None),
            ("matmed_1", "Tabela exemplo mat/med", "misto", "propria", "ativa", None, None),
            ("matmed_2", "Tabela exemplo própria", "misto", "propria", "ativa", None, None)])

    def test_indice_por_tipo_e_valores(self):
        from decimal import Decimal
        import datetime
        self.assertEqual(self.lido["indice_cobranca"], [("indice_0", "outro"), ("indice_1", "outro")])
        self.assertEqual(self.lido["valor_indice"], [
            ("indice_0", datetime.date(2025, 1, 1), Decimal("0.500000")),
            ("indice_0", datetime.date(2026, 1, 1), Decimal("0.600000")),
            ("indice_1", datetime.date(2025, 1, 1), Decimal("1.250000"))])

    def test_competencia(self):
        import datetime
        self.assertEqual(self.lido["competencia_faturamento"],
                         [("fonte_pagadora", datetime.date(2026, 11, 1), "aberta")])

    def test_tipo_de_atendimento(self):
        self.assertEqual(self.lido["tipo_atendimento_tabela"],
                         [("atendimento_1", "Consulta exemplo", "proprio", "1"),
                          ("atendimento_2", "Exame exemplo", "proprio", "2")])

    def test_numeracao_fiscal_inativa_para_conferir(self):
        self.assertEqual(self.lido["sequencias"], [
            ("origem_faturamento_ultima_nfse", 321, 0), ("origem_faturamento_ultima_nota_loja", 0, 0),
            ("origem_faturamento_ultima_nota_serie_h", 150, 0), ("origem_faturamento_ultimo_lote_rps", 12, 0)])

    def test_credenciamento_com_tipo_de_conta(self):
        self.assertEqual(self.lido["tipo_conta_credenciamento"], [("ambulatorial",)])

    def test_tipo_de_servico_por_codigo(self):
        self.assertEqual(self.lido["tipos_servico"], [("tipo_servico_1", "Tipo de serviço migrado"),
                                                     ("tipo_servico_2", "Tipo de serviço migrado")])

    def test_contagens_dos_vinculos(self):
        # membro, credenciamento (só o médico: o prestador e a diária carregam depois, na ordem do mapa),
        # diária x centro de custo, módulos
        self.assertEqual(self.lido["contagens"], [(1, 1, 0, 2)])


if __name__ == "__main__":
    unittest.main()
