"""Fatia L8-15 (faturamento e restantes, módulo SGO): declarações planejadas, literais e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-15`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_15

TABELAS = set(l8_15.CARREGADAS)
FORA = set(l8_15.NAO_CARREGADAS)
# tabelas cujo destino já recebe a chave inteira como código de outra tabela anterior: código = nome (pedido 1)
POR_NOME = {"PSTIPMEN": "origem_cobranca_plano", "PSTIPOGUIA": "tipo_guia_plano",
            "PSTPACUMULPOR": "nivel_acumulo_limite", "PSTPPERIODO": "unidade_prazo",
            "TBTIPOCOBRANCASGO": "origem_cobranca_plano", "TBTPPRESTADOR": "tipo_prestador_rede",
            "TBTPUNIDTEMPO": "unidade_prazo"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | FORA)}

    def cols(self, t, d):
        return {c["destino"]: c for c in self.plano[t]["colunas"][d]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t in TABELAS:
            self.assertEqual(len(self.plano[t]["destinos"]), 1, t)

    def test_codigo_pelo_nome_onde_o_destino_e_compartilhado(self):
        for t, d in POR_NOME.items():
            cs = self.cols(t, d)
            self.assertEqual(cs["codigo"]["coluna"], "NOME", t)
            self.assertEqual(cs["descricao"]["coluna"], "NOME", t)
        cs = self.cols("TBENVCOBEMAIL", "preferencia_envio_cobranca")
        self.assertEqual(cs["codigo"]["coluna"], "ID")

    def test_literais(self):
        self.assertEqual(self.cols("PSTIPMEN", "origem_cobranca_plano")["natureza"]["coluna"], "=~mensalidade")
        self.assertEqual(self.cols("TBTIPOCOBRANCASGO", "origem_cobranca_plano")["natureza"]["coluna"], "=~outra")
        self.assertEqual(self.cols("PSTPPERIODO", "unidade_prazo")["aplica_limite"]["coluna"], "=1")
        self.assertEqual(self.cols("TBTPUNIDTEMPO", "unidade_prazo")["aplica_contrato"]["coluna"], "=1")

    def test_canal_de_cobranca_presumido_no_valor_seguro(self):
        # a opção de NÃO enviar também é linha desta tabela: nunca presumir um canal que dispara envio
        self.assertEqual(self.cols("TBENVCOBEMAIL", "preferencia_envio_cobranca")["canal"]["coluna"], "=~nenhum")

    def test_comportamento_sem_origem_sempre_presumido(self):
        # colunas que mudam o comportamento nunca ficam com o padrão do destino em silêncio
        esperado = {("PSTIPOGUIA", "tipo_guia_plano", "internacao"): "=~0",
                    ("PSTIPOGUIA", "tipo_guia_plano", "exige_autorizacao"): "=~1",
                    ("TBSTATUSCREPLS", "situacao_movimento_rede", "comunica_ans"): "=~0",
                    ("TBSTATUSCREPLS", "situacao_movimento_rede", "ativa_prestador"): "=~0",
                    ("TBTPCONTRATOCREPLS", "tipo_contrato_rede", "contratacao_direta"): "=~1"}
        for (t, d, c), lit in esperado.items():
            self.assertEqual(self.cols(t, d)[c]["coluna"], lit, (t, c))

    def test_classificacao_heterogenea_nunca_literal_fixo(self):
        # natureza, unidade e canal variam por linha na origem: só presumido (=~), nunca literal definido
        for t, d, c in (("PSTIPMEN", "origem_cobranca_plano", "natureza"),
                        ("TBTIPOCOBRANCASGO", "origem_cobranca_plano", "natureza"),
                        ("PSTPPERIODO", "unidade_prazo", "unidade_base"),
                        ("TBTPUNIDTEMPO", "unidade_prazo", "unidade_base"),
                        ("TBREGIMEATEND", "regime_atendimento_rede", "natureza")):
            self.assertTrue(self.cols(t, d)[c]["coluna"].startswith("=~"), (t, c))

    def test_fora_da_carga_aparece_na_conciliacao(self):
        # tabela do mapa com destino e sem coluna declarada nunca some sem rastro (pedido 5, regra tabela_bloqueada)
        f = getattr(carga_mapa, "tabelas_bloqueadas", None)
        if f is None:
            self.skipTest("regra genérica tabela_bloqueada ainda não aplicada no motor (pedido 5 em saida/L8-15.json)")
        self.assertTrue(FORA <= set(f(self.mapa, TABELAS | FORA)))

    def test_modelo_de_email_entra_inativo(self):
        cs = self.cols("TBTPEMAILPLS", "modelo_comunicacao_beneficiario")
        self.assertEqual(cs["ativo"]["coluna"], "=0")
        self.assertEqual(cs["canal"]["coluna"], "=email")
        self.assertTrue(cs["corpo"]["coluna"].startswith("=~"))

    def test_fora_da_carga_sem_destino(self):
        decl = [c for c in self.mapa["colunas_decl"] if c["tabela"] in FORA]
        self.assertTrue(decl)
        self.assertFalse([c for c in decl if c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Taxa  adesão exemplo ".encode("cp1252")), ("Taxa adesão exemplo", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", b"  Presencial  exemplo "), ("Presencial  exemplo", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_15.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(FORA <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        vistos = []
        l8_15.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(l8_15.colunas(t)), t)


if __name__ == "__main__":
    unittest.main()
