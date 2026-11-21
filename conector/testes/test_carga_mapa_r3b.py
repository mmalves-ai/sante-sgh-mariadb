"""Mecanismos genéricos da rodada 3 de cobertura do conector (F4), regras de estrutura: retrato completo da linha com
SHA-256, referência ao destino secundário do pai em colunas concorrentes, cópia de coluna do destino do pai, divisão
do destino principal com item falso e agrupamento de parcelas sob um título. Só dados falsos (imagem sintética
`exemplo_r3b`)."""
import hashlib
import json
import os
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.sintetica_d import exemplo_r3b as ex

TABS = {"EX3B_PAC", "EX3B_HPAC", "EX3B_PRO", "EX3B_MAT", "EX3B_LAN", "EX3B_CIH", "EX3B_PAR", "EX3B_HER"}


class Formas(unittest.TestCase):
    def test_ref_com_coluna_do_destino(self):
        self.assertEqual(mapa.passos_ref("T@item_id"), [{"tabela": "T", "modo": "chave", "arg": None,
                                                         "coluna_destino": "item_id"}])
        p = mapa.passos_ref("L>COD>P/item@codigo")
        self.assertEqual((p[-1]["tabela"], p[-1]["destino"], p[-1]["coluna_destino"]), ("P", "item", "codigo"))
        self.assertIsNone(mapa.passos_ref("T@x>COL"))      # @coluna só no último passo
        self.assertIsNone(mapa.passos_ref("T@X"))          # coluna do destino em minúsculas
        self.assertFalse(mapa.ref_simples("T@item_id"))

    def test_especiais_novas(self):
        for n in ("#retrato:*", "#retrato:*-A,B", "#retrato:NOME,DOC", "#sha256:#retrato", "#sha256:#retrato:*-X",
                  "#grupo_contar", "#grupo_seq", "#grupo_somar:VALOR", "#grupo_min:D", "#grupo_max:D"):
            self.assertTrue(mapa._ESPECIAIS.fullmatch(n), n)
        for n in ("#retrato:", "#retrato:*-", "#grupo_somar:", "#grupo_media:X"):
            self.assertFalse(mapa._ESPECIAIS.fullmatch(n), n)
        self.assertEqual(mapa.spec_retrato("#sha256:#retrato:*-A,B"), {"todas": True, "exceto": ["A", "B"],
                                                                       "extras": []})
        self.assertEqual(mapa.spec_retrato("#retrato:N"), {"todas": False, "exceto": [], "extras": ["N"]})
        self.assertIsNone(mapa.spec_retrato("#sha256:NOME"))
        self.assertIsNone(carga_mapa.fonte_especial("#sha256:#retrato"))
        self.assertEqual(carga_mapa.fonte_especial("#grupo_somar:VALOR"), "VALOR")
        self.assertTrue(mapa.SEGREDO_NOME.search("SENHA_PROXY") and not mapa.SEGREDO_NOME.search("NOME"))


class Plano(unittest.TestCase):
    def setUp(self):
        self.plano = {p["tabela"]: p for p in carga_mapa.planejar(ex.MAPA_TESTE, TABS)}

    def test_le_o_necessario(self):
        h = self.plano["EX3B_HPAC"]
        self.assertEqual(set(h["lidas"]), {"ID", "ID_PAC", "NOME"})  # o `*` é expandido na carga (dicionário vivo)
        self.assertEqual(h["retratos"]["#retrato:*-INTERNO"]["exceto"], ["INTERNO"])
        par = self.plano["EX3B_PAR"]
        self.assertTrue({"EMPRESA", "DOC", "SERIE", "EMISSAO", "VENC", "VALOR"} <= set(par["lidas"]))
        self.assertEqual(par["destinos"], ["ex3b_parcela", "ex3b_titulo"])
        self.assertEqual(par["opcoes"]["ex3b_titulo"]["agrupar"], ["EMPRESA", "DOC", "SERIE"])
        self.assertTrue(self.plano["EX3B_HER"]["opcoes"]["ex3b_heranca"]["com_falso"])
        cih = {c["destino"]: c for c in self.plano["EX3B_CIH"]["colunas"]["ex3b_equivalencia"]}
        self.assertEqual(cih["item_id"]["passos"][-1]["coluna_destino"], "item_id")


