"""Carregador oficial das terminologias TISS (C1 e C3 do grupo 1 da ProntoCardio), com planilha sintética no formato
da ANS. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import re
import tempfile
import unittest
import zipfile
from pathlib import Path

TISS = Path(__file__).resolve().parents[1] / "carregadores/tiss.py"


def _tiss():
    esp = importlib.util.spec_from_file_location("carregador_tiss_teste", TISS)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def norm_conselho(v):
    """Cópia da normalização do de-para conselho_classe (conector/sante_conector/depara.py, norm_conselho)."""
    s = re.sub(r"[\s.\-]", "", str(v).strip().upper())
    return s if re.fullmatch(r"[A-Z]{2,10}", s) else None


def _xlsx(caminho, abas):
    """Planilha mínima (strings em linha) no formato da ANS: título na linha 4, cabeçalho na 6, termos a partir da 7."""
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    nsr = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    with zipfile.ZipFile(caminho, "w") as z:
        folhas, rels = [], []
        for i, (nome, titulo, linhas) in enumerate(abas, 1):
            folhas.append(f'<sheet name="{nome}" sheetId="{i}" r:id="rId{i}"/>')
            rels.append(f'<Relationship Id="rId{i}" Type="x" Target="worksheets/sheet{i}.xml"/>')
            cab = ["Código do Termo", "Termo", "Data de início de vigência", "Data de fim de vigência"]
            todas = [(4, [titulo]), (6, cab)] + [(7 + j, l) for j, l in enumerate(linhas)]
            xml = "".join(f'<row r="{n}">' + "".join(
                f'<c r="{"ABCD"[k]}{n}" t="inlineStr"><is><t>{v}</t></is></c>' if not isinstance(v, int) else
                f'<c r="{"ABCD"[k]}{n}"><v>{v}</v></c>' for k, v in enumerate(l)) + "</row>" for n, l in todas)
            z.writestr(f"xl/worksheets/sheet{i}.xml", f"<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>")
        z.writestr("xl/workbook.xml", f"<workbook {ns} {nsr}><sheets>{''.join(folhas)}</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
                   'relationships">' + "".join(rels) + "</Relationships>")


class CarregadorTiss(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arq = Path(self.tmp.name) / "demais.xlsx"
        _xlsx(self.arq, [
            ("Capa", "Padrão TISS", []),
            ("Tab 23", "Tabela 23 - Terminologia de caráter do atendimento",
             [["1", "Eletivo", 41192, ""], ["2", "Urgência/Emergência", 41192, ""]]),
            ("Tab 26", "Tabela 26 - Terminologia de conselho profissional",
             [["06", "Conselho Regional de Medicina (CRM)", 41192, ""], ["10", "Outros Conselhos ", 41192, ""],
              ["11", "Conselho Regional de Biologia (CRBio)", 44409, ""], ["", "linha sem código", "", ""]]),
            ("Tab 61", "Tabela 61 - Terminologia de via de acesso",
             [["1", "Única", 41192, ""], ["2", "Mesma via", 41192, ""], ["3", "Diferentes vias", 41192, ""]]),
            ("Tab 69", "Tabela 69 - Terminologia de versão do componente de comunicação do padrão TISS",
             [["022", "03.05.00", 43924, ""], ["027", "04.03.00", 46000, ""], ["028", "versão sem forma", 46000, ""]]),
        ])
        self.mod = _tiss()
        self.mod.AVISOS.clear()

    def tearDown(self):
        self.tmp.cleanup()

    def test_le_as_tabelas_de_dominio_com_vigencia(self):
        tab, avisos = self.mod.ler(self.arq)
        self.assertEqual(sorted(tab), ["23", "26", "61", "69"])
        self.assertEqual(tab["23"]["termos"][1], ("2", "Urgência/Emergência", "2012-10-10", None))
        self.assertEqual(tab["23"]["nome"], "Terminologia de caráter do atendimento")
        self.assertEqual(len(tab["26"]["termos"]), 3)
        self.assertEqual(len(avisos), 1)  # a linha sem código, pelo número da linha (nunca o conteúdo)

    def test_siglas_dos_conselhos_casam_com_o_de_para(self):
        tab, _ = self.mod.ler(self.arq)
        siglas = {c: self.mod.sigla_conselho(c, d) for c, d, _, _ in tab["26"]["termos"]}
        self.assertEqual(siglas, {"06": "CRM", "10": "OUTROS", "11": "CRBIO"})
        for s in siglas.values():  # o de-para conselho_classe (L5-04) procura pela sigla normalizada
            self.assertEqual(norm_conselho(s.lower()), s)

    def test_sql_alimenta_terminologia_carater_e_conselho_sem_duplicar(self):
        tab, _ = self.mod.ler(self.arq)
        sql = self.mod.gerar_sql(tab, "202609", "0" * 64)
        self.assertIn("INSERT INTO carater_atendimento_tiss", sql)
        self.assertIn("('2', 'Urgência/Emergência', '2012-10-10', NULL, '202609', TRUE", sql)
        self.assertIn("('1', 'Eletivo', '2012-10-10', NULL, '202609', FALSE", sql)
        self.assertIn("INSERT INTO conselho_classe", sql)
        self.assertIn("'06', 'CRM'", sql)
        self.assertEqual(sql.count("ON DUPLICATE KEY UPDATE"), sql.count("INSERT INTO"))
        self.assertIn("'dominio_tiss'", sql)

    def test_carater_da_admissao_com_os_codigos_do_de_para(self):
        tab, _ = self.mod.ler(self.arq)
        sql = self.mod.gerar_sql(tab, "202609", "0" * 64)
        self.assertIn("INSERT INTO carater_admissao", sql)
        self.assertIn("('eletiva', 'Eletivo', TRUE, '1', FALSE", sql)
        self.assertIn("('urgencia', 'Urgência/Emergência', TRUE, '2', TRUE", sql)

    def test_via_de_acesso_pelo_codigo_tiss(self):
        tab, _ = self.mod.ler(self.arq)
        sql = self.mod.gerar_sql(tab, "202609", "0" * 64)
        self.assertIn("INSERT INTO via_acesso_cirurgico", sql)
        for v in ("('unica', 'Única', TRUE, '1', '202609'", "('mesma_via', 'Mesma via', TRUE, '2'",
                  "('diferentes_vias', 'Diferentes vias', TRUE, '3'"):
            self.assertIn(v, sql)

    def test_versoes_do_padrao_na_forma_do_de_para(self):
        tab, _ = self.mod.ler(self.arq)
        sql = self.mod.gerar_sql(tab, "202609", "0" * 64)
        self.assertIn("INSERT INTO versao_padrao_tiss", sql)
        self.assertIn("('3.05.00', 'troca', 'Padrão TISS versão 3.05.00', '2020-04-03', NULL, '202609', TRUE", sql)
        self.assertIn("('4.03.00', 'troca'", sql)
        self.assertNotIn("sem forma", sql.split("INSERT INTO versao_padrao_tiss")[1])
        self.assertEqual(len([a for a in self.mod.AVISOS if a.startswith("tabela 69")]), 1)
        self.assertEqual(sql.count("ON DUPLICATE KEY UPDATE"), sql.count("INSERT INTO"))


if __name__ == "__main__":
    unittest.main()
