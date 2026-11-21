"""Fatia L7-08 (SADT e suprimentos, módulo SUP): declarações, plano e imagem sintética. Sem banco; só valores
inventados. Rodada de cobertura total: 14 tabelas declaradas (2 delas com o pai obrigatório bloqueado), GEPARAM e
GEQTDELOTEVALLOTEDOCSAIDA descartadas e 9 bloqueadas por mecanismo ou modelo (pedidos em saida/L7-08.json). A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L7-08`."""
import random
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.sintetica_d import l7_08

FATIA = tuple(l7_08.FORMAS)


class FatiaL708(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def _d(self, t, col, destino=None):
        return [c for c in self.decl if c["tabela"] == t and c["coluna"] == col
                and (destino is None or c.get("destino") == destino)]

    def test_fatia_tem_as_25_tabelas_e_particao(self):
        self.assertEqual(len(FATIA), 25)
        partes = set(l7_08.CARREGADAS) | set(l7_08.BLOQUEADAS) | set(l7_08.DESCARTADAS)
        self.assertEqual(partes, set(FATIA))
        self.assertEqual(len(l7_08.CARREGADAS) + len(l7_08.BLOQUEADAS) + len(l7_08.DESCARTADAS), 25)

    def test_declaradas_e_plano(self):
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l7_08.CARREGADAS))
        self.assertEqual(set(self.plano), set(l7_08.CARREGADAS))
        self.assertTrue(all(c.get("_arquivo", "").endswith("L7-08.tsv") for c in self.decl))
        for c in self.decl:
            self.assertTrue(c["motivo"].strip(), c["coluna"])

    def test_referencia_simples_usa_a_chave_do_pai(self):
        # regra declarada diferente de chave_origem numa ref:T simples gravaria o código cru como id
        for c in self.decl:
            via = [x for x in (c.get("via") or "").split(";") if x.startswith("ref:")]
            if via and mapa.ref_simples(via[0][4:]):
                self.assertIn(c["regra"], ("", "chave_origem"), (c["tabela"], c["coluna"]))

    def test_documento_de_estoque(self):
        nums = {t: self._d(t, c)[0] for t in ("GECADSAI", "GECADDEV") for c in
                [x["coluna"] for x in self.decl if x["tabela"] == t and x.get("destino") == "documento_estoque.numero"]}
        prefixos = {t: c["coluna"].split(":")[-1] for t, c in nums.items()}
        self.assertEqual(len(set(prefixos.values())), 2, prefixos)  # números não colidem entre saída e devolução
        for t in ("GECADSAI", "GECADDEV"):
            mov = [c for c in self.decl if c["tabela"] == t and c.get("destino") == "documento_estoque.movimentado_em"]
            self.assertEqual([c["regra"] for c in mov], ["data_hora"])  # DATE em DATETIME diverge a soma
        self.assertTrue(self._d("GECADSAI", "=~saida_setor", "documento_estoque.tipo"))
        self.assertTrue(self._d("GECADDEV", "=devolucao_interna", "documento_estoque.tipo"))

    def test_complementos(self):
        for t, col, dt in [("GEINFVENEXT", "ID_GECADSAI", "documento_estoque.id"),
                           ("PRINTEGRACAOESTOQUE", "ID_PRCHKGERAL", "horario_administracao.id")]:
            c = self._d(t, col, dt)
            self.assertEqual(len(c), 1, t)
            self.assertIn("complementa", c[0]["via"].split(";"))

    def test_toda_coluna_da_origem_declarada(self):
        # coluna omitida sem declaração some em silêncio: cada coluna fora da chave é carregada ou tem motivo
        chaves = {t: set(ch.split(",")) for t, (ch, _) in l7_08.FORMAS.items()}
        for t in l7_08.CARREGADAS:
            usadas = set()
            for c in self.decl:
                if c["tabela"] != t:
                    continue
                n = c["coluna"]
                usadas.add(n.split(":")[1] if n.startswith("#") and ":" in n else n)
            faltam = {c for c, _, _ in l7_08.COLUNAS[t]} - chaves[t] - usadas
            self.assertFalse(faltam, (t, sorted(faltam)))

    def test_centro_de_custo_pela_coluna_id_e_pelo_codigo(self):
        for t in ("GEUSERS_TBCENCUS", "PRPARINTEGEST"):
            for c in self._d(t, "ID_TBCENCUS"):
                self.assertTrue(c["via"].startswith("ref:TBCENCUS.ID"), (t, c["destino"]))
        for t in ("GECADSAI", "GECADDEV"):
            self.assertEqual(self._d(t, "CDC")[0]["via"], "ref:TBCENCUS")

    def test_documento_usuarios_e_situacao(self):
        for t in ("GECADSAI", "GECADDEV"):
            self.assertEqual(self._d(t, "USUARIO")[0]["destino"], "documento_estoque.criado_por")
            self.assertEqual(self._d(t, "USU_CONS")[0]["destino"], "documento_estoque.concluido_usuario_id")
            sit = self._d(t, "CONSOL", "documento_estoque.situacao")
            self.assertEqual(sit[0]["depara"], "valores")
            self.assertFalse(self._d(t, "=concluido"))

    def test_sem_duas_fontes_na_mesma_coluna_e_saldo_vigente_fora(self):
        self.assertFalse([c for c in self.decl if c["tabela"] == "GEQTDELOTEVALLOTEDOCSAIDA"])
        self.assertFalse([c for c in self.decl if c.get("destino") == "inventario_estoque_lote.saldo_sistema"])
        self.assertIn("GEQTDELOTEVALLOTEDOCSAIDA", l7_08.DESCARTADAS)

    def test_regra_presumida_entra_inativa(self):
        self.assertTrue(self._d("PRPARINTEGEST", "=0", "regra_integracao_prescricao.ativo"))

    def test_presumidos_e_vigencia(self):
        pres = [c["coluna"] for c in self.decl if c["tabela"] == "PRPARINTEGEST" and c["coluna"].startswith("=~")]
        self.assertEqual(len(pres), 3)
        self.assertTrue(self._d("GEUSERS_TBCENCUS", "@vigencia_carga", "usuario_estoque_centro_custo.vigencia_inicio"))

    def test_pais_externos_de_fora_da_fatia(self):
        self.assertFalse(set(l7_08.PAIS_EXTERNOS) & set(FATIA))

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l7_08.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(set(esp), set(l7_08.CARREGADAS))
        por = {}
        for t, v in a:
            cols = l7_08.COLUNAS[t] if t in l7_08.COLUNAS else l7_08.ORIGEM_PAIS[t][1]
            self.assertEqual(len(v), len(cols), t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA) | set(l7_08.ORIGEM_PAIS))
        self.assertFalse(set(l7_08.ORIGEM_PAIS) & set(FATIA))
        self.assertLessEqual(set(l7_08.ORIGEM_PAIS), set(l7_08.PAIS_EXTERNOS))
        cols = [c for c, _, _ in l7_08.COLUNAS["GEANTIMI"]]
        self.assertEqual(len([v for t, v in a if t == "GEANTIMI" and v[cols.index("DATA_INT")] is not None]), 1)
        self.assertIn("PRIMARY KEY (ANO,MES,DOC,SEQ,ITEM)", l7_08.DDL)


if __name__ == "__main__":
    unittest.main()
