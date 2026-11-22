"""Fatia L8-16 (faturamento e restantes, módulo INTG): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, referências (simples, composta e complemento do pai), de-para de valores, literal presumido,
segredo nunca migrado, descartes de produto com motivo, de-para oficial do conselho e coerência da imagem sintética. Só dados inventados (sintetica_d/l8_16.py)."""
import csv
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import l8_16

CARREGADAS = ["GEINTAPOIOCOT", "RETPPROTOLIFE", "SIMATHP", "SITBELHP", "SITBEXEQ", "TBDIGITAL_ESPECIALIDADE",
              "TBMEDSOLWEBCAD"]
# declaradas na fatia por outra rodada (sem imagem sintética própria aqui)
OUTRAS_DECLARADAS = ["TBREGUL_TABELAS", "TBREGUL_VLR_TABELAS"]
# rodada 5 (ADR 0006): configuração de integração e listas do hospital passam a carregar
NOVAS_R5 = ["FPESOCTPAMB", "PRCABEARQINTEGRAQT", "SIMODULO_SIWEBATOS", "TBDIGITAL_INTEG_FIELD", "TBDIGITAL_INTEG_TYPE",
            "TBENDPOINT", "TBENDPOINTURI", "TBFORMA_ASSINATURA_ICP", "TBIDENTIFICACAOENDPOINT", "TBINFBANCO",
            "TBOPERSCHEMA", "TBREGUL_ENDPOINT", "TBCID10"]
CARREGADAS = sorted(CARREGADAS + NOVAS_R5)
DESCARTE = {}  # r5c: TBCID10 carrega na trilha (ADR 0006, 4)
OBRIGATORIAS = {"parametro_opcao": {"parametro_definicao_id", "sequencia", "valor", "rotulo"},
                # r5c (ADR 0006): CID-10 do hospital guardado na trilha com o retrato
                "trilha_auditoria": {"ocorrido_em", "acao", "entidade"},
                "sistema_externo": {"codigo", "nome", "categoria", "finalidade"},
                "ponto_integracao": {"estabelecimento_id", "codigo", "nome", "sistema_externo_id", "padrao_troca_id",
                                     "direcao", "transporte", "formato_conteudo"},
                "operacao_ponto_integracao": {"ponto_integracao_id", "sequencia", "codigo", "descricao"},
                "credencial_integracao": {"codigo", "descricao", "tipo", "referencia_cofre"},
                "tipo_evento_publicado": {"codigo", "descricao", "entidade"},
                "esquema_mensagem": {"padrao_troca_id", "codigo", "descricao", "versao_esquema", "formato",
                                     "vigencia_inicio"},
                "perfil_prioridade_externa": {"codigo", "descricao"},
                "vinculo_pedido_compra_portal": {"pedido_compra_id", "portal_cotacao_id", "codigo_cotacao_portal"},
                "equivalencia_exame_equipamento": {"interface_equipamento_id", "exame_id",
                                                   "codigo_exame_equipamento"},
                "pedido_vinculo_profissional_externo": {"estabelecimento_id", "nome", "cpf", "email",
                                                        "conselho_classe_id", "numero_conselho",
                                                        "conselho_unidade_federativa_id", "solicitado_em"},
                "material_laboratorio_apoio": {"laboratorio_apoio_id", "codigo_externo"},
                "elemento_exame_laboratorio_apoio": {"exame_laboratorio_apoio_id", "codigo_elemento_externo"},
                "mapeamento_codigo_externo": {"sistema_externo_id", "tipo_mapeamento_codigo_id", "entidade",
                                              "entidade_id", "codigo_externo"}}


def _raiz():
    for r in (Path(__file__).resolve().parents[2], Path("/app")):
        if (r / "conector/mapa/declarado/colunas.d").is_dir():
            return r
    return None


def _mapa():
    try:
        return mapa.carregar_execucao()
    except FileNotFoundError:
        return None


