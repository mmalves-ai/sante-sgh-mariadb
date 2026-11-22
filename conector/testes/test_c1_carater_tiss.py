"""Grupo 1 da liberação da ProntoCardio (C1 a C4), com dados sintéticos (nenhum valor da cópia real).

C1: caráter do atendimento vazio ou 0 não recusa o atendimento (melhor estimativa pela categoria, com pendência) e a
    conciliação nunca dá conferido quando tudo foi recusado; o catálogo oficial TISS 23 vem do carregador tiss.
C2: efeito de C1 (a ficha e a alta entram com o atendimento): coberto pela ausência de recusa em C1.
C3: conselho profissional (TISS 26) carregado pelo carregador oficial: teste em catalogos/testes/test_tiss.py.
C4: idade máxima da especialidade com a marca de "sem limite" (0 ou acima de 130) vira NULL com pendência, em vez de
    recusar a linha pelo CHECK ck_especialidade_medica_idade (idade <= 130).
"""
import unittest
from pathlib import Path

from sante_conector import carga, sentinela

class CaraterDoAtendimento(unittest.TestCase):
    def test_vazio_e_zero_estimados_pela_categoria_com_pendencia(self):
        self.assertEqual(carga.carater_do_atendimento(None, "U"), ("2", "carater_estimado"))
        self.assertEqual(carga.carater_do_atendimento(0, "U"), ("2", "carater_estimado"))
        for cat in ("A", "I", "E"):
            self.assertEqual(carga.carater_do_atendimento(None, cat), ("1", "carater_estimado"))
            self.assertEqual(carga.carater_do_atendimento(0, cat), ("1", "carater_estimado"))

    def test_informado_vale_como_veio_e_fora_do_dominio_tem_pendencia_propria(self):
        self.assertEqual(carga.carater_do_atendimento(1, "U"), ("1", None))
        self.assertEqual(carga.carater_do_atendimento(2, "A"), ("2", None))
        self.assertEqual(carga.carater_do_atendimento(7, "A"), ("1", "carater_fora_do_dominio"))

    def test_nenhum_caso_fica_sem_codigo_do_catalogo_23(self):
        for v in (None, 0, 1, 2, 3, -1):
            for cat in ("A", "I", "E", "U", ""):
                self.assertIn(carga.carater_do_atendimento(v, cat)[0], {"1", "2"})


class Conciliacao(unittest.TestCase):
    def test_tudo_recusado_nunca_e_conferido(self):
        # o caso medido: 3.986 lidos, 0 gravados, 3.986 recusados, somas vazias iguais
        self.assertFalse(carga.conciliacao_conferida(3986, 3986, 0, 3986, 0, 0))

    def test_parte_recusada_com_somas_iguais_continua_conferida(self):
        self.assertTrue(carga.conciliacao_conferida(10, 10, 7, 3, 123, 123))
        self.assertTrue(carga.conciliacao_conferida(0, 0, 0, 0, 0, 0))  # tabela vazia na origem
        self.assertFalse(carga.conciliacao_conferida(10, 10, 7, 2, 123, 123))
        self.assertFalse(carga.conciliacao_conferida(10, 10, 7, 3, 123, 124))


class IdadeSemLimite(unittest.TestCase):
    R = "idade_maxima_sem_limite:130"

    def test_marca_de_sem_limite_vira_nulo_com_pendencia(self):
        self.assertTrue(sentinela.regra_conhecida(self.R))
        for v in (0, 131, 150, 999, 9999):
            self.assertEqual(sentinela.aplicar(self.R, v), (None, "idade_sem_limite"))

    def test_idade_valida_fica_e_invalida_vira_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar(self.R, 80), (80, None))
        self.assertEqual(sentinela.aplicar(self.R, 130), (130, None))
        self.assertEqual(sentinela.aplicar(self.R, -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar(self.R, None), (None, None))

    def test_saida_sempre_cabe_no_check_do_destino(self):
        for v in range(-5, 1200):
            x = sentinela.aplicar(self.R, v)[0]
            self.assertTrue(x is None or 0 < x <= 130)
            y = sentinela.aplicar("inteiro_faixa:0,130", v)[0]
            self.assertTrue(y is None or 0 <= y <= 130)

    def test_declaracao_da_especialidade_usa_as_regras(self):
        tsv = Path(__file__).resolve().parents[1] / "mapa/declarado/colunas.d/L5-06.tsv"
        if not tsv.exists():
            tsv = Path("/app/mapa/declarado/colunas.d/L5-06.tsv")
        regras = {l.split("\t")[1]: l.split("\t")[3] for l in tsv.read_text(encoding="utf-8").splitlines()
                  if l.startswith("TBESPEC\tIDADE_")}
        self.assertEqual(regras, {"IDADE_INICIAL": "inteiro_faixa:0,130", "IDADE_FINAL": self.R})


if __name__ == "__main__":
    unittest.main()
