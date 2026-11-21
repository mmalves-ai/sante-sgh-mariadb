"""Mecanismos genéricos da rodada 2 de cobertura do conector (F4): id pelo código no cadastro do destino (`cod:`),
`@unico:`, chave alternativa composta, referência ao destino secundário do pai, data em DATETIME e as regras
`minutos_hhmm` e `email`. Só dados falsos (imagem sintética `exemplo_r2`)."""
import datetime
import os
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import exemplo_r2

FORA = "valor_fora_do_dominio"


class Regras(unittest.TestCase):
    def test_minutos_hhmm(self):
        f = lambda v: sentinela.aplicar("minutos_hhmm", v)  # noqa: E731
        self.assertEqual(f("0030"), (30, None))
        self.assertEqual(f("0100"), (60, None))
        self.assertEqual(f(b"0130"), (90, None))
        self.assertEqual(f("01:15"), (75, None))
        self.assertEqual(f(245), (165, None))
        self.assertEqual(f("0000"), (None, None))
        self.assertEqual(f("   "), (None, None))
        self.assertEqual(f("0075"), (None, FORA))
        self.assertEqual(f("ab"), (None, FORA))
        self.assertEqual(f(-5), (None, FORA))

    def test_email(self):
        f = lambda v: sentinela.aplicar("email", v)  # noqa: E731
        self.assertEqual(f("  pessoa@exemplo.com "), ("pessoa@exemplo.com", None))
        self.assertEqual(f("semarroba"), (None, FORA))
        self.assertEqual(f("a@b"), (None, FORA))
        self.assertEqual(f(""), (None, None))

    def test_hora_hhmm_texto_cru(self):
        self.assertEqual(sentinela.aplicar("hora_hhmm", b"0800"), (datetime.time(8, 0), None))
        self.assertEqual(sentinela.aplicar("hora_hhmm", b"2500"), (None, "hora_invalida"))

    def test_conhecidas(self):
        for r in ("minutos_hhmm", "email"):
            self.assertTrue(sentinela.regra_conhecida(r), r)


class DataHora(unittest.TestCase):
    def test_data_hora_composta(self):
        f, d = carga_mapa.data_hora_composta, datetime.date(2026, 4, 2)
        self.assertEqual(f(d, "0930"), (datetime.datetime(2026, 4, 2, 9, 30), None))
        self.assertEqual(f(d, b"0930"), (datetime.datetime(2026, 4, 2, 9, 30), None))
        self.assertEqual(f(d, 1415), (datetime.datetime(2026, 4, 2, 14, 15), None))
        self.assertEqual(f(d, datetime.datetime(1899, 12, 30, 7, 5)), (datetime.datetime(2026, 4, 2, 7, 5), None))
        self.assertEqual(f(d, None), (datetime.datetime(2026, 4, 2), None))
        self.assertEqual(f(d, "2575"), (None, "hora_invalida"))
        self.assertEqual(f(None, "0930"), (None, None))
        self.assertEqual(f(datetime.date(1899, 12, 30), "0930"), (None, "data_sentinela"))


class Tipar(unittest.TestCase):
    def test_data_em_datetime_e_volta(self):
        d = datetime.date(2026, 4, 2)
        self.assertEqual(carga_mapa.tipar(d, "datetime"), datetime.datetime(2026, 4, 2))
        self.assertEqual(carga_mapa.tipar(datetime.datetime(2026, 4, 2, 10, 5), "date"), d)
        self.assertEqual(carga_mapa.tipar(d, "date"), d)
        self.assertEqual(carga_mapa.tipar("23:59:59", "time"), datetime.time(23, 59, 59))
        self.assertEqual(carga_mapa.tipar("2026-01-02", "date"), d.replace(month=1, day=2))
        self.assertIs(carga_mapa.tipar("xx", "time"), carga_mapa.NAO_NUMERICO)


