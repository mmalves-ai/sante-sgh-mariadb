"""Grupo 2 da liberação da ProntoCardio (C5 a C8), com dados sintéticos (nenhum valor da cópia real).

C5: agenda de consultas com a idade final na marca de "sem limite" (999 estourava o TINYINT: 1264) vira NULL com
    idade_sem_limite; a agenda de exames sem profissional tem o setor da unidade como dono (ck_agenda_servico_dono).
C7: a recusa pelo destino registra o metadado do erro (coluna, restrição ou chave), nunca o valor.
C8: o código do município da origem com 6 dígitos (sem o verificador do IBGE) acha o município do catálogo oficial.
"""
import unittest
from pathlib import Path

import pymysql

from sante_conector import carga, sentinela


def _colunas(fatia):
    tsv = Path(__file__).resolve().parents[1] / ("mapa/declarado/colunas.d/%s.tsv" % fatia)
    if not tsv.exists():
        tsv = Path("/app/mapa/declarado/colunas.d/%s.tsv" % fatia)
    return [l.split("\t") for l in tsv.read_text(encoding="utf-8").splitlines() if l and not l.startswith("tabela\t")]


class AgendaIdadeSemLimite(unittest.TestCase):
    def test_idade_final_999_vira_nulo_e_cabe_no_tinyint(self):
        regra = {c[1]: c[3] for c in _colunas("L6-03") if c[0] == "REAGENDA" and c[1].startswith("FX_")}
        self.assertEqual(regra["FX_FIN"], "idade_maxima_sem_limite:130")
        self.assertEqual(sentinela.aplicar(regra["FX_FIN"], 999), (None, "idade_sem_limite"))
        for v in range(0, 1000):
            x = sentinela.aplicar(regra["FX_FIN"], v)[0]
            self.assertTrue(x is None or 0 < x <= 130)  # TINYINT UNSIGNED e ck_agenda_servico_idade

    def test_agenda_de_exame_tem_o_setor_da_unidade_como_dono(self):
        sia = [c for c in _colunas("L6-04") if c[0] == "SIAGENDA"]
        rea = [c for c in _colunas("L6-03") if c[0] == "REAGENDA"]
        destinos = {c[2] for c in sia}
        self.assertIn("agenda_servico.setor_funcional_id", destinos)
        # mesmo código do setor da agenda de consultas: as duas adotam o setor da unidade, sem duplicar
        cod = lambda ls: [(c[1], c[3], c[5]) for c in ls if c[2] == "setor_funcional.codigo"]
        self.assertEqual(cod(sia), cod(rea))


class DetalheDoErro(unittest.TestCase):
    def _e(self, cod, msg):
        return pymysql.err.IntegrityError(cod, msg)

    def test_coluna_e_restricao_sem_valor(self):
        casos = [
            (1048, "Column 'duracao_horario_minutos' cannot be null", "duracao_horario_minutos"),
            (1264, "Out of range value for column 'idade_maxima_anos' at row 1", "idade_maxima_anos"),
            (4025, "CONSTRAINT `ck_regra_repasse_item_valor` failed for `cliente_x`.`regra_repasse_item`",
             "ck_regra_repasse_item_valor"),
            (1062, "Duplicate entry 'VALOR-SECRETO' for key 'uq_plano_fonte_pagadora_fonte_codigo'",
             "uq_plano_fonte_pagadora_fonte_codigo"),
            (1452, "Cannot add or update a child row: a foreign key constraint fails (`c`.`t`, CONSTRAINT `fk_x` "
                   "FOREIGN KEY (`profissional_id`) REFERENCES `profissional` (`id`))", "profissional_id"),
            (1364, "Field 'codigo' doesn't have a default value", "codigo"),
            (1366, "Incorrect integer value: 'VALOR-SECRETO' for column `c`.`t`.`dias_retorno` at row 1", None),
        ]
        for cod, msg, esperado in casos:
            d = carga.detalhe_erro(self._e(cod, msg))
            self.assertEqual(d, esperado, msg)
            self.assertNotIn("SECRETO", d or "")

    def test_por_restricao_agrega_sem_chave(self):
        pend = [("T", "1", "restricao_destino_1048", "critica", "codigo"),
                ("T", "2", "restricao_destino_1048", "critica", "codigo"),
                ("T", "3", "pai_pendente", "critica", None)]
        self.assertEqual(carga.por_restricao(pend), {"T:restricao_destino_1048:codigo": 2})


class MunicipioSeisDigitos(unittest.TestCase):
    POR7 = {"3550308": 10, "3304557": 20}

    def test_seis_digitos_pelo_prefixo_do_catalogo(self):
        por6 = {"355030": 10, "330455": 20}
        self.assertEqual(carga.municipio_ibge("355030", self.POR7, por6), 10)
        self.assertEqual(carga.municipio_ibge("3304557", self.POR7, por6), 20)
        self.assertIsNone(carga.municipio_ibge("999999", self.POR7, por6))
        self.assertIsNone(carga.municipio_ibge("", self.POR7, por6))
        self.assertIsNone(carga.municipio_ibge("12345678", self.POR7, por6))


if __name__ == "__main__":
    unittest.main()
