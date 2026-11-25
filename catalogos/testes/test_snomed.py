"""Carregador da terminologia clínica (RF2 Snapshot) com amostra SINTÉTICA no formato oficial (TSV UTF-8, cabeçalho na
1ª linha, CRLF). Os códigos das folhas são fictícios; só as raízes de hierarquia são as oficiais.
Roda no host: python3 -I -m unittest discover -s catalogos/testes
Com SGH_SNOMED_BANCO_TESTE=<banco de cliente de teste>, grava a amostra no banco duas vezes (idempotência) e confere
as contagens; sem a variável, esse caso é pulado."""
import importlib.util
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

SNOMED = Path(__file__).resolve().parents[1] / "carregadores/snomed.py"
RAIZ = Path(__file__).resolve().parents[2]


def _snomed():
    esp = importlib.util.spec_from_file_location("carregador_snomed_teste", SNOMED)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


P = "SnomedCT_Sintetico/Snapshot/"
CONCEITOS = [  # id, effectiveTime, active
    ("138875005", "20250101", "1"), ("123037004", "20250101", "1"), ("404684003", "20250101", "1"),
    ("900000101", "20250101", "1"),  # membro superior (região)
    ("900000102", "20250101", "1"),  # mão (localização primária)
    ("900000103", "20250601", "1"),  # dedo (localização)
    ("900000104", "20250601", "1"),  # falange (sublocalização)
    ("900000201", "20250101", "1"),  # achado: fratura de mão
    ("900000202", "20240101", "0"),  # conceito inativo
]
DESCR = [  # id, conceptId, languageCode, typeId, term, preferido_pt
    ("1001", "138875005", "en", "900000000000003001", "SNOMED CT Concept (SNOMED RT+CTV3)", False),
    ("1002", "123037004", "en", "900000000000003001", "Body structure (body structure)", False),
    ("1003", "123037004", "pt", "900000000000013009", "Estrutura do corpo", True),
    ("1004", "404684003", "en", "900000000000003001", "Clinical finding (finding)", False),
    ("1005", "900000101", "en", "900000000000003001", "Upper limb structure (body structure)", False),
    ("1006", "900000101", "pt", "900000000000013009", "Estrutura do membro superior", True),
    ("1007", "900000102", "pt", "900000000000013009", "Estrutura da mão", True),
    ("1008", "900000102", "pt", "900000000000013009", "Mão", False),
    ("1009", "900000103", "en", "900000000000003001", "Finger structure (body structure)", False),
    ("1010", "900000104", "pt", "900000000000013009", "Falange", True),
    ("1011", "900000201", "en", "900000000000003001", "Fracture of hand (disorder)", False),
    ("1012", "900000201", "pt", "900000000000013009", "Fratura da mão", True),
    ("1013", "900000202", "en", "900000000000003001", "Retired concept (disorder)", False),
]
RELS = [  # source, destination, typeId, characteristic, active
    ("123037004", "138875005", "116680003", "900000000000011006", "1"),
    ("404684003", "138875005", "116680003", "900000000000011006", "1"),
    ("900000101", "123037004", "116680003", "900000000000011006", "1"),
    ("900000102", "900000101", "116680003", "900000000000011006", "1"),
    ("900000102", "900000101", "123005000", "900000000000011006", "1"),
    ("900000103", "900000102", "116680003", "900000000000011006", "1"),
    ("900000104", "900000103", "116680003", "900000000000011006", "1"),
    ("900000201", "404684003", "116680003", "900000000000011006", "1"),
    ("900000201", "900000102", "363698007", "900000000000011006", "1"),
    ("900000201", "900000101", "363698007", "900000000000011006", "0"),  # inativa: não entra
    ("900000201", "123037004", "116680003", "900000000000010007", "1"),  # declarada (stated): não entra
    ("900000202", "404684003", "116680003", "900000000000011006", "1"),
]


def _tsv(cab, linhas):
    return ("\r\n".join(["\t".join(cab)] + ["\t".join(ln) for ln in linhas]) + "\r\n").encode("utf-8")


def _zip(caminho):
    with zipfile.ZipFile(caminho, "w") as z:
        z.writestr(P + "Terminology/sct2_Concept_Snapshot_INT_20250601.txt", _tsv(
            ["id", "effectiveTime", "active", "moduleId", "definitionStatusId"],
            [(i, t, a, "900000000000207008", "900000000000074008") for i, t, a in CONCEITOS]))
        z.writestr(P + "Terminology/sct2_Description_Snapshot-pt_INT_20250601.txt", _tsv(
            ["id", "effectiveTime", "active", "moduleId", "conceptId", "languageCode", "typeId", "term",
             "caseSignificanceId"],
            [(i, "20250101", "1", "900000000000207008", c, l, t, termo, "900000000000448009")
             for i, c, l, t, termo, _ in DESCR]))
        z.writestr(P + "Terminology/sct2_Relationship_Snapshot_INT_20250601.txt", _tsv(
            ["id", "effectiveTime", "active", "moduleId", "sourceId", "destinationId", "relationshipGroup", "typeId",
             "characteristicTypeId", "modifierId"],
            [(str(5000 + n), "20250101", a, "900000000000207008", o, d, "0", t, c, "900000000000451002")
             for n, (o, d, t, c, a) in enumerate(RELS)]))
        z.writestr(P + "Refset/Language/der2_cRefset_LanguageSnapshot-pt_INT_20250601.txt", _tsv(
            ["id", "effectiveTime", "active", "moduleId", "refsetId", "referencedComponentId", "acceptabilityId"],
            [(f"r{i}", "20250101", "1", "900000000000207008", "5000000000", i,
              "900000000000548007" if pref else "900000000000549004") for i, _, _, _, _, pref in DESCR]))