def _tsv(p):
    with open(p, newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


class Plano(unittest.TestCase):
    def setUp(self):
        self.m = _mapa()
        if self.m is None:
            self.skipTest("mapa do conector ausente")
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS) | set(DESCARTE))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino):
        p = self.por[t]
        return [c for c in p["colunas"][p["destinos"][0]] if c["destino"] == destino]

    def test_so_as_carregaveis_entram(self):
        self.assertEqual(sorted(self.por), CARREGADAS)

    def test_um_destino_por_tabela(self):
        esp = {"RETPPROTOLIFE": "perfil_prioridade_externa", "GEINTAPOIOCOT": "vinculo_pedido_compra_portal",
               "SITBEXEQ": "equivalencia_exame_equipamento", "TBMEDSOLWEBCAD": "pedido_vinculo_profissional_externo",
               "SIMATHP": "material_laboratorio_apoio", "SITBELHP": "elemento_exame_laboratorio_apoio"}
        for t, dt in esp.items():
            self.assertEqual(self.por[t]["destinos"], [dt], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            dt = p["destinos"][0]
            self.assertFalse(OBRIGATORIAS[dt] - {c["destino"] for c in p["colunas"][dt]}, dt)

    def test_referencias(self):
        self.assertEqual(self._col("GEINTAPOIOCOT", "pedido_compra_id")[0]["referencia"], "GECADPED")
        self.assertEqual(self._col("GEINTAPOIOCOT", "portal_cotacao_id")[0]["referencia"], "GEPORTALCOMPRAS")
        self.assertEqual(self._col("SITBEXEQ", "interface_equipamento_id")[0]["referencia"], "SITPEQV")
        self.assertEqual(self._col("SIMATHP", "laboratorio_apoio_id")[0]["referencia"], "SITPEQV/laboratorio_apoio")
        self.assertEqual(self._col("SITBELHP", "exame_laboratorio_apoio_id")[0]["referencia"], "SITBEXHP")
        self.assertEqual(self._col("SITBELHP", "material_laboratorio_apoio_id")[0]["referencia"], "SIMATHP")
        ex = self._col("SITBEXEQ", "exame_id")[0]
        self.assertEqual(ex["passos"][0], {"tabela": "SITABPRO", "modo": "composta", "arg": ["ATO", "CODALF"]})

    def test_conselho_pelo_de_para_oficial_encadeado(self):
        c = self._col("TBMEDSOLWEBCAD", "conselho_classe_id")[0]
        self.assertEqual(c["depara"], "conselho_classe")
        self.assertEqual(c["passos"][0]["tabela"], "TBCONSPROF")
        self.assertEqual(self._col("TBMEDSOLWEBCAD", "conselho_unidade_federativa_id")[0]["depara"], "ibge_uf")
        self.assertEqual(self._col("TBMEDSOLWEBCAD", "solicitado_em")[0]["coluna"], "=~@data_carga")

    def test_codigos_em_texto_e_nomes_colapsados(self):
        self.assertEqual(self._col("RETPPROTOLIFE", "codigo")[0]["regra"], "texto")
        self.assertEqual(self._col("GEINTAPOIOCOT", "codigo_cotacao_portal")[0]["regra"], "texto")
        self.assertEqual(self._col("RETPPROTOLIFE", "descricao")[0]["regra"], "texto_nome")
        self.assertEqual(self._col("TBMEDSOLWEBCAD", "nome")[0]["regra"], "texto_nome")


class EspecialidadeDoParceiro(unittest.TestCase):
    def setUp(self):
        self.m = _mapa()
        if self.m is None:
            self.skipTest("mapa do conector ausente")
        self.p = {p["tabela"]: p for p in carga_mapa.planejar(self.m, {"TBDIGITAL_ESPECIALIDADE"})}[
            "TBDIGITAL_ESPECIALIDADE"]

    def test_uma_equivalencia_por_especialidade_do_hospital(self):
        self.assertEqual(self.p["destinos"][0], "mapeamento_codigo_externo")
        c = [c for c in self.p["colunas"]["mapeamento_codigo_externo"] if c["destino"] == "entidade_id"][0]
        self.assertEqual(c["referencia"], "TBESPEC.ID_TBDIGITAL_ESPECIALIDADE")
        self.assertTrue(self.p["opcoes"]["mapeamento_codigo_externo"]["por_pai"])

    def test_parceiro_e_dominio_adotados_pelo_codigo(self):
        self.assertIn("sistema_externo", self.p["destinos"])
        self.assertIn("tipo_mapeamento_codigo", self.p["destinos"])


class DeparaConselho(unittest.TestCase):
    def test_catalogo_pela_sigla(self):
        d = depara.Depara("conselho_classe", [("CRM", 1), ("COREN", 2)])
        self.assertEqual(d.resolver(" crm "), (1, None))
        self.assertEqual(d.resolver("COREN"), (2, None))
        self.assertEqual(d.resolver("XYZ"), (None, "catalogo_codigo_inexistente"))
        self.assertEqual(d.resolver("12"), (None, "catalogo_codigo_invalido"))
        self.assertEqual(d.resolver(None), (None, None))


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        self.linhas = _tsv(r / "conector/mapa/declarado/colunas.d/L8-16.tsv")
        self.sem_carga = {l["tabela"]: l for l in _tsv(r / "conector/mapa/declarado/sem_carga.tsv")}

    def test_tabelas_declaradas(self):
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS) | set(OUTRAS_DECLARADAS))
        self.assertFalse(set(DESCARTE) & {l["tabela"] for l in self.linhas})

    def test_descartes_de_produto_com_motivo(self):
        for t, causa in DESCARTE.items():
            l = self.sem_carga.get(t)
            self.assertIsNotNone(l, t)
            self.assertEqual((l["situacao"], l["causa"]), ("descarte", causa), t)
            self.assertTrue(l["motivo"].startswith("L8-16: "), t)

    def test_conselho_declarado_pela_sigla_do_pai(self):
        cons = [l for l in self.linhas if (l["tabela"], l["coluna"]) == ("TBMEDSOLWEBCAD", "ID_TBCONSPROF")][0]
        self.assertEqual((cons["depara"], cons["via"]), ("conselho_classe", "ref:TBCONSPROF>COD_CONSELHO_PROF"))

    def test_segredo_nunca_migra(self):
        ls = [l for l in self.linhas if (l["tabela"], l["coluna"]) == ("TBMEDSOLWEBCAD", "SENHA")]
        self.assertEqual([l["destino"] for l in ls], [""])

    def test_regras_validas(self):
        for l in self.linhas:
            if l["regra"]:
                self.assertIn(l["regra"], sentinela.REGRAS, (l["tabela"], l["coluna"]))

    def test_sem_nome_da_origem_no_destino(self):
        for l in self.linhas:
            if l["destino"]:
                self.assertRegex(l["destino"], r"^[a-z_]+\.[a-z_]+$")


