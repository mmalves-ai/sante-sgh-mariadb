"""Carregador da CIAP-2 e da correspondência com a CID-10, com amostra SINTÉTICA no formato da tabela oficial (texto
delimitado com cabeçalho). As descrições são fictícias; os códigos seguem o formato oficial (letra do capítulo e dois
dígitos).
Roda no host: python3 -I -m unittest discover -s catalogos/testes -p 'test_ciap2.py'
Com SGH_CIAP2_BANCO_TESTE=<banco de cliente de teste sem a CIAP-2 carregada>, grava a amostra duas vezes
(idempotência), depois uma edição nova sem um código e sem um par, confere as contagens e remove o que gravou."""
import importlib.util
import os
import subprocess
import unittest
from pathlib import Path

CIAP = Path(__file__).resolve().parents[1] / "carregadores/ciap2.py"
RAIZ = Path(__file__).resolve().parents[2]


def _ciap():
    esp = importlib.util.spec_from_file_location("carregador_ciap2_teste", CIAP)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


AMOSTRA = (
    "CO_CIAP;DS_CIAP;CID10\n"
    "K86;Descrição sintética circulatória;I10, I15.0\n"
    "K86;Descrição sintética circulatória;I15.0\n"
    "T90;Descrição sintética endócrina;E11/E14\n"
    "A01;Descrição sintética geral;\n"
    "XX1;linha inválida;A00\n"
    "R74;Descrição sintética respiratória;J00 Z99.9 U999\n"
)


class LeituraTabela(unittest.TestCase):
    def test_le_codigos_pares_e_preferencial(self):
        m = _ciap().ler_tabela(AMOSTRA.encode("latin-1"))
        self.assertEqual(sorted(m["termos"]), ["A01", "K86", "R74", "T90"])
        self.assertEqual(m["termos"]["K86"]["descricao"], "Descrição sintética circulatória")
        self.assertIn(("K86", "I10", True), m["pares"])
        self.assertIn(("K86", "I150", False), m["pares"])
        self.assertEqual(sum(1 for p in m["pares"] if p[0] == "K86"), 2)  # repetido não duplica
        self.assertIn(("T90", "E14", False), m["pares"])
        self.assertIn(("R74", "Z999", False), m["pares"])

    def test_cabecalho_por_nome_e_coluna_preferencial(self):
        txt = "codigo,descrição,cid,preferencial\nK86,x,I10,0\nK86,x,I11,sim\n"
        m = _ciap().ler_tabela(txt.encode("utf-8"))
        self.assertEqual(m["pares"], [("K86", "I10", False), ("K86", "I11", True)])

    def test_sem_colunas_recusa(self):
        with self.assertRaises(ValueError):
            _ciap().ler_tabela(b"a;b\n1;2\n")

    def test_normaliza_cid(self):
        c = _ciap()
        self.assertEqual(c.normalizar_cid("i15.0"), "I150")
        self.assertIsNone(c.normalizar_cid("15"))


BANCO = os.environ.get("SGH_CIAP2_BANCO_TESTE")


@unittest.skipUnless(BANCO, "sem SGH_CIAP2_BANCO_TESTE")
class GravacaoNoBanco(unittest.TestCase):
    def _sql(self, q):
        r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), BANCO, "-N", "-B"], input=q, capture_output=True,
                           text=True, check=True)
        return [ln.split("\t") for ln in r.stdout.splitlines() if ln]

    def _contar(self):
        return self._sql(
            "SELECT (SELECT COUNT(*) FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id "
            "WHERE t.codigo = 'ciap2'), (SELECT COUNT(*) FROM termo_terminologia tt JOIN terminologia t ON "
            "t.id = tt.terminologia_id WHERE t.codigo = 'ciap2' AND tt.ativo = 1), (SELECT COUNT(*) FROM "
            "correspondencia_ciap_cid c JOIN termo_terminologia tt ON tt.id = c.ciap_termo_terminologia_id JOIN "
            "terminologia t ON t.id = tt.terminologia_id WHERE t.codigo = 'ciap2' AND c.excluido_em IS NULL), "
            "(SELECT COUNT(*) FROM terminologia_edicao e JOIN terminologia t ON t.id = e.terminologia_id WHERE "
            "t.codigo = 'ciap2')")[0]

    def _limpar(self):
        self._sql(
            "DELETE c FROM correspondencia_ciap_cid c JOIN termo_terminologia tt ON tt.id = c.ciap_termo_terminologia_id "
            "JOIN terminologia t ON t.id = tt.terminologia_id WHERE t.codigo = 'ciap2';\n"
            "UPDATE terminologia SET edicao_vigente_terminologia_edicao_id = NULL WHERE codigo = 'ciap2';\n"
            "UPDATE termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id SET tt.termo_superior_id = "
            "NULL, tt.terminologia_edicao_id = NULL WHERE t.codigo = 'ciap2';\n"
            "DELETE tt FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id WHERE t.codigo = 'ciap2';\n"
            "DELETE e FROM terminologia_edicao e JOIN terminologia t ON t.id = e.terminologia_id WHERE t.codigo = 'ciap2';\n"
            "DELETE FROM terminologia WHERE codigo = 'ciap2';")

    def setUp(self):
        if self._sql("SELECT COUNT(*) FROM terminologia WHERE codigo = 'ciap2'")[0][0] != "0":
            self.skipTest("o banco já tem a CIAP-2 carregada: o teste não mexe nela")
        self.addCleanup(self._limpar)

    def test_grava_idempotente_e_edicao_nova_inativa(self):
        c = _ciap()
        m = c.ler_tabela(AMOSTRA.encode("utf-8"))
        r1 = c.gravar(BANCO, m, "sintetica-1", "0" * 64)
        r2 = c.gravar(BANCO, m, "sintetica-1", "0" * 64)
        self.assertEqual(r1, r2)
        # 4 capítulos + 4 códigos; pares: K86 2, T90 2, R74 2 (U99.9 não existe na CID-10)
        self.assertEqual(self._contar(), ["8", "8", "6", "1"])
        superior = self._sql(
            "SELECT s.codigo_termo FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id "
            "JOIN termo_terminologia s ON s.id = tt.termo_superior_id WHERE t.codigo = 'ciap2' AND "
            "tt.codigo_termo = 'K86'")
        self.assertEqual(superior, [["K"]])
        nova = c.ler_tabela("CO_CIAP;DS_CIAP;CID10\nK86;Nova;I10\nT90;Nova;E11/E14\n".encode())
        c.gravar(BANCO, nova, "sintetica-2", "1" * 64)
        # nada apagado: 8 termos; ativos K, T, K86, T90; pares vivos 3; duas edições
        self.assertEqual(self._contar(), ["8", "4", "3", "2"])


if __name__ == "__main__":
    unittest.main()