class Cabecalho(unittest.TestCase):
    def test_cabecalho_do_grupo(self):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        c._cab, c._grp = {}, ("1|A1|1", 2)
        c._grupos = ("ex3b_titulo", {}, {"1|A1|1": ({"#grupo_contar": 3}, ["1", "2", "3"])})
        c.existente = {"T": {"1/ex3b_titulo": (None, b"", None, "x", "alta"), "3/ex3b_titulo": (7, b"", b"", None,
                                                                                              None)}}
        self.assertEqual(c._cabecalho("T", "ex3b_titulo", "2"), (7, True))     # de execução anterior
        c._cab[("T", "1|A1|1")] = 9
        self.assertEqual(c._cabecalho("T", "ex3b_titulo", "2"), (9, False))    # gravado nesta execução
        c._cab, c.existente = {}, {"T": {}}
        self.assertEqual(c._cabecalho("T", "ex3b_titulo", "2"), (None, False))
        self.assertEqual((c._agregado("#grupo_seq"), c._agregado("#grupo_contar")), (2, 3))


class Verificador(unittest.TestCase):
    DDL = {t: {"colunas": cs} for t, cs in (
        ("ex3b_parcela", ["id", "titulo_id", "numero", "vencimento", "valor"]),
        ("ex3b_titulo", ["id", "empresa", "documento", "serie", "quantidade_parcelas", "valor_total", "emitido_em",
                         "ultimo_vencimento"]),
        ("ex3b_heranca", ["id", "campo", "herda"]),
        ("ex3b_equivalencia", ["id", "lancamento_id", "item_id", "codigo_item", "procedimento"]),
        ("ex3b_item", ["id", "codigo", "tipo", "proc_id", "mat_id"]),
        ("ex3b_lancamento", ["id", "numero", "item_id", "quantidade"]))}

    def _decl(self, t):
        return [dict(c, _arquivo="x") for c in ex.MAPA_TESTE["colunas_decl"] if c["tabela"] == t]

    def _erros(self, cols):
        return mapa.erros_especiais_e_opcoes(cols, ex.MAPA_TESTE["tabelas"], self.DDL)

    def test_exemplo_sem_erros(self):
        for t in TABS:
            self.assertEqual(self._erros(self._decl(t)), [], t)
        self.assertEqual(mapa.erros_referencia_e_valores(ex.MAPA_TESTE["colunas_decl"], [], TABS), [])

    def test_recusas(self):
        par = self._decl("EX3B_PAR")
        sem_antes = [dict(c, via="agrupar:EMPRESA,DOC") if c["via"].startswith("antes") else c for c in par]
        self.assertTrue(any("agrupar só em destino secundário" in e for e in self._erros(sem_antes)))
        sem_grupo = [dict(c, via="antes") if c["via"].startswith("antes") else c for c in par]
        self.assertTrue(any("#grupo_* sem destino agrupado" in e for e in self._erros(sem_grupo)))
        com_adotar = [dict(c, via=c["via"] + ";adotar:documento") if c["via"].startswith("antes") else c for c in par]
        self.assertTrue(any("não combina" in e for e in self._erros(com_adotar)))
        falso = [dict(par[0], coluna="QTD", destino="ex3b_lancamento.quantidade", via="com_falso", tabela="EX3B_LAN")]
        self.assertTrue(any("com_falso só em destino desdobrado" in e for e in self._erros(
            [c for c in self._decl("EX3B_LAN") if c["coluna"] != "QTD"] + falso)))
        cih = self._decl("EX3B_CIH")
        ruim = [dict(cih[1], via="ref:EX3B_PRO/ex3b_item@nao_existe")]
        self.assertTrue(any("@coluna inexistente" in e for e in self._erros(cih + ruim)))
        her = self._decl("EX3B_HER") + [dict(self._decl("EX3B_HER")[1], coluna="=x")]
        self.assertTrue(any("várias vezes com item" in e for e in self._erros(her)))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR3b(unittest.TestCase):
    def test_mecanismos_carregam_conciliam_e_reexecutam(self):
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT dados, hash_dados, resumo FROM ex3b_versao ORDER BY id")
                lidos["versao"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT l.numero, i.codigo FROM ex3b_lancamento l JOIN ex3b_item i ON i.id=l.item_id"
                          " ORDER BY l.numero")
                lidos["lanc"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT l.numero, e.item_id = l.item_id, e.codigo_item, e.procedimento FROM"
                          " ex3b_equivalencia e JOIN ex3b_lancamento l ON l.id=e.lancamento_id ORDER BY l.numero")
                lidos["equiv"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT empresa, documento, serie, quantidade_parcelas, CAST(valor_total AS CHAR),"
                          " DATE_FORMAT(emitido_em, '%Y-%m-%d'), DATE_FORMAT(ultimo_vencimento, '%Y-%m-%d')"
                          " FROM ex3b_titulo ORDER BY id")
                lidos["titulo"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT t.documento, p.numero, CAST(p.valor AS CHAR) FROM ex3b_parcela p JOIN ex3b_titulo t"
                          " ON t.id=p.titulo_id ORDER BY p.id")
                lidos["parcela"] = [list(x) for x in c.fetchall()]
                c.execute("SELECT campo, herda FROM ex3b_heranca ORDER BY id")
                lidos["heranca"] = [list(x) for x in c.fetchall()]
        r = conferencia.conferir("exemplo_r3b", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        self.assertTrue(all(e["conferido"] for e in r["entidades"].values()))
        # retrato completo: sem SENHA nem INTERNO, BLOB binário em SHA-256, texto com a quebra; hash do mesmo JSON
        v1, v2 = lidos["versao"]
        d1 = json.loads(v1[0])
        self.assertEqual(sorted(d1), ["FOTO", "ID", "ID_PAC", "NASC", "NOME", "OBS", "VALOR"])
        self.assertEqual(d1["FOTO"], "sha256:" + hashlib.sha256(b"\x00\x01\x02").hexdigest())
        self.assertEqual((d1["OBS"], d1["VALOR"], d1["NASC"]), ("linha um\nlinha dois", "10.5", "1990-05-01"))
        self.assertEqual(v1[1], hashlib.sha256(v1[0].encode("utf-8")).hexdigest())
        self.assertNotEqual(v1[1], v2[1])
        self.assertEqual(sorted(json.loads(v1[2])), ["ID", "ID_PAC", "NOME"])
        self.assertEqual(lidos["lanc"], [[1, "P1"], [2, "M1"], [3, "M1"], [5, "P1"]])
        self.assertEqual(lidos["equiv"], [[1, 1, "P1", "S1"], [2, 1, None, "S2"], [3, 1, None, "S3"],
                                          [5, 1, "P1", "S5"]])
        self.assertEqual(lidos["titulo"], [
            [1, "A1", "1", 3, "250.50", "2026-01-10", "2026-04-10"],
            [1, "B2", "1", 2, "80.00", "2026-01-15", "2026-03-15"],
            [None, None, None, 1, "10.00", "2026-01-20", "2026-02-20"],
            [None, None, None, 1, "20.00", "2026-01-20", "2026-02-20"],
            [2, "A1", "1", 1, "30.00", "2026-01-05", "2026-02-05"]])
        self.assertEqual(lidos["parcela"], [["A1", 1, "100.00"], ["A1", 2, "100.00"], ["A1", 3, "50.50"],
                                            ["B2", 2, "80.00"], [None, 1, "10.00"], [None, 1, "20.00"],
                                            ["A1", 1, "30.00"]])
        self.assertEqual(lidos["heranca"], [["nome", 1], ["telefone", 0]])
        ent = r["entidades"]
        self.assertEqual((ent["ex3b_titulo"]["registros_origem"], ent["ex3b_titulo"]["registros_destino"]), (7, 7))
        self.assertEqual(r["segunda"]["puladas_iguais"], 1 + 3 + 2 + 1 + 5 + 6 + 8 + 2)


if __name__ == "__main__":
    unittest.main()
