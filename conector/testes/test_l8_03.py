"""Fatia L8-03 (faturamento e restantes, módulo FAT): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, literais presumidos, declarações das tabelas que aguardam e coerência da imagem sintética.
Só dados inventados (sintetica_d/l8_03.py)."""
import csv
import os
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_03

CARREGADAS = ["TBCOSPPROF", "TBIRREGULARID", "TBLOCCON"]
# aguardam regra genérica do motor ou decisão (pedidos em docs/obra/fatias/f4/saida/L8-03.json)
AGUARDAM = ["TBCONVPERCTAPAC", "TBCOOPER", "TBCRECOO", "TBCREMED", "TBCREPRS", "TBCTRDTH", "TBCTRMEM", "TBCTRTAT",
            "TBCTRTHM", "TBDTHCDC", "TBINDICE", "TBINDPRO", "TBIRREGCTRCTA", "FCPARAM", "TBITEATE", "TBMATMED",
            "TBPACTHM", "TBPORMED", "TBPROCTO", "TBIRREGULARID_TBMODULO"]
OBRIGATORIAS = {"funcao_equipe_cobranca": {"codigo", "descricao", "tipo_funcao"},
                "tipo_pendencia_conta": {"codigo", "descricao", "categoria"},
                "local_cobranca": {"codigo", "descricao", "tipo_local"}}
PRESUMIDOS = {("TBCOSPPROF", "tipo_funcao"): "=~outro", ("TBIRREGULARID", "categoria"): "=~outra",
              ("TBIRREGULARID", "controle"): "=~alerta",
              ("TBLOCCON", "tipo_local"): "=~outro"}


