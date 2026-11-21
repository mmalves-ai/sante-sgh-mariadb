"""Fatia L5-03 (cadastros e administração): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L5-03`."""
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_03

TABELAS = {"TBOID", "TBTPMINISTCER", "TBTPACAOAUDIT"}
NA_IMAGEM = TABELAS | {"TBALERTA"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["TBOID"]["destinos"], ["oid_icp"])
        self.assertEqual(self.plano["TBTPMINISTCER"]["destinos"], ["orgao_certificador"])
        self.assertEqual(self.plano["TBTPACAOAUDIT"]["destinos"], ["tipo_acao_auditavel"])

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "oid", "descricao", "tipo_oid"} <= set(self.cols("TBOID", "oid_icp")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBTPMINISTCER", "orgao_certificador")))
        self.assertTrue({"codigo", "descricao", "categoria", "acao_trilha"}
                        <= set(self.cols("TBTPACAOAUDIT", "tipo_acao_auditavel")))

    def test_regras_literais_e_referencia(self):
        self.assertEqual(self.cols("TBOID", "oid_icp")["tipo_oid"]["coluna"], "=outro")
        t = self.cols("TBTPACAOAUDIT", "tipo_acao_auditavel")
        self.assertEqual((t["categoria"]["coluna"], t["acao_trilha"]["coluna"]), ("=administracao", "=operacao"))
        self.assertEqual(self.cols("TBTPMINISTCER", "orgao_certificador")["descricao"]["regra"], "texto_nome")
        # chave inteira gravada em código VARCHAR: regra texto (a soma de controle compara texto com texto)
        self.assertEqual(t["codigo"]["regra"], "texto")
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))


    def test_regra_alerta_nao_carregada_sem_depara(self):
        # sexo, repetição e exibição sem via no motor: carregar mudaria o significado da regra (L5-03.json)
        self.assertNotIn("TBALERTA", self.plano)
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] == "TBALERTA"])

    def test_tipo_acao_auditavel_uma_so_alimentadora(self):
        # duas origens com chave inteira no mesmo código colidiriam no UNIQUE (restricao_destino_1062)
        outras = sorted({c["tabela"] for c in self.mapa["colunas_decl"]
                         if (c.get("destino") or "").startswith("tipo_acao_auditavel.")} - {"TBTPACAOAUDIT"})
        self.assertEqual(outras, [], "combinar o espaço de código de tipo_acao_auditavel (L5-03.json)")

    def test_oid_registra_perda_de_tipo_e_conselho(self):
        m = [c["motivo"] for c in self.mapa["colunas_decl"] if c["destino"] == "oid_icp.tipo_oid"][0]
        self.assertIn("ID_TBTIPOOID", m)
        self.assertIn("ID_TBCONSPROF", m)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Alerta   nove ".encode("cp1252")), ("Alerta nove", None))
        self.assertEqual(a("texto", b"  Atributo\r\ncom quebra  "), ("Atributo\r\ncom quebra", None))
        self.assertEqual(a("texto_longo", "linha ação\r\n  dois  ".encode("cp1252")), ("linha ação\r\n  dois  ", None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("inteiro", 7), (7, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_03.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l5_03.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, NA_IMAGEM)

    def test_alerta_traz_os_casos_do_depara_futuro(self):
        alertas = []
        l5_03.linhas(random.Random(1), lambda t, v: alertas.append(v) if t == "TBALERTA" else None)
        self.assertTrue(any(v[7] is not None for v in alertas))               # sexo
        self.assertTrue(any((v[13] or 0) * 60 + (v[14] or 0) > 0 for v in alertas))  # intervalo
        self.assertIn((0, 0), [(v[3], v[4]) for v in alertas])                # faixa 0..0
        self.assertTrue(any(v[3] and v[4] == 0 for v in alertas))             # 0 no limite superior


if __name__ == "__main__":
    unittest.main()
