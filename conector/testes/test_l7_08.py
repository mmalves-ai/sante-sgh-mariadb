"""Fatia L7-08 (SADT e suprimentos, módulo SUP): declarações, plano e imagem sintética. Sem banco; só valores
inventados. Nenhuma tabela da fatia é carregável hoje: as três que a carga saberia gravar têm pai obrigatório que o
mapa não carrega (BLOQUEADAS, pedido 10 em saida/L7-08.json). A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L7-08` (esperado {})."""
import random
import unittest

from sante_conector import carga, carga_mapa, mapa
from sante_conector.sintetica_d import l7_08

FATIA = tuple(l7_08.FORMAS)


class FatiaL708(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        # tabelas que o mapa de fato carrega: alguma coluna declarada com destino (L5 a L8) ou a carga própria do L3
        cls.carregadas_no_mapa = {c["tabela"] for c in cls.m["colunas_decl"] if c.get("destino")} | set(carga.ORDEM)

    def _motivo(self, t, col):
        return next(c["motivo"] for c in self.decl if c["tabela"] == t and c["coluna"] == col)

    def test_fatia_tem_as_25_tabelas(self):
        self.assertEqual(len(FATIA), 25)

    def test_nenhuma_tabela_com_destino_e_plano_vazio(self):
        self.assertEqual(l7_08.CARREGADAS, ())
        self.assertEqual({c["tabela"] for c in self.decl if c.get("destino")}, set())
        self.assertEqual(self.plano, {})
        self.assertTrue(all(c.get("_arquivo", "").endswith("L7-08.tsv") for c in self.decl))
        for c in self.decl:  # coluna sem destino sempre com motivo
            self.assertTrue(c["motivo"].strip(), c["coluna"])

    def test_bloqueio_pelo_pai_obrigatorio_vale(self):
        # enquanto algum pai obrigatório não for carregado pelo mapa a tabela fica fora (recusa em massa: 1048);
        # se este teste falhar, o pai entrou: reative a declaração prevista (pedido 10)
        for t, pais in l7_08.BLOQUEADAS.items():
            self.assertTrue(set(pais) - self.carregadas_no_mapa, "%s: pais %s já carregados" % (t, pais))
            for c in self.decl:
                if c["tabela"] == t and c["coluna"] in ("ID_GELANPED", "ID_GELANBAL", "ID_GECADANTIMI"):
                    self.assertIn(pais[0], c["motivo"])
                    self.assertIn("destino previsto", c["motivo"])

    def test_pais_externos_so_os_que_o_mapa_carrega(self):
        for t in l7_08.PAIS_EXTERNOS:
            self.assertIn(t, self.carregadas_no_mapa, t)
        for t, pais in l7_08.BLOQUEADAS.items():
            self.assertFalse(set(pais) & set(l7_08.PAIS_EXTERNOS), t)

    def test_interrupcao_e_saldo_tem_pedido(self):
        self.assertIn("suspenso", self._motivo("GEANTIMI", "DATA_INT"))
        self.assertIn("pedido 11", self._motivo("GEANTIMI", "DATA_INT"))
        self.assertIn("saldo_sistema", self._motivo("GERASVALBAL", "ID_GERASVALFINAL"))
        self.assertIn("pedido 13", self._motivo("GERASVALBAL", "ID_GERASVALFINAL"))

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l7_08.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(esp, {})
        por = {}
        for t, v in a:
            self.assertEqual(len(v), len(l7_08.COLUNAS[t]), t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA))
        cols = [c for c, _, _ in l7_08.COLUNAS["GEANTIMI"]]
        interrompidas = [v for t, v in a if t == "GEANTIMI" and v[cols.index("DATA_INT")] is not None]
        self.assertEqual(len(interrompidas), 1)
        self.assertIn("CREATE TABLE GEPARAM", l7_08.DDL)
        self.assertIn("PRIMARY KEY (ANO,MES,DOC,SEQ,ITEM)", l7_08.DDL)


if __name__ == "__main__":
    unittest.main()
