"""Contrato de efeito da base de doses e interações (03-PEP L108, C2-104) no MariaDB, com dados SINTÉTICOS.

Roda o SQL que o carregador manda ao espelho num banco de teste (o desenho é o mesmo do cliente), dentro de uma
transação desfeita no fim: nada fica no banco. Prova o que a carga deixa: limite e interação com a edição, o par na
ordem do id, o cadastro próprio do hospital intocado, a linha sem princípio ativo contada e a edição nova com
--completa inativando (sem apagar) o que saiu da base.

uso: BANCO_TESTE=cliente_f22_o4 python3 -I catalogos/licenciados/test_dose_interacao_banco.py
"""
import importlib.util
import os
import subprocess
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
spec = importlib.util.spec_from_file_location("carregar_licenciado", AQUI / "carregar.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
BANCO = os.environ.get("BANCO_TESTE", "cliente_f22_o4")

PREPARO = """START TRANSACTION;
INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES
  ('SINT001', 'Princípio sintético 1', 'SINT', UTC_TIMESTAMP(3)), ('SINT002', 'Princípio sintético 2', 'SINT', UTC_TIMESTAMP(3)),
  ('SINT003', 'Princípio sintético 3', 'SINT', UTC_TIMESTAMP(3));
INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES ('SINT-MG', 'Miligrama sintético', 'smg', UTC_TIMESTAMP(3));
INSERT INTO via_de_uso (codigo, descricao, criado_em) VALUES ('SINT-VO', 'Oral sintética', UTC_TIMESTAMP(3)),
  ('SINT-EV', 'Endovenosa sintética', UTC_TIMESTAMP(3));
INSERT INTO gravidade_interacao (codigo, descricao, nivel, ativo, criado_em) VALUES ('moderada', 'Moderada', 2, TRUE, UTC_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE id = id;
INSERT INTO interacao_medicamentosa (principio_ativo_id, interagente_principio_ativo_id, gravidade_interacao_id, efeito, ativo, criado_em)
SELECT a.id, b.id, (SELECT id FROM gravidade_interacao WHERE codigo = 'moderada'), 'Cadastro próprio do hospital', TRUE, UTC_TIMESTAMP(3)
FROM principio_ativo a JOIN principio_ativo b ON a.codigo_dcb = 'SINT001' AND b.codigo_dcb = 'SINT003';"""

PROVA = """SELECT 'p', CONCAT_WS('|', l.codigo_base, l.edicao_base, l.ativo, l.versao, l.periodo, l.por_peso, l.dose_maxima_alerta,
  IF(l.via_de_uso_id IS NULL, '-', 'via'))
FROM limite_dose_principio l WHERE l.codigo_base LIKE 'SINT-%' ORDER BY l.codigo_base;
SELECT 'i', CONCAT_WS('|', a.codigo_dcb, b.codigo_dcb, g.codigo, COALESCE(i.edicao_base, 'hospital'), i.efeito)
FROM interacao_medicamentosa i JOIN principio_ativo a ON a.id = i.principio_ativo_id
  JOIN principio_ativo b ON b.id = i.interagente_principio_ativo_id JOIN gravidade_interacao g ON g.id = i.gravidade_interacao_id
WHERE a.codigo_dcb LIKE 'SINT%' ORDER BY a.codigo_dcb, b.codigo_dcb;
SELECT 'g', COUNT(*) FROM gravidade_interacao WHERE codigo IN ('leve', 'moderada', 'grave', 'contraindicada');"""


def rodar(texto):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), BANCO, "-N", "-B"], input=texto, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stderr[-600:])
    return [ln.split("\t") for ln in r.stdout.splitlines() if ln]


class TestContratoBanco(unittest.TestCase):
    def test_carga_da_base_no_banco(self):
        dose, _, _ = mod.ler(AQUI / "sintetico/base_dose_ed1.csv", "dose")
        inter, _, _ = mod.ler(AQUI / "sintetico/base_interacao_ed1.csv", "interacao")
        s1, c1 = mod.GERAR["dose"]("base_dose", "Base de doses", "ED1", "2026-01-01", None, dose, False)
        s2, c2 = mod.GERAR["interacao"]("base_interacao", "Base de interações", "ED1", "2026-01-01", None, inter, False)
        d1 = {**dose[0], "dose_maxima_alerta": mod.Decimal("1200")}
        s3, c3 = mod.GERAR["dose"]("base_dose", "Base de doses", "ED2", "2026-06-01", None, [d1], True)
        texto = "\n".join([PREPARO, s1, c1, s2, c2, s1, c1, PROVA, "SELECT 'x', 'ed2';", s3, c3, PROVA, "ROLLBACK;"])
        out = rodar(texto)
        corte = out.index(["x", "ed2"])
        antes, depois = out[:corte], out[corte + 1:]
        cont = [r for r in antes if r[0] in ("limite_dose_principio", "interacao_medicamentosa", "sem_principio_ativo")]
        self.assertEqual(cont, [["limite_dose_principio", "3"], ["sem_principio_ativo", "1"],
                                ["interacao_medicamentosa", "1"], ["sem_principio_ativo", "0"],
                                ["limite_dose_principio", "3"], ["sem_principio_ativo", "1"]])
        lim = [r[1] for r in antes if r[0] == "p"]
        self.assertEqual(lim, ["SINT-D1|ED1|1|2|dose|0|1000.0000|via", "SINT-D2|ED1|1|2|dia|1|60.0000|-",
                               "SINT-D3|ED1|1|2|tratamento|0|via"])
        inter_ = [r[1] for r in antes if r[0] == "i"]
        self.assertEqual(inter_, ["SINT001|SINT002|grave|ED1|Aumento do risco de sangramento (fictício)",
                                  "SINT001|SINT003|moderada|hospital|Cadastro próprio do hospital"])
        self.assertIn(["g", "4"], antes)
        self.assertEqual([r for r in depois if r[0] == "limite_dose_principio"], [["limite_dose_principio", "1"]])
        lim2 = [r[1] for r in depois if r[0] == "p"]
        self.assertEqual(lim2, ["SINT-D1|ED2|1|3|dose|0|1200.0000|via", "SINT-D2|ED1|0|3|dia|1|60.0000|-",
                                "SINT-D3|ED1|0|3|tratamento|0|via"])
        self.assertEqual(rodar("SELECT COUNT(*) FROM limite_dose_principio WHERE codigo_base LIKE 'SINT-%';"), [["0"]])


if __name__ == "__main__":
    unittest.main()
