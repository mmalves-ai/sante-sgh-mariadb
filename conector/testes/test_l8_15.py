"""Fatia L8-15 (faturamento e restantes, módulo SGO): declarações planejadas, literais e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-15`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_15

TABELAS = set(l8_15.CARREGADAS)
FORA = set(l8_15.NAO_CARREGADAS)
# tabelas cujo destino recebe códigos de várias origens: código = prefixo de domínio + chave, adoção pela descrição
POR_PREFIXO = {"PSTIPMEN": "origem_cobranca_plano", "PSTIPOGUIA": "tipo_guia_plano",
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
        self.assertEqual(self.plano["PSBENEFI"]["destinos"], ["beneficiario_plano"])
        self.assertEqual(self.plano["PSVENDAS"]["destinos"], ["proposta_adesao"])

    def test_codigo_com_prefixo_e_adocao_onde_o_destino_e_compartilhado(self):
        prefixos = set()
        for t, d in POR_PREFIXO.items():
            cs = self.cols(t, d)
            self.assertTrue(cs["codigo"]["coluna"].startswith("#codigo_derivado:"), t)
            prefixos.add(cs["codigo"]["coluna"].split(":")[3])
            self.assertEqual(cs["descricao"]["coluna"], "NOME", t)
            self.assertEqual(self.plano[t]["opcoes"][d].get("adotar"), ["descricao"], t)
        self.assertEqual(len(prefixos), len(POR_PREFIXO))  # um prefixo de domínio por origem
        self.assertEqual(carga_mapa.codigo_derivado("3", 30, "periodo_"), ("periodo_3", False))
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

    def test_descartadas_com_causa_de_produto(self):
        # cobertura total: toda tabela fora da carga tem descarte com causa aceita e motivo (declarado/sem_carga.tsv)
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        causas = {"TBTPFAVORECIDO": "catalogo_oficial", "TBTPFORMAREAJ": "catalogo_oficial",
                  "TBTPVIGCONTRATO": "catalogo_oficial", "PSTPSVIGENCIA": "catalogo_oficial",
                  "PSBENCPL": "duplicado"}
        self.assertNotIn("PSVENDAS", sc)
        # o descarte como catálogo oficial é coerente com declarado/catalogos.tsv
        cat = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/catalogos.tsv")}
        self.assertTrue({t for t, c in causas.items() if c == "catalogo_oficial"} <= cat)
        self.assertEqual(set(causas), FORA)
        for t, causa in causas.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"], t)

    def test_beneficiario_nunca_sem_contrato_plano_e_pessoa(self):
        cs = self.cols("PSBENEFI", "beneficiario_plano")
        decl = {c["destino"]: (c["coluna"], c.get("via")) for c in self.mapa["colunas_decl"]
                if c["tabela"] == "PSBENEFI" and c.get("destino")}
        self.assertEqual(decl["beneficiario_plano.contrato_plano_id"], ("EMP", "ref:PSEMPBEN"))
        self.assertEqual(decl["beneficiario_plano.plano_comercializado_id"], ("PLANO", "ref:PSPLANOS"))
        self.assertEqual(decl["beneficiario_plano.pessoa_fisica_id"], ("CPF", "ref:TBPESSOA.CPF_CNPJ"))
        # obrigatórias do destino todas com fonte; situação presumida, nunca afirmada
        for c in ("tipo", "matricula", "data_adesao", "inicio_vigencia"):
            self.assertIn(c, cs)
        self.assertEqual((cs["situacao"]["coluna"], cs["situacao"]["depara"]), ("STATUS", "valores"))
        self.assertEqual((cs["tipo"]["coluna"], cs["tipo"]["depara"]), ("DEP", "valores"))
        self.assertEqual(decl["beneficiario_plano.titular_beneficiario_plano_id"],
                         ("ID_PSBENEFI_VINCULO", "ref:PSBENEFI.ID"))
        self.assertEqual(cs["fim_vigencia"]["coluna"], "FIM_VIG")
        # nenhuma coluna do destino com duas origens (PSBENCPL é descarte; a venda só em PSVENDAS)
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENCPL" and c.get("destino")])

    def test_situacao_e_tipo_pela_evidencia_nunca_ativo_presumido(self):
        pares = {}
        for v in self.mapa["valores"]:
            if v["tabela"] == "PSBENEFI":
                pares.setdefault(v["coluna"], {})[v["valor_origem"]] = v["valor_destino"]
        self.assertEqual(pares["DEP"]["0"], "titular")
        self.assertEqual({pares["DEP"][str(i)] for i in range(1, 100)}, {"dependente"})
        st = pares["STATUS"]
        self.assertEqual([k for k, x in st.items() if x == "ativo"], ["A"])
        self.assertEqual(st[""], "suspenso")  # nulo nunca vira o padrão 'ativo' do destino
        self.assertNotIn("excluido", st.values())  # excluído exige motivo e data, sem fonte na origem
        self.assertEqual(len(st), 1 + 26 * 2 + 10)  # todo código de 1 caractere tem par: nada cai no padrão

    def test_venda_vira_proposta_efetivada_com_plano_e_contrato_do_beneficiario(self):
        cs = self.cols("PSVENDAS", "proposta_adesao")
        self.assertEqual(cs["situacao"]["coluna"], "=efetivada")
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        decl = {c["destino"]: c.get("via") for c in self.mapa["colunas_decl"] if c["tabela"] == "PSVENDAS"
                and c.get("destino")}
        self.assertEqual(decl["proposta_adesao.plano_comercializado_id"], "ref:PSBENEFI>PLANO>PSPLANOS")
        self.assertEqual(decl["proposta_adesao.contrato_plano_id"], "ref:PSBENEFI>EMP>PSEMPBEN")

    def test_modelo_de_email_entra_inativo(self):
        cs = self.cols("TBTPEMAILPLS", "modelo_comunicacao_beneficiario")
        self.assertEqual(cs["ativo"]["coluna"], "=0")
        self.assertEqual(cs["canal"]["coluna"], "=email")
        self.assertTrue(cs["corpo"]["coluna"].startswith("=~"))

    def test_descartadas_sem_destino(self):
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
