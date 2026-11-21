"""Fatia L7-04 (SADT e suprimentos, módulo SADT), rodada de cobertura total: plano da carga dirigida pelo mapa,
cobertura das colunas obrigatórias do destino, referências declaradas (composta, alternativa, encadeada), adoção do
resultado por exame, de-para de valores do fator Rh, descartes de produto e coerência da imagem sintética. Só dados
inventados (sintetica_d/l7_04.py)."""
import csv
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_04

# na ordem do mapa
CARREGADAS = ["SIWSETIQUETA", "TBFATORRH", "TBTPSANGUINEO", "SICADATE", "SIHISTVLREF", "SIHISTVLREFEXAME",
              "SIRES01_DELETE", "SILANEXA", "SIASSLAUDO_IMP_SILANEXA", "SILIBERACAOEXAME", "SIRES01", "SIRESOBS",
              "SIRESVAR", "HTNOTEXAMESEXO", "SHBOLSAHIST", "SIKITHISTEXA", "SIKITHISTITE"]
# vínculo exame -> documento assinado (rodada 3): carrega em exame_item_assinatura; a posição na ordem depende do
# pedido de dependências (exame e cabeçalho antes do vínculo)
VINCULO = "PREXAMEASSINATURA"
# versão da faixa do analito: declarada (faixa_referencia_versao), bloqueada só até o L7-03 gravar a faixa
BLOQUEADAS = {"SIHISTVLREFELEMENTO": "depende_faixa_referencia"}
# revisão da rodada 3: nenhum descarte (os cinco antigos eram dado que o hospital usa)
DESCARTES = {}
# NOT NULL sem padrão de cada destino (db/migracoes), menos id, origem e criado_em
OBRIGATORIAS = {
    "modelo_etiqueta_amostra_biologica": {"estabelecimento_id", "codigo", "descricao", "largura_mm", "altura_mm",
                                          "layout"},
    "fator_rh": {"codigo", "descricao", "sinal"}, "grupo_sanguineo": {"codigo", "descricao", "sigla"},
    "requisicao_exame": {"estabelecimento_id", "numero", "paciente_id", "atendimento_id", "setor_diagnostico_id",
                         "solicitante_profissional_id", "fonte_pagadora_id", "solicitado_em"},
    "trilha_auditoria": {"ocorrido_em", "acao", "entidade"},
    "exame_item": {"requisicao_exame_id", "sequencia", "exame_id"},
    "emissao_laudo_exame": {"emissao_laudo_id", "sequencia", "exame_item_id"},
    "liberacao_exame": {"exame_item_id", "ocorrido_em", "etapa"},
    "resultado_exame": {"exame_item_id", "paciente_id", "setor_diagnostico_id", "resultado_em"},
    "resultado_analito": {"resultado_exame_id", "sequencia", "analito_id"},
    "resultado_observacao": {"resultado_exame_id", "sequencia", "texto"},
    "kit_exame_versao": {"kit_exame_id", "ocorrido_em", "numero_versao", "nome", "vigencia_inicio"},
    "kit_exame_versao_item": {"kit_exame_versao_id", "sequencia", "exame_id"},
    "exame_item_assinatura": {"exame_item_id", "documento_prontuario_id"},
    "movimento_bolsa": {"bolsa_hemocomponente_id", "tipo_movimento_bolsa_id", "ocorrido_em", "usuario_id"},
    "resultado_variavel_formula": {"resultado_exame_id", "sequencia", "variavel_formula_id", "valor_numerico"},
    "faixa_referencia_versao": {"faixa_referencia_id", "operacao", "ocorrido_em", "vigente_de"}}


