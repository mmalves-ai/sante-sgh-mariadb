"""Fatia L8-09 (faturamento e restantes, módulo FIN): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-09`."""
import datetime
import os
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_09

TABELAS = set(l8_09.CARREGADAS)
FORA = set(l8_09.BLOQUEADAS) | set(l8_09.DESCARTADAS)
RAIZ = os.path.join(os.path.dirname(__file__), "..", "mapa", "declarado")


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | FORA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        # exportacao_custo (arquivo gerado) não vem do grupo de exportação
        self.assertEqual(self.plano["CTWGRUPOEXPORTACAO"]["destinos"], ["grupo_exportacao_custo"])
        # parâmetros da contabilidade e do custeio por usuário: contexto de trabalho (não parâmetro do estabelecimento)
        for t in ("COPARAM", "CTPARAM", "FPPARAM_USUARIO"):
            self.assertEqual(self.plano[t]["destinos"], ["contexto_trabalho_usuario"], t)

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("COPERIODESCRIT", "periodo_escrituracao"): {"estabelecimento_id", "descricao", "forma",
                                                               "vigencia_inicio"},
                 ("COTP_ORIGEM_LANCAMENTO", "origem_lancamento_contabil"): {"codigo", "descricao", "modulo"},
                 ("CTCTARECEITANCI", "conta_receita_custeio"): {"codigo", "descricao", "grupo"},
                 ("CTTIPODADO", "tipo_dado_estatistico"): {"codigo", "descricao", "unidade_medida"},
                 ("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo"): {"codigo", "nome", "destino"},
                 ("FPPARAM_USUARIO", "contexto_trabalho_usuario"): {"usuario_id", "modulo", "estabelecimento_id",
                                                                     "competencia"},
                 ("COPARAM", "contexto_trabalho_usuario"): {"usuario_id", "modulo", "estabelecimento_id", "competencia"},
                 ("CTPARAM", "contexto_trabalho_usuario"): {"usuario_id", "modulo", "estabelecimento_id", "competencia"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_estabelecimento_unico(self):
        self.assertEqual(self.cols("COPERIODESCRIT", "periodo_escrituracao")["estabelecimento_id"]["coluna"],
                         "@estabelecimento")

    def test_literais_presumidos(self):
        esperado = {("COPERIODESCRIT", "periodo_escrituracao", "forma"): "=~mensal",
                    ("CTCTARECEITANCI", "conta_receita_custeio", "grupo"): "=~outro",
                    ("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo", "destino"): "=~outro"}
        for (t, dt, dc), lit in esperado.items():
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit, (t, dc))
        self.assertTrue(self.cols("CTTIPODADO", "tipo_dado_estatistico")["unidade_medida"]["coluna"].startswith("=~"))

    def test_origem_de_lancamento_pelo_de_para_da_descricao(self):
        # módulo, automático e digitação vêm do MESMO de-para da descrição (nada presumido): só 'manual' aceita
        # digitação e não é automático; sem par, o módulo recusa e os booleanos ficam no padrão seguro do DDL
        cs = self.cols("COTP_ORIGEM_LANCAMENTO", "origem_lancamento_contabil")
        mod, aut, man = (cs[k]["valores"] for k in ("modulo", "automatico", "permite_lancamento_manual"))
        self.assertTrue(mod and set(mod) == set(aut) == set(man))
        self.assertTrue(all(c["coluna"] == "DESCRICAO" and c["depara"] == "valores"
                            for k, c in cs.items() if k in ("modulo", "automatico", "permite_lancamento_manual")))
        for d, m in mod.items():
            self.assertIn(m, {"financeiro", "faturamento", "estoque", "folha", "patrimonio", "custos", "tributario",
                              "contabil", "manual"}, d)
            self.assertEqual((aut[d], man[d]), ("0", "1") if m == "manual" else ("1", "0"), d)
        self.assertEqual(mod["Folha"], "folha")
        self.assertNotIn("Integração antiga exemplo", mod)

    def test_bloqueadas_com_declaracao_pronta_comentada(self):
        # emitido_em e ocorrido_em DATETIME(3) com DATE da origem divergiriam a soma: declaração só comentada
        for t in l8_09.BLOQUEADAS:
            self.assertNotIn(t, self.plano)
        with open(os.path.join(RAIZ, "colunas.d", "L8-09.tsv"), encoding="utf-8") as f:
            coment = [l.rstrip("\n").split("\t") for l in f if l.startswith("#") and "\t" in l]
        destinos = {(c[0][1:], c[2]) for c in coment}
        for dc in ("recibo.emitido_em", "recibo.valor_extenso", "recibo.pagador_nome", "recibo.referente",
                   "recibo.estabelecimento_id", "recibo.numero", "recibo.tipo", "recibo.valor", "recibo.origem",
                   "recibo.profissional_id", "recibo.vias_impressas", "recibo.situacao"):
            self.assertIn(("FCRECIBO", dc), destinos)
        # toda coluna NOT NULL sem padrão de situacao_especial_empresa (inclusive data_evento)
        for dc in ("estabelecimento_id", "situacao", "data_evento", "vigencia_inicio", "operacao", "ocorrido_em"):
            self.assertIn(("COSPEDHSTSEMP", "situacao_especial_empresa." + dc), destinos)
        self.assertTrue(all("DATE em DATETIME" in c[-1] for c in coment))
        # toda coluna da origem do recibo e do histórico declarada (aproveitada ou com motivo)
        for t in l8_09.BLOQUEADAS:
            cols = {c[1] for c in coment if c[0][1:] == t and c[1][:1] not in "=@#"}
            self.assertEqual(len(cols), len(l8_09._TODAS[t]), t)

    def test_descartes_com_causa_de_produto(self):
        with open(os.path.join(RAIZ, "sem_carga.tsv"), encoding="utf-8") as f:
            sc = {l.split("\t")[0]: l.rstrip("\n").split("\t") for l in f}
        for t in l8_09.DESCARTADAS:
            self.assertIn(t, sc)
            self.assertEqual(sc[t][1], "descarte", t)
            self.assertIn(sc[t][2], {"sem_valor", "duplicado", "licenciado", "catalogo_oficial",
                                     "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t][3].strip(), t)
        self.assertEqual(len(l8_09.DESCARTADAS), 12)
        self.assertNotIn("COPARAM", sc)
        self.assertNotIn("CTPARAM", sc)

    def test_contexto_de_trabalho_da_folha(self):
        cs = self.cols("FPPARAM_USUARIO", "contexto_trabalho_usuario")
        self.assertEqual(cs["competencia"]["coluna"], "#data:ANO,MES")
        self.assertEqual(cs["modulo"]["coluna"], "=folha")
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(cs["usuario_id"]["referencia"], "TBUSERS")
        for t, m in (("FPPARAM_USUARIO", "=folha"), ("COPARAM", "=contabil"), ("CTPARAM", "=custos")):
            c = self.cols(t, "contexto_trabalho_usuario")
            self.assertEqual(c["modulo"]["coluna"], m, t)
            self.assertEqual(c["competencia"]["coluna"], "#data:ANO,MES", t)
            self.assertEqual(self.plano[t]["opcoes"]["contexto_trabalho_usuario"]["adotar"], ["usuario_id", "modulo"], t)
        c = self.cols("COPARAM", "contexto_trabalho_usuario")
        self.assertEqual((c["periodo_inicio"]["coluna"], c["periodo_fim"]["coluna"]), ("PERLANC_INI", "PERLANC_FIM"))
        self.assertEqual(carga_mapa.data_composta(2025, 3), (datetime.date(2025, 3, 1), None))
        self.assertEqual(carga_mapa.data_composta(2025, 13), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(None, 3), (None, None))

    def test_ativo_do_grupo_de_exportacao(self):
        self.assertEqual(self.cols("CTWGRUPOEXPORTACAO", "grupo_exportacao_custo")["ativo"]["regra"], "booleano_ai")

    def test_fora_da_carga_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & FORA)

    def test_toda_coluna_da_fatia_declarada(self):
        decl = {(c["tabela"], c["coluna"]) for c in self.mapa["colunas_decl"]
                if c["tabela"] in TABELAS}
        for t in TABELAS:
            formas = l8_09._TODAS[t]
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
        for t in FORA:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], {"FCRECIBO": 13, "COSPEDSITEMP": 3, "COSPEDHSTSEMP": 4}.get(t, 2), t)
        # bloqueadas: o esperado previsto fecha com as linhas (para quando a regra de data e hora entrar)
        for t, e in (("FCRECIBO", l8_09.PREVISTO_FCRECIBO), ("COSPEDHSTSEMP", l8_09.PREVISTO_COSPEDHSTSEMP)):
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_"))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_09.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | FORA)
        self.assertEqual(len(criadas), 22)

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {t: len(f) for t, f in l8_09._TODAS.items()}
        lidas = {}
        l8_09.linhas(random.Random(1), lambda t, v: lidas.setdefault(t, set()).add(len(v)))
        for t, ns in lidas.items():
            self.assertEqual(ns, {ncols[t]}, t)


if __name__ == "__main__":
    unittest.main()
