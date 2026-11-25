"""Carregador das curvas de crescimento (03-PEP L141), com amostras SINTÉTICAS no formato das tabelas oficiais (LMS da
OMS por dia; escore Z do INTERGROWTH por semana). Os valores das amostras são fictícios.
Roda no host: python3 -I -m unittest discover -s catalogos/testes -p 'test_curvas.py'
Com SGH_CURVAS_BANCO_TESTE=<banco de cliente de teste> e o cache baixado, carrega duas vezes (idempotência) e confere
as contagens (as curvas ficam: são catálogo público)."""
import importlib.util
import os
import unittest
from pathlib import Path

CURVAS = Path(__file__).resolve().parents[1] / "carregadores/curvas.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_curvas_teste", CURVAS)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


LMS = "sex\tage\tl\tm\ts\n" + "".join(
    f"{sx}\t{d}\t0.5\t{3 + d / 100:.4f}\t0.1\n" for sx in (1, 2) for d in range(0, 1857)
)
IG_SEM_CAB = "27 0.36 0.44 0.55 0.67 0.83 1.02 1.25\n28 0.46 0.56 0.68 0.83 1.01 1.23 1.50\n"
IG_COM_CAB = '"x","SD3neg","SD2neg","SD1neg","SD0","SD1","SD2","SD3"\n' + IG_SEM_CAB.replace(" ", ",")


class TesteCurvas(unittest.TestCase):
    def test_le_lms_por_sexo_e_amostra_semanas_e_meses_publicados(self):
        m = _mod()
        t = m.ler_lms(LMS)
        self.assertEqual(len(t["m"]), 1857)
        self.assertEqual(len(t["f"]), 1857)
        a = m.amostrar_oms2006(t["m"])
        # 14 semanas (0 a 13) + 58 meses (3 a 60); o dia 91 (13 semanas) e o mês 3 (dia 91) coincidem.
        self.assertEqual(len(a), 14 + 58 - 1)
        self.assertAlmostEqual(a[0][0], 0)
        self.assertAlmostEqual(a[-1][0], round(60 * 30.4375) / 30.4375)
        self.assertAlmostEqual(a[-1][2], 3 + 1826 / 100, places=4)

    def test_le_escore_z_com_e_sem_cabecalho(self):
        m = _mod()
        for txt in (IG_SEM_CAB, IG_COM_CAB):
            z = m.ler_linhas_z(txt)
            self.assertEqual([x for x, _ in z], [27.0, 28.0])
            self.assertEqual(z[0][1][3], 0.67)

    def test_recusa_linha_fora_de_ordem(self):
        with self.assertRaises(RuntimeError):
            _mod().ler_linhas_z("27 0.36 0.44 0.55 0.67 0.83 1.25 1.02\n")

    @unittest.skipUnless(os.environ.get("SGH_CURVAS_BANCO_TESTE"), "sem banco de teste")
    def test_carrega_no_banco_sem_duplicar(self):
        m = _mod()
        banco = os.environ["SGH_CURVAS_BANCO_TESTE"]
        r1 = m.carregar(banco)
        r2 = m.carregar(banco)
        self.assertEqual(r1, r2)
        self.assertEqual(r1["curva_referencia"], 8 + 6 + 6)
        n = m._consulta(banco, "SELECT COUNT(*) FROM curva_referencia_ponto p JOIN curva_referencia c "
                               "ON c.id = p.curva_referencia_id WHERE c.codigo_curva REGEXP '^(oms|intergrowth)'")
        self.assertEqual(int(n[0][0]), r1["curva_referencia_ponto"])


if __name__ == "__main__":
    unittest.main()