def _raiz():
    """Pasta do mapa: no repositório (conector/mapa) ou no container (/app/mapa)."""
    for r in (Path(__file__).resolve().parents[1] / "mapa", Path("/app/mapa")):
        if (r / "declarado/colunas.d").is_dir():
            return r
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
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS) | {VINCULO} | set(DESCARTES) | set(BLOQUEADAS))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino, dt=None):
        p = self.por[t]
        return [c for c in p["colunas"][dt or p["destinos"][0]] if c["destino"] == destino]

    def _via(self, t, destino, dt=None):
        c = self._col(t, destino, dt)[0]
        return c["coluna"], c["referencia"]

    def test_carregadas_em_ordem_e_descartes_fora(self):
        self.assertEqual([p["tabela"] for p in self.plano if p["tabela"] != VINCULO and p["tabela"] not in BLOQUEADAS],
                         CARREGADAS)
        self.assertIn(VINCULO, self.por)

    def test_vinculo_exame_documento_assinado(self):
        self.assertEqual(self.por[VINCULO]["destinos"], ["exame_item_assinatura"])
        self.assertEqual(self._via(VINCULO, "exame_item_id"), ("ID_SILANEXA", "SILANEXA"))
        self.assertEqual(self._via(VINCULO, "documento_prontuario_id"), (
            "ID", "PRASS_DOC_PREXAMEASS.ID_PREXAMEASSINATURA>ID_PRASSINATURA_DOC>PRASSINATURA_DOC"
                  ">ID_PRASSINATURA_CAB>PRASSINATURA_CAB"))
        self.assertEqual(self._via(VINCULO, "local_assistencia_id"), ("ID_PRLOCAL_ASSISTENCIA", "PRLOCAL_ASSISTENCIA"))

    def test_destinos(self):
        self.assertEqual(self.por["SICADATE"]["destinos"], ["requisicao_exame"])
        self.assertEqual(self.por["SIRES01"]["destinos"], ["resultado_exame", "resultado_analito"])
        self.assertEqual(self.por["SIWSETIQUETA"]["destinos"], ["modelo_etiqueta_amostra_biologica"])
        self.assertEqual(self.por["SILIBERACAOEXAME"]["destinos"], ["liberacao_exame"])
        self.assertEqual(self.por["HTNOTEXAMESEXO"]["destinos"], ["trilha_auditoria"])

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            for dt in p["destinos"]:
                cobertas = {c["destino"] for c in p["colunas"][dt]}
                self.assertFalse(OBRIGATORIAS.get(dt, set()) - cobertas, (p["tabela"], dt))

    def test_requisicao_referencias(self):
        self.assertEqual(self._via("SICADATE", "paciente_id"), ("ID_ATCABECATEND", "ATCABECATEND>ID_RICADPAC>RICADPAC"))
        self.assertEqual(self._via("SICADATE", "setor_diagnostico_id"), ("ID", "SILANEXA.ID_SICADATE>ATO>SIMODULO"))
        self.assertEqual(self._via("SICADATE", "solicitante_profissional_id"),
                         ("ID_TBCBOPRO_SOLICITANTE", "TBCBOPRO>ID_TBPROFIS>TBPROFIS"))
        self.assertEqual(self._col("SICADATE", "numero")[0]["regra"], "inteiro_faixa:1,999999999999999")
        self.assertEqual(self._col("SICADATE", "estabelecimento_id")[0]["coluna"], "@estabelecimento")
        self.assertEqual(self._col("SICADATE", "situacao")[0]["coluna"], "=~concluida")

    def test_exame_pedido_pela_chave_composta(self):
        self.assertEqual(self._via("SILANEXA", "exame_id"), ("ATO", "SITABPRO(ATO,EXAME)"))
        self.assertEqual(self._via("SILANEXA", "setor_diagnostico_id"), ("ATO", "SIMODULO"))
        self.assertEqual(self._col("SILANEXA", "quantidade")[0]["regra"], "piso:1")
        self.assertEqual(self._via("SIKITHISTITE", "exame_id"), ("ATO", "SITABPRO(ATO,EXAME)"))
        self.assertEqual(self._col("SIKITHISTITE", "sequencia")[0]["coluna"], "#seq:ID_SIKITHISTEXA")

    def test_resultado_adotado_por_exame_e_analito_por_linha(self):
        self.assertEqual(self.por["SIRES01"]["opcoes"]["resultado_exame"].get("adotar"), ["exame_item_id"])
        self.assertEqual(self._col("SIRES01", "resultado_exame_id", "resultado_analito")[0]["coluna"], "@id")
        self.assertEqual(self._via("SIRES01", "analito_id", "resultado_analito"),
                         ("EXAME", "SITABELE(EXAME,ELEMENTO)"))
        self.assertEqual(self._via("SIRES01", "referencia_texto", "resultado_analito"),
                         ("ID_SIHISTVLREFELEMENTO", "SIHISTVLREFELEMENTO>VLRREF"))
        self.assertEqual(self._via("SIRESOBS", "resultado_exame_id"), ("ID_SILANEXA", "SIRES01.ID_SILANEXA"))

    def test_etiqueta_e_historico(self):
        self.assertEqual(self._col("SIWSETIQUETA", "layout")[0]["coluna"], "#retrato")
        self.assertEqual(self._col("SIWSETIQUETA", "largura_mm")[0]["coluna"], "=~50")
        self.assertIn("LAYOUTETIQUETA", self.por["SIWSETIQUETA"]["retrato"])
        self.assertEqual(self._col("HTNOTEXAMESEXO", "dados_depois")[0]["coluna"], "#retrato:*")
        self.assertEqual(self._via("HTNOTEXAMESEXO", "entidade_id"),
                         ("ID_SITABPRO_ATO", "SITABPRO(ID_SITABPRO_ATO,ID_SITABPRO_CODALF)"))

    def test_fator_rh_por_valores(self):
        s = self._col("TBFATORRH", "sinal")[0]
        self.assertEqual(s["depara"], "valores")
        self.assertEqual(set(s["valores"].values()), {"+", "-"})
        self.assertEqual(s["valores"].get("POSITIVO"), "+")
        self.assertEqual(s["valores"].get("NEGATIVO"), "-")

    def test_exclusao_de_resultado_na_trilha(self):
        self.assertEqual(self._col("SIRES01_DELETE", "acao")[0]["coluna"], "=exclusao")
        u = self._col("SIRES01_DELETE", "usuario_id")[0]
        self.assertEqual((u["regra"], u["referencia"]), ("chave_origem", "TBUSERS"))

    def test_situacao_do_exame_pela_liberacao(self):
        s = self._col("SILANEXA", "situacao")[0]
        self.assertEqual((s["coluna"], s["regra"], s["depara"]), ("DATA_HORA_LIBERA_EXAME", "preenchido", "valores"))
        self.assertEqual(s["valores"], {"1": "liberado", "0": "", "": ""})
        self.assertEqual(self._col("SILANEXA", "refazimento")[0]["regra"], "booleano_sn")
        self.assertEqual(self._via("SILANEXA", "cancelado_por_usuario_id"), ("USUARIO_SUSPENSAO_PEP", "TBUSERS"))

    def test_coleta_com_hora(self):
        """Rodada 4, revisão: a coleta leva a hora (HRCOL); a meia-noite só quando a hora não veio."""
        cs = self._col("SILANEXA", "coletado_em")
        self.assertEqual([c["coluna"] for c in cs], ["#data_hora:COLETA,HRCOL", "COLETA"])
        with open(_raiz() / "declarado/colunas.d/L7-04.tsv", encoding="utf-8") as f:
            vias = {(l[0], l[1]): l[5] for l in (x.rstrip("\n").split("\t") for x in f) if len(l) > 5}
        self.assertEqual(vias[("SILANEXA", "#data_hora:COLETA,HRCOL")], "se:HRCOL")
        self.assertEqual(vias[("SILANEXA", "COLETA")], "se:HRCOL=")
        ddl = re.search(r"CREATE TABLE SILANEXA \((.*?)\);", l7_04.DDL, re.S).group(1)
        self.assertIn("HRCOL TIME", ddl)

    def test_resultado_emissor_metodo_e_referencia_do_exame(self):
        self.assertEqual(self._via("SIRES01", "liberado_por_profissional_id"),
                         ("ID_TBCBOPRO_EMISSOR", "TBCBOPRO>ID_TBPROFIS>TBPROFIS"))
        self.assertEqual(self._via("SIRES01", "metodo_analitico_id", "resultado_analito"), ("METODO", "SIMETODO"))
        # a referência do exame nunca vai a observacao (observação clínica): DDL referencia_texto pedido
        self.assertFalse(self._col("SIRES01", "observacao"))
        u = self._col("SIRES01", "unidade_resultado_id", "resultado_analito")[0]
        self.assertEqual((u["coluna"], u["referencia"], u.get("cod")),
                         ("ID_SIHISTVLREFELEMENTO", "SIHISTVLREFELEMENTO>UNIDADE", ("unidade_resultado", "codigo")))
        # limites de valor ABSURDO (MIN_ABE/MAX_ABE) não são valor crítico
        self.assertFalse(self._col("SIRES01", "critico_minimo", "resultado_analito"))
        self.assertFalse(self._col("SIRES01", "critico_maximo", "resultado_analito"))

    def test_resultado_situacao_pela_liberacao_e_momento_por_concorrentes(self):
        s = self._col("SIRES01", "situacao")
        self.assertEqual([(c["coluna"], c["referencia"]) for c in s],
                         [("ID_SILANEXA", "SILANEXA>DATA_HORA_LIBERA_EXAME"), ("=digitado", "")])
        self.assertEqual(s[0]["valores"], {"1": "liberado", "0": "", "": ""})
        self.assertEqual(self._via("SIRES01", "liberado_em"), ("ID_SILANEXA", "SILANEXA>DATA_HORA_LIBERA_EXAME"))
        self.assertEqual([c["coluna"] for c in self._col("SIRES01", "resultado_em")],
                         ["DATA_HORA_EVENTO", "#data_hora:DATARES,HORA", "DATA"])
        self.assertEqual([c["coluna"] for c in self._col("SIRES01_DELETE", "ocorrido_em")],
                         ["DATA_HORA_EVENTO", "DATA_HORA_GRAVACAO"])

    def test_liberacao_sem_etapa_presumida(self):
        e = self._col("SILIBERACAOEXAME", "etapa")
        self.assertEqual([(c["coluna"], c["depara"]) for c in e], [("SITUACAO", "valores")])
        self.assertEqual(e[0]["valores"], {"": "liberacao_clinica"})   # todo código sem par confirmado recusa

    def test_movimento_da_bolsa(self):
        self.assertEqual(self.por["SHBOLSAHIST"]["destinos"], ["movimento_bolsa"])
        for d, c, r in (("bolsa_hemocomponente_id", "ID_BOLSA", "SHBOLSA"), ("tipo_movimento_bolsa_id", "CODMOV", "SHMOV"),
                        ("motivo_devolucao_bolsa_id", "CODMOTDEV", "SHMOTDEV"), ("usuario_id", "USUARIO", "TBUSERS")):
            self.assertEqual(self._via("SHBOLSAHIST", d), (c, r))

    def test_variaveis_da_formula(self):
        self.assertEqual(self.por["SIRESVAR"]["destinos"], ["resultado_variavel_formula"])
        r = self._col("SIRESVAR", "resultado_exame_id")[0]
        self.assertEqual((r["coluna"], r["referencia"], r.get("cod")),
                         ("ID_SILANEXA", "SILANEXA", ("resultado_exame", "exame_item_id")))
        self.assertEqual(self._via("SIRESVAR", "variavel_formula_id"), ("CODIGOVARFORMULA", "SIVARFORMULA"))

    def test_historicos_de_referencia(self):
        for t in ("SIHISTVLREF", "SIHISTVLREFEXAME"):
            self.assertEqual(self.por[t]["destinos"], ["trilha_auditoria"], t)
            self.assertEqual(self._col(t, "dados_depois")[0]["coluna"], "#retrato:*", t)
        p = self.por["SIHISTVLREFELEMENTO"]
        self.assertEqual(p["destinos"], ["faixa_referencia_versao"])
        self.assertEqual(self._col("SIHISTVLREFELEMENTO", "dados")[0]["coluna"], "#retrato:*")
        self.assertEqual(self._via("SIHISTVLREFELEMENTO", "faixa_referencia_id"),
                         ("ID_SITABELE_CODPRC", "SITABELE(ID_SITABELE_CODPRC,ID_SITABELE_CODELE)/faixa_referencia"))

    def test_exclusao_com_retrato(self):
        self.assertEqual(self._col("SIRES01_DELETE", "dados_antes")[0]["coluna"], "#retrato:*")
        self.assertTrue(mapa.spec_retrato("#retrato:*")["todas"])
        # a imagem sintética traz o conteúdo do resultado excluído, que tem de chegar ao retrato
        ddl = re.search(r"CREATE TABLE SIRES01_DELETE \(([^;]*)\);", l7_04.DDL).group(1)
        for c in ("NUMERICO", "ALFA", "TEXTO", "CONCLUSAO", "EXAME", "ELEMENTO"):
            self.assertIn(c + " ", ddl)

    def test_kit_pela_referencia_e_versao_por_kit(self):
        k = self._col("SIKITHISTEXA", "kit_exame_id")[0]
        self.assertEqual((k["regra"], k["referencia"]), ("chave_origem", "SIKITEXA"))
        self.assertEqual(self._col("SIKITHISTEXA", "numero_versao")[0]["coluna"], "#seq:ID_SIKITEXA")


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r / "declarado/colunas.d/L7-04.tsv", newline="") as f:
            self.linhas = list(csv.DictReader(f, delimiter="\t"))
        with open(r / "declarado/sem_carga.tsv", newline="") as f:
            self.sem_carga = {l["tabela"]: l for l in csv.DictReader(f, delimiter="\t")}

    def test_toda_tabela_da_fatia_declarada(self):
        self.assertEqual({l["tabela"] for l in self.linhas},
                         set(CARREGADAS) | {VINCULO} | set(DESCARTES) | set(BLOQUEADAS))
        self.assertNotIn(VINCULO, self.sem_carga)

    def test_bloqueadas_com_decisao(self):
        for t, causa in BLOQUEADAS.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("bloqueada", causa), t)
            self.assertIn("decisão", self.sem_carga[t]["motivo"], t)

    def test_sem_motivo_generico(self):
        for l in self.linhas:
            self.assertNotIn("coluna técnica, de controle ou repetida de outra tabela; o que importa",
                             l["motivo"] if (l["tabela"], l["coluna"]) == ("SICADATE", "ID_TBMEDSOL")
                             or l["tabela"] == "SIRES01" and l["coluna"] in (
                                 "CRM", "MEDICO", "RESULTADO_PDF", "ID_TBCBOPRO_EMISSOR", "METODO",
                                 "RESPONSAVEL_TECNICO", "NOME_RESPONSAVEL_TECNICO", "APAREL", "AMOSTRA", "DATARES",
                                 "HORA", "ID_SITPEQV", "ID_SIHISTVLREF", "ID_SIHISTVLREFEXAME")
                             or l["tabela"] in ("SHBOLSAHIST", "SIRESVAR", "SIHISTVLREF", "SIHISTVLREFEXAME",
                                                "SIHISTVLREFELEMENTO", "SIRES01_DELETE", "HTNOTEXAMESEXO")
                             else "", (l["tabela"], l["coluna"]))

    def test_descartes_com_causa_de_produto_e_sem_destino(self):
        for t, causa in DESCARTES.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(self.sem_carga[t]["motivo"].startswith("L7-04"), t)
            self.assertFalse([l for l in self.linhas if l["tabela"] == t and l["destino"]], t)

    def test_carregadas_tem_destino_e_motivo(self):
        for t in CARREGADAS + [VINCULO]:
            self.assertTrue([l for l in self.linhas if l["tabela"] == t and l["destino"]], t)
        for l in self.linhas:
            self.assertTrue(l["motivo"], (l["tabela"], l["coluna"]))

    def test_regras_validas(self):
        for l in self.linhas:
            if l["regra"]:
                self.assertTrue(sentinela.regra_conhecida(l["regra"]), (l["tabela"], l["coluna"], l["regra"]))

    def test_sem_nome_da_origem_no_destino(self):
        for l in self.linhas:
            if l["destino"]:
                self.assertRegex(l["destino"], r"^[a-z_]+\.[a-z_]+$")


