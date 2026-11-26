"""Carga dirigida pelo mapa (carga_mapa.py) e mecanismos de paralelismo dos lotes L5 a L8: colunas.d, imagem
sintética por fatia e conferência por fatia. Só a imagem SINTÉTICA (fatia `exemplo`, dados 100% falsos)."""
import datetime
import decimal
import os
import tempfile
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sintetica
from sante_conector.sintetica_d import exemplo


class Plano(unittest.TestCase):
    def test_plano_em_ordem_so_com_declaradas_e_sem_l3(self):
        m = dict(exemplo.MAPA_TESTE)
        m["tabelas"] = list(m["tabelas"]) + [
            {"tabela": "EX_SEM_DECL", "tabelas_destino": "x", "ordem": "0", "chave": "ID"},
            {"tabela": "TBUSERS", "tabelas_destino": "usuario", "ordem": "0", "chave": "NOME"}]
        m["colunas_decl"] = list(m["colunas_decl"]) + [
            {"tabela": "TBUSERS", "coluna": "NOMEC", "destino": "usuario.nome"}]
        presentes = {"EX_CAD_GRUPO", "EX_CAD_ITEM", "EX_CAD_NOTA", "EX_SEM_DECL", "TBUSERS"}
        p = carga_mapa.planejar(m, presentes)
        self.assertEqual([x["tabela"] for x in p], ["EX_CAD_GRUPO", "EX_CAD_ITEM", "EX_CAD_NOTA"])
        item = p[1]
        self.assertEqual(item["destinos"], ["ex_item", "ex_item_extra"])
        self.assertEqual(item["lidas"][0], "ID")
        self.assertNotIn("=exemplo", item["lidas"])
        self.assertNotIn("@id", item["lidas"])
        self.assertEqual(p[2]["chave"], [])
        self.assertIn("EX_CAD_GRUPO", p[0]["duas_fases"])  # autorreferência
        self.assertEqual(carga_mapa.planejar(m, {"EX_CAD_NOTA"})[0]["tabela"], "EX_CAD_NOTA")

    def test_canon_iguala_origem_e_destino(self):
        c = carga_mapa.canon
        self.assertEqual(c(decimal.Decimal("1.50")), c(decimal.Decimal("1.5")))
        self.assertEqual(c(5), c(decimal.Decimal("5.00")))
        self.assertEqual(c(True), c(1))
        self.assertEqual(c(datetime.time(8, 30)), c(datetime.timedelta(hours=8, minutes=30)))
        self.assertEqual(c("ação"), c("ação".encode("cp1252")))
        self.assertNotEqual(c("ação"), c("acao"))
        self.assertEqual(carga_mapa._truncar(datetime.datetime(2026, 1, 1, 1, 2, 3, 456789), 0),
                         datetime.datetime(2026, 1, 1, 1, 2, 3))


