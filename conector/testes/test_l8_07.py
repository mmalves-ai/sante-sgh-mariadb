"""Fatia L8-07 (faturamento e restantes, módulo SUS): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-07`.
"""
import os
import random
from pathlib import Path
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_07

FATIA = set(l8_07.CARREGADAS) | set(l8_07.NAO_CARREGADAS)
# listas permitidas pelo CHECK do modelo (db/migracoes/13_SUS/01_tabelas.sql), só as que esta fatia usa e mais
# as que ficam para outras fontes (copiadas: o container dos testes não monta db/)
CHECK_LISTA = {
    "dominio_contratualizacao_sus": {"periodicidade", "rede_assistencial", "complexidade", "tipo_afericao", "escore",
                                     "esfera", "tipo_dado", "tipo_indicador", "tipo_item_indicador",
                                     "componente_orcamento"},
    "dominio_sus": {"motivo_saida", "carater_atendimento", "credor", "classificacao_diagnostico",
                    "justificativa_paciente_sem_documento", "tipo_apac", "local_atendimento",
                    "associacao_quimioterapia", "regional_saude", "tipo_leito_uti", "acesso_vascular",
                    "caracteristica_tratamento_dialitico", "contraindicacao_transplante", "situacao_transplante",
                    "grupo_atendimento", "tipo_atendimento", "tipo_prestador", "nivel_atencao", "fonte_orcamentaria",
                    "contraceptivo", "finalidade_tratamento", "grupo_justificativa_auditiva",
                    "justificativa_auditiva", "medicamento_antineoplasico", "local_metastase",
                    "atividade_profissional", "estadio_tumor"},
}


# o id é o código do leiaute do gestor (SIH/SIA) nestas: vai também para dominio_sus.codigo_oficial
CODIGO_OFICIAL = {"FHLEITOUTITP", "FHCLASSIFDIAG", "FHJUSTPACDESC", "FAHEMOACEVASC", "FAHEMOCARTRAT", "FAHEMOCONTRAN",
                  "FAHEMOSITTRAN"}


def _listas_permitidas(tabela):
    return CHECK_LISTA[tabela]


