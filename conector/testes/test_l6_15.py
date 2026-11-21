"""Fatia L6-15 (internação, módulo INT): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-15`.
"""
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_15

FATIA = set(l6_15.CARREGADAS) | set(l6_15.NAO_CARREGADAS)


class PlanoL615(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_carregaveis_entram_na_carga(self):
        self.assertEqual(len(FATIA), 16)
        self.assertEqual(set(self.plano), set(l6_15.CARREGADAS))

    def test_ordem_do_mapa(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        self.assertEqual(ordem, ["TBDESFECHO_INTERNACAO", "TBMOTALT", "TBREGUL_SISTEMA", "TBREGUL_SERVICO",
                                 "TBTIPOACOMOD", "TBTISSREGINT", "RELOCLEITO", "RELEITO", "REOCUPLEITO"])

    def test_destinos(self):
        esperado = {"TBDESFECHO_INTERNACAO": ["desfecho_internacao"], "TBMOTALT": ["motivo_saida_hospitalar"],
                    "TBREGUL_SISTEMA": ["central_reguladora", "sistema_externo"],
                    "TBREGUL_SERVICO": ["servico_regulacao"], "TBTIPOACOMOD": ["categoria_acomodacao"],
                    "TBTISSREGINT": ["regime_atendimento_internacao"], "RELOCLEITO": ["local_observacao"],
                    "RELEITO": ["leito_observacao"], "REOCUPLEITO": ["ocupacao_leito_observacao"]}
        for t, dts in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_referencias_pelo_conector_origem(self):
        for t, dt, dc, ref in [("TBREGUL_SERVICO", "servico_regulacao", "central_reguladora_id", "TBREGUL_SISTEMA"),
                               ("RELOCLEITO", "local_observacao", "centro_custo_id", "TBCENCUS"),
                               ("RELEITO", "leito_observacao", "local_observacao_id", "RELOCLEITO"),
                               ("RELEITO", "leito_observacao", "tipo_leito_observacao_id", "RETPLEITO"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "atendimento_id", "RECADATE"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "leito_observacao_id", "RELEITO")]:
            self.assertEqual(self.cols(t, dt)[dc]["referencia"], ref, (t, dc))

    def test_estabelecimento_nunca_fixo(self):
        for t, dt in [("TBREGUL_SERVICO", "servico_regulacao"), ("RELOCLEITO", "local_observacao"),
                      ("RELEITO", "leito_observacao"), ("REOCUPLEITO", "ocupacao_leito_observacao")]:
            self.assertEqual(self.cols(t, dt)["estabelecimento_id"]["coluna"], "@estabelecimento", t)

    def test_classificacao_sem_fonte_e_presumida(self):
        for t, dt, dc, lit in [("TBDESFECHO_INTERNACAO", "desfecho_internacao", "obito", "=~0"),
                               ("TBMOTALT", "motivo_saida_hospitalar", "tipo_saida", "=~alta"),
                               ("TBREGUL_SISTEMA", "central_reguladora", "esfera", "=~estadual"),
                               ("TBREGUL_SERVICO", "servico_regulacao", "tipo", "=~internacao"),
                               ("TBTIPOACOMOD", "categoria_acomodacao", "tipo", "=~outro")]:
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit, (t, dc))
        self.assertEqual(self.cols("TBREGUL_SISTEMA", "sistema_externo")["categoria"]["coluna"], "=regulacao")

    def test_destino_com_padrao_significativo_e_presumido_nunca_silencioso(self):
        # sexo, finalidade, situação e ativo têm padrão no destino: sem de-para, o literal presumido marca cada linha
        for t, dt, dc, lit in [("RELOCLEITO", "local_observacao", "sexo_permitido", "=~qualquer"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "finalidade", "=~observacao"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "situacao", "=~ativa"),
                               ("TBMOTALT", "motivo_saida_hospitalar", "ativo", "=~1")]:
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit, (t, dc))

    def test_literais_presumidos_depois_das_referencias(self):
        # pai_pendente recusa antes dos literais: a contagem de valor_presumido da imagem depende desta ordem
        nomes = [c["coluna"] for c in self.plano["REOCUPLEITO"]["colunas"]["ocupacao_leito_observacao"]]
        self.assertGreater(nomes.index("=~observacao"), nomes.index("ID_RELEITO"))
        self.assertGreater(nomes.index("=~ativa"), nomes.index("ID_RELEITO"))

    def test_regras_de_data_e_texto(self):
        c = self.cols("REOCUPLEITO", "ocupacao_leito_observacao")
        self.assertEqual(c["data_hora_entrada"]["regra"], "data_hora")
        self.assertEqual(c["data_hora_saida"]["regra"], "data_hora")
        self.assertEqual(c["justificativa"]["regra"], "texto_longo")
        r = self.cols("TBTISSREGINT", "regime_atendimento_internacao")
        self.assertEqual((r["vigencia_inicio"]["regra"], r["vigencia_fim"]["regra"]), ("data", "data"))
        self.assertNotIn("codigo_tiss", r)  # o código TISS não é presumido a partir da chave da origem

    def test_nada_de_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)

    def test_nao_carregadas_tem_motivo(self):
        decl = {}
        for c in self.m["colunas_decl"]:
            decl.setdefault(c["tabela"], []).append(c)
        for t in l6_15.NAO_CARREGADAS:
            self.assertTrue(decl.get(t), t)
            for c in decl[t]:
                self.assertEqual(c.get("destino") or "", "", t)
                self.assertTrue((c.get("motivo") or "").startswith("L6-15: não carregada"), t)


class RegrasL615(unittest.TestCase):
    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Alta  melhorada".encode("cp1252"))[0], "Alta melhorada")
        self.assertEqual(sentinela.aplicar("texto_nome", b"   "), (None, None))

    def test_sn_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "N"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_data_sentinela(self):
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30))[1], "data_sentinela")
        self.assertEqual(sentinela.aplicar("data", datetime.date(2020, 1, 1)), (datetime.date(2020, 1, 1), None))

    def test_data_hora_com_data_sentinela(self):
        v, p = sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30, 10, 0))
        self.assertEqual((v, p), (None, "hora_sem_data"))

    def test_saida_sentinela_vira_nulo_com_pendencia(self):
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30, 15, 30)),
                         (None, "hora_sem_data"))

    def test_texto_longo_preserva_quebra_e_espacos(self):
        v, _ = sentinela.aplicar("texto_longo", "Observação\r\n  pós-medicação  ".encode("cp1252"))
        self.assertEqual(v, "Observação\r\n  pós-medicação  ")


class ImagemL615(unittest.TestCase):
    def test_esperado_cobre_so_as_carregadas(self):
        lidas = []
        esp = l6_15.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(l6_15.CARREGADAS))
        self.assertEqual(set(lidas), FATIA)

    def test_ddl_tem_as_16_tabelas(self):
        criadas = {x.split()[2] for x in l6_15.DDL.split(";") if x.strip().startswith("CREATE TABLE")}
        self.assertEqual(criadas, FATIA)
