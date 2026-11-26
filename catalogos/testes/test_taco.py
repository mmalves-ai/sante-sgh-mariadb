"""Carregador da composição nutricional (TACO 4ª ed.), com amostra SINTÉTICA no formato da planilha oficial (título do
grupo numa linha só, cabeçalho com a unidade entre parênteses, vírgula decimal, Tr, NA e *). Alimentos e valores são
fictícios.
Roda no host: python3 -I -m unittest discover -s catalogos/testes -p 'test_taco.py'
Com SGH_TACO_BANCO_TESTE=<banco de cliente de teste sem a TACO carregada>, grava a amostra duas vezes (idempotência),
depois uma edição nova sem um alimento e sem um nutriente, confere as contagens e remove o que gravou."""
import importlib.util
import os
import subprocess
import unittest
from pathlib import Path

TACO = Path(__file__).resolve().parents[1] / "carregadores/taco.py"
RAIZ = Path(__file__).resolve().parents[2]


def _taco():
    esp = importlib.util.spec_from_file_location("carregador_taco_teste", TACO)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


AMOSTRA = (
    "Tabela sintética de composição;;;;;;\n"
    "Número do Alimento;Descrição dos alimentos;Umidade (%);Energia (kcal);Energia (kJ);Proteína (g);Sódio (mg)\n"
    "Grupo sintético um;;;;;;\n"
    "1;Alimento sintético A;12,5;360;1508;7,3;Tr\n"
    "2;Alimento sintético B;70,1;128;534;2,5;NA\n"
    "Grupo sintético dois;;;;;;\n"
    "3;Alimento sintético C;*;52;218;0,3;1\n"
    "3;Alimento sintético C repetido;1;1;1;1;1\n"
    "x;linha inválida;1;1;1;1;1\n"
)


class LeituraTabela(unittest.TestCase):
    def test_le_grupos_alimentos_e_valores(self):
        m = _taco().ler_tabela(AMOSTRA.encode("latin-1"))
        self.assertEqual(sorted(m["grupos"].values()), ["Grupo sintético dois", "Grupo sintético um"])
        self.assertEqual([a["codigo"] for a in m["alimentos"]], ["1", "2", "3"])
        a, b, c = m["alimentos"]
        self.assertEqual(a["quantidades"], {"umidade": 12.5, "energia_kcal": 360.0, "energia_kj": 1508.0,
                                            "proteina": 7.3, "sodio": 0.0})
        self.assertNotIn("sodio", b["quantidades"])  # NA fica sem valor
        self.assertNotIn("umidade", c["quantidades"])  # * fica sem valor
        self.assertEqual(c["grupo"], _taco().codigo_grupo("Grupo sintético dois"))
        self.assertEqual(m["nutrientes"], ["umidade", "energia_kcal", "energia_kj", "proteina", "sodio"])

    def test_coluna_de_grupo_e_ponto_decimal(self):
        txt = "numero,descricao,categoria,energia (kcal)\n7,Item sintético,Frutas sintéticas,45.5\n"
        m = _taco().ler_tabela(txt.encode("utf-8"))
        self.assertEqual(m["alimentos"][0]["quantidades"], {"energia_kcal": 45.5})
        self.assertEqual(list(m["grupos"].values()), ["Frutas sintéticas"])

    def test_sem_colunas_recusa(self):
        with self.assertRaises(ValueError):
            _taco().ler_tabela(b"a;b\n1;2\n")
        with self.assertRaises(ValueError):
            _taco().ler_tabela("numero;descricao;proteina (g)\n1;x;2\n".encode())

    def test_valor(self):
        t = _taco()
        self.assertEqual(t.valor("1.234,5"), 1234.5)
        self.assertEqual(t.valor("tr"), 0.0)
        self.assertIsNone(t.valor("-"))
        self.assertIsNone(t.valor("-3"))


BANCO = os.environ.get("SGH_TACO_BANCO_TESTE", "").strip()