class ColunasPorFatia(unittest.TestCase):
    def test_colunas_d_lidas_e_conflito_entre_arquivos(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "declarado/colunas.d").mkdir(parents=True)
            cab = "\t".join(mapa.CAMPOS_DECL) + "\n"
            Path(d, "declarado/colunas.tsv").write_text(cab + "TBA\tX\ta.x\t\t\t\tm\n", encoding="utf-8")
            Path(d, "declarado/colunas.d/L5-01.tsv").write_text(cab + "TBB\tY\tb.y\t\t\t\tm\n", encoding="utf-8")
            Path(d, "declarado/colunas.d/L5-02.tsv").write_text(cab + "TBC\tZ\tc.z\t\t\t\tm\n", encoding="utf-8")
            cs = mapa.ler_colunas_declaradas(d)
            self.assertEqual([c["tabela"] for c in cs], ["TBA", "TBB", "TBC"])
            self.assertEqual(cs[1]["_arquivo"], "declarado/colunas.d/L5-01.tsv")
            self.assertEqual(mapa.conflitos_declarados(cs), [])
            Path(d, "declarado/colunas.d/L5-02.tsv").write_text(cab + "TBB\tW\tb.w\t\t\t\tm\n", encoding="utf-8")
            e = mapa.conflitos_declarados(mapa.ler_colunas_declaradas(d))
            self.assertEqual(e, ["tabela declarada em mais de um arquivo: TBB (declarado/colunas.d/L5-01.tsv e "
                                 "declarado/colunas.d/L5-02.tsv)"])
            Path(d, "declarado/colunas.d/L5-02.tsv").write_text(cab, encoding="utf-8")
            Path(d, "declarado/colunas.d/L5-01.tsv").write_text(cab + "TBB\tY\tb.y\t\t\t\tm\nTBB\tY\tb.y\t\t\t\tm\n",
                                                                  encoding="utf-8")
            self.assertIn("coluna declarada duas vezes: TBB.Y -> b.y", mapa.conflitos_declarados(
                mapa.ler_colunas_declaradas(d))[0])

    def test_conflito_entra_no_verificador(self):
        from testes.test_l4 import _cenario
        c = _cenario()
        c["colunas_decl"] = [dict(c["colunas_decl"][0], _arquivo="declarado/colunas.tsv"),
                             dict(c["colunas_decl"][0], coluna="OUTRA", _arquivo="declarado/colunas.d/L6-01.tsv")]
        self.assertIn("tabela declarada em mais de um arquivo: TBFILHA (declarado/colunas.tsv e "
                      "declarado/colunas.d/L6-01.tsv)", mapa.verificar_dados(**c))


class SinteticaPorFatia(unittest.TestCase):
    def test_fatias_descobertas_e_requer(self):
        self.assertIn("exemplo", sintetica.fatias_disponiveis())
        self.assertEqual(sintetica.resolver_fatias(["EXEMPLO"]), ["exemplo"])
        self.assertEqual(sintetica.nome_modulo("L5-01"), "l5_01")
        with self.assertRaises(KeyError):
            sintetica.modulo_fatia("L9-99")


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemplo(unittest.TestCase):
    def test_fatia_exemplo_carrega_concilia_e_reexecuta(self):
        from sante_conector import conferencia

        def editar(cc):  # edição no destino depois da primeira carga: conflito visível na segunda
            with cc.cursor() as c:
                c.execute("UPDATE ex_item SET descricao='editado', versao=versao+1 ORDER BY id LIMIT 1")
        r = conferencia.conferir("exemplo", depois_da_primeira=editar)
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        ent = r["entidades"]
        self.assertEqual((ent["ex_grupo"]["registros_destino"], ent["ex_grupo"]["recusados"]), (5, 1))
        self.assertEqual((ent["ex_item"]["registros_destino"], ent["ex_item"]["recusados"]), (19, 1))
        self.assertEqual(ent["ex_item_extra"]["registros_destino"], 19)
        self.assertEqual((ent["ex_nota"]["registros_destino"], ent["ex_nota"]["recusados"]), (6, 0))
        self.assertEqual(r["fase2"], {"fase2_gravadas": 3, "fase2_pendentes": 1})
        self.assertEqual(r["segunda"]["puladas_iguais"], 6 + 20 + 6)
        self.assertEqual(r["segunda"]["pendencias_por_regra"].get("ex_item:edicao_no_destino:media"), 1)
        self.assertTrue(all(v["linhas_por_segundo"] is None or v["linhas_por_segundo"] > 0
                            for v in r["por_tabela"].values()))

    def test_divergencia_sem_rastro_de_edicao_falha_a_conciliacao(self):
        from sante_conector import conferencia

        def corromper(cc):  # muda o destino sem versao/alterado_em: não é edição visível, é divergência
            with cc.cursor() as c:
                c.execute("UPDATE ex_nota SET texto='outro' ORDER BY id LIMIT 1")
        r = conferencia.conferir("exemplo", depois_da_primeira=corromper)
        self.assertFalse(r["ok"])
        self.assertTrue(any(e.startswith("segunda: conciliação divergiu em ex_nota") for e in r["erros"]), r["erros"])


if __name__ == "__main__":
    unittest.main()