class Sintetica(unittest.TestCase):
    def test_ddl_tem_as_carregadas(self):
        tabs = set(re.findall(r"CREATE TABLE (\w+)", l7_04.DDL))
        self.assertFalse((set(CARREGADAS) | {VINCULO}) - tabs)
        self.assertFalse(tabs & (set(DESCARTES) - {"SIHISTVLREFELEMENTO", "SIHISTVLREFEXAME"}))

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l7_04.linhas(None, lambda t, v: ins.append(t))
        self.assertEqual(set(esp), set(CARREGADAS) | {VINCULO} | set(BLOQUEADAS))
        for t, e in esp.items():
            recusas = sum(n for rg, n in e["pendencias"].items()
                          if rg.startswith("restricao_destino_") or rg == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, ins.count(t), t)

    def test_requisicao_so_carrega_com_um_exame(self):
        exames = {}
        for t, ls, _ in l7_04.DADOS:
            if t == "SILANEXA":
                for v in ls:
                    exames[v[1]] = exames.get(v[1], 0) + 1
        self.assertEqual(exames[2.0], 2)            # setor pai_ambiguo
        self.assertEqual({k for k, n in exames.items() if n > 1}, {2.0})

    def test_kit_externo_e_inexistente(self):
        kits = {v[6] for t, ls, _ in l7_04.DADOS if t == "SIKITHISTEXA" for v in ls}
        self.assertEqual(kits - {int(k) for k in l7_04.PAIS_EXTERNOS["SIKITEXA"]}, {9})


