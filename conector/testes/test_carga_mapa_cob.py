"""Mecanismos genéricos da rodada de cobertura total do conector (F4): regras, especiais, referências compostas,
alternativas e encadeadas, opções de destino, catálogo oficial com parâmetro e a ferramenta de cobertura. Só dados
falsos (imagem sintética `exemplo_cob`)."""
import datetime
import decimal
import json
import os
import sys
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import exemplo_cob

D = decimal.Decimal
FORA = "valor_fora_do_dominio"


class Regras(unittest.TestCase):
    def test_piso_eleva_com_pendencia(self):
        self.assertEqual(sentinela.aplicar("piso:8", 3), (8, "valor_elevado_ao_minimo"))
        self.assertEqual(sentinela.aplicar("piso:8", 12), (12, None))
        self.assertEqual(sentinela.aplicar("piso:0.5", D("0.1")), (D("0.5"), "valor_elevado_ao_minimo"))
        self.assertEqual(sentinela.aplicar("piso:8", None), (None, None))

    def test_faixa_decimal(self):
        self.assertEqual(sentinela.aplicar("faixa:0,100", D("50.5")), (D("50.5"), None))
        self.assertEqual(sentinela.aplicar("faixa:0,100", D("150")), (None, FORA))
        self.assertEqual(sentinela.aplicar("faixa:0,100", "abc"), (None, FORA))
        self.assertEqual(sentinela.aplicar("faixa:-1.5,1.5", 1), (1, None))

    def test_texto_resumo_na_fronteira_de_palavra(self):
        f = lambda v: sentinela.aplicar("texto_resumo:20", v)  # noqa: E731
        self.assertEqual(f("Texto longo do grupo alfa com várias palavras"), ("Texto longo do grupo", "texto_resumido"))
        self.assertEqual(f("Texto longo do grupoalfa"), ("Texto longo do", "texto_resumido"))
        self.assertEqual(f("x" * 30), ("x" * 20, "texto_resumido"))
        self.assertEqual(f("  curto  "), ("curto", None))

    def test_minutos_em_timestamp(self):
        f = lambda v: sentinela.aplicar("minutos_em_timestamp", v)  # noqa: E731
        self.assertEqual(f(datetime.datetime(1899, 12, 30, 1, 30)), (90, None))
        self.assertEqual(f(datetime.datetime(1899, 12, 30, 0, 0)), (None, None))
        self.assertEqual(f(datetime.datetime(2026, 1, 5, 0, 45)), (45, "hora_com_data"))
        self.assertEqual(f(datetime.time(2, 5)), (125, None))

    def test_conhecidas_e_mal_formadas(self):
        for r in ("piso:8", "faixa:0,100", "texto_resumo:20", "minutos_em_timestamp"):
            self.assertTrue(sentinela.regra_conhecida(r), r)
        for r in ("piso:", "faixa:5,1", "faixa:1", "texto_resumo:0", "piso:x"):
            self.assertFalse(sentinela.regra_conhecida(r), r)


