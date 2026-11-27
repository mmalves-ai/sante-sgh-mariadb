"""Carregador oficial do rol de procedimentos da agência (08-SGO linha 103, C2-122), com planilha sintética na forma da
"Correlação TUSS x Rol" do Anexo I. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

ROL = Path(__file__).resolve().parents[1] / "carregadores/rol_ans.py"
CAB = ["CÓDIGO", "TERMINOLOGIA DE PROCEDIMENTOS E EVENTOS EM SAÚDE (Tab. 22)", "CORRELAÇÃO (SIM/NÃO)", "PROCEDIMENTO",
       "RESOLUÇÃO NORMATIVA (ALTERAÇÃO)", "VIGÊNCIA", "OD", "AMB", "HCO", "HSO", "REF", "PAC", "DUT"]


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_rol_teste", ROL)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _linhas(n, extras=()):
    cols = "ABCDEFGHIJKLM"
    ls = [{"A": "Anexo I sintético"}, dict(zip(cols, CAB))]
    for i in range(n):
        ls.append(dict(zip(cols, [f"{10000000 + i}", f"Procedimento sintetico {i}", "SIM", f"PROC {i}", "RN 465/2021",
                                  "01/04/2021", "", "AMB", "HCO", "HSO", "", "", ""])))
    return ls + list(extras)


def _xlsx(caminho, linhas):
    cel = lambda c, v: f'<c r="{c}1" t="inlineStr"><is><t>{v}</t></is></c>'
    rows = "".join("<row>" + "".join(cel(k, v) for k, v in ln.items()) + "</row>" for ln in linhas)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(caminho, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/'
                                      'relationships"><sheets><sheet name="Rol" r:id="r1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
                                                  'relationships"><Relationship Id="r1" Target="worksheets/s1.xml"/></Relationships>')
        z.writestr("xl/worksheets/s1.xml", f"<worksheet {ns}><sheetData>{rows}</sheetData></worksheet>")


class Leitura(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_segmentacoes_diretriz_e_correlacao(self):
        cols = "ABCDEFGHIJKLM"
        extras = [dict(zip(cols, ["2.01.01.99-9", "Exame com diretriz", "SIM", "EXAME X", "RN 500", "44287",
                                  "OD", "", "", "", "REF", "PAC", "65.1"])),
                  dict(zip(cols, ["20101999", "Exame com diretriz", "SIM", "EXAME Y", "", "", "", "AMB", "", "", "", "", ""])),
                  dict(zip(cols, ["30000001", "Sem correlação", "NÃO", "", "", "", "", "AMB", "", "", "", "", ""]))]
        itens = {i[0]: i for i in self.m.ler_linhas(_linhas(self.m.MINIMO, extras))}
        self.assertEqual(len(itens), self.m.MINIMO + 1)
        c = itens["20101999"]
        # (código, descrição, amb, hosp, obst, odonto, ref, pac, dut, norma, vigência): soma das linhas do mesmo código
        self.assertEqual(c[2:9], (True, False, False, True, True, True, "65.1"))
        self.assertEqual(c[10], "2021-04-01")
        self.assertNotIn("30000001", itens)
        self.assertEqual(itens["10000000"][2:6], (True, True, True, False))

    def test_recusa_fora_da_forma(self):
        with self.assertRaises(RuntimeError):
            self.m.ler_linhas([{"A": "sem cabeçalho"}])
        with self.assertRaises(RuntimeError):
            self.m.ler_linhas(_linhas(self.m.MINIMO - 1))
        with self.assertRaises(RuntimeError):
            self.m.ler_linhas(_linhas(self.m.MINIMO, [{"A": "123", "B": "X", "C": "SIM", "D": "X"}]))

    def test_le_o_xlsx_pela_biblioteca_padrao(self):
        with tempfile.TemporaryDirectory() as d:
            arq = Path(d) / "rol.xlsx"
            _xlsx(arq, _linhas(self.m.MINIMO))
            self.assertEqual(len(self.m.ler(arq)), self.m.MINIMO)


class Carga(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_script_idempotente_liga_tuss_e_encerra_sem_apagar(self):
        s = self.m.montar_script([("10101012", "Consulta O'A", True, False, False, False, False, False, "1", None,
                                   "2021-04-01")], "rn465-sint")
        self.assertIn("ON DUPLICATE KEY UPDATE", s)
        self.assertIn("'Consulta O''A'", s)
        self.assertIn("numero_tabela_tiss = '22'", s)
        self.assertIn("vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)", s)
        self.assertNotIn("DELETE", s)

    def test_sem_planilha_registrada_nao_falha_e_avisa(self):
        self.m.estado = lambda banco: (True, 7)
        self.m.registro = lambda: None
        self.assertEqual(self.m.carregar("qualquer"), {"rol_procedimento_ans": 7})
        self.assertEqual(len(self.m.AVISOS), 1)

    def test_banco_sem_as_tabelas_do_rol_so_avisa(self):
        self.m.estado = lambda banco: (False, 0)
        self.assertEqual(self.m.carregar("qualquer"), {"rol_procedimento_ans": 0})


if __name__ == "__main__":
    unittest.main()
