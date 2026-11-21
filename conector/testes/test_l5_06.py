"""Fatia L5-06 (cadastros e administração, módulo CAD): plano dirigido pelo mapa real, regras declaradas e imagem
sintética. Sem banco e só com valores inventados; a carga e a conciliação na imagem SINTÉTICA rodam em
`tools/obra/conferir-fatia-f4.sh L5-06`."""
import datetime
import os
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import l5_06

CARREGADAS = l5_06.CARREGADAS
SEM_CARGA = l5_06.SEM_CARGA
DIR = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE) / "declarado"
DECL = DIR / "colunas.d" / "L5-06.tsv"


class PlanoL506(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + SEM_CARGA))}

    def col(self, t, c, dt=None):
        return next(x for d in self.plano[t]["destinos"] if dt in (None, d) for x in self.plano[t]["colunas"][d]
                    if x["coluna"] == c)

    def test_carregadas_em_ordem_e_sem_carga_fora(self):
        self.assertEqual(list(self.plano), CARREGADAS)

    def test_destinos(self):
        for t in ["HTTBCBOPRO", "HTTBCBOPRO_TBUNIDAD", "HTTBHOSPIT"]:
            self.assertEqual(self.plano[t]["destinos"], ["trilha_auditoria"], t)
        # o dado fiscal é secundário opcional; conta bancária, configuração TISS e contrato por estabelecimento
        # ficam para o cliente (decisões em docs/obra/passagens/F4-decisoes-destino.md)
        self.assertEqual(self.plano["TBPROFIS"]["destinos"], ["profissional", "profissional_dado_fiscal",
                                                              "pessoa_fisica"])
        self.assertTrue(self.plano["TBPROFIS"]["opcoes"]["pessoa_fisica"]["antes"])
        self.assertTrue(self.plano["TBPROFIS"]["opcoes"]["profissional_dado_fiscal"]["opcional"])
        self.assertEqual(self.plano["TBCONVEN"]["destinos"], ["fonte_pagadora"])

    def test_situacao_pelo_depara_de_valores(self):
        # sem o de-para, fonte encerrada e profissional desligado entrariam com o padrão (ativos)
        self.assertEqual(self.col("TBCONVEN", "SITUACAO")["valores"], {"A": "ativa", "I": "inativa"})
        self.assertEqual(self.col("TBPROFIS", "SITUACAO")["valores"], {"A": "ativo", "I": "inativo"})

    def test_referencias_declaradas(self):
        self.assertEqual(self.col("TBCONVEN", "CLASSE")["referencia"], "TBCLASSC")
        self.assertEqual(self.col("HTCONVEN", "CLASSIFICACAO")["referencia"], "TBCLASSC")
        self.assertEqual(self.col("TBMEDESP", "ESP")["referencia"], "TBESPEC")
        for t in ("HTTBCBOPRO", "HTTBCBOPRO_TBUNIDAD"):
            self.assertEqual(self.col(t, "USUARIO")["referencia"], "TBUSERS", t)
        # a trilha do estabelecimento diz qual estabelecimento mudou e onde
        self.assertEqual({c["destino"]: c["referencia"] for c in self.plano["HTTBHOSPIT"]["colunas"]["trilha_auditoria"]
                          if c["coluna"] == "COD"}, {"entidade_id": "TBHOSPIT", "estabelecimento_id": "TBHOSPIT"})
        for t, dt in [("TBMEDESP", "profissional_especialidade"), ("TBCBOPRO_TBCONVEN", "profissional_fonte_pagadora")]:
            c = next(x for x in self.plano[t]["colunas"][dt] if x["destino"] == "profissional_id")
            self.assertEqual([p.get("tabela") or p.get("coluna") for p in c["passos"]],
                             ["TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"], t)

    def test_lotacao_da_trilha_pela_chave_composta_sem_depara_cbo(self):
        # CBOPRO é o ID da inscrição: a lotação sai da chave composta (CBOPRO,UNIDAD), nunca do de-para cbo
        c = self.col("HTTBCBOPRO_TBUNIDAD", "CBOPRO")
        self.assertEqual(c["destino"], "entidade_id")
        self.assertEqual(c["passos"][0]["modo"], "composta")
        self.assertEqual(c["passos"][0]["tabela"], "TBCBOPRO_TBUNIDAD")
        self.assertEqual(c["passos"][0]["arg"], ["CBOPRO", "UNIDAD"])

    def test_cbo_pelo_codigo_da_linha_pai_nunca_pelo_id(self):
        c = self.col("TBCBOSUS_TBESPEC", "ID_TBCBOSUS")
        self.assertEqual(c["depara"], "cbo")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in c["passos"]], ["TBCBOSUS", "COD"])

    def test_retrato_por_linha_e_sem_hash_constante(self):
        self.assertEqual(self.col("HTCONVEN", "#retrato")["destino"], "dados")
        for c in self.m["colunas_decl"]:
            if c["tabela"] in CARREGADAS and (c.get("destino") or "").endswith((".hash_dados", ".dados")):
                self.assertEqual(c["coluna"], "#retrato", c)
        # HTCONVEN: o retrato cobre todas as colunas da tabela
        self.assertEqual(set(self.plano["HTCONVEN"]["retrato"]),
                         {"ID", "ID_TBCONVEN", "DATA_HORA_HISTORICO", "NOME", "CLASSIFICACAO"})

    def test_sem_carga_comentadas_ou_pedidas(self):
        linhas = [x.split("\t") for x in DECL.read_text(encoding="utf-8").splitlines() if x.startswith("#")]
        self.assertEqual({x[0][1:] for x in linhas}, set(SEM_CARGA) - {"TBEMPHOSLOGO"})