class Especiais(unittest.TestCase):
    def test_codigo_derivado_estavel(self):
        self.assertEqual(carga_mapa.codigo_derivado("curto", 12), ("curto", False))
        x, mudou = carga_mapa.codigo_derivado("Grupo Beta com nome bem comprido", 12)
        self.assertTrue(mudou)
        self.assertEqual(len(x), 12)
        self.assertEqual(x, carga_mapa.codigo_derivado("Grupo Beta com nome bem comprido", 12)[0])
        self.assertIn("~", x)
        self.assertEqual(carga_mapa.codigo_derivado("A1", 12, "comp_"), ("comp_A1", False))
        x, mudou = carga_mapa.codigo_derivado("nome longo demais", 12, "comp_")
        self.assertTrue(mudou and x.startswith("com") and len(x) == 12)

    def test_data_composta(self):
        f = carga_mapa.data_composta
        self.assertEqual(f(2026, 3), (datetime.date(2026, 3, 1), None))
        self.assertEqual(f("2026", "2", "28"), (datetime.date(2026, 2, 28), None))
        self.assertEqual(f(2026, 13), (None, FORA))
        self.assertEqual(f(0, 0), (None, None))

    def test_fonte_das_especiais(self):
        f = carga_mapa.fonte_especial
        self.assertEqual([f("#seq:A"), f("#sha256:B"), f("#cofre:C"), f("#codigo_derivado:D:12"), f("@id")],
                         ["A", "B", "C", "D", None])

    def test_verificador_recusa_especial_desconhecida_e_opcao_no_principal(self):
        dec = [dict(exemplo_cob._d("EXC_GRUPO", "#inventada:X", "exc_grupo.nome"), _arquivo="x"),
               dict(exemplo_cob._d("EXC_GRUPO", "NOME", "exc_grupo.nome", via="opcional"), _arquivo="x")]
        tab = [{"tabela": "EXC_GRUPO", "tabelas_destino": "exc_grupo"}]
        e = mapa.erros_especiais_e_opcoes(dec, tab, {"exc_grupo": {"colunas": ["nome"]}})
        self.assertTrue(any("especial desconhecida" in x for x in e), e)
        self.assertTrue(any("principal não pode ser opcional" in x for x in e), e)
        ok = [dict(c, _arquivo="x") for c in exemplo_cob.MAPA_TESTE["colunas_decl"]]
        ddl = {"exc_pessoa": {"colunas": ["cpf", "nome"]}}
        self.assertEqual(mapa.erros_especiais_e_opcoes(ok, exemplo_cob.MAPA_TESTE["tabelas"], ddl), [])


class Referencias(unittest.TestCase):
    def test_passos(self):
        p = mapa.passos_ref
        self.assertEqual(p("T"), [{"tabela": "T", "modo": "chave", "arg": None}])
        self.assertEqual(p("T.SIGLA"), [{"tabela": "T", "modo": "alt", "arg": "SIGLA"}])
        self.assertEqual(p("T(A,B)"), [{"tabela": "T", "modo": "composta", "arg": ["A", "B"]}])
        self.assertEqual(p("T>X>U.K"), [{"tabela": "T", "modo": "chave", "arg": None}, {"coluna": "X"},
                                        {"tabela": "U", "modo": "alt", "arg": "K"}])
        for ruim in ("T>x", "T>X>U(A,B)", "t", "T(A)", ""):
            self.assertIsNone(p(ruim), ruim)
        self.assertTrue(mapa.ref_simples("TBUSERS"))
        self.assertFalse(mapa.ref_simples("T.K"))

    def test_verificador_referencia_mal_formada_ou_tabela_ausente(self):
        e = mapa.erros_referencia_e_valores([exemplo_cob._d("EXC_ITEM", "EMP", "exc_item.grupo_id",
                                                            via="ref:EXC_GRUPO>X>NAO_EXISTE")], [], {"EXC_GRUPO"})
        self.assertTrue(any("tabela inexistente" in x for x in e), e)
        e = mapa.erros_referencia_e_valores([exemplo_cob._d("EXC_ITEM", "EMP", "exc_item.grupo_id",
                                                            via="ref:EXC_GRUPO>x")], [], {"EXC_GRUPO"})
        self.assertTrue(any("mal formada" in x for x in e), e)

    def test_plano_le_colunas_da_composta_e_do_desdobramento(self):
        plano = {p["tabela"]: p for p in carga_mapa.planejar(exemplo_cob.MAPA_TESTE, {"EXC_GRUPO", "EXC_PESSOA",
                                                                                       "EXC_SUB", "EXC_ITEM"})}
        self.assertIn("COD_GRUPO", plano["EXC_ITEM"]["lidas"])
        g = plano["EXC_GRUPO"]
        self.assertEqual(g["destinos"], ["exc_grupo", "exc_grupo_detalhe", "exc_grupo_dia"])
        for c in ("SEG", "TER", "QUA", "SENHA", "TEXTO"):
            self.assertIn(c, g["lidas"])
        self.assertTrue(g["opcoes"]["exc_grupo_detalhe"]["opcional"])
        self.assertEqual(g["opcoes"]["exc_grupo_dia"]["desdobrar"], [("SEG", "seg"), ("TER", "ter"), ("QUA", "qua")])
        self.assertEqual(plano["EXC_PESSOA"]["opcoes"]["exc_pessoa"]["adotar"], ["cpf"])
        cod = {c["destino"]: c for c in plano["EXC_ITEM"]["colunas"]["exc_item"]}
        self.assertEqual(cod["sub_codigo"]["regra"], "texto")      # encadeada terminada em coluna: valor
        self.assertEqual(cod["pessoa_id"]["regra"], "chave_origem")  # terminada em tabela: id


