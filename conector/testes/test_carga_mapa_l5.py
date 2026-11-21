"""Recursos genéricos do motor acrescentados na integração do L5 (carga_mapa, sentinela, mapa). Só dados falsos."""
import decimal
import os
import unittest

from sante_conector import carga, carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import exemplo_l5


class Regras(unittest.TestCase):
    def test_booleano_ai(self):
        self.assertEqual([sentinela.aplicar("booleano_ai", v) for v in (b"A", "i ", "", "X", None)],
                         [(True, None), (False, None), (None, None), (None, "valor_fora_do_dominio"), (None, None)])

    def test_inteiro_zero_nulo(self):
        self.assertEqual([sentinela.aplicar("inteiro_zero_nulo", v) for v in (0, 7, None)],
                         [(None, None), (7, None), (None, None)])

    def test_codigo_do_estabelecimento_no_formato_do_modelo(self):
        f = carga.codigo_estabelecimento
        self.assertEqual([f("hc"), f("1"), f("Unidade-02"), f("12345678901234")],
                         ["hc", "e1", "unidade02", "e123456789"])

    def test_1364_recusa_so_a_linha(self):
        self.assertIn(1364, carga.ERROS_LINHA)


class Tipar(unittest.TestCase):
    def test_valor_no_tipo_do_destino(self):
        t = carga_mapa.tipar
        self.assertEqual((t("5", "int"), t("1", "tinyint"), t(7, "varchar"), t(decimal.Decimal("1.50"), "char")),
                         (5, 1, "7", "1.50"))
        self.assertEqual((t("2.5", "decimal"), t(True, "varchar"), t(None, "int"), t("x", "varchar")),
                         (decimal.Decimal("2.5"), True, None, "x"))
        self.assertEqual(carga_mapa.canon(t(12, "varchar")), carga_mapa.canon("12"))


class Plano(unittest.TestCase):
    def test_referencia_declarada_valores_e_especiais(self):
        plano = carga_mapa.planejar(exemplo_l5.MAPA_TESTE, {"EX5_PERFIL", "EX5_ACESSO"})
        perfil, acesso = plano
        cols = {c["destino"]: c for c in acesso["colunas"]["ex5_acesso"]}
        self.assertEqual((cols["usuario_id"]["regra"], cols["usuario_id"]["referencia"]), ("chave_origem", "TBUSERS"))
        self.assertEqual(cols["perfil_id"]["referencia"], "EX5_PERFIL")
        self.assertEqual(acesso["lidas"], ["ID", "ID_EX5_PERFIL", "USUARIO"])  # #seq lê a coluna do grupo uma vez
        pc = {c["destino"]: c for c in perfil["colunas"]["ex5_perfil"]}
        self.assertEqual(pc["situacao"]["valores"], {"A": "ativo", "I": "inativo"})
        self.assertIsNone(pc["nome"]["valores"])
        self.assertNotIn("@estabelecimento", perfil["lidas"])

    def test_referencia_declarada_na_via(self):
        self.assertEqual(mapa.referencia_declarada({"via": "outra_tabela;ref:TBUSERS"}), "TBUSERS")
        self.assertEqual(mapa.referencia_declarada({"via": ""}), "")


class Verificador(unittest.TestCase):
    def _erros(self, colunas_decl, valores):
        return mapa.erros_referencia_e_valores(colunas_decl, valores, {"EX5_PERFIL", "TBUSERS"})

    def test_valores_sem_par_e_par_sem_coluna(self):
        dec = [dict(exemplo_l5._d("EX5_PERFIL", "SIT", "ex5_perfil.situacao", dp="valores"), _arquivo="x")]
        e = self._erros(dec, [])
        self.assertTrue(any("de-para de valores sem par" in x for x in e), e)
        self.assertEqual(self._erros(dec, [exemplo_l5._v("EX5_PERFIL", "SIT", "ex5_perfil.situacao", "A", "x")]), [])
        e = self._erros([], [exemplo_l5._v("EX5_PERFIL", "SIT", "ex5_perfil.situacao", "A", "ativo")])
        self.assertTrue(any("sem coluna declarada com depara valores" in x for x in e), e)

    def test_referencia_declarada_a_tabela_inexistente(self):
        dec = [dict(exemplo_l5._d("EX5_PERFIL", "SIT", "ex5_perfil.situacao", via="ref:NAO_EXISTE"), _arquivo="x")]
        e = self._erros(dec, [])
        self.assertTrue(any("referência declarada a tabela inexistente" in x for x in e), e)


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploL5(unittest.TestCase):
    def test_recursos_l5_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        r = conferencia.conferir("exemplo_l5")
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        ent = r["entidades"]
        self.assertEqual((ent["ex5_perfil"]["registros_destino"], ent["ex5_perfil"]["recusados"]), (3, 2))
        self.assertEqual((ent["ex5_acesso"]["registros_destino"], ent["ex5_acesso"]["recusados"]), (4, 2))
        self.assertEqual(r["segunda"]["puladas_iguais"], 5 + 6)


if __name__ == "__main__":
    unittest.main()
