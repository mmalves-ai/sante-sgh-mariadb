"""Fatia L8-14 (faturamento e restantes, módulo SGO): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-14`."""
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_14

NA_IMAGEM = set(re.findall(r"CREATE TABLE (\w+) \(", l8_14.DDL))
TABELAS = NA_IMAGEM - set(l8_14.NAO_CARREGADAS)
DESTINOS = {
    "CDTPDESPCTAPGCM": "classe_despesa_assistencial", "CDTPEMISSAO": "forma_emissao_documento",
    "CDTPEVTCTAREC": "tipo_lancamento_fatura", "CDTPFRANQUIA": "tipo_franquia", "CDTPGUIA": "tipo_guia_plano",
    "CDTPLANCAMEN": "tipo_lancamento_fatura", "CDTPMOVVALOR": "tipo_movimentacao_valor",
    "CDTPPERIODO": "unidade_prazo", "CDVENDATPREP": "papel_venda", "PFPORTALOPCAO": "funcao_portal_prestador",
    "PFTPATEND": "tipo_prestador_rede", "PSCOPARTTPGUIAQNDO": "condicao_cobranca_coparticipacao",
    "PSCRITICA": "critica_autorizacao", "PSDOCIMPNOMESOCIAL": "documento_emitido_operadora",
    "PSFORNEMEMSIT": "situacao_fornecimento", "PSMOTIVO": "motivo_movimento_cadastral",
    "PSNATUREZAPS": "natureza_prestador_rede", "PSORIGEMCOBR": "origem_cobranca_plano",
    "PSORIGEMGUIA": "origem_guia_plano"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "classe_despesa_assistencial": {"codigo", "descricao", "nivel"},
    "forma_emissao_documento": {"codigo", "descricao", "canal"},
    "tipo_lancamento_fatura": {"codigo", "descricao", "natureza"},
    "tipo_franquia": {"codigo", "descricao", "base_calculo"},
    "unidade_prazo": {"codigo", "descricao", "unidade_base"},
    "funcao_portal_prestador": {"codigo", "descricao", "grupo"},
    "critica_autorizacao": {"codigo", "descricao", "classe"},
    "documento_emitido_operadora": {"codigo", "descricao", "tipo_documento"},
    "motivo_movimento_cadastral": {"codigo", "descricao", "tipo_movimento"},
    "origem_cobranca_plano": {"codigo", "descricao", "natureza"},
    "origem_guia_plano": {"codigo", "descricao", "canal"}}