class CatalogoEsocial(unittest.TestCase):
    def test_catalogo_com_parametro(self):
        c = depara.catalogo("codigo_esocial:18")
        self.assertEqual((c["tabela"], c["coluna"]), ("codigo_esocial", "codigo_esocial"))
        self.assertIn("'18'", c["filtro"])
        self.assertIsNone(depara.catalogo("codigo_esocial:18' OR 1=1"))
        self.assertIsNone(depara.catalogo("codigo_esocial"))
        self.assertTrue(depara.conhecido("cid10"))

    def test_zeros_a_esquerda_nao_contam(self):
        d = depara.Depara("codigo_esocial:18", [("01", 7), ("A1", 8)])
        self.assertEqual(d.resolver(1), (7, None))
        self.assertEqual(d.resolver(" a1 "), (8, None))
        self.assertEqual(d.resolver("99"), (None, "catalogo_codigo_inexistente"))
        self.assertEqual(d.resolver(None), (None, None))


RAIZ = Path(__file__).resolve().parents[2]


@unittest.skipUnless((RAIZ / "tools/obra/cobertura_conector.py").exists() and (RAIZ / "db/migracoes").exists(),
                     "só no host: a cobertura lê o mapa, o DDL e as fatias do repositório")
class Cobertura(unittest.TestCase):
    def test_toda_carregavel_classificada(self):
        sys.path.insert(0, str(RAIZ / "tools/obra"))
        import cobertura_conector
        res = cobertura_conector.avaliar()
        self.assertTrue(res)
        self.assertTrue(all(v[1] in ("CARREGA", "DESCARTE", "BLOQUEADA") and v[2] for v in res.values()))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploCob(unittest.TestCase):
    def test_mecanismos_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT nome FROM exc_pessoa WHERE cpf=%s", (exemplo_cob.CPF_EXISTENTE,))
                lidos["nome"] = c.fetchone()[0]
                c.execute("SELECT COUNT(*) FROM exc_pessoa")
                lidos["pessoas"] = c.fetchone()[0]
                c.execute("SELECT COUNT(*) FROM exc_grupo WHERE senha_ref IS NOT NULL")
                lidos["segredos"] = c.fetchone()[0]
                c.execute("SELECT GROUP_CONCAT(dia ORDER BY dia) FROM exc_grupo_dia")
                lidos["dias"] = c.fetchone()[0]
                c.execute("SELECT COUNT(*) FROM exc_grupo WHERE carregado_em = UTC_DATE() AND vigencia_inicio ="
                          " UTC_DATE() AND LENGTH(hash_texto) = 64")
                lidos["datas"] = c.fetchone()[0]
                c.execute("SELECT COUNT(*), MIN(origem) FROM exc_grupo WHERE titulo IS NOT NULL")
                lidos["complemento"] = list(c.fetchone())
                c.execute("SELECT COUNT(*) FROM exc_grupo")
                lidos["grupos"] = c.fetchone()[0]
                c.execute("SELECT dados FROM exc_item ORDER BY id LIMIT 1")
                lidos["retrato"] = sorted(json.loads(c.fetchone()[0]))
        r = conferencia.conferir("exemplo_cob", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        ent = r["entidades"]
        self.assertEqual(ent["exc_grupo_detalhe"]["registros_destino"], 2)   # opcional: g2 sem detalhe
        self.assertEqual(ent["exc_grupo_dia"]["registros_destino"], 3)       # desdobrado: S/N por coluna
        self.assertTrue(all(e["conferido"] for e in ent.values()))
        self.assertEqual(lidos, {"nome": "Pessoa ja cadastrada", "pessoas": 3, "segredos": 0, "dias": "qua,seg,ter",
                                 "datas": 3, "complemento": [1, "migracao"], "grupos": 3,
                                 "retrato": ["COD_GRUPO", "EMP", "ID", "ID_EXC_SUB", "SIGLA"]})
        self.assertEqual(r["segunda"]["puladas_iguais"], 3 + 3 + 3 + 4 + 2)


if __name__ == "__main__":
    unittest.main()
