"""Autoconferência do L4 (mapa declarativo, verificador, de-para oficial, sentinelas e pendência "pai pendente").

Sem banco e sem Firebird; só valores inventados. O último caso roda o verificador sobre o mapa real do repositório.
"""
import datetime
import decimal
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
        self.assertEqual(c("NOME", 37, 40, 0), "texto")
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
        for d in (datetime.date(1899, 12, 30), datetime.date(1900, 1, 1), datetime.date(1, 1, 1),
                  datetime.datetime(1899, 12, 30, 10, 0)):
            self.assertEqual(a("data_hora" if isinstance(d, datetime.datetime) else "data", d), (None, "data_sentinela"))
        self.assertEqual(a("data", datetime.date(2020, 2, 29)), (datetime.date(2020, 2, 29), None))
        self.assertEqual(a("hora_hhmm", 830), (datetime.time(8, 30), None))
        self.assertEqual(a("hora_hhmm", 0), (datetime.time(0, 0), None))
        self.assertEqual(a("hora_hhmm", 2400), (None, "hora_invalida"))
        self.assertEqual(a("hora_hhmm", 1261), (None, "hora_invalida"))
        self.assertEqual(a("texto_char", b"ABC     "), ("ABC", None))
        self.assertEqual(a("texto", b"  Jo\xe3o   da\xa0Silva "), ("João da Silva", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("codigo_char", b"m"), ("M", None))
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
        self.assertEqual(p.resolver("TBPAI", 1), [("TBFILHA", "10"), ("TBFILHA", "12"), ("TBNETA", "100")])
        self.assertFalse(p.pendente("TBNETA", 100))
        for x in s + n:  # pendência sem valor: só tabela, chave, coluna e regra
            self.assertEqual(set(x), {"tabela_origem", "chave_original", "regra", "gravidade", "coluna", "tabela_pai",
                                      "chave_pai", "raiz"})


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

    @unittest.skipUnless((mapa.RAIZ / mapa.MAPA_ANALISE).exists(), "fora do repositório (container): a esteira roda")
    def test_mapa_do_repositorio_valido(self):
        self.assertEqual(mapa.verificar(), [])


if __name__ == "__main__":
    unittest.main()