NOME_COMO_CODIGO = ("CDTPLANCAMEN", "PSMOTIVO", "PSORIGEMCOBR", "PSORIGEMGUIA")
PRESUMIDOS = {
    "CDTPEMISSAO": {"canal": "=~impresso"}, "CDTPEVTCTAREC": {"natureza": "=~debito"},
    "CDTPLANCAMEN": {"natureza": "=~debito"}, "CDTPFRANQUIA": {"base_calculo": "=~evento"},
    "CDTPPERIODO": {"unidade_base": "=~dia"}, "PFPORTALOPCAO": {"grupo": "=~consulta"},
    "PSCRITICA": {"classe": "=~outra"}, "PSDOCIMPNOMESOCIAL": {"tipo_documento": "=~outro"},
    "PSORIGEMCOBR": {"natureza": "=~outra"}, "PSORIGEMGUIA": {"canal": "=~outro"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}
        cls.decl = [c for c in cls.mapa["colunas_decl"] if c["tabela"] in NA_IMAGEM]

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in list(DESTINOS.items()) + list(l8_14.SEM_BENEFICIARIO.items()):
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_sem_beneficiario_lidas_e_recusadas(self):
        # nunca saem do plano em silêncio: entram, e o NOT NULL do beneficiário (não declarado) recusa com pendência
        for t, dt in l8_14.SEM_BENEFICIARIO.items():
            cols = {c["destino"] for c in self.plano[t]["colunas"][dt]}
            self.assertNotIn("beneficiario_plano_id", cols, t)
            self.assertNotIn("contrato_plano_id", cols, t)
        self.assertEqual({c["destino"]: c["coluna"] for c in self.plano["PSATVASS"]["colunas"][
            "movimento_cadastral_beneficiario"]}["canal"], "=migracao")

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS.get(dt, {"codigo", "descricao"}) <= set(self.cols(t)), t)

    def test_toda_coluna_da_origem_declarada_com_motivo(self):
        por = {}
        for c in self.decl:
            por.setdefault(c["tabela"], set()).add(c["coluna"])
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
        for t in NA_IMAGEM:
            self.assertTrue({n for n, _, _ in l8_14.colunas(t)} <= por[t], t)

    def test_nao_carregadas_sem_destino(self):
        for c in self.decl:
            if c["tabela"] in l8_14.NAO_CARREGADAS:
                self.assertFalse(c["destino"], (c["tabela"], c["coluna"]))

    def test_codigo_e_descricao(self):
        for t in DESTINOS:
            c = self.cols(t)
            self.assertEqual(c["descricao"]["regra"], "texto_nome", t)
            if t not in NOME_COMO_CODIGO:
                self.assertEqual(c["codigo"]["regra"], "texto", t)
        # destino já gravado antes com a chave inteira como código: o código é o nome até o prefixo (pedido 1)
        for t in NOME_COMO_CODIGO:
            self.assertEqual(self.cols(t)["codigo"]["coluna"], "NOME", t)
            self.assertEqual(self.cols(t)["codigo"]["regra"], "texto_nome", t)

    def test_nome_social_pela_pertenca(self):
        self.assertEqual(self.cols("PSDOCIMPNOMESOCIAL")["imprime_nome_social"]["coluna"], "=1")

    def test_presumidos_e_literais(self):
        for t, cols in PRESUMIDOS.items():
            c = self.cols(t)
            for d, lit in cols.items():
                self.assertEqual(c[d]["coluna"], lit, (t, d))
        self.assertEqual(self.cols("PSMOTIVO")["tipo_movimento"]["coluna"], "=exclusao")
        # classificação plana: só 'grupo' dispensa a classe superior (CHECK de hierarquia do destino)
        self.assertEqual(self.cols("CDTPDESPCTAPGCM")["nivel"]["coluna"], "=grupo")
        self.assertEqual(self.cols("PSCRITICA")["extra_contrato"]["regra"], "booleano_sn")


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", "  Cartão   exemplo ".encode("cp1252")), ("Cartão exemplo", None))
        self.assertEqual(a("texto_nome", "   ".encode("cp1252")), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))

    def test_literais_tipados_no_destino(self):
        self.assertEqual(carga_mapa.tipar("1", "tinyint"), 1)
        self.assertEqual(carga_mapa.tipar(7, "varchar"), "7")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_14.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        decl = mapa.carregar_execucao()["colunas_decl"]
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
            presumidas = sum(1 for c in decl if c["tabela"] == t and c["destino"] and c["coluna"].startswith("=~"))
            self.assertEqual(e["pendencias"].get("valor_presumido", 0), cont[t] * presumidas, t)
        for t in l8_14.NAO_CARREGADAS:
            self.assertEqual(cont[t], 2, t)

    def test_linhas_com_o_numero_de_colunas_do_ddl(self):
        def conferir(t, v):
            self.assertEqual(len(v), len(l8_14.colunas(t)), t)
        l8_14.linhas(random.Random(1), conferir)

    def test_ddl_so_das_tabelas_da_fatia(self):
        self.assertEqual(len(NA_IMAGEM), 23)
        self.assertEqual(set(l8_14.NAO_CARREGADAS) | set(DESTINOS) | set(l8_14.SEM_BENEFICIARIO), NA_IMAGEM)


if __name__ == "__main__":
    unittest.main()
