"""Resíduo do motor da rodada 4 de cobertura do conector (F4): regra sobre `=@data_carga`, `#dif`/`#soma`,
`exige_dominio`, `senao`, presumida só quando gravada e `por_pai`. Só dados falsos (imagem sintética `exemplo_r4b`)."""
import decimal
import os
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.sintetica_d import exemplo_r4b as ex

TABS = {t["tabela"] for t in ex.MAPA_TESTE["tabelas"]}
D = decimal.Decimal


class Aritmetica(unittest.TestCase):
    def _a(self, nome, linha, regra=""):
        pend = []
        x = carga_mapa.CargaMapa._aritmetica(None, linha, {"coluna": nome, "regra": regra}, pend)
        return x, [p[0] for p in pend]

    def test_dif_e_soma(self):
        self.assertEqual(self._a("#dif:A,B", {"A": D("10"), "B": D("4")}), (D("6"), []))
        self.assertEqual(self._a("#dif:A,B", {"A": D("5"), "B": D("8")}, "piso:0"), (0, ["valor_elevado_ao_minimo"]))
        self.assertEqual(self._a("#dif:A,B", {"A": D("5"), "B": None}), (D("5"), []))
        self.assertEqual(self._a("#dif:A,B", {"A": None, "B": None}), (None, []))
        self.assertEqual(self._a("#soma:A,B,C", {"A": 1, "B": "2,5", "C": None}), (D("3.5"), []))
        self.assertEqual(self._a("#soma:A,B", {"A": "x", "B": 1}), (None, ["valor_fora_do_dominio"]))

    def test_fontes_lidas(self):
        self.assertEqual(carga_mapa.fontes_especial("#dif:A,B"), ["A", "B"])
        self.assertEqual(carga_mapa.fontes_especial("#soma:A,B,C"), ["A", "B", "C"])


class Plano(unittest.TestCase):
    def test_flags_e_opcoes(self):
        plano = {p["tabela"]: p for p in carga_mapa.planejar(ex.MAPA_TESTE, TABS, excluir=frozenset())}
        res = plano[ex.RES]
        self.assertTrue(res["opcoes"]["ex5_opcao"]["por_pai"])
        self.assertTrue(carga_mapa.CargaMapa._desdobrado(res, "ex5_opcao"))
        self.assertTrue(next(c for c in res["colunas"]["ex5_opcao"] if c["coluna"] == "PERG")["por_pai"])
        frq = plano[ex.FRQ]["colunas"]["ex5_frequencia"]
        self.assertTrue(next(c for c in frq if c["coluna"] == "NOME")["senao"])
        est = plano[ex.EST]["colunas"]["ex5_estado"]
        self.assertTrue(est[0]["exige_dominio"])
        self.assertEqual(plano[ex.SAL]["colunas"]["ex5_saldo"][0]["regra"], "data_primeiro_dia_mes")
        self.assertEqual(plano[ex.PAR]["colunas"]["ex5_parcela"][0]["regra"], "piso:0")
        self.assertEqual(plano[ex.PAR]["lidas"], ["ID", "VALOR", "PAGO"])


class Verificador(unittest.TestCase):
    DDL = {"ex5_opcao": {"colunas": {"campo_id": "bigint", "rotulo": "varchar"}},
           "ex5_estado": {"colunas": {"situacao": "varchar"}},
           "ex5_parcela": {"colunas": {"saldo": "decimal", "total": "decimal"}}}

    def _decl(self, t):
        return [dict(c, _arquivo="x") for c in ex.MAPA_TESTE["colunas_decl"] if c["tabela"] == t]

    def _erros(self, cols):
        return mapa.erros_especiais_e_opcoes(cols, ex.MAPA_TESTE["tabelas"], self.DDL)

    def test_exemplo_sem_erros(self):
        for t in TABS:
            self.assertEqual(self._erros(self._decl(t)), [], t)

    def test_recusas(self):
        ruim = [dict(c, via="ref:EX5_PER;por_pai") if c["coluna"] == "PERG" else c for c in self._decl(ex.RES)]
        self.assertTrue(any("por_pai sem referência" in e for e in self._erros(ruim)))
        ruim = [dict(c, via="por_pai") if c["coluna"] == "TXT" else c for c in self._decl(ex.RES)] + \
            [dict(self._decl(ex.RES)[0], destino="ex5_estado.situacao", via="ref:EX5_PER.PERG;por_pai")]
        self.assertTrue(any("por_pai só no destino principal" in e for e in self._erros(ruim)))
        ruim = [dict(c, depara="") for c in self._decl(ex.EST)]
        self.assertTrue(any("exige_dominio sem depara=valores" in e for e in self._erros(ruim)))
        self.assertTrue(any("especial desconhecida" in e for e in
                            self._erros([dict(self._decl(ex.PAR)[0], coluna="#dif:A")])))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR4b(unittest.TestCase):
    def test_residuo_carrega_concilia_e_reexecuta(self):
        from sante_conector import conferencia
        lidos = {}

        def q(c, sql):
            c.execute(sql)
            return [list(x) for x in c.fetchall()]

        def ler(cc):
            with cc.cursor() as c:
                lidos["sal"] = q(c, "SELECT DATE_FORMAT(competencia, '%d'), quantidade FROM ex5_saldo ORDER BY id")
                lidos["par"] = q(c, "SELECT CAST(saldo AS CHAR), CAST(total AS CHAR) FROM ex5_parcela ORDER BY id")
                lidos["est"] = q(c, "SELECT situacao FROM ex5_estado ORDER BY id")
                lidos["frq"] = q(c, "SELECT tipo FROM ex5_frequencia ORDER BY id")
                lidos["opc"] = q(c, "SELECT o.rotulo, k.modelo FROM ex5_opcao o JOIN ex5_campo k ON k.id=o.campo_id"
                                    " ORDER BY o.id")
        r = conferencia.conferir("exemplo_r4b", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertEqual(lidos["sal"], [["01", 5], ["01", 7]])
        self.assertEqual(lidos["par"], [["6.00", "14.00"], ["0.00", "13.00"], [None, None]])
        self.assertEqual(lidos["est"], [["aberto"], ["fechado"]])
        self.assertEqual(lidos["frq"], [["vezes_dia"], ["se_necessario"], ["a_criterio"], ["vezes_dia"]])
        self.assertEqual(lidos["opc"], [["Sim", 1], ["Sim", 2], ["Nao", 1]])


if __name__ == "__main__":
    unittest.main()