class Referencias(unittest.TestCase):
    def test_passos(self):
        self.assertEqual(mapa.passos_ref("T.(A,B)=(C,D)"),
                         [{"tabela": "T", "modo": "alt_composta", "arg": ["A", "B"], "cols": ["C", "D"]}])
        self.assertEqual(mapa.passos_ref("T/conta_item"),
                         [{"tabela": "T", "modo": "chave", "arg": None, "destino": "conta_item"}])
        self.assertEqual(mapa.passos_ref("T>X>U/item")[-1]["destino"], "item")
        for ruim in ("T.(A,B)=(C)", "T/x>X", "T>X>U.(A,B)=(C,D)", "T/X"):
            self.assertIsNone(mapa.passos_ref(ruim), ruim)
        self.assertFalse(mapa.ref_simples("T/item"))
        self.assertTrue(mapa.ref_simples("T"))

    def test_plano_le_colunas_da_alternativa_composta_e_guarda_cod(self):
        plano = {p["tabela"]: p for p in carga_mapa.planejar(exemplo_r2.MAPA_TESTE, {"EXR_PAI", "EXR_FILHO"})}
        f = plano["EXR_FILHO"]
        self.assertTrue({"EMP", "DOC", "ID_EXR_PAI", "TIPO"} <= set(f["lidas"]))
        cods = {c["coluna"]: c.get("cod") for c in f["colunas"]["exr_filho"]}
        self.assertEqual(cods["TIPO"], ("exr_tipo", "codigo"))
        self.assertEqual(cods["=posto"], ("exr_tipo", "codigo"))

    def test_verificador(self):
        ddl = {t: {"colunas": cs} for t, cs in (("exr_tipo", ["id", "codigo"]), ("exr_sala", ["id", "nome"]),
                                                  ("exr_filho", ["id", "tipo_id", "sala_id"]))}
        ok = [dict(c, _arquivo="x") for c in exemplo_r2.MAPA_TESTE["colunas_decl"] if c["tabela"] == "EXR_FILHO"
              and c["destino"].split(".")[1] in ("tipo_id", "tipo_fixo_id", "sala_id")]
        self.assertEqual(mapa.erros_especiais_e_opcoes(ok, exemplo_r2.MAPA_TESTE["tabelas"], ddl), [])
        ruins = [dict(ok[0], via="cod:exr_tipo.nada"), dict(ok[2], coluna="@unico:nao_existe")]
        self.assertEqual(len(mapa.erros_especiais_e_opcoes(ruins, exemplo_r2.MAPA_TESTE["tabelas"], ddl)), 2)

    def test_antes_e_id_do_secundario(self):
        prof = [c for c in exemplo_r2.MAPA_TESTE["colunas_decl"] if c["tabela"] == "EXR_PROF"]
        ddl = {"exr_prof": {"colunas": ["id", "pessoa_id", "apelido"]}, "exr_pessoa": {"colunas": ["id", "cpf", "nome"]}}
        tabs = exemplo_r2.MAPA_TESTE["tabelas"]
        self.assertEqual(mapa.erros_especiais_e_opcoes(prof, tabs, ddl), [])
        self.assertTrue(mapa.opcoes_destino(prof)["exr_pessoa"]["antes"])
        sem_antes = [dict(c, via="adotar:cpf") if c["coluna"] == "CPF" else c for c in prof]
        self.assertEqual(len(mapa.erros_especiais_e_opcoes(sem_antes, tabs, ddl)), 1)


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR2(unittest.TestCase):
    def test_mecanismos_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT f.minutos, TIME_FORMAT(f.hora, '%H:%i'), t.codigo, x.codigo, s.nome, p.nome, i.nome"
                          " FROM exr_filho f JOIN exr_tipo t ON t.id=f.tipo_id JOIN exr_tipo x ON x.id=f.tipo_fixo_id"
                          " JOIN exr_sala s ON s.id=f.sala_id JOIN exr_pai p ON p.id=f.pai_id"
                          " JOIN exr_pai_item i ON i.id=f.item_id")
                lidos["filho1"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT COUNT(*) FROM exr_filho WHERE pai_id IS NULL AND tipo_id IS NULL")
                lidos["sem_pai_nem_tipo"] = c.fetchone()[0]
                c.execute("SELECT DATE_FORMAT(MIN(data_em), '%Y-%m-%d %H:%i'), DATE_FORMAT(MIN(entrada_em),"
                          " '%Y-%m-%d %H:%i'), COUNT(entrada_em) FROM exr_pai")
                lidos["data"] = list(c.fetchone())
                c.execute("SELECT p.apelido, s.nome FROM exr_prof p JOIN exr_pessoa s ON s.id=p.pessoa_id ORDER BY p.id")
                lidos["prof"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT COUNT(*) FROM exr_pessoa")
                lidos["pessoas"] = c.fetchone()[0]
        r = conferencia.conferir("exemplo_r2", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertTrue(all(e["conferido"] for e in r["entidades"].values()))
        self.assertEqual(lidos, {"filho1": [[90, "08:00", "posto", "posto", "Sala ativa", "Pai um", "Pai um"]],
                                 "sem_pai_nem_tipo": 2, "data": ["2026-04-02 00:00", "2026-04-02 09:30", 1],
                                 "prof": [["Um", "Profissional Um"], ["Dois", "Pessoa ja cadastrada"]], "pessoas": 2})
        self.assertEqual(r["segunda"]["puladas_iguais"], 3 + 3 + 3)


if __name__ == "__main__":
    unittest.main()