def _raiz():
    """Pasta colunas.d: no repositório (conector/mapa) ou no container (/app/mapa)."""
    for r in (Path(__file__).resolve().parents[1] / "mapa", Path("/app/mapa")):
        if (r / "declarado/colunas.d").is_dir():
            return r / "declarado/colunas.d"
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
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + AGUARDAM))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino):
        p = self.por[t]
        return [c for c in p["colunas"][p["destinos"][0]] if c["destino"] == destino]

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela(self):
        for t, d in (("TBCOSPPROF", "funcao_equipe_cobranca"), ("TBIRREGULARID", "tipo_pendencia_conta"),
                     ("TBLOCCON", "local_cobranca")):
            self.assertEqual(self.por[t]["destinos"], [d], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for p in self.plano:
            dt = p["destinos"][0]
            cobertas = {c["destino"] for c in p["colunas"][dt]}
            self.assertFalse(OBRIGATORIAS[dt] - cobertas, dt)

    def test_classificacao_presumida_para_revisao(self):
        for (t, d), lit in PRESUMIDOS.items():
            self.assertEqual(self._col(t, d)[0]["coluna"], lit, (t, d))

    def test_modulo_do_catalogo_do_produto_nunca_por_conector_origem(self):
        # modulo_sistema é gravado com o produto: referência por chave_origem seria sempre pai_inexistente
        for p in self.plano:
            for cs in p["colunas"].values():
                self.assertFalse([c for c in cs if c["referencia"] == "TBMODULO"], p["tabela"])

    def test_regras_de_coluna(self):
        self.assertEqual(self._col("TBIRREGULARID", "descricao")[0]["regra"], "texto_longo")
        self.assertEqual(self._col("TBLOCCON", "ativo")[0]["regra"], "booleano_sn")
        for t in ("TBCOSPPROF", "TBLOCCON"):
            self.assertEqual(self._col(t, "descricao")[0]["regra"], "texto_nome", t)


class Declaracoes(unittest.TestCase):
    def setUp(self):
        r = _raiz()
        if r is None:
            self.skipTest("declarações ausentes")
        with open(r / "L8-03.tsv", newline="", encoding="utf-8") as f:
            self.linhas = list(csv.DictReader(f, delimiter="\t"))

    def test_toda_tabela_da_fatia_declarada(self):
        self.assertEqual({l["tabela"] for l in self.linhas}, set(CARREGADAS + AGUARDAM))

    def test_aguardam_sem_destino_e_com_motivo(self):
        for l in self.linhas:
            if l["tabela"] in AGUARDAM:
                self.assertEqual(l["destino"], "", l["tabela"])
                self.assertTrue(l["motivo"].startswith("L8-03: não carregada: "), l["tabela"])

    def test_catalogo_licenciado_nunca_carregado(self):
        self.assertFalse([l for l in self.linhas if l["tabela"] == "TBMATMED" and l["destino"]])

    def test_tipo_de_pendencia_so_na_conta(self):
        ds = {l["destino"].split(".")[0] for l in self.linhas if l["tabela"] == "TBIRREGULARID" and l["destino"]}
        self.assertEqual(ds, {"tipo_pendencia_conta"})

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
        self.assertEqual(re.findall(r"CREATE TABLE (\w+)", l8_03.DDL), CARREGADAS)

    def test_esperado_coerente_com_as_linhas(self):
        ins = []
        esp = l8_03.linhas(None, lambda t, v: ins.append(t))
        for t, e in esp.items():
            recusas = sum(n for rg, n in e["pendencias"].items()
                          if rg.startswith("restricao_destino_") or rg == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, ins.count(t), t)

    def test_sem_pai_externo_de_modulo(self):
        # a imagem reflete o caminho real: nenhum módulo do sistema finge ter vindo pelo conector
        self.assertFalse(getattr(l8_03, "PAIS_EXTERNOS", {}).get("TBMODULO"))


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

    def test_codigo_inteiro_vira_texto_sem_decimal(self):
        x = sentinela.aplicar("texto", 1)[0]
        self.assertEqual(carga_mapa.tipar(x, "varchar"), "1")
        self.assertEqual(carga_mapa.tipar(1, "varchar"), "1")


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
    """Carga da imagem sintética e releitura dos valores gravados (ativo, código, descrição, presumidos)."""

    @classmethod
    def setUpClass(cls):
        from sante_conector import conferencia
        lido = {}

        def ler(cc):
            with cc.cursor() as cur:
                for t, cols in (("funcao_equipe_cobranca", "codigo, descricao, tipo_funcao"),
                                ("tipo_pendencia_conta", "codigo, descricao, categoria, controle"),
                                ("local_cobranca", "codigo, descricao, tipo_local, ativo")):
                    cur.execute("SELECT %s FROM %s ORDER BY CAST(codigo AS UNSIGNED)" % (cols, t))
                    lido[t] = [tuple(r) for r in cur.fetchall()]
        cls.r = conferencia.conferir("L8-03", depois_da_primeira=ler)
        cls.lido = lido

    def test_conferencia_ok(self):
        self.assertEqual(self.r["erros"], [])

    def test_funcao(self):
        self.assertEqual(self.lido["funcao_equipe_cobranca"],
                         [("1", "Função exemplo um", "outro"), ("2", "Função exemplo ação", "outro"),
                          ("3", "Anestesia exemplo", "outro")])

    def test_tipo_de_pendencia(self):
        self.assertEqual(self.lido["tipo_pendencia_conta"],
                         [("1", "Pendência exemplo de diagnóstico", "outra", "alerta"),
                          ("2", "Pendência exemplo\r\n  de assinatura", "outra", "alerta"),
                          ("5", "Guia exemplo não autorizada", "outra", "alerta")])

    def test_local_e_ativo(self):
        # S -> 1, N -> 0, X (fora do domínio) e vazio -> padrão do destino (1); 3 sem nome recusado
        self.assertEqual([(c, d, t, int(a)) for c, d, t, a in self.lido["local_cobranca"]],
                         [("1", "Local exemplo internação", "outro", 1), ("2", "Local exemplo ação", "outro", 0),
                          ("4", "Local exemplo fora", "outro", 1), ("5", "Local exemplo sem ativo", "outro", 1)])


if __name__ == "__main__":
    unittest.main()
