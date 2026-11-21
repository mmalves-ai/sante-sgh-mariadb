"""Fatia L8-16 (faturamento e restantes, módulo INTG): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, referências (simples, composta e complemento do pai), de-para de valores, literal presumido,
segredo nunca migrado, descartes de produto com motivo, de-para oficial do conselho e coerência da imagem sintética. Só dados inventados (sintetica_d/l8_16.py)."""
import csv
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import l8_16

CARREGADAS = ["GEINTAPOIOCOT", "RETPPROTOLIFE", "SITBEXEQ", "TBMEDSOLWEBCAD"]
DESCARTE = {"FPESOCTPAMB": "mecanismo_do_produto", "PRCABEARQINTEGRAQT": "mecanismo_do_produto",
            "SIMATHP": "duplicado", "SITBELHP": "duplicado", "TBCID10": "catalogo_oficial",
            "TBDIGITAL_ESPECIALIDADE": "duplicado", "TBDIGITAL_INTEG_TYPE": "mecanismo_do_produto",
            "TBDIGITAL_INTEG_FIELD": "mecanismo_do_produto", "TBFORMA_ASSINATURA_ICP": "mecanismo_do_produto",
            "TBENDPOINT": "mecanismo_do_produto", "TBENDPOINTURI": "mecanismo_do_produto",
            "TBOPERSCHEMA": "mecanismo_do_produto", "TBINFBANCO": "sem_valor",
            "TBREGUL_ENDPOINT": "mecanismo_do_produto", "TBREGUL_TABELAS": "duplicado",
            "TBREGUL_VLR_TABELAS": "duplicado", "TBIDENTIFICACAOENDPOINT": "mecanismo_do_produto",
            "SIMODULO_SIWEBATOS": "mecanismo_do_produto"}
OBRIGATORIAS = {"perfil_prioridade_externa": {"codigo", "descricao"},
                "vinculo_pedido_compra_portal": {"pedido_compra_id", "portal_cotacao_id", "codigo_cotacao_portal"},
                "equivalencia_exame_equipamento": {"interface_equipamento_id", "exame_id",
                                                   "codigo_exame_equipamento"},
                "pedido_vinculo_profissional_externo": {"estabelecimento_id", "nome", "cpf", "email",
                                                        "conselho_classe_id", "numero_conselho",
                                                        "conselho_unidade_federativa_id", "solicitado_em"}}


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
               "SITBEXEQ": "equivalencia_exame_equipamento", "TBMEDSOLWEBCAD": "pedido_vinculo_profissional_externo"}
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
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS))
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
            self.assertEqual(e["gravados"] + recusadas, ins.count(t), t)

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