class PlanoL807(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_toda_a_fatia_entra_na_carga(self):
        self.assertEqual(len(FATIA), 19)
        self.assertEqual(set(self.plano), set(l8_07.CARREGADAS))
        self.assertEqual(l8_07.NAO_CARREGADAS, [])

    def test_incentivo_carrega_inativo_com_presumidos(self):
        """ADR 0006 (1): o incentivo padrão continua no produto, inativo até o cliente ligar ao contrato."""
        d = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)
        sc = {r["tabela"] for r in mapa.ler_tsv(d / "declarado/sem_carga.tsv")}
        self.assertNotIn("CMINCENTIVO", sc)
        p = self.plano["CMINCENTIVO"]
        self.assertEqual(p["destinos"], ["incentivo_contratual_sus"])
        c = {x["destino"]: x for x in p["colunas"]["incentivo_contratual_sus"]}
        self.assertEqual((c["codigo"]["coluna"], c["codigo"]["regra"]), ("ID", "texto"))
        self.assertEqual(c["nome"]["coluna"], "NOME")
        self.assertIn("CMTPDADOS", repr(c["tipo_dado_dominio_contratualizacao_sus_id"]))
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual((c["percentual"]["coluna"], c["ativo"]["coluna"]), ("=~0", "=~0"))

    def test_cada_tabela_grava_sua_lista_codigo_e_descricao(self):
        for t, (_, dt, lista) in l8_07.LISTAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)
            c = self.cols(t, dt)
            self.assertEqual(c["lista"]["coluna"], "=" + lista, t)
            self.assertEqual((c["codigo"]["coluna"], c["codigo"]["regra"]), ("ID", "texto"), t)
            self.assertEqual((c["descricao"]["coluna"], c["descricao"]["regra"]), ("NOME", "texto_nome"), t)
            esperado = {"lista", "codigo", "descricao"} | ({"sigla"} if t == "CMREDEASSIST" else set())
            esperado |= {"ativo"} if t in l8_07.SENTINELA_ZERO else set()
            esperado |= {"codigo_oficial"} if t in CODIGO_OFICIAL else set()
            self.assertEqual(set(c), esperado, t)

    def test_codigo_oficial_do_leiaute(self):
        # o id da origem é o código do Ministério nas listas do SIH/SIA; o credor não tem evidência e fica sem ele
        for t in CODIGO_OFICIAL:
            c = self.cols(t, "dominio_sus")["codigo_oficial"]
            self.assertEqual((c["coluna"], c["regra"]), ("ID", "texto"), t)
        self.assertNotIn("codigo_oficial", self.cols("FGTBTPCREDOR", "dominio_sus"))
        self.assertEqual(self.cols("CMTPCONTRATO", "dominio_contratualizacao_sus")["lista"]["coluna"], "=esfera")

    def test_listas_existem_no_check_e_nao_se_repetem(self):
        por_destino = {}
        for t, (_, dt, lista) in l8_07.LISTAS.items():
            self.assertIn(lista, _listas_permitidas(dt), t)
            self.assertNotIn(lista, por_destino.setdefault(dt, set()), t)
            por_destino[dt].add(lista)
        self.assertEqual(len(por_destino["dominio_contratualizacao_sus"]), 10)
        self.assertEqual(len(por_destino["dominio_sus"]), 8)

    def test_listas_cabem_no_modelo_alargado(self):
        # toda lista cabe em VARCHAR(40) (migração pedida em saida/L8-07.json); LISTA_LONGA só existe enquanto a
        # largura da imagem for a do modelo atual (30): com a migração, LARGURA_LISTA = 40 e LISTA_LONGA fica vazio
        self.assertTrue(all(len(l) <= 40 for _, _, l in l8_07.LISTAS.values()))
        self.assertLessEqual(l8_07.LISTA_LONGA, {"FAHEMOCARTRAT", "FHJUSTPACDESC"})

    def test_sentinela_zero_entra_inativo(self):
        # o id 0 ('não informado') vira item INATIVO: o produto representa 'não informado' com o vínculo NULL
        for t in l8_07.SENTINELA_ZERO:
            c = self.cols(t, "dominio_contratualizacao_sus")["ativo"]
            self.assertEqual((c["coluna"], c["regra"]), ("ID", "booleano"), t)
        for t in set(l8_07.LISTAS) - l8_07.SENTINELA_ZERO:
            self.assertNotIn("ativo", self.cols(t, l8_07.LISTAS[t][1]), t)

    def test_nenhum_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)


class RegrasL807(unittest.TestCase):
    def test_codigo_numerico_como_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 9), ("9", None))

    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Opção   número dois".encode("cp1252"))[0],
                         "Opção número dois")
        self.assertEqual(sentinela.aplicar("texto_nome", b"   "), (None, None))

    def test_id_zero_vira_inativo(self):
        self.assertEqual(sentinela.aplicar("booleano", 0), (False, None))
        self.assertEqual(sentinela.aplicar("booleano", 5), (True, None))

    def test_sigla_apara_e_vazia_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto", b" RCP")[0], "RCP")
        self.assertIsNone(sentinela.aplicar("texto", b"    ")[0])


class ImagemL807(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_07.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(l8_07.CARREGADAS))
        for t in l8_07.SENTINELA_ZERO:  # a imagem exercita o id 0
            self.assertGreater(esp[t]["gravados"], 0, t)
        # nenhuma tabela carregada fica com 0 gravados, fora as que aguardam a migração (LISTA_LONGA)
        self.assertEqual({t for t, e in esp.items() if e["gravados"] == 0}, l8_07.LISTA_LONGA)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_"))
            self.assertEqual(e["gravados"] + recusas, cont[t], t)


if __name__ == "__main__":
    unittest.main()
