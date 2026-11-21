"""Fatia L6-01 (recepção, módulo REC): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-01`.
"""
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_01

FATIA = set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS)


class PlanoL601(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_declaradas_entram_na_carga(self):
        self.assertEqual(len(FATIA), 19)
        self.assertEqual(len(l6_01.CARREGADAS), 8)
        self.assertEqual(set(self.plano), set(l6_01.CARREGADAS))

    def test_ordem_do_mapa(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        self.assertEqual(ordem, ["PNTIPO", "RETPINDATEND", "TBACAOFLUXOSENHA", "TBCADGRUPOATEN",
                                 "TBGRUPOPRIORIDADE", "TBMODULO_RECEPCAO", "TBMOTEXC", "TBPROCED"])

    def test_um_destino_por_tabela_carregada(self):
        esperado = {"PNTIPO": "tipo_painel", "RETPINDATEND": "tipo_indicacao",
                    "TBACAOFLUXOSENHA": "acao_fluxo_senha", "TBCADGRUPOATEN": "grupo_atendimento",
                    "TBGRUPOPRIORIDADE": "grupo_prioridade_legal", "TBMODULO_RECEPCAO": "modulo_recepcao",
                    "TBMOTEXC": "motivo_cancelamento_operacao", "TBPROCED": "procedencia"}
        for t, dt in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_codigos_numericos_viram_texto(self):
        for t, dt, col in [("PNTIPO", "tipo_painel", "ID"),
                           ("RETPINDATEND", "tipo_indicacao", "ID"), ("TBACAOFLUXOSENHA", "acao_fluxo_senha", "ID"),
                           ("TBCADGRUPOATEN", "grupo_atendimento", "ID"),
                           ("TBGRUPOPRIORIDADE", "grupo_prioridade_legal", "ID"),
                           ("TBMODULO_RECEPCAO", "modulo_recepcao", "ID"),
                           ("TBMOTEXC", "motivo_cancelamento_operacao", "COD"), ("TBPROCED", "procedencia", "COD")]:
            c = self.cols(t, dt)["codigo"]
            self.assertEqual((c["coluna"], c["regra"]), (col, "texto"), t)

    def test_classificacao_sem_fonte_e_presumida(self):
        # a origem não classifica: literal presumido (pendência valor_presumido), nunca literal firme
        for t, dt, dc in [("PNTIPO", "tipo_painel", "finalidade"), ("RETPINDATEND", "tipo_indicacao", "categoria"),
                          ("TBACAOFLUXOSENHA", "acao_fluxo_senha", "encerra_senha")]:
            self.assertTrue(self.cols(t, dt)[dc]["coluna"].startswith("=~"), (t, dc))
        self.assertEqual(self.cols("PNTIPO", "tipo_painel")["finalidade"]["coluna"], "=~outro")

    def test_encerra_senha_presumido_ate_o_depara_da_sigla(self):
        # sem a sigla, 'não tira da fila' é presumido (valor_presumido por linha), nunca literal firme
        self.assertEqual(self.cols("TBACAOFLUXOSENHA", "acao_fluxo_senha")["encerra_senha"]["coluna"], "=~0")

    def test_modelo_so_entra_com_a_chave_composta(self):
        # codigo=COD provisório não se desfaz depois da primeira carga (linha recusada com hash igual nunca regrava):
        # o modelo fica sem carga até a coluna especial '@chave'
        self.assertNotIn("REMODFIC", self.plano)
        decl = [c for c in self.m["colunas_decl"] if c["tabela"] == "REMODFIC"]
        self.assertTrue(decl)
        self.assertTrue(all("'@chave'" in c["motivo"] for c in decl))

    def test_nada_de_destino_oficial_nem_referencia(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t, p in self.plano.items():
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)
            for dt in p["destinos"]:
                self.assertFalse([c for c in p["colunas"][dt] if c["referencia"]], t)

    def test_nao_carregadas_tem_motivo(self):
        decl = {}
        for c in self.m["colunas_decl"]:
            decl.setdefault(c["tabela"], []).append(c)
        for t in l6_01.NAO_CARREGADAS:
            self.assertTrue(decl.get(t), t)
            for c in decl[t]:
                self.assertEqual(c.get("destino") or "", "", t)
                self.assertTrue((c.get("motivo") or "").startswith("L6-01:"), t)


class RegrasL601(unittest.TestCase):
    def test_zero_e_sem_valor(self):
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 12), (12, None))

    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Painel  de   senhas".encode("cp1252"))[0], "Painel de senhas")
        self.assertEqual(sentinela.aplicar("texto_nome", b"  "), (None, None))

    def test_texto_preserva_quebra_interna(self):
        v, _ = sentinela.aplicar("texto", "  Encaminhar\r\npara outro guichê ".encode("cp1252"))
        self.assertEqual(v, "Encaminhar\r\npara outro guichê")

    def test_sn_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_codigo_numerico_como_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))


class ImagemL601(unittest.TestCase):
    def test_esperado_cobre_so_as_carregadas(self):
        linhas = []
        esp = l6_01.linhas(__import__("random").Random(1), lambda t, v: linhas.append(t))
        self.assertEqual(set(esp), set(l6_01.CARREGADAS))
        self.assertEqual(set(linhas), set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS))

    def test_ddl_tem_as_19_tabelas(self):
        criadas = {x.split()[2] for x in l6_01.DDL.split(";") if x.strip().startswith("CREATE TABLE")}
        self.assertEqual(criadas, set(l6_01.CARREGADAS) | set(l6_01.NAO_CARREGADAS))