def _n(banco, q):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, "-N", "-B", "-e", q], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:300])
    return r.stdout.strip()


@unittest.skipUnless(BANCO, "SGH_TACO_BANCO_TESTE não definido")
class GravacaoNoBanco(unittest.TestCase):
    def setUp(self):
        self.assertEqual(_n(BANCO, "SELECT COUNT(*) FROM alimento_referencia WHERE fonte_composicao = 'taco'"), "0")
        self.nutr_antes = _n(BANCO, "SELECT COUNT(*) FROM nutriente_referencia")

    def tearDown(self):
        _n(BANCO, "DELETE an FROM alimento_referencia_nutriente an JOIN alimento_referencia ar ON ar.id = "
                  "an.alimento_referencia_id WHERE ar.fonte_composicao = 'taco'; "
                  "DELETE FROM alimento_referencia WHERE fonte_composicao = 'taco'; "
                  "DELETE FROM grupo_alimento WHERE codigo LIKE 'taco.%'; "
                  "DELETE FROM nutriente_referencia WHERE versao_fonte LIKE 'sint-%'")

    def test_grava_idempotente_e_edicao_nova_encerra(self):
        t = _taco()
        m = t.ler_tabela(AMOSTRA.encode("latin-1"))
        r1 = t.gravar(BANCO, m, "sint-1")
        r2 = t.gravar(BANCO, m, "sint-1")
        self.assertEqual(r1["alimento_referencia_nutriente"], 13)
        self.assertEqual(r2["nutrientes_encerrados"], 0)
        q = ("SELECT COUNT(*), SUM(ar.vigencia_fim IS NULL), (SELECT COUNT(*) FROM alimento_referencia_nutriente an "
             "JOIN alimento_referencia x ON x.id = an.alimento_referencia_id WHERE x.fonte_composicao = 'taco' "
             "AND an.vigencia_fim IS NULL) FROM alimento_referencia ar WHERE ar.fonte_composicao = 'taco'")
        self.assertEqual(_n(BANCO, q), "3\t3\t13")
        self.assertEqual(_n(BANCO, "SELECT CONCAT(CAST(energia_kcal AS SIGNED), '|', CAST(porcao_referencia AS SIGNED), '|', g.codigo) FROM "
                                   "alimento_referencia a JOIN grupo_alimento g ON g.id = a.grupo_alimento_id "
                                   "WHERE a.fonte_composicao = 'taco' AND a.codigo_fonte = '1'"),
                         f"360|100|{t.codigo_grupo('Grupo sintético um')}")
        # o hospital ligou o alimento 1 a um gênero: a carga nunca toca a ligação
        _n(BANCO, "SET FOREIGN_KEY_CHECKS = 0; UPDATE alimento_referencia SET insumo_id = 999999999 WHERE fonte_composicao = 'taco' "
                  "AND codigo_fonte = '1'")
        nova = AMOSTRA.replace("2;Alimento sintético B;70,1;128;534;2,5;NA\n", "").replace(";Tr\n", ";\n")
        r3 = t.gravar(BANCO, t.ler_tabela(nova.encode("latin-1")), "sint-2")
        self.assertEqual(r3["alimentos_encerrados"], 1)
        self.assertEqual(r3["nutrientes_encerrados"], 13)  # todas as linhas da sint-1 encerradas
        self.assertEqual(_n(BANCO, q), "3\t2\t8")  # nada apagado; o B encerrado; 4 + 4 linhas vivas da sint-2
        self.assertEqual(_n(BANCO, "SELECT CONCAT(insumo_id, '|', versao_fonte) FROM alimento_referencia WHERE "
                                   "fonte_composicao = 'taco' AND codigo_fonte = '1'"), "999999999|sint-2")
        _n(BANCO, "UPDATE alimento_referencia SET insumo_id = NULL WHERE fonte_composicao = 'taco'")


if __name__ == "__main__":
    unittest.main()
