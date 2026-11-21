"""Teste do leitor do formato de edição licenciada com os arquivos SINTÉTICOS (sem banco).

uso: python3 -I catalogos/licenciados/test_licenciados.py
"""
import importlib.util
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("carregar_licenciado", AQUI / "carregar.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TestFormato(unittest.TestCase):
    def test_matmed(self):
        linhas, avisos, total = mod.ler(AQUI / "sintetico/matmed_ed1.csv", "matmed")
        self.assertEqual((total, len(linhas)), (6, 4))
        self.assertEqual(sorted(avisos), ["linha 6: sem_preco", "linha 7: tipo_produto_fora_do_dominio"])
        alfa = linhas[0]
        self.assertEqual(str(alfa["preco_fabrica"]), "12.50")
        self.assertEqual(linhas[1]["preco_fabrica"], mod.Decimal("3.40"))
        self.assertIsNone(linhas[2]["preco_maximo_consumidor"])

    def test_cbhpm(self):
        linhas, avisos, total = mod.ler(AQUI / "sintetico/cbhpm.csv", "cbhpm")
        self.assertEqual((total, len(linhas)), (3, 2))
        self.assertEqual(list(avisos), ["linha 4: porte_anestesico_fora_da_faixa"])
        self.assertEqual(linhas[0]["numero_auxiliares"], 0)

    def test_cep(self):
        linhas, avisos, total = mod.ler(AQUI / "sintetico/cep.csv", "cep")
        self.assertEqual((total, len(linhas)), (5, 4))
        self.assertEqual(list(avisos), ["linha 6: cep_invalido"])

    def test_cabecalho_fora_do_formato(self):
        arq = Path("/tmp/claude-1000/licenciado_cab_errado.csv")
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text("codigo;descricao;coluna_estranha\nX;Y;Z\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            mod.ler(arq, "matmed")

    def test_decimal(self):
        self.assertEqual(mod.dec("1.234,50", "v"), mod.Decimal("1234.50"))
        with self.assertRaises(mod.LinhaInvalida):
            mod.dec("-1", "v", 0)


if __name__ == "__main__":
    unittest.main()
