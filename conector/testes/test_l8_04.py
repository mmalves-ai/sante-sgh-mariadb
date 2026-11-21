"""Fatia L8-04 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-04`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_04

TABELAS = set(l8_04.CARREGADAS)
RECUSA = ("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l8_04.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        # segundo destino do mapa (favorecido_repasse) não se aplica ao domínio de tipos
        self.assertEqual(self.plano["TBRPATPREPASSE"]["destinos"], ["tipo_prestador_repasse"])
        self.assertEqual(self.plano["TBTIPO_PROCEDIMENTO"]["destinos"], ["tipo_lancamento"])
        self.assertEqual(self.plano["TBTPLANC"]["destinos"], ["tipo_lancamento"])
        self.assertEqual(self.plano["TBGRAUPARTPROC"]["destinos"], ["funcao_equipe_cobranca"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("TBRPATPREPASSE", "tipo_prestador_repasse"): {"codigo", "descricao", "categoria"},
                 ("TBSRVCON", "tipo_servico_contratado"): {"codigo", "descricao", "categoria"},
                 ("TBTABATO", "grupo_ato"): {"codigo", "descricao"},
                 ("TBTIPO_PROCEDIMENTO", "tipo_lancamento"): {"codigo", "descricao", "natureza"},
                 ("TBTPLANC", "tipo_lancamento"): {"codigo", "descricao", "natureza"},
                 ("TBGRAUPARTPROC", "funcao_equipe_cobranca"): {"codigo", "descricao", "tipo_funcao"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_literais_presumidos(self):
        for t, dt, c, v in [("TBRPATPREPASSE", "tipo_prestador_repasse", "categoria", "=~outro"),
                            ("TBSRVCON", "tipo_servico_contratado", "categoria", "=~outro"),
                            ("TBTPLANC", "tipo_lancamento", "natureza", "=~servico_hospitalar"),
                            ("TBTPLANC", "tipo_lancamento", "gera_repasse", "=~0"),
                            ("TBGRAUPARTPROC", "funcao_equipe_cobranca", "tipo_funcao", "=~outro")]:
            self.assertEqual(self.cols(t, dt)[c]["coluna"], v, (t, c))

    def test_regras_das_colunas(self):
        g = self.cols("TBTABATO", "grupo_ato")
        self.assertEqual((g["cobra_filme"]["regra"], g["alta_complexidade"]["regra"]), ("booleano_sn", "booleano_sn"))
        t = self.cols("TBTIPO_PROCEDIMENTO", "tipo_lancamento")
        self.assertEqual((t["codigo"]["coluna"], t["codigo"]["regra"]), ("CODIGO", "codigo_char"))
        self.assertEqual(t["sigla"]["coluna"], "CODIGO")
        for tab, dt in [("TBRPATPREPASSE", "tipo_prestador_repasse"), ("TBSRVCON", "tipo_servico_contratado"),
                        ("TBTPLANC", "tipo_lancamento"), ("TBGRAUPARTPROC", "funcao_equipe_cobranca")]:
            self.assertEqual(self.cols(tab, dt)["descricao"]["regra"], "texto_nome", tab)

    def test_natureza_e_repasse_pelo_codigo(self):
        # a natureza e a base de repasse vêm do código da origem, nunca presumidas; fora do domínio não tem par
        t = self.cols("TBTIPO_PROCEDIMENTO", "tipo_lancamento")
        nat, rep = t["natureza"], t["gera_repasse"]
        self.assertEqual((nat["coluna"], nat["regra"], rep["coluna"], rep["regra"]),
                         ("CODIGO", "codigo_char", "CODIGO", "codigo_char"))
        self.assertEqual(nat["valores"], {"SH": "servico_hospitalar", "SP": "servico_profissional",
                                          "MM": "material_medicamento"})
        self.assertEqual(rep["valores"], {"SH": "0", "SP": "1", "MM": "0"})
        self.assertNotIn("mm", nat["valores"])

    def test_bloqueadas_fora_do_plano(self):
        # presentes na imagem, as bloqueadas nunca entram no plano de carga: zero linha no destino
        self.assertFalse(set(self.plano) & set(l8_04.BLOQUEADAS))

    def test_terminologia_tiss_nunca_gravada(self):
        # grau de participação TISS é catálogo oficial: nem a tabela nem a referência entram
        f = self.cols("TBGRAUPARTPROC", "funcao_equipe_cobranca")
        self.assertNotIn("grau_participacao_termo_terminologia_id", f)
        self.assertNotIn("TBTISSPOSPROF", self.plano)

    def test_bloqueadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l8_04.BLOQUEADAS))
        self.assertEqual(len(TABELAS) + len(l8_04.BLOQUEADAS), 23)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Laboratório   clínico "), ("Laboratório clínico", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("codigo_char", "sp")[0], "sp")

    def test_colisao_de_caixa_no_codigo(self):
        grupos = sentinela.colisoes_caixa(["SH", "SP", "MM", "mm", "XX"])
        achatado = {x for g in (grupos.values() if isinstance(grupos, dict) else grupos) for x in g}
        self.assertEqual(achatado, {"MM", "mm"})


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_04.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(RECUSA))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l8_04.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_04.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l8_04.BLOQUEADAS))

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {}
        for stmt in l8_04.DDL.split(";"):
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
        l8_04.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, ncols[t], t)


if __name__ == "__main__":
    unittest.main()