class RegrasL506(unittest.TestCase):
    def test_sentinelas_das_colunas_declaradas(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 300001), ("300001", None))
        self.assertEqual(a("inteiro_zeros_esquerda:6", 5711), ("005711", None))
        self.assertEqual(a("inteiro_zeros_esquerda:6", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zeros_esquerda:11", 123456789012), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("faixa:0,100", 150), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("texto_nome", "  Dr.  Exemplo   1 "), ("Dr. Exemplo 1", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30, 10, 15)), (None, "hora_sem_data"))
        self.assertEqual(a("texto_longo", "a\r\n  b "), ("a\r\n  b ", None))

    def test_id_do_cbo_nunca_e_o_codigo(self):
        # na sintética o ID substituto nunca coincide com um código CBO válido (falharia se o ID fosse tratado como código)
        d = depara.Depara("cbo", [(c, i) for i, c in l5_06.CBO_POR_ID.items() if len(c) == 6])
        for i, cod in l5_06.CBO_POR_ID.items():
            self.assertNotEqual(str(i), cod)
            self.assertIsNone(d.resolver(i)[0])
        self.assertEqual(d.resolver(l5_06.CBO_POR_ID[1])[0], 1)


class SinteticaL506(unittest.TestCase):
    def test_tabelas_e_colunas_da_imagem_cobrem_o_plano(self):
        plano = carga_mapa.planejar(mapa.carregar_execucao(), set(l5_06.COLUNAS))
        self.assertEqual([p["tabela"] for p in plano], CARREGADAS)
        for p in plano:
            self.assertFalse(set(p["lidas"]) - set(l5_06.COLUNAS[p["tabela"]]), p["tabela"])

    def test_esperado_bate_com_as_linhas(self):
        cont = {}
        esp = l5_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino") or r == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, cont[t], t)

    def test_vinculo_profissional_fonte_carrega_de_verdade(self):
        # o profissional do credenciamento vem pela inscrição: só existe se TBPROFIS carregar antes (aresta
        # TBCBOPRO_TBCONVEN -> TBPROFIS pedida ao integrador). Sem ela todo credenciamento seria recusado: falha aqui
        esp = l5_06.linhas(random.Random(1), lambda t, v: None)["TBCBOPRO_TBCONVEN"]
        self.assertEqual(esp["gravados"], 4)
        self.assertTrue(l5_06.profissional_antes_do_vinculo(),
                        "TBCBOPRO_TBCONVEN vem antes de TBPROFIS na ordem do mapa: credenciamento não grava")


if __name__ == "__main__":
    unittest.main()
