"""Autoconferência do L4 (mapa declarativo, verificador, de-para oficial, sentinelas e pendência "pai pendente").

Sem banco; só valores inventados. O caso da imagem SINTÉTICA (BLOB de texto e tabela_sem_mapa) roda no container do
conector (`conector/conector.sh testes`); o verificador sobre o mapa real do repositório roda no host (esteira).
"""
import datetime
import decimal
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from sante_conector import depara, mapa, pendencia, sentinela


class Sentinelas(unittest.TestCase):
    def test_classificar_por_forma_e_nome(self):
        c = sentinela.classificar
        self.assertEqual(c("ATIVO", 14, 1, 0), "booleano_sn")
        self.assertEqual(c("FL_URGENTE", 37, 1, 0), "booleano_sn")
        self.assertEqual(c("SEXO", 14, 1, 0), "codigo_char")
        self.assertEqual(c("NOME", 14, 40, 0), "texto_char")
        self.assertEqual(c("NOME", 37, 40, 0), "texto_nome")
        self.assertEqual(c("OBSERVACAO", 37, 400, 0), "texto")
        self.assertEqual(c("NOTA", 261, 8, 0, 1), "texto_longo")
        self.assertEqual(c("NOTA", 261, 8, 0, 0), "blob")
        self.assertEqual(c("HORARIO", 35, 8, 0), "hora_em_timestamp")
        self.assertEqual(c("HR_INICIO_INICIAL", 35, 8, 0), "hora_em_timestamp")
        self.assertEqual(c("HORA_SUGERIDA_COLETA_PEP", 35, 8, 0), "hora_em_timestamp")
        self.assertEqual(c("DATA_HORA", 35, 8, 0), "data_hora")
        self.assertEqual(c("DT_HR_GER", 35, 8, 0), "data_hora")
        self.assertEqual(sentinela.regra_efetiva("blob", 1), "texto_longo")
        self.assertEqual(sentinela.regra_efetiva("texto_longo", 0), "blob")
        self.assertEqual(sentinela.regra_efetiva("texto", 0), "texto")
        self.assertEqual(c("DT", 12, 4, 0), "data")
        self.assertEqual(c("DH", 35, 8, 0), "data_hora")
        self.assertEqual(c("HORA_INICIO", 8, 4, 0), "hora_hhmm")
        self.assertEqual(c("QTDE_HORAS", 8, 4, 0), "inteiro")
        self.assertEqual(c("FUSO_HORARIO_EVENTO", 7, 2, 0), "inteiro")
        self.assertEqual(c("ID_TBQUALQUER", 8, 4, 0), "chave_origem")
        self.assertEqual(c("VALOR", 16, 8, -2), "decimal")
        self.assertEqual(c("PESO", 27, 8, 0), "flutuante")
        self.assertEqual(c("LAUDO", 261, 8, 0), "blob")
        self.assertEqual(sentinela.forma(16, 8, -2), "NUMERIC(18,2)")

    def test_aplicar(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", b"S "), (True, None))
        self.assertEqual(a("booleano_sn", "n"), (False, None))
        self.assertEqual(a("booleano_sn", b"  "), (None, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_01", 1), (True, None))
        self.assertEqual(a("booleano_01", 2), (None, "valor_fora_do_dominio"))
        for d in (datetime.date(1899, 12, 30), datetime.date(1900, 1, 1), datetime.date(1, 1, 1)):
            self.assertEqual(a("data", d), (None, "data_sentinela"))
        # TIMESTAMP: sentinela com hora 00:00 é data fictícia; com hora preenchida a hora não some calada
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30, 10, 0)), (None, "hora_sem_data"))
        self.assertEqual(a("data_hora", datetime.datetime(2024, 5, 1, 0, 0)), (datetime.datetime(2024, 5, 1), None))
        # só hora em TIMESTAMP (convenção 1899-12-30 HH:MM): vira TIME
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(1899, 12, 30, 10, 0)), (datetime.time(10, 0), None))
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(1899, 12, 30)), (datetime.time(0, 0), None))
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(2024, 5, 1, 7, 15)), (datetime.time(7, 15),
                                                                                       "hora_com_data"))
        self.assertEqual(a("data", datetime.date(2020, 2, 29)), (datetime.date(2020, 2, 29), None))
        self.assertEqual(a("hora_hhmm", 830), (datetime.time(8, 30), None))
        self.assertEqual(a("hora_hhmm", 0), (datetime.time(0, 0), None))
        self.assertEqual(a("hora_hhmm", 2400), (None, "hora_invalida"))
        self.assertEqual(a("hora_hhmm", 1261), (None, "hora_invalida"))
        self.assertEqual(a("texto_char", b"ABC     "), ("ABC", None))
        self.assertEqual(a("texto_char", b"AB  CD    "), ("AB  CD", None))  # só o preenchimento à direita
        self.assertEqual(a("texto_char", b"  AB"), ("  AB", None))
        self.assertEqual(a("texto_nome", b"  Jo\xe3o   da\xa0Silva "), ("João da Silva", None))
        self.assertEqual(a("texto", b"linha1\r\nlinha2   fim  "), ("linha1\r\nlinha2   fim", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("codigo_char", b"m"), ("m", None))  # caixa preservada: 'm' e 'M' são códigos distintos
        self.assertEqual(a("codigo_char", b"M"), ("M", None))
        self.assertEqual(sentinela.colisoes_caixa(["a", "A", "b", None, "c", "C", "c"]), [["A", "a"], ["C", "c"]])
        self.assertEqual(sentinela.colisoes_caixa(["a", "b"]), [])
        longo = "Observação:\r\n  item 1\r\n\r\n  item 2  ".encode("cp1252")
        self.assertEqual(a("texto_longo", longo), ("Observação:\r\n  item 1\r\n\r\n  item 2  ", None))
        self.assertEqual(a("texto_longo", b" \r\n "), (None, None))
        self.assertEqual(a("flutuante", 0.1 + 0.2), (decimal.Decimal("0.30000000000000004"), None))
        self.assertEqual(a("blob", b"\x00\xff"), (b"\x00\xff", None))
        with self.assertRaises(KeyError):
            a("regra_inexistente", 1)


class DeparaOficial(unittest.TestCase):
    def test_normalizacoes(self):
        self.assertEqual(depara.norm_cid10(" a00.0 "), "A000")
        self.assertEqual(depara.norm_cid10("A0"), None)
        self.assertEqual(depara.norm_sigtap(301010072), "0301010072")
        self.assertEqual(depara.norm_cbo("2251-25"), "225125")
        self.assertEqual(depara.norm_municipio(4314902), "431490")
        self.assertEqual(depara.norm_municipio("431490"), "431490")
        self.assertEqual(depara.norm_municipio(12), None)
        self.assertEqual(depara.norm_uf(b"rs"), "RS")
        self.assertEqual(depara.norm_banco(1), "001")

    def test_resolver_nunca_cria(self):
        d = depara.Depara("ibge_municipio", [("4314902", 7), ("3550308", 8)])
        self.assertEqual(d.resolver(431490), (7, None))
        self.assertEqual(d.resolver("4314902"), (7, None))
        self.assertEqual(d.resolver(999999), (None, "catalogo_codigo_inexistente"))
        self.assertEqual(d.resolver("12"), (None, "catalogo_codigo_invalido"))
        self.assertEqual(d.resolver(None), (None, None))
        self.assertEqual(d.resolver(0), (None, None))
        c = depara.Depara("cid10", [("A000", 1), ("J18", 2)])
        self.assertEqual(c.resolver("A00.0"), (1, None))
        self.assertEqual(c.resolver("j18"), (2, None))
        self.assertIn("terminologia", depara.consulta("cid10"))


class PaiPendente(unittest.TestCase):
    def test_propaga_em_cadeia_e_resolve(self):
        p = pendencia.Propagador()
        p.registrar("TBPAI", 1, "nome_ausente", "critica")
        s = p.avaliar("TBFILHA", 10, [("ID_TBPAI", "TBPAI", 1), ("ID_OUTRA", "TBOUTRA", None)])
        self.assertEqual(len(s), 1)
        self.assertEqual((s[0]["regra"], s[0]["gravidade"], s[0]["raiz"]), ("pai_pendente", "critica",
                                                                           ("TBPAI", "1", "nome_ausente")))
        self.assertTrue(p.pendente("TBFILHA", 10))
        n = p.avaliar("TBNETA", 100, [("ID_TBFILHA", "TBFILHA", 10)])
        self.assertEqual(n[0]["raiz"], ("TBPAI", "1", "nome_ausente"))
        self.assertEqual(p.avaliar("TBFILHA", 11, [("ID_TBPAI", "TBPAI", 2)]), [])
        p.registrar("TBFILHA", 12, "data_sentinela", "baixa")
        p.avaliar("TBFILHA", 12, [("ID_TBPAI", "TBPAI", 1)])
        self.assertEqual(p.pendencias("TBFILHA", 12), ["data_sentinela", "pai_pendente"])
        self.assertEqual(p.resolver("TBPAI", 1), [("TBFILHA", "10"), ("TBFILHA", "12"), ("TBNETA", "100")])
        self.assertFalse(p.pendente("TBNETA", 100))
        self.assertEqual(p.pendencias("TBFILHA", 12), ["data_sentinela"])  # a própria continua
        for x in s + n:  # pendência sem valor: só tabela, chave, coluna e regra
            self.assertEqual(set(x), {"tabela_origem", "chave_original", "regra", "gravidade", "coluna", "tabela_pai",
                                      "chave_pai", "raiz"})


    def test_pai_mais_grave_nao_apaga_pendencia_propria(self):
        p = pendencia.Propagador()
        p.registrar("C", "1", "cpf_invalido", "baixa")
        p.registrar("A", "9", "x", "alta")
        self.assertEqual(p.avaliar("C", "1", [("ID_A", "A", "9")])[0]["gravidade"], "alta")
        self.assertEqual(p.resolver("A", "9"), [("C", "1")])
        self.assertTrue(p.pendente("C", "1"))
        self.assertEqual(p.pendencias("C", "1"), ["cpf_invalido"])

    def test_dois_pais_pendentes(self):
        p = pendencia.Propagador()
        p.registrar("A", "1", "x", "critica")
        p.registrar("B", "2", "y", "baixa")
        p.avaliar("C", "5", [("ID_A", "A", "1"), ("ID_B", "B", "2")])
        p.avaliar("D", "7", [("ID_C", "C", "5")])
        # resolve primeiro o pai cuja raiz era a guardada (a mais grave): o filho segue pendente pelo outro
        self.assertEqual(p.resolver("A", "1"), [("C", "5")])
        self.assertEqual(p.pendencias("C", "5"), ["pai_pendente"])
        self.assertTrue(p.pendente("D", "7"))  # o neto segue pendente: o pai dele ainda está
        self.assertEqual(p.resolver("B", "2"), [("C", "5"), ("D", "7")])
        self.assertFalse(p.pendente("C", "5"))
        self.assertFalse(p.pendente("D", "7"))


DDL = """CREATE TABLE pai (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(30) NOT NULL,
  UNIQUE KEY uq_pai_codigo (codigo)
);

CREATE TABLE filha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pai_id BIGINT UNSIGNED NULL,
  velha INT NULL,
  CONSTRAINT ck_filha CHECK (velha > 0)
) COMMENT='x';

ALTER TABLE filha
  ADD COLUMN nova VARCHAR(10) NULL,
  DROP COLUMN velha;
ALTER TABLE filha
  ADD CONSTRAINT fk_filha_pai_id FOREIGN KEY (pai_id) REFERENCES pai (id);
"""


def _cenario():
    analise = [{"tabela": "TBPAI", "destino_tipo": "TABELA", "destino": "pai", "modulo": "CAD", "motivo": ""},
               {"tabela": "TBFILHA", "destino_tipo": "TABELA", "destino": "filha", "modulo": "PEP", "motivo": ""},
               {"tabela": "TBVELHA", "destino_tipo": "NAO", "destino": "", "modulo": "SIS", "motivo": "sem uso"}]
    volume = [{"tabela": "TBPAI", "registros": "5", "pk": "ID", "pk_inteira_unica": "S", "col_alteracao": "",
               "depende_de": ""},
              {"tabela": "TBFILHA", "registros": "200000", "pk": "ID", "pk_inteira_unica": "S", "col_alteracao": "",
               "depende_de": "TBPAI,TBVELHA"},
              {"tabela": "TBVELHA", "registros": "3", "pk": "", "pk_inteira_unica": "N", "col_alteracao": "",
               "depende_de": ""},
              {"tabela": "TBVAZIA", "registros": "0", "pk": "", "pk_inteira_unica": "N", "col_alteracao": "",
               "depende_de": ""}]
    with tempfile.TemporaryDirectory() as d:
        Path(d, "db/migracoes/01_X").mkdir(parents=True)
        Path(d, "db/migracoes/01_X/01_tabelas.sql").write_text(DDL, encoding="utf-8")
        ddl = mapa.ler_ddl(d)
    tab, deps, _, _ = mapa.montar(analise, volume, [])
    return dict(analise=analise, volume=volume, ddl=ddl, tabelas=tab, deps=deps, ciclos_decl=[],
                descartes=[{"padrao": ".*", "condicao": "vazia", "motivo": "vazia"}],
                colunas=[{"tabela": "TBFILHA", "coluna": "ID_TBPAI", "regra": "chave_origem", "referencia": "TBPAI",
                          "depara": ""}],
                colunas_decl=[{"tabela": "TBFILHA", "coluna": "ID_TBPAI", "destino": "filha.pai_id"}],
                catalogos_decl=[])


class MapaEVerificador(unittest.TestCase):
    def test_ddl_com_alter(self):
        c = _cenario()
        self.assertEqual(c["ddl"]["filha"]["colunas"], ["id", "pai_id", "nova"])
        self.assertEqual(len(c["ddl"]["filha"]["fks"]), 1)

    def test_montar_estrategia_ordem(self):
        c = _cenario()
        por = {r["tabela"]: r for r in c["tabelas"]}
        self.assertEqual(por["TBPAI"]["estrategia"], "hash_linha")
        self.assertEqual(por["TBFILHA"]["estrategia"], "faixa_id_hash_bloco")
        self.assertEqual(por["TBFILHA"]["dep_fora_do_mapa"], "TBVELHA")
        self.assertLess(int(por["TBPAI"]["ordem"]), int(por["TBFILHA"]["ordem"]))
        self.assertEqual(mapa.verificar_dados(**c), [])

    def test_falha_tabela_sem_destino_nem_descarte(self):
        c = _cenario()
        c["volume"].append({"tabela": "TBNOVA", "registros": "9", "pk": "ID", "pk_inteira_unica": "S",
                            "col_alteracao": "", "depende_de": ""})
        self.assertIn("tabela da origem sem destino nem descarte justificado: TBNOVA", mapa.verificar_dados(**c))
        c = _cenario()
        c["analise"][2]["motivo"] = ""
        c["tabelas"] = mapa.montar(c["analise"], c["volume"], [])[0]
        self.assertIn("descarte sem justificativa: TBVELHA", mapa.verificar_dados(**c))

    def test_falha_ciclo_nao_declarado_e_aceita_declarado(self):
        c = _cenario()
        c["volume"][0]["depende_de"] = "TBFILHA"
        c["tabelas"], c["deps"], ciclos, arestas = mapa.montar(c["analise"], c["volume"], [])
        self.assertEqual(ciclos, [["TBFILHA", "TBPAI"]])
        self.assertIn("ciclo não declarado em declarado/ciclos.tsv: TBFILHA,TBPAI", mapa.verificar_dados(**c))
        c["ciclos_decl"] = mapa.propor_quebras(ciclos, arestas, c["tabelas"])
        self.assertEqual([(q["tabela"], q["depende_de"]) for q in c["ciclos_decl"]], [("TBPAI", "TBFILHA")])
        c["tabelas"], c["deps"], ciclos, _ = mapa.montar(c["analise"], c["volume"], c["ciclos_decl"])
        self.assertEqual((ciclos, mapa.verificar_dados(**c)), ([], []))

    def test_falha_coluna_de_destino_inexistente(self):
        c = _cenario()
        c["colunas_decl"][0]["destino"] = "filha.velha"  # apagada pelo ALTER
        self.assertIn("coluna de destino inexistente no DDL: TBFILHA.ID_TBPAI -> filha.velha",
                      mapa.verificar_dados(**c))
        c["colunas_decl"][0]["destino"] = "pai.codigo"
        self.assertIn("coluna de destino fora dos destinos da tabela: TBFILHA.ID_TBPAI -> pai.codigo",
                      mapa.verificar_dados(**c))
        c = _cenario()
        c["analise"][0]["destino"] = "tabela_que_nao_existe"
        c["tabelas"] = mapa.montar(c["analise"], c["volume"], [])[0]
        self.assertIn("destino inexistente no DDL: TBPAI -> tabela_que_nao_existe", mapa.verificar_dados(**c))

    def test_falha_mapa_desatualizado_e_regra_desconhecida(self):
        c = _cenario()
        c["tabelas"][0] = dict(c["tabelas"][0], estrategia="hash_bloco_chave")
        c["colunas"][0]["regra"] = "inventada"
        e = mapa.verificar_dados(**c)
        self.assertTrue(any(x.startswith("tabelas.tsv desatualizado") for x in e))
        self.assertIn("regra de coluna desconhecida: TBFILHA.ID_TBPAI", e)

    def test_catalogo_oficial_nunca_gravado(self):
        # `pai` passa a ser oficial (versao_fonte): TBPAI vira de-para; parte oficial de uma tabela mista sai do destino
        c = _cenario()
        ddl_ofi = DDL.replace("codigo VARCHAR(30) NOT NULL,", "codigo VARCHAR(30) NOT NULL,\n  versao_fonte VARCHAR(30) NULL,")
        with tempfile.TemporaryDirectory() as d:
            Path(d, "db/migracoes/01_X").mkdir(parents=True)
            Path(d, "db/migracoes/01_X/01_tabelas.sql").write_text(ddl_ofi, encoding="utf-8")
            c["ddl"] = mapa.ler_ddl(d)
        ofi = mapa.oficiais(c["ddl"])
        self.assertEqual(ofi, {"pai"})
        # mapa antigo (pai gravado): o verificador recusa
        e = mapa.verificar_dados(**c)
        self.assertIn("tabela carregável grava em catálogo oficial: TBPAI -> pai", e)
        # tabela mista: a parte oficial vira de-para; só o resto é gravado
        c["analise"][1]["destino"] = "filha;pai"
        c["tabelas"], c["deps"], _, _ = mapa.montar(c["analise"], c["volume"], [], ofi)
        por = {r["tabela"]: r for r in c["tabelas"]}
        self.assertEqual((por["TBPAI"]["estrategia"], por["TBPAI"]["tabelas_destino"], por["TBPAI"]["destinos_oficiais"]),
                         ("depara_catalogo_oficial", "", "pai"))
        self.assertEqual((por["TBFILHA"]["tabelas_destino"], por["TBFILHA"]["destinos_oficiais"]), ("filha", "pai"))
        e = mapa.verificar_dados(**c)
        self.assertIn("tabela com destino em catálogo oficial sem declaração em declarado/catalogos.tsv: TBPAI", e)
        self.assertIn("tabela com destino em catálogo oficial sem declaração em declarado/catalogos.tsv: TBFILHA", e)
        c["catalogos_decl"] = [{"tabela": "TBPAI", "catalogo": "oficial:pai", "coluna_codigo": "", "motivo": "teste"},
                               {"tabela": "TBFILHA", "catalogo": "oficial:pai", "coluna_codigo": "", "motivo": "teste"}]
        c["colunas_decl"] = []
        self.assertEqual(mapa.verificar_dados(**c), [])
        # declarada como catálogo mas sem destino oficial (seria gravada inteira): recusa
        c2 = _cenario()
        c2["catalogos_decl"] = [{"tabela": "TBPAI", "catalogo": "cid10", "coluna_codigo": "COD", "motivo": ""}]
        self.assertIn("tabela declarada como catálogo sem destino oficial (seria gravada inteira): TBPAI (hash_linha)",
                      mapa.verificar_dados(**c2))
        # oficiais.tsv: N tira uma tabela do grupo; tabela inexistente ou sem motivo é recusada
        self.assertEqual(mapa.oficiais(c["ddl"], [{"tabela": "pai", "oficial": "N", "motivo": "x"}]), frozenset())
        c["oficiais_decl"] = [{"tabela": "nao_existe", "oficial": "S", "motivo": ""}]
        e = mapa.verificar_dados(**c)
        self.assertIn("oficiais.tsv cita tabela inexistente no DDL: nao_existe", e)
        self.assertIn("oficiais.tsv sem oficial S/N ou sem motivo: nao_existe", e)

    def test_destino_time_exige_regra_de_hora(self):
        c = _cenario()
        ddl_t = DDL.replace("nova VARCHAR(10) NULL", "nova TIME NULL")
        with tempfile.TemporaryDirectory() as d:
            Path(d, "db/migracoes/01_X").mkdir(parents=True)
            Path(d, "db/migracoes/01_X/01_tabelas.sql").write_text(ddl_t, encoding="utf-8")
            c["ddl"] = mapa.ler_ddl(d)
        self.assertEqual(mapa.tipo_coluna_ddl(c["ddl"], "filha", "nova"), "TIME")
        c["colunas"].append({"tabela": "TBFILHA", "coluna": "HORARIO", "regra": "data_hora", "referencia": "", "depara": ""})
        c["colunas_decl"].append({"tabela": "TBFILHA", "coluna": "HORARIO", "destino": "filha.nova"})
        self.assertIn("destino TIME com regra data_hora (use hora_em_timestamp, hora_hhmm ou hora): TBFILHA.HORARIO -> "
                      "filha.nova", mapa.verificar_dados(**c))
        c["colunas_decl"][-1]["regra"] = "hora_em_timestamp"
        self.assertEqual(mapa.verificar_dados(**c), [])

    def test_tabelas_sem_mapa(self):
        tab = [{"tabela": "TBPAI"}, {"tabela": "TBVELHA"}]
        desc = [{"padrao": "SGH_.*", "condicao": "qualquer", "motivo": "x"}, {"padrao": ".*", "condicao": "vazia",
                                                                              "motivo": "y"}]
        cont = {"TBPAI": 5, "TBVELHA": 3, "SGH_X": 9, "TBVAZIA": 0, "TBNOVA": 7, "OUTRA": 1}
        self.assertEqual(mapa.tabelas_sem_mapa(cont, tab, desc), [("OUTRA", 1), ("TBNOVA", 7)])

    @unittest.skipUnless((mapa.RAIZ / mapa.MAPA_ANALISE).exists(), "fora do repositório (container): a esteira roda")
    def test_mapa_do_repositorio_valido(self):
        self.assertEqual(mapa.verificar(), [])


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql"), "só no container do conector (imagem sintética)")
class ImagemSintetica(unittest.TestCase):
    """BLOB de texto (EX_ANEXO.NOTA, SUB_TYPE 1) e tabela_sem_mapa sobre a imagem SINTÉTICA do cliente de exemplo."""

    @classmethod
    def setUpClass(cls):
        from sante_conector import sintetica
        cls.dir = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "origens-teste-l4")
        shutil.rmtree(cls.dir, ignore_errors=True)
        os.makedirs(cls.dir)
        cls.arq = os.path.join(cls.dir, "exemplo-l4.fdb")
        cls.manif = sintetica.gerar(cls.arq, mapa=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_blob_texto_vira_texto_e_hash_fica_nos_bytes(self):
        from sante_conector import abridor
        from sante_conector.leitor import Leitor, hash_linha
        from sante_conector.texto import cp1252_para_texto
        with abridor.abrir(self.arq, modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
            cols = {c["nome"]: c for c in lt.colunas("EX_ANEXO")}
            regra = {n: sentinela.classificar(n, c["codigo_tipo"], c["bytes"], c["escala"], c["subtipo"])
                     for n, c in cols.items()}
            self.assertEqual((regra["NOTA"], regra["CONTEUDO"]), ("texto_longo", "blob"))
            # mapa gerado de dicionário sem subtipo: o dicionário vivo corrige na execução
            self.assertEqual(sentinela.regra_efetiva("blob", cols["NOTA"]["subtipo"]), "texto_longo")
            nomes, it = lt.ler_faixa("EX_ANEXO", "ID", 1, 21)
            linhas = list(it)
        i_nota, i_cont = nomes.index("NOTA"), nomes.index("CONTEUDO")
        self.assertTrue(linhas)
        for l in linhas:
            texto, pend = sentinela.aplicar("texto_longo", l[i_nota])
            self.assertIsNone(pend)
            self.assertIsInstance(texto, str)
            self.assertTrue(texto.startswith("ação nota "))
            self.assertEqual(texto, cp1252_para_texto(l[i_nota]))
            self.assertEqual(sentinela.aplicar("blob", l[i_cont]), (l[i_cont], None))  # binário intacto
            self.assertIsInstance(hash_linha(l), str)  # o hash da linha continua sobre os bytes crus
            self.assertNotEqual(hash_linha(l), hash_linha(tuple(texto if k == i_nota else v for k, v in enumerate(l))))

    def test_tabela_sem_mapa_na_imagem_sintetica(self):
        m = mapa.carregar_execucao()  # o mapa montado no container (/app/mapa)
        sem = dict(mapa.tabelas_sem_mapa(self.manif["contagens"], m["tabelas"], m["descartes"]))
        ex = {t for t, n in self.manif["contagens"].items() if t.startswith("EX_") and n > 0}
        self.assertTrue(ex)
        self.assertEqual(set(sem), ex)  # as do cliente de exemplo, fora do mapa, viram pendência
        for t in ("TBUSERS", "TBHOSPIT", "RICADPAC", "ATCABECATEND"):
            self.assertNotIn(t, sem)


if __name__ == "__main__":
    unittest.main()