class Sintetica(unittest.TestCase):
    def test_so_tabelas_carregaveis_no_ddl(self):
        self.assertEqual(sorted(re.findall(r"CREATE TABLE (\w+)", l8_16.DDL)), sorted(CARREGADAS + l8_16.AUXILIARES))

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l8_16.linhas(None, lambda t, v: ins.append(t))
        for t, ls, e, recusadas in l8_16.DADOS:
            self.assertEqual(esp[t], e)
            gravadas = l8_16.LIDAS_POR_ITEM.get(t, e["gravados"])
            self.assertEqual(gravadas + recusadas, ins.count(t), t)

    def test_cpf_falso_valido_e_um_invalido(self):
        cpfs = [v[5] for t, ls, _, _ in l8_16.DADOS if t == "TBMEDSOLWEBCAD" for v in ls]
        self.assertEqual(sum(1 for c in cpfs if not sentinela_cpf_ok(c)), 1)

    def test_sigla_fora_do_catalogo_preparado(self):
        siglas = {c[1] for c in l8_16.CONSELHOS}
        self.assertEqual(siglas - {"CRM", "COREN"}, {"XYZ"})
        for s in ("CRM", "COREN"):
            self.assertIn("'%s'" % s, l8_16.PREPARO_DESTINO)


def sentinela_cpf_ok(c):
    d = [int(x) for x in str(c).zfill(11)]
    if len(set(d)) == 1:
        return False
    for n in (9, 10):
        r = sum(v * (n + 1 - i) for i, v in enumerate(d[:n])) * 10 % 11
        if (0 if r == 10 else r) != d[n]:
            return False
    return True


if __name__ == "__main__":
    unittest.main()
