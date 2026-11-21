"""Fatia L7-05 (SADT e suprimentos, módulo SUP): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L7-05`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_05

TABELAS = set(l7_05.CARREGADAS)
# fase 2 (autorreferência do local de estoque): a linha fica gravada, a pendência não é recusa
FASE2 = {"GELOCARM"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l7_05.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["GELOCARM"]["destinos"], ["local_estoque"])
        self.assertEqual(self.plano["GEKITRAS"]["destinos"], ["kit_rastreavel"])
        self.assertEqual(self.plano["GECAPELAMP_GEGRUPOMP"]["destinos"], ["capela_manipulacao_grupo"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("GECAPELAMP", "capela_manipulacao"): {"estabelecimento_id", "codigo", "nome"},
                 ("GEGRUPOMP", "grupo_manipulacao"): {"codigo", "descricao"},
                 ("GECAPELAMP_GEGRUPOMP", "capela_manipulacao_grupo"): {"capela_manipulacao_id",
                                                                        "grupo_manipulacao_id"},
                 ("GEGRUPOS", "grupo_insumo"): {"codigo", "descricao", "natureza"},
                 ("GEITEACAODOSE", "acao_dose"): {"codigo", "descricao"},
                 ("GEKITS", "kit_material"): {"estabelecimento_id", "codigo", "nome"},
                 ("GELOCARM", "local_estoque"): {"estabelecimento_id", "codigo", "nome", "tipo"},
                 ("GEKITRAS", "kit_rastreavel"): {"estabelecimento_id", "codigo", "nome", "local_estoque_id"},
                 ("GEDESCOM", "destino_entrega_compra"): {"estabelecimento_id", "codigo", "descricao"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        k = self.cols("GEKITRAS", "kit_rastreavel")
        self.assertEqual(k["local_estoque_id"]["referencia"], "GELOCARM")
        self.assertEqual(k["kit_material_id"]["referencia"], "GEKITS")
        self.assertEqual((k["criado_por"]["regra"], k["criado_por"]["referencia"]), ("chave_origem", "TBUSERS"))
        self.assertEqual(self.cols("GELOCARM", "local_estoque")["origem_local_estoque_id"]["referencia"], "GELOCARM")
        a = self.cols("GECAPELAMP_GEGRUPOMP", "capela_manipulacao_grupo")
        self.assertEqual((a["capela_manipulacao_id"]["referencia"], a["grupo_manipulacao_id"]["referencia"]),
                         ("GECAPELAMP", "GEGRUPOMP"))
        for t, dt in [("GECAPELAMP", "capela_manipulacao"), ("GEKITS", "kit_material"),
                      ("GELOCARM", "local_estoque"), ("GEKITRAS", "kit_rastreavel")]:
            self.assertEqual(self.cols(t, dt)["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_uf_pelo_catalogo_oficial(self):
        self.assertEqual(self.cols("GEDESCOM", "destino_entrega_compra")["unidade_federativa_id"]["depara"], "ibge_uf")

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("GEGRUPOS", "grupo_insumo")["natureza"]["coluna"], "=~outro")
        self.assertEqual(self.cols("GELOCARM", "local_estoque")["tipo"]["coluna"], "=~outro")
        # ação da dose: sem de-para, notifica e bloqueia entram presumidos (pendência por linha), nunca em silêncio
        a = self.cols("GEITEACAODOSE", "acao_dose")
        self.assertEqual((a["notifica"]["coluna"], a["bloqueia"]["coluna"]), ("=~0", "=~0"))

    def test_situacao_da_capela_por_de_para(self):
        c = self.cols("GECAPELAMP", "capela_manipulacao")["situacao"]
        self.assertEqual((c["coluna"], c["depara"]), ("FUNCIONAMENTO", "valores"))
        self.assertEqual(c["valores"], {"S": "disponivel", "N": "inativa"})

    def test_prazo_do_grupo_nao_recusa_fora_da_faixa(self):
        # negativo ou acima do CHECK (365) vira NULL com pendência; o grupo (pai NOT NULL do insumo) é gravado
        self.assertEqual(self.cols("GEGRUPOS", "grupo_insumo")["prazo_entrega_dias"]["regra"], "inteiro_faixa:0,365")

    def test_cep_e_cnpj_inteiros_com_zeros_a_esquerda(self):
        # integração L7: regra genérica de zeros à esquerda e de documento (dígito verificador)
        c = self.cols("GEDESCOM", "destino_entrega_compra")
        self.assertEqual(c["cep"]["regra"], "inteiro_zeros_esquerda:8")
        self.assertEqual(c["cnpj"]["regra"], "cnpj")

    def test_bloqueadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l7_05.BLOQUEADAS))


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Almoxarifado   central "), ("Almoxarifado central", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_01", 1), (True, None))
        self.assertEqual(a("booleano_01", 7), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(a("inteiro_zero_nulo", 12345), (12345, None))
        self.assertEqual(a("inteiro_nao_negativo", -5), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", 0), (0, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_05.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            pref = ("restricao_destino_",) if t in FASE2 else ("restricao_destino_", "pai_pendente")
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(pref))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l7_05.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l7_05.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l7_05.BLOQUEADAS))

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {}
        for stmt in l7_05.DDL.split(";"):
            s = " ".join(stmt.split())
            if s.startswith("CREATE TABLE"):
                corpo = s[s.index("(") + 1:s.rindex(")")].split(", PRIMARY KEY")[0]
                n, prof = 1, 0
                for ch in corpo:
                    prof += ch == "("
                    prof -= ch == ")"
                    n += ch == "," and prof == 0
                ncols[s.split()[2]] = n
        vistos = []
        l7_05.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, ncols[t], t)


if __name__ == "__main__":
    unittest.main()