class Vinculo(unittest.TestCase):
    def test_esperado_so_na_ordem_certa(self):
        e = l7_04.ESPERADO_ASSINATURA
        recusas = sum(n for rg, n in e["pendencias"].items()
                      if rg.startswith("restricao_destino_") or rg == "pai_pendente")
        self.assertEqual(e["gravados"] + recusas, len(l7_04.ASSINATURA_EXAME))
        self.assertEqual(e["gravados"], 5)  # rodada 4: o exame 102 grava (requisição com setor NULL, DDL 10_SADT/09)
        self.assertFalse(hasattr(l7_04, "ESPERADO_ASSINATURA_ANTES"))

    def test_vinculo_depois_do_exame_e_do_cabecalho(self):
        # pedido de dependências (saida/L7-04.json, alta): falha enquanto o mapa carregar o vínculo antes dos pais
        m = _mapa()
        if m is None:
            self.skipTest("mapa do conector ausente")
        o = {r["tabela"]: int(r["ordem"]) for r in m["tabelas"] if (r.get("ordem") or "").isdigit()}
        self.assertGreater(o[VINCULO], o["SILANEXA"])
        self.assertGreater(o[VINCULO], o["PRASSINATURA_CAB"])

    def test_ligacoes_coerentes(self):
        ligadas = {}
        for _, ev, ass in l7_04.LIGACAO:
            self.assertIn(ev, l7_04.EVENTO_CAB)
            ligadas.setdefault(ass, set()).add(l7_04.EVENTO_CAB[ev])
        self.assertNotIn(6, ligadas)                     # sem ligação
        self.assertEqual(len(ligadas[7]), 2)             # dois documentos: ambiguidade real
        self.assertEqual(ligadas[1], ligadas[10])        # par repetido: 1062
        externos = {int(k) for k in l7_04.PAIS_EXTERNOS["PRASSINATURA_CAB"]}
        self.assertEqual({c for c in l7_04.EVENTO_CAB.values()} - externos, {99})


if __name__ == "__main__":
    unittest.main()
