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
CARREGADAS = ["SIWSETIQUETA", "TBFATORRH", "TBTPSANGUINEO", "SICADATE", "SIRES01_DELETE", "SILANEXA",
              "SIASSLAUDO_IMP_SILANEXA", "SILIBERACAOEXAME", "SIRES01", "SIRESOBS", "HTNOTEXAMESEXO",
              "SIKITHISTEXA", "SIKITHISTITE"]
# vínculo exame -> documento assinado: decisão registrada, espera o documento (L6-11) e a coluna do DDL (pedido)
BLOQUEADAS = {"PREXAMEASSINATURA": "destino_decidido"}
DESCARTES = {"SHBOLSAHIST": "sem_valor", "SIHISTVLREF": "duplicado",
             "SIHISTVLREFEXAME": "duplicado", "SIHISTVLREFELEMENTO": "duplicado", "SIRESVAR": "duplicado"}
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
    "kit_exame_versao_item": {"kit_exame_versao_id", "sequencia", "exame_id"}}


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
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS) | set(DESCARTES) | set(BLOQUEADAS))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino, dt=None):
        p = self.por[t]
        return [c for c in p["colunas"][dt or p["destinos"][0]] if c["destino"] == destino]

    def _via(self, t, destino, dt=None):
        c = self._col(t, destino, dt)[0]
        return c["coluna"], c["referencia"]

    def test_carregadas_em_ordem_e_descartes_fora(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

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
        self.assertEqual(self._col("HTNOTEXAMESEXO", "dados_depois")[0]["coluna"], "#retrato")
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

    def test_resultado_emissor_metodo_e_referencia_do_exame(self):
        self.assertEqual(self._via("SIRES01", "liberado_por_profissional_id"),
                         ("ID_TBCBOPRO_EMISSOR", "TBCBOPRO>ID_TBPROFIS>TBPROFIS"))
        self.assertEqual(self._via("SIRES01", "metodo_analitico_id", "resultado_analito"), ("METODO", "SIMETODO"))
        self.assertEqual(self._via("SIRES01", "observacao"), ("ID_SIHISTVLREFEXAME", "SIHISTVLREFEXAME>VLRREF"))

    def test_exclusao_com_retrato(self):
        self.assertEqual(self._col("SIRES01_DELETE", "dados_antes")[0]["coluna"], "#retrato")
        self.assertIn("ID_SILANEXA", self.por["SIRES01_DELETE"]["retrato"])

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
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS) | set(DESCARTES) | set(BLOQUEADAS))

    def test_bloqueadas_com_decisao(self):
        for t, causa in BLOQUEADAS.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("bloqueada", causa), t)
            self.assertIn("decisão", self.sem_carga[t]["motivo"], t)

    def test_sem_motivo_generico(self):
        for l in self.linhas:
            self.assertNotIn("coluna técnica, de controle ou repetida de outra tabela; o que importa",
                             l["motivo"] if l["tabela"] in ("SICADATE", "SIRES01") and l["coluna"] in (
                                 "ID_TBMEDSOL", "CRM", "MEDICO", "RESULTADO_PDF", "ID_TBCBOPRO_EMISSOR", "METODO")
                             else "", (l["tabela"], l["coluna"]))

    def test_descartes_com_causa_de_produto_e_sem_destino(self):
        for t, causa in DESCARTES.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(self.sem_carga[t]["motivo"].startswith("L7-04"), t)
            self.assertFalse([l for l in self.linhas if l["tabela"] == t and l["destino"]], t)

    def test_carregadas_tem_destino_e_motivo(self):
        for t in CARREGADAS:
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
        self.assertFalse(set(CARREGADAS) - tabs)
        self.assertFalse(tabs & (set(DESCARTES) - {"SIHISTVLREFELEMENTO", "SIHISTVLREFEXAME"}))

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l7_04.linhas(None, lambda t, v: ins.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
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


if __name__ == "__main__":
    unittest.main()
