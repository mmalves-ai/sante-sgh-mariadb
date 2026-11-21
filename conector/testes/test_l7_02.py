"""Fatia L7-02 (SADT e suprimentos, módulo SADT): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L7-02`."""
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_02

TABELAS = set(l7_02.CARREGADAS)
BLOQUEADAS = set(l7_02.NAO_CARREGADAS)
DESTINO = {"SICTRPSR": "grupo_resposta", "SIESPEC": "especialidade_diagnostica", "SIKITEXA": "kit_exame",
           "SIMATERI": "material_biologico", "SIMETODO": "metodo_analitico", "SIMODULO": "setor_diagnostico",
           "SIPACSMODALID": "modalidade_imagem"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt=None):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt or DESTINO[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, d in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [d], t)

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {"SICTRPSR": {"codigo", "descricao"}, "SIESPEC": {"codigo", "descricao"},
                 "SIKITEXA": {"codigo", "nome"}, "SIMATERI": {"codigo", "descricao"},
                 "SIMETODO": {"codigo", "descricao"},
                 "SIMODULO": {"estabelecimento_id", "codigo", "nome", "tipo"},
                 "SIPACSMODALID": {"codigo", "descricao", "sigla_padrao"}}
        for t, o in obrig.items():
            self.assertTrue(o <= set(self.cols(t)), t)

    def test_especiais(self):
        s = self.cols("SIMODULO")
        self.assertEqual(s["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(s["tipo"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SIKITEXA")["hora_sugerida_coleta"]["regra"], "hora_em_timestamp")
        self.assertEqual(self.cols("SIKITEXA")["gera_bateria"]["regra"], "booleano_sn")
        self.assertEqual(self.cols("SIMETODO")["descricao_laudo"]["regra"], "texto_longo")
        # classificação sem origem: presumida 'outro' por linha, nunca o padrão do destino em silêncio
        self.assertEqual(self.cols("SIESPEC")["tipo_servico"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SIMATERI")["tipo"]["coluna"], "=~outro")
        # sigla única sem caixa: codigo_char faz o motor recusar o grupo inteiro (codigo_colisao_caixa)
        self.assertEqual(self.cols("SIPACSMODALID")["sigla_padrao"]["regra"], "codigo_char")

    def test_unica_alimentadora(self):
        for t, dt in DESTINO.items():
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_bloqueadas_sem_destino(self):
        # dependem de regra genérica, de ordem do mapa ou de decisão do dono (docs/obra/fatias/f4/saida/L7-02.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])

    def test_secundario_de_material_fora(self):
        # de_para_material_apoio exige laboratorio_apoio_id sem origem: só o destino principal é carregado
        self.assertNotIn("de_para_material_apoio", self.plano["SIMATERI"]["destinos"])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Reagente  e não reagente".encode("cp1252")), ("Reagente e não reagente", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"N"), (False, None))
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(1899, 12, 30, 7, 0)), (datetime.time(7, 0), None))
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(2025, 3, 10, 8, 15)),
                         (datetime.time(8, 15), "hora_com_data"))
        t = "Método\r\n  com  leitura  ".encode("cp1252")
        self.assertEqual(a("texto_longo", t)[0], "Método\r\n  com  leitura  ")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith(("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        f = l7_02.formas()
        self.assertEqual(set(f), TABELAS | BLOQUEADAS)
        vistos = []
        l7_02.linhas(random.Random(2), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(f[t]), t)

    def test_siglas_por_caixa_todas_recusadas(self):
        # 'CT', 'CT' e 'ct' formam um grupo: nenhuma grava (o esperado conta as três como codigo_colisao_caixa)
        sig = {}
        esp = l7_02.linhas(random.Random(4), lambda t, v: sig.setdefault(v[0], v[1]) if t == "SIPACSMODALID" else None)
        cods = [sentinela.aplicar("codigo_char", x)[0] for x in sig.values()]
        grupos = sentinela.colisoes_caixa(cods)
        self.assertEqual(grupos, [["CT", "ct"]])
        no_grupo = [k for k, x in sig.items() if x is not None and x.casefold() == "ct"]
        self.assertEqual(len(no_grupo), esp["SIPACSMODALID"]["pendencias"]["codigo_colisao_caixa"])

    def test_classificacao_presumida_em_toda_linha(self):
        cont = {}
        esp = l7_02.linhas(random.Random(5), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        for t in ("SIESPEC", "SIMATERI", "SIMODULO"):
            self.assertEqual(esp[t]["pendencias"]["valor_presumido"], cont[t], t)

    def test_senha_gerencial_nunca_na_imagem(self):
        f = [c for c, _, _ in l7_02.formas()["SIPARLAB"]]
        i = f.index("SENHAGERENCIAL")
        linhas = []
        l7_02.linhas(random.Random(3), lambda t, v: linhas.append(v) if t == "SIPARLAB" else None)
        self.assertTrue(linhas and all(v[i] is None for v in linhas))


if __name__ == "__main__":
    unittest.main()
