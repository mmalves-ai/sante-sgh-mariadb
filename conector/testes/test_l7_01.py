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
              "SICADATE_EXCLUSAO": "trilha_auditoria", "SICOLETE": "dispositivo_coleta",
              "PRHEMOTLAN": "hemocomponente", "SHCLIENT": "servico_hemoterapia_fornecedor",
              "SHINTER": "tipo_reacao_transfusional", "SHDOACAO": "doacao_sangue",
              "SHLOCAL": "local_guarda_hemocomponente", "SHRESPOSTA": "grupo_resposta",
              "SHBOLSA": "bolsa_hemocomponente", "SIASSLAUDO_IMPRESSAO": "trilha_auditoria"}
DESCARTADAS = {"SHPARAM": "mecanismo_do_produto", "SHREQUISICAO": "sem_valor"}


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

    def test_cobertura_total_carrega_ou_descarta(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        self.assertEqual(set(CARREGADAS) | set(DESCARTADAS), set(FATIA))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"][0], dt, t)
        self.assertEqual(self.plano["SHRESPOSTA"]["destinos"], ["grupo_resposta", "resposta_padrao"])
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t, causa in DESCARTADAS.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L7-01: "), t)
        self.assertFalse(any(l.startswith("#--- ") for l in _decl()))

    def test_literais_e_presumidos(self):
        # nada presumido que mexa no estoque: situação e natureza pelo de-para do NOME; sem par, recusa visível
        for t, d in (("SHESTFINAL", "situacao_bolsa"), ("SHMOV", "natureza")):
            self.assertEqual(self.cols(t)[d]["depara"], "valores", t)
        self.assertEqual(self.cols("SHESTFINAL")["situacao_bolsa"]["valores"]["DESCARTE"], "descartada")
        self.assertEqual(self.cols("SHMOV")["natureza"]["valores"]["Transfusão"], "transfusao")
        self.assertNotIn("Estranho exemplo", self.cols("SHMOV")["natureza"]["valores"])
        self.assertEqual(self.cols("PRHEMOTLAN")["validade_dias"]["coluna"], "=~1")
        self.assertEqual(self.cols("PRHEMOTLAN")["faturavel"]["coluna"], "=~0")
        self.assertEqual(self.cols("SHLOCAL")["temperatura_minima"]["coluna"], "=~2")
        self.assertEqual(self.cols("SHLOCAL")["temperatura_maxima"]["coluna"], "=~6")
        # situação da bolsa pelo último movimento (nome do tipo, encadeado) e da doação pelo indicador de inaptidão
        sb = self.cols("SHBOLSA")["situacao"]
        self.assertEqual((sb["coluna"], sb["referencia"], sb["depara"]), ("CODMOV", "SHMOV>NOME", "valores"))
        self.assertEqual(sb["valores"]["Devolução"], "devolvida")
        self.assertEqual(sb["valores"]["ENTRADA"], "quarentena")
        self.assertNotIn("Transfusão", sb["valores"])  # transfundida exige data do destino que a bolsa não tem
        d = self.cols("SHDOACAO")
        self.assertEqual((d["situacao"]["valores"]["0"], d["situacao"]["valores"]["1"]), ("coletada", "inapto"))
        self.assertEqual((d["apto"]["valores"]["0"], d["apto"]["valores"]["1"]), ("1", "0"))
        self.assertTrue(d["motivo_inaptidao"]["valores"]["1"])
        bx = self.cols("SHMOV")["baixa_estoque"]["valores"]
        for n, v in (("Transfusão", "1"), ("DESCARTE", "1"), ("Perda", "1"), ("Devolução", "1"), ("ENTRADA", "0"),
                     ("Bloqueio", "0")):
            self.assertEqual(bx[n], v, n)
        for col in ("pesquisa_hemoglobina_s", "sorologia_aprovada"):
            self.assertEqual(self.cols("SHBOLSA")[col]["valores"], {"": ""}, col)
        self.assertEqual(self.cols("SHINTER")["natureza"]["coluna"], "=intercorrencia")
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

    def test_intercorrencia_da_doacao_com_prefixo_de_dominio(self):
        c = self.cols("SHINTER")["codigo"]["coluna"]
        self.assertEqual(c, "#codigo_derivado:CODINTER:30:intercorrencia_")
        self.assertEqual(carga_mapa.codigo_derivado("2", 30, "intercorrencia_"), ("intercorrencia_2", False))

    def test_referencias_declaradas(self):
        b = self.cols("SHBOLSA")
        self.assertEqual(b["hemocomponente_id"]["referencia"], "PRHEMOTLAN.CODALF")
        for d, ref in (("grupo_sanguineo_id", "TBTPSANGUINEO"), ("fator_rh_id", "TBFATORRH"),
                       ("doacao_sangue_id", "SHDOACAO"), ("servico_hemoterapia_fornecedor_id", "SHCLIENT"),
                       ("local_guarda_hemocomponente_id", "SHLOCAL"), ("recebida_por_usuario_id", "TBUSERS")):
            self.assertEqual(b[d]["referencia"], ref, d)
        self.assertEqual(self.cols("SHDOACAO")["doador_pessoa_fisica_id"]["referencia"], "SHDOADOR")
        self.assertEqual(self.cols("SHCLIENT")["empresa_fornecedora_id"]["referencia"], "TBFORNEC.NOME")
        self.assertEqual(self.cols("SIASSLAUDO_IMPRESSAO")["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(self.cols("SIASSLAUDO_IMPRESSAO")["acao"]["coluna"], "=impressao")

    def test_pais_das_referencias_entram_antes(self):
        # ref: declarada sem FK na origem: a aresta em declarado/dependencias.tsv põe o pai antes na ordem
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if (r.get("ordem") or "").isdigit()}
        for filho, pai in (("SHCLIENT", "TBFORNEC"), ("SHDOACAO", "TBTPSANGUINEO"), ("SHDOACAO", "TBFATORRH"),
                           ("SHBOLSA", "TBTPSANGUINEO"), ("SHBOLSA", "TBFATORRH"), ("SHBOLSA", "SHMOV"),
                           ("SHBOLSA", "SHCLIENT"), ("SHBOLSA", "SHDOACAO")):
            self.assertLess(ordem[pai], ordem[filho], (filho, pai))

    def test_opcoes_de_resposta_em_grupo_por_pergunta(self):
        p = self.plano["SHRESPOSTA"]
        self.assertEqual(p["opcoes"]["grupo_resposta"]["adotar"], ["codigo"])
        g = {c["destino"]: c for c in p["colunas"]["grupo_resposta"]}
        self.assertEqual(g["descricao"]["referencia"], "SHPERGUN>DESCRICAO")
        r = {c["destino"]: c["coluna"] for c in p["colunas"]["resposta_padrao"]}
        self.assertEqual((r["grupo_resposta_id"], r["sequencia"]), ("@id", "#seq:COD_PERGUNTA"))

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
            self.assertNotIn(r["tabela"], DESCARTADAS)
            self.assertTrue(r["motivo"].startswith("L7-01: "))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l7_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, lidas.count(t), t)
        self.assertNotIn("TBFORNEC", l7_01.PAIS_EXTERNOS)  # alternativa lê a origem: fornecedor ausente


if __name__ == "__main__":
    unittest.main()
