"""Fatia L7-01 (SADT e suprimentos, módulo SADT): declarações, plano da carga dirigida pelo mapa e regras das colunas.
Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L7-01`)."""
import csv
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_01

FATIA = ["PRHEMOTLAN", "SHCLIENT", "SHCONDUTA", "SHESTFINAL", "SHEXAME", "SHINTER", "SHDOACAO", "SHLOCAL", "SHMOTDEV",
         "SHMOV", "SHPARAM", "SHPERGUN", "SHREACAO", "SHREQUISICAO", "SHBOLSA", "SHRESPOSTA", "SHTPTRANSF",
         "SIASSLAUDO_IMPRESSAO", "SICADATE_EXCLUSAO", "SICOLETE"]
CARREGADAS = {"SHCONDUTA": "conduta_reacao_transfusional", "SHESTFINAL": "destino_final_bolsa",
              "SHEXAME": "tipo_teste_imuno_hematologico",
              "SHREACAO": "tipo_reacao_transfusional", "SHMOTDEV": "motivo_devolucao_bolsa",
              "SHMOV": "tipo_movimento_bolsa", "SHPERGUN": "pergunta_triagem_doador", "SHTPTRANSF": "tipo_transfusao",
              "SICADATE_EXCLUSAO": "trilha_auditoria", "SICOLETE": "dispositivo_coleta"}
BLOQUEADAS = set(FATIA) - set(CARREGADAS)


def _decl():
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L7-01.tsv", encoding="utf-8") as f:
        return list(f)


class L701(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_so_as_carregaveis_entram_com_o_destino_certo(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_bloqueadas_tem_motivo_registrado(self):
        linhas = _decl()
        for t in BLOQUEADAS:
            self.assertTrue(any(l.startswith("#--- %s: bloqueada: " % t) for l in linhas), t)

    def test_literais_e_presumidos(self):
        # nada presumido que mexa no estoque: sem fonte, a linha é recusada (NOT NULL sem padrão) até o de-para
        self.assertNotIn("situacao_bolsa", self.cols("SHESTFINAL"))
        self.assertNotIn("natureza", self.cols("SHMOV"))
        self.assertEqual(self.cols("SHPERGUN")["tipo_resposta"]["coluna"], "=~sim_nao")
        self.assertEqual(self.cols("SHREACAO")["natureza"]["coluna"], "=~imunologica")
        self.assertEqual(self.cols("SHREACAO")["tempo_ocorrencia"]["coluna"], "=~imediata")
        self.assertEqual(self.cols("SHMOTDEV")["tipo"]["coluna"], "=~devolucao")
        sexo = self.cols("SHPERGUN")["sexo_aplicavel"]
        self.assertEqual((sexo["depara"], sexo["valores"]), ("valores", {"": ""}))
        c = self.cols("SICADATE_EXCLUSAO")
        self.assertEqual(c["acao"]["coluna"], "=exclusao")
        self.assertEqual(c["entidade"]["coluna"], "=requisicao_exame")

    def test_exclusao_vira_trilha_com_a_chave_e_sem_usuario_presumido(self):
        c = self.cols("SICADATE_EXCLUSAO")
        self.assertNotIn("usuario_id", c)  # USUARIO é o da requisição copiada, não quem excluiu
        self.assertEqual(c["ocorrido_em"]["regra"], "data_hora")
        self.assertEqual((c["correlacao"]["coluna"], c["correlacao"]["regra"]), ("ID_SICADATE", "flutuante"))
        self.assertEqual(carga_mapa.tipar(sentinela.aplicar("flutuante", 101.0)[0], "varchar"), "101.0")
        self.assertNotIn("entidade_id", c)

    def test_intercorrencia_da_doacao_fora_do_catalogo_de_reacoes(self):
        self.assertNotIn("SHINTER", self.plano)
        self.assertTrue(any(l.startswith("#--- SHINTER: bloqueada: ") for l in _decl()))

    def test_regras_das_colunas(self):
        c = self.cols("SHEXAME")
        for d in ("aplica_doador", "aplica_bolsa", "aplica_pre_transfusional"):
            self.assertEqual(c[d]["regra"], "booleano_sn")
        self.assertEqual(c["ordem"]["regra"], "inteiro_nao_negativo")
        self.assertEqual(self.cols("SICOLETE")["ativo"]["regra"], "booleano_ai")
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("inteiro_nao_negativo", -1)[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto", "  Hidratar   exemplo  ")[0], "Hidratar   exemplo")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Programada   exemplo ")[0], "Programada exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])

    def test_declaracoes_com_motivo_e_so_da_fatia(self):
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t") if not r["tabela"].startswith("#")]
        for r in rows:
            self.assertIn(r["tabela"], CARREGADAS)
            self.assertTrue(r["motivo"].startswith("L7-01: "))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l7_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(e["gravados"] + recusas, lidas.count(t), t)
        self.assertEqual(l7_01.PAIS_EXTERNOS, {})


if __name__ == "__main__":
    unittest.main()
