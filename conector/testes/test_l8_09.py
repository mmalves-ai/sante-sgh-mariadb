"""Fatia L8-09 (faturamento e restantes, módulo FIN): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-09`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_09

TABELAS = set(l8_09.CARREGADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l8_09.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        # exportacao_custo (arquivo gerado) não vem do grupo de exportação
        self.assertEqual(self.plano["CTWGRUPOEXPORTACAO"]["destinos"], ["grupo_exportacao_custo"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("COPERIODESCRIT", "periodo_escrituracao"): {"estabelecimento_id", "descricao", "forma",
                                                               "vigencia_inicio"},
                 ("COTP_ORIGEM_LANCAMENTO", "origem_lancamento_contabil"): {"codigo", "descricao", "modulo"},
                 ("CTCTARECEITANCI", "conta_receita_custeio"): {"codigo", "descricao", "grupo"},
                 ("CTTIPODADO", "tipo_dado_estatistico"): {"codigo", "descricao", "unidade_medida"},
                 ("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo"): {"codigo", "nome", "destino"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_estabelecimento_unico(self):
        self.assertEqual(self.cols("COPERIODESCRIT", "periodo_escrituracao")["estabelecimento_id"]["coluna"],
                         "@estabelecimento")

    def test_literais_presumidos(self):
        esperado = {("COPERIODESCRIT", "periodo_escrituracao", "forma"): "=~mensal",
                    ("COTP_ORIGEM_LANCAMENTO", "origem_lancamento_contabil", "modulo"): "=~manual",
                    ("CTCTARECEITANCI", "conta_receita_custeio", "grupo"): "=~outro",
                    ("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo", "destino"): "=~outro"}
        for (t, dt, dc), lit in esperado.items():
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit, (t, dc))
        self.assertTrue(self.cols("CTTIPODADO", "tipo_dado_estatistico")["unidade_medida"]["coluna"].startswith("=~"))

    def test_origem_manual_coerente_com_os_booleanos(self):
        # módulo 'manual' presumido exige automatico FALSE e permite_lancamento_manual TRUE (o padrão do DDL é o oposto)
        cs = self.cols("COTP_ORIGEM_LANCAMENTO", "origem_lancamento_contabil")
        modulo = cs["modulo"]["coluna"].lstrip("=~")
        automatico = cs["automatico"]["coluna"].lstrip("=~")
        manual = cs["permite_lancamento_manual"]["coluna"].lstrip("=~")
        self.assertEqual(modulo == "manual", automatico == "0")
        if modulo == "manual":
            self.assertEqual(manual, "1")

    def test_recibo_bloqueado_ate_a_regra_de_data_e_hora(self):
        # emitido_em DATETIME(3) com DATE da origem divergiria a soma de controle: nada do recibo tem destino ainda
        self.assertNotIn("FCRECIBO", self.plano)
        decl = [c for c in self.mapa["colunas_decl"] if c["tabela"] == "FCRECIBO"]
        self.assertEqual(len(decl), 30)
        self.assertTrue(all(not c["destino"] and "bloqueada" in c["motivo"] for c in decl))

    def test_ativo_do_grupo_de_exportacao(self):
        self.assertEqual(self.cols("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo")["ativo"]["regra"], "booleano_ai")

    def test_fora_da_carga_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l8_09.BLOQUEADAS))

    def test_toda_coluna_da_fatia_declarada(self):
        decl = {(c["tabela"], c["coluna"]) for c in self.mapa["colunas_decl"]
                if c["tabela"] in TABELAS | set(l8_09.BLOQUEADAS)}
        for t, formas in l8_09._TODAS.items():
            n = len([c for (tt, c) in decl if tt == t and c[:1] not in "=@#"])
            self.assertEqual(n, len(formas), t)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Taxas   e serviços "), ("Taxas e serviços", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("texto", "  Faturamento  "), ("Faturamento", None))
        self.assertEqual(a("booleano_ai", "A"), (True, None))
        self.assertEqual(a("booleano_ai", "I"), (False, None))
        self.assertEqual(a("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("cpf", 52998224725), ("52998224725", None))          # fictício, dígito certo
        self.assertEqual(a("cpf", 11222333000181), (None, "documento_invalido"))  # CNPJ fictício na coluna de CPF
        self.assertEqual(a("cpf", 12345678900), (None, "documento_invalido"))
        self.assertEqual(a("data", __import__("datetime").date(1899, 12, 30)), (None, "data_sentinela"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_09.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l8_09.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 13 if t == "FCRECIBO" else 2, t)
        # recibo: o esperado previsto fecha com as 13 linhas (para quando a regra de data e hora entrar)
        e = l8_09.PREVISTO_FCRECIBO
        recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_"))
        self.assertEqual(cont["FCRECIBO"], e["gravados"] + recusas)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_09.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l8_09.BLOQUEADAS))
        self.assertEqual(len(criadas), 22)

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {t: len(f) for t, f in l8_09._TODAS.items()}
        lidas = {}
        l8_09.linhas(random.Random(1), lambda t, v: lidas.setdefault(t, set()).add(len(v)))
        for t, ns in lidas.items():
            self.assertEqual(ns, {ncols[t]}, t)


if __name__ == "__main__":
    unittest.main()
