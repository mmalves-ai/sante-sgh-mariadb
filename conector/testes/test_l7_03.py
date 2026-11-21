"""Fatia L7-03 (SADT e suprimentos, módulo SADT): declarações planejadas, regras das colunas, de-para de valores e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L7-03`."""
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_03

TABELAS = set(l7_03.CARREGADAS)
BLOQUEADAS = set(l7_03.BLOQUEADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        esperado = {"SIPOSRES": ["resposta_padrao"], "SIRECIPI": ["recipiente_coleta"],
                    "SISTATUS_AMOSTRA": ["situacao_amostra"], "SITABELE": ["analito"], "SITABPRO": ["exame"],
                    "SITPEQVMODELO": ["modelo_comunicacao"], "SIWEBCADPERFIL": ["perfil_portal_resultado"],
                    "SIWEBCADPERFIL_SIPACSMODALID": ["perfil_portal_modalidade"],
                    "SIWEBCADPERFIL_TBUSERS": ["perfil_portal_usuario"], "SIWEBPARLAUDO": ["modelo_impressao_laudo"]}
        for t, dts in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_obrigatorias_do_destino_cobertas(self):
        req = {("SIPOSRES", "resposta_padrao"): {"grupo_resposta_id", "sequencia", "codigo", "descricao"},
               ("SIRECIPI", "recipiente_coleta"): {"codigo", "descricao"},
               ("SISTATUS_AMOSTRA", "situacao_amostra"): {"codigo", "descricao"},
               ("SITABELE", "analito"): {"codigo", "nome"},
               ("SITABPRO", "exame"): {"codigo", "sigla", "nome", "tipo_servico"},
               ("SITPEQVMODELO", "modelo_comunicacao"): {"codigo", "descricao", "padrao_mensagem"},
               ("SIWEBCADPERFIL", "perfil_portal_resultado"): {"codigo", "descricao", "publico"},
               ("SIWEBCADPERFIL_SIPACSMODALID", "perfil_portal_modalidade"): {"perfil_portal_resultado_id",
                                                                               "modalidade_imagem_id"},
               ("SIWEBCADPERFIL_TBUSERS", "perfil_portal_usuario"): {"perfil_portal_resultado_id", "usuario_id"},
               ("SIWEBPARLAUDO", "modelo_impressao_laudo"): {"estabelecimento_id", "codigo", "descricao"}}
        for (t, dt), cs in req.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        ref = lambda t, dt, c: self.cols(t, dt)[c]["referencia"]  # noqa: E731
        self.assertEqual(ref("SIPOSRES", "resposta_padrao", "grupo_resposta_id"), "SICTRPSR")
        self.assertEqual(ref("SITABELE", "analito", "metodo_analitico_id"), "SIMETODO")
        self.assertEqual(ref("SITABPRO", "exame", "especialidade_diagnostica_id"), "SIESPEC")
        self.assertEqual(ref("SITABPRO", "exame", "modalidade_imagem_id"), "SIPACSMODALID")
        # sexo: TBSEXO não entra no conector_origem (L3 pelas siglas; adoção pedida no L5-05): não aproveitado
        self.assertNotIn("sexo_id", self.cols("SITABPRO", "exame"))
        self.assertNotIn("TBSEXO", l7_03.PAIS_EXTERNOS)
        self.assertEqual(ref("SIWEBCADPERFIL_TBUSERS", "perfil_portal_usuario", "usuario_id"), "TBUSERS")
        self.assertEqual(ref("SIWEBPARLAUDO", "modelo_impressao_laudo", "setor_diagnostico_id"), "SIMODULO")
        # autorreferência: gravada em duas fases
        self.assertEqual(ref("SISTATUS_AMOSTRA", "situacao_amostra", "situacao_anterior_id"), "SISTATUS_AMOSTRA")
        self.assertIn("SISTATUS_AMOSTRA", self.plano["SISTATUS_AMOSTRA"]["duas_fases"])
        for t in self.plano:
            for dt in self.plano[t]["destinos"]:
                for c in self.plano[t]["colunas"][dt]:
                    if c["destino"].endswith("_id") and c["coluna"][:1] not in "=@":
                        self.assertEqual(c["regra"], "chave_origem", (t, c["destino"]))

    def test_literais_presumidos_e_estabelecimento(self):
        self.assertEqual(self.cols("SIRECIPI", "recipiente_coleta")["tipo"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SITABPRO", "exame")["tipo_servico"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SITPEQVMODELO", "modelo_comunicacao")["padrao_mensagem"]["coluna"],
                         "=~proprietario")
        self.assertEqual(self.cols("SIWEBCADPERFIL", "perfil_portal_resultado")["publico"]["coluna"],
                         "=~medico_externo")
        self.assertEqual(self.cols("SIWEBPARLAUDO", "modelo_impressao_laudo")["estabelecimento_id"]["coluna"],
                         "@estabelecimento")

    def test_codigos_como_texto(self):
        for t, dt in [("SIRECIPI", "recipiente_coleta"), ("SISTATUS_AMOSTRA", "situacao_amostra"),
                      ("SITABELE", "analito"), ("SITABPRO", "exame"), ("SITPEQVMODELO", "modelo_comunicacao"),
                      ("SIWEBCADPERFIL", "perfil_portal_resultado"), ("SIWEBPARLAUDO", "modelo_impressao_laudo"),
                      ("SIPOSRES", "resposta_padrao")]:
            self.assertEqual(self.cols(t, dt)["codigo"]["regra"], "texto", t)
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))

    def test_tipo_resultado_por_valores(self):
        c = self.cols("SITABELE", "analito")["tipo_resultado"]
        self.assertEqual(c["depara"], "valores")
        self.assertEqual(c["valores"], {"S": "numerico", "N": "texto"})

    def test_segredos_e_layout_nunca_migram(self):
        decl = {(c["tabela"], c["coluna"]): c for c in self.mapa["colunas_decl"]}
        for col in ("SENHA_EXPORTACAO", "SENHA_FTP"):
            self.assertEqual(decl[("SITPEQV", col)]["destino"], "")
        self.assertEqual(decl[("SIWEBPARLAUDO", "ARQUIVO_LAUDO")]["destino"], "")

    def test_exame_ativo_tipo_e_sigla(self):
        # inativo nunca entra ativo: ativo=FALSE sem desativado_em é recusado pelo CHECK (pendência por linha)
        ex = self.cols("SITABPRO", "exame")
        self.assertEqual(ex["ativo"]["coluna"], "SITUACAO")
        self.assertEqual(ex["ativo"]["regra"], "booleano_ai")
        self.assertEqual(ex["tipo_resultado"]["coluna"], "=~misto")
        # sigla em chave única sem caixa: codigo_char passa pela detecção de colisão de caixa
        self.assertEqual(ex["sigla"]["regra"], "codigo_char")
        self.assertEqual(sentinela.colisoes_caixa({"VDR": 1, "Vdr": 1, "GLI": 1}), [["VDR", "Vdr"]])
        self.assertEqual(self.plano["SITABELE"]["destinos"], ["analito"])

    def test_analito_titulo_e_limites_zero(self):
        an = self.cols("SITABELE", "analito")
        self.assertEqual(an["resultado_obrigatorio"]["coluna"], "TITULO")
        self.assertEqual(an["resultado_obrigatorio"]["valores"], {"N": "1"})  # S sem par: pendência por linha
        for c in ("limite_minimo_aceito", "limite_maximo_aceito"):
            self.assertEqual(an[c]["regra"], "decimal_zero_nulo")
        self.assertEqual(sentinela.aplicar("decimal_zero_nulo", decimal.Decimal("0.0000")), (None, None))

    def test_bloqueadas_sem_destino(self):
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Hemoglobina   glicada ".encode("cp1252")), ("Hemoglobina glicada", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(a("booleano_sn", b"N"), (False, None))
        self.assertEqual(a("inteiro_nao_negativo", -5)[1], "valor_fora_do_dominio")
        texto = "Jejum de 4 horas.\r\n  Trazer pedido."
        self.assertEqual(a("texto_longo", texto.encode("cp1252")), (texto, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_03.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusam = ("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(recusam))
            if t == "SISTATUS_AMOSTRA":  # pai_pendente da autorreferência sai na fase 2: a linha fica gravada
                recusas -= e["pendencias"]["pai_pendente"]
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_colunas_da_origem(self):
        for t, cols in l7_03.COLUNAS.items():
            self.assertEqual(len(cols), len(set(cols)), t)
        self.assertEqual(set(l7_03.COLUNAS), TABELAS | BLOQUEADAS)


if __name__ == "__main__":
    unittest.main()