class LeituraRf2(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _snomed()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.zip = Path(cls.tmp.name) / "SnomedCT_Sintetico.zip"
        _zip(cls.zip)
        cls.m = cls.mod.ler_pacotes([cls.zip])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_versao_e_conceitos(self):
        self.assertEqual(self.m["versao"], "20250601")
        self.assertEqual(len(self.m["termos"]), 9)
        self.assertFalse(self.m["termos"]["900000202"]["ativo"])
        self.assertEqual(self.mod.data_rf2("20250601"), "2025-06-01")

    def test_descricao_preferida_pt_depois_fsn_sem_etiqueta(self):
        t = self.m["termos"]
        self.assertEqual(t["900000102"]["descricao"], "Estrutura da mão")  # preferido, não o sinônimo aceitável
        self.assertEqual(t["900000103"]["descricao"], "Finger structure")  # só FSN: sem a etiqueta semântica
        self.assertEqual(t["900000103"]["completa"], "Finger structure (body structure)")
        self.assertEqual(t["900000201"]["descricao"], "Fratura da mão")

    def test_hierarquia_superior_e_nivel(self):
        t = self.m["termos"]
        self.assertIsNone(t["138875005"]["superior"])
        self.assertEqual(t["138875005"]["nivel"], 0)
        self.assertEqual(t["900000104"]["superior"], "900000103")
        self.assertEqual(t["900000104"]["nivel"], 5)
        self.assertEqual(t["900000201"]["superior"], "404684003")  # a relação declarada não conta

    def test_relacoes_so_ativas_e_inferidas(self):
        r = set(self.m["relacoes"])
        self.assertIn(("900000201", "900000102", "localizacao"), r)
        self.assertIn(("900000102", "900000101", "parte_de"), r)
        self.assertNotIn(("900000201", "900000101", "localizacao"), r)
        self.assertNotIn(("900000201", "123037004", "e_um"), r)
        self.assertEqual(len(r), 10)

    def test_regioes_da_estrutura_do_corpo(self):
        reg = {r["codigo"]: r for r in self.m["regioes"]}
        self.assertEqual(sorted(reg), ["900000101", "900000102", "900000103", "900000104"])
        self.assertEqual([self.mod.nivel_regiao(reg[c]["profundidade"]) for c in sorted(reg)],
                         ["regiao", "localizacao_primaria", "localizacao", "sublocalizacao"])
        self.assertIsNone(reg["900000101"]["superior"])
        self.assertEqual(reg["900000104"]["superior"], "900000103")
        self.assertEqual([r["profundidade"] for r in self.m["regioes"]], [1, 2, 3, 4])  # de cima para baixo

    def test_sem_pacote_avisa_e_nao_grava(self):
        mod = _snomed()
        mod.PASTA = Path(self.tmp.name) / "inexistente"
        self.assertEqual(mod.carregar("banco_que_nao_e_tocado"), {})
        self.assertEqual(len(mod.AVISOS), 1)

    @unittest.skipUnless(os.environ.get("SGH_SNOMED_BANCO_TESTE"), "sem banco de teste")
    def test_grava_no_banco_e_idempotente(self):
        banco = os.environ["SGH_SNOMED_BANCO_TESTE"]
        r1 = self.mod.gravar(banco, self.m, "0" * 64)
        r2 = self.mod.gravar(banco, self.m, "0" * 64)
        self.assertEqual(r1, r2)
        q = ("SELECT (SELECT COUNT(*) FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id "
             "WHERE g.codigo = 'snomed' AND t.codigo_termo LIKE '9000002%' AND t.ativo = 1), "
             "(SELECT COUNT(*) FROM regiao_anatomica_codificada WHERE sistema_codificacao = 'snomed' "
             "AND codigo_anatomico LIKE '9000001%'), "
             "(SELECT COUNT(*) FROM regiao_anatomica_codificada f JOIN regiao_anatomica_codificada s "
             "ON s.id = f.regiao_superior_id WHERE f.codigo_anatomico = '900000104' AND s.codigo_anatomico = '900000103'), "
             "(SELECT situacao_carga FROM terminologia_edicao e JOIN terminologia g ON g.id = e.terminologia_id "
             "WHERE g.codigo = 'snomed' AND e.versao_edicao = '20250601')")
        saida = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, "-N", "-B", "-e", q], capture_output=True,
                               text=True, check=True).stdout.split()
        self.assertEqual(saida, ["1", "4", "1", "carregada"])


if __name__ == "__main__":
    unittest.main()
