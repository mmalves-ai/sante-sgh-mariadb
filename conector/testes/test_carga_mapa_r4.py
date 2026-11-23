"""Mecanismos genéricos da rodada 4 de cobertura do conector (F4), pedidos pelas fatias: regras novas de sentinela,
formas novas de referência, condições, `cod:` composto, destino principal agrupado, grupos de leitura, agregados das
filhas e fim do horário pela duração. Só dados falsos (imagem sintética `exemplo_r4`)."""
import datetime
import decimal
import json
import os
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import exemplo_r4 as ex

TABS = {t["tabela"] for t in ex.MAPA_TESTE["tabelas"]}
D = decimal.Decimal


class Regras(unittest.TestCase):
    def test_digitos_de_double_inteiro(self):
        self.assertEqual(sentinela.aplicar("cpf", 52998224725.0), ("52998224725", None))
        self.assertEqual(sentinela.aplicar("cpf", "52998224725.0"), ("52998224725", None))
        self.assertEqual(sentinela.aplicar("cnpj", 11222333000181.0), ("11222333000181", None))
        self.assertEqual(sentinela.aplicar("cpf", 5299822472.5)[1], "documento_invalido")
        self.assertEqual(sentinela.aplicar("cnpj", "11.222.333/0001-81"), ("11222333000181", None))

    def test_documento_num_campo_so(self):
        for v, tp, cpf, cnpj in ((52998224725.0, "fisica", "52998224725", None),
                                 ("11.222.333/0001-81", "juridica", None, "11222333000181"),
                                 (0, None, None, None)):
            self.assertEqual(sentinela.aplicar("tipo_pessoa_documento", v), (tp, None))
            self.assertEqual(sentinela.aplicar("cpf_de_documento", v), (cpf, None))
            self.assertEqual(sentinela.aplicar("cnpj_de_documento", v), (cnpj, None))
        self.assertEqual(sentinela.aplicar("tipo_pessoa_documento", "12345678900"), (None, "documento_invalido"))
        self.assertEqual(sentinela.aplicar("cpf_de_documento", "ABC"), (None, "documento_invalido"))

    def test_inteiro_mais_um(self):
        self.assertEqual(sentinela.aplicar("inteiro_mais_um", 41), (42, None))
        self.assertEqual(sentinela.aplicar("inteiro_mais_um", " 0099 "), (100, None))
        self.assertEqual(sentinela.aplicar("inteiro_mais_um", ""), (None, None))
        self.assertEqual(sentinela.aplicar("inteiro_mais_um", "1A"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("inteiro_mais_um", -1), (None, "valor_fora_do_dominio"))

    def test_data_fim_aberta(self):
        self.assertTrue(sentinela.regra_conhecida("data_fim_aberta:2999"))
        self.assertFalse(sentinela.regra_conhecida("data_fim_aberta:x"))
        r = "data_fim_aberta:2999"
        self.assertEqual(sentinela.aplicar(r, datetime.date(2999, 12, 31)), (None, None))
        self.assertEqual(sentinela.aplicar(r, datetime.date(2026, 6, 30)), (datetime.date(2026, 6, 30), None))
        self.assertEqual(sentinela.aplicar(r, datetime.date(1899, 12, 30)), (None, "data_sentinela"))


class Formas(unittest.TestCase):
    def test_referencias_novas(self):
        p = mapa.passos_ref("RT.(DOC,TP)=(DOC,=1)>max:VALOR>(G,S)>NAT")
        self.assertEqual(p[0]["cols"], ["DOC", "=1"])
        self.assertEqual(p[0]["escolha"], ("max", "VALOR"))
        self.assertEqual(p[1], {"colunas": ["G", "S"]})
        self.assertEqual(p[2]["tabela"], "NAT")
        self.assertEqual(mapa.colunas_da_linha(p[0]), ["DOC"])
        self.assertIsNone(mapa.passos_ref("T>max:V"))              # escolha só depois de chave alternativa
        self.assertIsNone(mapa.passos_ref("T.K>(A,B)"))            # chave composta só antes de um passo de tabela
        self.assertIsNone(mapa.passos_ref("T.K>max:V>min:W>X"))
        self.assertEqual(mapa.passos_ref("T.K>min:V>X")[1], {"coluna": "X"})
        # formas antigas intactas
        self.assertEqual(mapa.passos_ref("T@item_id"), [{"tabela": "T", "modo": "chave", "arg": None,
                                                         "coluna_destino": "item_id"}])

    def test_condicao_e_cod(self):
        self.assertEqual(mapa.condicao("TIPO=C,"), {"coluna": "TIPO", "passos": None, "valores": ["C", ""],
                                                    "regra": "", "cod": None})
        c = mapa.condicao("TAB>T>PROPRIA=S!licenca_nao_comprovada")
        self.assertEqual((c["coluna"], c["passos"][-1], c["regra"]), ("TAB", {"coluna": "PROPRIA"},
                                                                      "licenca_nao_comprovada"))
        self.assertIsNone(mapa.condicao("TAB>T"))                  # encadeada tem de terminar em coluna
        self.assertEqual(mapa.condicao("DT")["valores"], None)
        self.assertEqual(mapa.cod_spec("codigo.(tributo,codigo)=(=fgts,valor)"),
                         ("codigo", ["tributo", "codigo"], ["=fgts", "valor"]))
        self.assertEqual(mapa.cod_spec("tributo.sigla"), ("tributo", "sigla"))
        self.assertIsNone(mapa.cod_spec("codigo.(a,b)=(valor)"))

    def test_principal_escolhido_na_via(self):
        cols = [{"destino": "kit.codigo", "via": "antes;agrupar:PROC"}, {"destino": "kit_item.item_id", "via": ""}]
        self.assertEqual(mapa.principal_e_destinos("kit;kit_item", cols), ["kit", "kit_item"])
        cols[1]["via"] = "principal"
        self.assertEqual(mapa.principal_e_destinos("kit;kit_item", cols), ["kit_item", "kit"])

    def test_especiais_novas(self):
        for n in ("#data_hora_mais:D,H,M", "#codigo_derivado:A+B:12:x_", "#grupo_json:ID,OBS", "#grupo_seq@DOC",
                  "#grupo_razao:VALOR@DOC,SERIE", "#filhos_min:T.C|U.D@FK", "#filhos_somar:T.C@FK"):
            self.assertTrue(mapa._ESPECIAIS.fullmatch(n), n)
        for n in ("#data_hora_mais:D,H", "#grupo_razao:V", "#filhos_min:T@FK", "#filhos_media:T.C@FK"):
            self.assertFalse(mapa._ESPECIAIS.fullmatch(n), n)
        self.assertEqual(carga_mapa.fontes_especial("#codigo_derivado:A+B:12"), ["A", "B"])
        self.assertEqual(carga_mapa.fontes_especial("#grupo_razao:V@A,B"), ["V", "A", "B"])
        self.assertEqual(carga_mapa.fontes_especial("#data_hora_mais:D,H,M"), ["D", "H", "M"])
        self.assertEqual(carga_mapa.fontes_especial("#filhos_min:T.C@FK"), [])


class Plano(unittest.TestCase):
    def setUp(self):
        self.plano = {p["tabela"]: p for p in carga_mapa.planejar(ex.MAPA_TESTE, TABS)}

    def test_le_o_necessario(self):
        self.assertEqual(set(self.plano[ex.HOR]["lidas"]), {"ID", "NOME_AGE", "DATA", "HORA", "DUR"})
        self.assertEqual(set(self.plano[ex.TIT]["lidas"]), {"ID", "TIPO", "COD", "VALOR", "DT_PGTO"})
        self.assertEqual(set(self.plano[ex.ITE]["lidas"]), {"ID", "TAB", "NOME"})
        self.assertEqual(len(self.plano[ex.ITE]["filtros"]), 1)
        self.assertEqual(set(self.plano[ex.KON]["lidas"]), {"ID", "ANO", "CC", "VALOR", "OBS"})
        self.assertEqual(set(self.plano[ex.RAT]["lidas"]), {"ID", "DOC", "VALOR"})
        self.assertEqual(set(self.plano[ex.COD]["lidas"]), {"ID", "A", "B"})
        self.assertEqual(set(self.plano[ex.TT]["lidas"]), {"ID", "DOC"})
        self.assertEqual(self.plano[ex.TIT]["opcoes"]["ex4_baixa"]["se"]["coluna"], "DT_PGTO")
        inc = self.plano[ex.INC]["colunas"]["ex4_incidencia"][0]
        self.assertEqual(inc["cod"], ("ex4_codigo", ["tributo", "codigo"], ["=fgts", "valor"]))
        self.assertEqual(self.plano[ex.HOR]["colunas"]["ex4_horario"][1]["regra"], "minutos_hhmm")

    def test_desambiguar_e_escolha(self):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        c._alt_lista = {("P", ("A", "B")): {"1|x": ["3", "10"]}}
        c.existente = {"P": {"3": (7, b"", b"", None, None), "10": (7, b"", b"", None, None)}}
        s = {"tabela": "P", "modo": "alt_composta", "arg": ["A", "B"]}
        self.assertEqual(c._desambiguar(s, ("P", ("A", "B")), "1|x", True, []), "3")    # a mesma linha do destino
        self.assertIs(c._desambiguar(s, ("P", ("A", "B")), "1|x", False, []), carga_mapa._AMBIGUO)
        c.existente["P"]["10"] = (8, b"", b"", None, None)
        self.assertIs(c._desambiguar(s, ("P", ("A", "B")), "1|x", True, []), carga_mapa._AMBIGUO)
        c._origem_pai = {("P", "V"): {"3": D("5"), "10": D("5")}}
        pend = []
        self.assertEqual(c._desambiguar(dict(s, escolha=("max", "V")), ("P", ("A", "B")), "1|x", True, pend), "3")
        self.assertEqual(pend, [("escolha_pelo_maior", "baixa")])    # empate: a menor chave ('3' antes de '10')

    def test_condicao_na_linha(self):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        self.assertTrue(c._cond({"T": b"C "}, mapa.condicao("T=C,F")))
        self.assertFalse(c._cond({"T": None}, mapa.condicao("T=C,F")))
        self.assertTrue(c._cond({"T": None}, mapa.condicao("T=C,")))
        self.assertTrue(c._cond({"N": 1.0}, mapa.condicao("N=1")))
        self.assertFalse(c._cond({"D": "  "}, mapa.condicao("D")))


class Verificador(unittest.TestCase):
    DDL = {t: {"colunas": cs} for t, cs in (
        ("ex4_horario", ["id", "inicio_em", "fim_em"]), ("ex4_cliente", ["id", "nome"]),
        ("ex4_fornecedor", ["id", "nome"]), ("ex4_titulo", ["id", "cliente_id", "fornecedor_id", "valor"]),
        ("ex4_baixa", ["id", "titulo_id", "pago_em"]), ("ex4_item", ["id", "nome"]),
        ("ex4_codigo", ["id", "tributo", "codigo"]), ("ex4_incidencia", ["id", "codigo_id"]),
        ("ex4_tributo", ["id", "sigla"]), ("ex4_parametro", ["id", "tributo_id", "valor"]),
        ("ex4_consumo", ["id", "ano", "centro", "valor_total", "quantidade", "detalhes"]),
        ("ex4_uso", ["id", "consumo_id"]), ("ex4_rateio", ["id", "documento", "sequencia", "percentual"]),
        ("ex4_grupo", ["id", "numero", "data_operacao", "total"]), ("ex4_codigo_der", ["id", "codigo"]),
        ("ex4_natureza", ["id", "nome"]), ("ex4_titulo2", ["id", "documento", "natureza_id"]))}

    def _decl(self, t):
        return [dict(c, _arquivo="x") for c in ex.MAPA_TESTE["colunas_decl"] if c["tabela"] == t]

    def _erros(self, cols):
        return mapa.erros_especiais_e_opcoes(cols, ex.MAPA_TESTE["tabelas"], self.DDL)

    def test_exemplo_sem_erros(self):
        for t in TABS:
            self.assertEqual(self._erros(self._decl(t)), [], t)
        self.assertEqual(mapa.erros_referencia_e_valores(ex.MAPA_TESTE["colunas_decl"], [], TABS), [])

    def test_recusas(self):
        tit = self._decl(ex.TIT)
        ruim = [dict(c, via="destino_se:VALOR") if c["coluna"] == "VALOR" else c for c in tit]
        self.assertTrue(any("destino_se" in e for e in self._erros(ruim)))         # nunca no principal
        ruim = [dict(c, via="ref:EX4_CLI;se:TIPO>EX4_CLI") if c["destino"] == "ex4_titulo.cliente_id" else c
                for c in tit]
        self.assertTrue(any("condição mal formada" in e for e in self._erros(ruim)))
        ruim = [dict(c, via="ref:EX4_CLI;se:TIPO=C!regra") if c["destino"] == "ex4_titulo.cliente_id" else c
                for c in tit]
        self.assertTrue(any("condição mal formada" in e for e in self._erros(ruim)))  # !regra só no so_se
        inc = [dict(c, via="cod:ex4_codigo.(tributo,nao_existe)=(=fgts,valor)") for c in self._decl(ex.INC)]
        self.assertTrue(any("cod: a tabela.coluna inexistente" in e for e in self._erros(inc)))
        rat = [dict(c, coluna="#grupo_somar:VALOR") if c["coluna"].startswith("#grupo_razao") else c
               for c in self._decl(ex.RAT)]
        self.assertTrue(any("#grupo_* sem destino agrupado" in e for e in self._erros(rat)))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR4(unittest.TestCase):
    def test_mecanismos_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        lidos = {}

        def q(c, sql):
            c.execute(sql)
            return [list(x) for x in c.fetchall()]

        def ler(cc):
            with cc.cursor() as c:
                lidos["hor"] = q(c, "SELECT DATE_FORMAT(inicio_em, '%d %H:%i'), DATE_FORMAT(fim_em, '%d %H:%i')"
                                    " FROM ex4_horario ORDER BY id")
                lidos["tit"] = q(c, "SELECT cliente_id IS NOT NULL, fornecedor_id IS NOT NULL FROM ex4_titulo"
                                    " ORDER BY id")
                lidos["baixa"] = q(c, "SELECT COUNT(*) FROM ex4_baixa")
                lidos["item"] = q(c, "SELECT nome FROM ex4_item")
                lidos["inc"] = q(c, "SELECT k.tributo, k.codigo FROM ex4_incidencia i JOIN ex4_codigo k ON"
                                    " k.id=i.codigo_id ORDER BY i.id")
                lidos["par"] = q(c, "SELECT t.sigla, p.valor FROM ex4_parametro p JOIN ex4_tributo t ON"
                                    " t.id=p.tributo_id ORDER BY p.id")
                lidos["kon"] = q(c, "SELECT ano, centro, CAST(valor_total AS CHAR), quantidade, detalhes FROM"
                                    " ex4_consumo ORDER BY id")
                lidos["uso"] = q(c, "SELECT k.centro FROM ex4_uso u JOIN ex4_consumo k ON k.id=u.consumo_id"
                                    " ORDER BY u.id")
                lidos["rat"] = q(c, "SELECT documento, sequencia, CAST(percentual AS CHAR) FROM ex4_rateio"
                                    " ORDER BY id")
                lidos["grupo"] = q(c, "SELECT numero, DATE_FORMAT(data_operacao, '%Y-%m-%d'), CAST(total AS CHAR)"
                                      " FROM ex4_grupo")
                lidos["cod"] = q(c, "SELECT codigo FROM ex4_codigo_der ORDER BY id")
                lidos["uni"] = q(c, "SELECT u.codigo, p.cpf FROM ex4_unidade u LEFT JOIN ex4_prof p ON"
                                    " p.id=u.diretor_id ORDER BY u.id")
                lidos["tt"] = q(c, "SELECT t.documento, n.nome FROM ex4_titulo2 t JOIN ex4_natureza n ON"
                                   " n.id=t.natureza_id ORDER BY t.id")
        r = conferencia.conferir("exemplo_r4", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertEqual(lidos["hor"], [["04 08:00", "04 08:30"], ["04 09:00", "04 09:15"],
                                        ["04 23:50", "05 00:10"]])
        self.assertEqual(lidos["tit"], [[1, 0], [0, 1], [0, 0]])
        self.assertEqual(lidos["baixa"], [[1]])
        self.assertEqual(lidos["item"], [["Item próprio"]])
        self.assertEqual(lidos["inc"], [["fgts", "11"], ["fgts", "12"]])
        self.assertEqual(lidos["par"], [["fgts", "Cliente um"], ["fgts", "Cliente um"], ["inss", "Cliente dois"]])
        k1, k2 = lidos["kon"]
        self.assertEqual(k1[:4], [2026, "A", "15.50", 2])
        self.assertEqual(json.loads(k1[4]), [{"ID": 1, "OBS": "doc 1"}, {"ID": 2, "OBS": None}])
        self.assertEqual(k2[:4], [2026, "B", "1.00", 1])
        self.assertEqual(lidos["uso"], [["A"], ["B"]])
        self.assertEqual(lidos["rat"], [["D1", 1, "30.0000"], ["D1", 2, "70.0000"], ["D2", 1, "33.3333"],
                                        ["D2", 2, "66.6667"], ["D3", 1, None]])
        self.assertEqual(lidos["grupo"], [[1, "2026-03-01", "12.50"]])
        self.assertEqual(lidos["cod"][0], ["x_AB_12"])
        self.assertEqual(len(lidos["cod"][1][0]), 12)
        self.assertEqual(lidos["tt"], [["A", "Natureza dois"], ["B", "Natureza um"]])
        self.assertEqual(lidos["uni"], [[1, "111"], [2, "222"]])        # chave alternativa em duas fases
        self.assertEqual(r["fase2"]["fase2_gravadas"], 2)


if __name__ == "__main__":
    unittest.main()
