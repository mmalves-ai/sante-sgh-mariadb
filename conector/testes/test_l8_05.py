"""Fatia L8-05 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-05`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_05

TABELAS = set(l8_05.CARREGADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l8_05.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["TBTIPPLANO"]["destinos"], ["plano_fonte_pagadora"])
        # item_faturavel (secundário) fica fora: grupo_faturamento_id NOT NULL sem origem (pedido)
        self.assertEqual(self.plano["TBTABDTH"]["destinos"], ["preco_diaria_taxa"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("TBTIPPLANO", "plano_fonte_pagadora"): {"fonte_pagadora_id", "codigo", "descricao"},
                 ("TBTABDTH", "preco_diaria_taxa"): {"tabela_preco_id", "sequencia", "codigo", "nome", "tipo_item"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        self.assertEqual(self.cols("TBTIPPLANO", "plano_fonte_pagadora")["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        tab = self.cols("TBTABDTH", "preco_diaria_taxa")["tabela_preco_id"]
        self.assertEqual((tab["regra"], tab["referencia"]), ("chave_origem", "TBCTRDTH"))

    def test_pais_externos_sao_os_referenciados(self):
        refs = {c["referencia"] for t in TABELAS for cs in self.plano[t]["colunas"].values() for c in cs
                if c.get("referencia")}
        self.assertEqual(set(l8_05.PAIS_EXTERNOS), refs)

    def test_pais_externos_carregados_ou_dependencia_registrada(self):
        """Pai dado como carregado na conferência precisa ter destino em algum colunas.d; se não tem, a dependência
        bloqueante tem de estar marcada no motivo da coluna que o referencia (e o pedido em saida/L8-05.json); senão a
        conciliação, que dá o pai como carregado, não prova nada."""
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        for pai in l8_05.PAIS_EXTERNOS:
            if pai in com_destino:
                continue
            refs = [c for t in TABELAS for cs in self.plano[t]["colunas"].values() for c in cs
                    if c.get("referencia") == pai]
            self.assertTrue(refs, pai)
            for c in refs:
                m = next(d["motivo"] for d in self.mapa["colunas_decl"]
                         if d["tabela"] in TABELAS and d["coluna"] == c["coluna"] and d["destino"])
                self.assertIn("DEPENDÊNCIA BLOQUEANTE: " + pai, m)

    def test_codigo_que_colide_entre_origens_nao_carrega(self):
        # funcao_equipe_cobranca.codigo (UNIQUE) já recebe o ID de TBCOSPPROF e TBGRAUPARTPROC: TBTPPROFPROC espera
        # o prefixo de domínio por origem
        self.assertIn("TBTPPROFPROC", l8_05.BLOQUEADAS)
        destinos = {c["destino"] for c in self.mapa["colunas_decl"] if c["tabela"] == "TBTPPROFPROC"}
        self.assertEqual(destinos, {""})

    def test_todas_as_colunas_de_tbtabdth_declaradas(self):
        decl = {c["coluna"] for c in self.mapa["colunas_decl"] if c["tabela"] == "TBTABDTH"}
        faltam = {c for c, _, _ in l8_05.COLUNAS["TBTABDTH"]} - decl - {"ID"}
        self.assertFalse(faltam)

    def test_situacao_vira_ativo(self):
        self.assertEqual(self.cols("TBTABDTH", "preco_diaria_taxa")["ativo"]["regra"], "booleano_ai")

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("TBTABDTH", "preco_diaria_taxa")["tipo_item"]["coluna"], "=~taxa")

    def test_codigo_e_sequencia_da_mesma_operacao(self):
        c = self.cols("TBTABDTH", "preco_diaria_taxa")
        self.assertEqual((c["codigo"]["coluna"], c["sequencia"]["coluna"]), ("OPE", "OPE"))
        self.assertEqual(c["numero_meses"]["regra"], "inteiro_nao_negativo")
        for dc in ("cobra_taxa", "compoe_pacote", "exige_profissional", "insumo_material", "insumo_medicamento",
                   "lanca_hora_final"):
            self.assertEqual(c[dc]["regra"], "booleano_sn", dc)

    def test_bloqueadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l8_05.BLOQUEADAS))

    def test_senha_nunca_em_coluna(self):
        for c in self.mapa["colunas_decl"]:
            if c["tabela"] in ("TBCODATI", "TBTISS") and "SENHA" in c["coluna"]:
                self.assertEqual(c["destino"], "", c["coluna"])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Auxiliar   um "), ("Auxiliar um", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", 12), (12, None))
        self.assertEqual(a("booleano_ai", "I"), (False, None))
        self.assertEqual(a("booleano_ai", "Z"), (None, "valor_fora_do_dominio"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_05.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_"))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l8_05.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_05.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l8_05.BLOQUEADAS))
        self.assertEqual(len(criadas), 23)

    def test_colunas_das_linhas_batem_com_a_forma(self):
        vistos = []
        l8_05.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(l8_05.COLUNAS[t]), t)


if __name__ == "__main__":
    unittest.main()
