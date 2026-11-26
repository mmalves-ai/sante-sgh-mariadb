"""Recusas da carga, fase 2 (lote C1b): cargas à parte do motor do mapa.

- M14 (R18): a cobertura do par (paciente, fonte pagadora) pela ficha do atendimento no `carga.py`;
- M13 (R16, ADR 0011): a semente do espelho no banco do CLIENTE, com `#so_se` encadeado, campo `;se:` e ressemeadura;
- sequência pelo maior número migrado (`#max:<tabela>.<coluna>`, A05, substitui o M9).
Dados 100% falsos; só contagens."""
import datetime
import os
import unittest

from sante_conector import carga, mapa, semente_espelho, sincronizar
from sante_conector.sintetica_d import l8_05


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and _mariadb()


class LeitorMemoria:
    """Leitor da origem em memória: {tabela: (chave primária, colunas, linhas)}."""

    def __init__(self, tabelas):
        self.t = tabelas

    def tabelas(self):
        return list(self.t)

    def chave_primaria(self, t):
        return list(self.t[t][0])

    def colunas(self, t):
        return [{"nome": c, "codigo_tipo": 37} for c in self.t[t][1]]

    def ler_tudo(self, t, colunas=None):
        _pk, cols, linhas = self.t[t]
        colunas = list(colunas or cols)
        ix = [cols.index(c) for c in colunas]
        return colunas, iter([tuple(r[i] for i in ix) for r in linhas])


def _banco_ddl(root, nome, tabelas, extra=""):
    from sante_conector import conferencia
    ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
    with root.cursor() as c:
        c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
        c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
        c.execute("USE `%s`" % nome)
        for t in tabelas:
            c.execute(conferencia._sem_fk(ddl[t]["create"]))
            for a in ddl[t]["alter"]:
                if "FOREIGN KEY" not in a:
                    c.execute(a)
        for st in [x for x in extra.split(";") if x.strip()]:
            c.execute(st)


class Sintaxe(unittest.TestCase):
    def test_encadeada_condicao_e_campo_condicional(self):
        lt = LeitorMemoria(l8_05.ORIGEM_ESPELHO_CLIENTE)
        pais = {}
        self.assertEqual(semente_espelho._cadeia("TAB>TBCTRMEM>REF_SIMP"), ("TAB", [("TBCTRMEM", "REF_SIMP")]))
        self.assertEqual(semente_espelho._base("VALOR;se:PFB=T"), "VALOR")
        self.assertEqual(semente_espelho._base("TAB>TBCTRMEM>REF_SIMP=S,T"), "TAB")
        with self.assertRaises(RuntimeError):
            semente_espelho._cadeia("TAB>TBCTRMEM")
        so = {"TAB": 6, "PFB": "T", "VALOR": 10.0}
        duas = {"TAB": 7, "PFB": None, "VALOR": 9.0}
        bra = {"TAB": 3, "PFB": "F", "VALOR": 0.0}
        cond_s, cond_b = "TAB>TBCTRMEM>REF_SIMP=S,T", "TAB>TBCTRMEM>REF_SIMP=N,F,"
        self.assertEqual([semente_espelho._cond(cond_s, x, lt, pais) for x in (so, duas, bra)], [True, True, False])
        self.assertEqual([semente_espelho._cond(cond_b, x, lt, pais) for x in (so, duas, bra)], [False, False, True])
        self.assertEqual(semente_espelho._campo(lt, pais, so, "VALOR;se:PFB=T"), "10.0")
        self.assertEqual(semente_espelho._campo(lt, pais, so, "VALOR;se:PFB=F,"), "")
        self.assertEqual(semente_espelho._campo(lt, pais, duas, "VALOR;se:PFB=F,"), "9.0")  # PFB vazio: consumidor
        self.assertEqual(semente_espelho._campo(lt, pais, {"ID_TBMATMED": 3}, "ID_TBMATMED>TBMATMED>NOME"),
                         "Item exemplo tres")
        self.assertEqual(semente_espelho._ressemear(["brasindice:0", "simpro"]), {("brasindice", "0"), "simpro"})

    def test_ficha_le_extras_fora_do_hash_e_conciliacao_so_da_ficha(self):
        self.assertEqual(carga.MAPA["RECADATE"]["colunas"], ["REG", "ID_ATCABECATEND"])  # hash da ficha intacto
        lt = LeitorMemoria({"RECADATE": (["REG"], ["REG", "ID_ATCABECATEND", "CONV", "MATRICULA", "DT_ATE", "X"],
                                         [(1, 10, 2, "C1", datetime.date(2025, 1, 2), 9)])})
        c = carga.Carga(lt, None, "ctl", 1, 1)
        (l,) = list(c._linhas("RECADATE"))
        self.assertEqual(sorted(l), ["CONV", "DT_ATE", "ID_ATCABECATEND", "MATRICULA", "REG"])
        self.assertIn("co.entidade_destino='atendimento'", carga.Carga.DESTINO["atendimento_ficha"][1])
        c.existente["RECADATE"] = {"1": (5, b"", None, None, None)}
        self.assertTrue(c._cobertura_por_fazer())
        c.existente["RECADATE"]["1/cobertura_paciente"] = (None, b"", None, "cobertura_sem_convenio", "media")
        self.assertFalse(c._cobertura_por_fazer())


@unittest.skipUnless(NO_CONTAINER and os.path.isdir("/app/db/migracoes"), "só no container do conector, com o MariaDB")
class EspelhoDoCliente(unittest.TestCase):
    BANCO = "c1b_espelho_cliente_teste"

    def test_semente_no_cliente_por_edicao_e_ressemeadura(self):
        from sante_conector import banco
        lt = LeitorMemoria(l8_05.ORIGEM_ESPELHO_CLIENTE)
        decl = semente_espelho.ler_declaracao()
        antiga = {"brasindice": {"tabela": decl["brasindice"]["tabela"], "campos": {
            k: v for k, v in decl["brasindice"]["campos"].items() if k != "#so_se"}}}  # a semente de antes do R16
        root = banco.conectar(None, multi=True)
        try:
            _banco_ddl(root, self.BANCO, semente_espelho.CLIENTE_MATMED)
            cx = banco.conectar(self.BANCO, autocommit=False, multi=True)
            try:
                r0 = semente_espelho.semear(lt, cx, decl=antiga)
                self.assertEqual((r0["brasindice"]["0"]["origem"], r0["brasindice"]["0"]["validas"],
                                  r0["brasindice"]["0"]["situacao"]), (7, 5, "semeada"))  # o Simpro dentro do '0'
                with cx.cursor() as c:  # a edição '0' como veio do espelho padrão (sem a marca da semente)
                    c.execute("UPDATE edicao_referencia_matmed SET dados=NULL WHERE numero_edicao='0'")
                cx.commit()
                r1 = semente_espelho.semear(lt, cx, decl=decl)
                r2 = semente_espelho.semear(lt, cx, decl=decl, ressemear=["brasindice:0"])
                r3 = semente_espelho.semear(lt, cx, decl=decl)
            finally:
                cx.close()
            for cat, eds in l8_05.ESPERADO_ESPELHO_CLIENTE.items():
                for ed, (origem, validas, recusadas) in eds.items():
                    r = r2[cat][ed]
                    self.assertEqual((r["origem"], r["validas"], r["recusadas"], r["espelho"], r["conferido"]),
                                     (origem, validas, recusadas, validas, True), (cat, ed))
            self.assertEqual((r1["brasindice"]["0"]["situacao"], r1["brasindice"]["0"]["conferido"]),
                             ("adotada_do_espelho_padrao", False))
            self.assertEqual((r2["brasindice"]["0"]["situacao"], r2["brasindice"]["0"]["precos_apagados"]),
                             ("ressemeada", 5))
            self.assertEqual(r2["_itens_sem_preco"], {"brasindice": 4})  # 501 a 504 ficam como item, sem preço
            self.assertEqual({k: v["situacao"] for k, v in r1["simpro"].items()},
                             {"2025-03-01": "semeada", "2025-04-01": "semeada"})
            self.assertEqual({(c, e): v["situacao"] for c in ("brasindice", "simpro") for e, v in r3[c].items()},
                             {("brasindice", "0"): "ja_semeada", ("brasindice", "101"): "ja_semeada",
                              ("simpro", "2025-03-01"): "ja_semeada", ("simpro", "2025-04-01"): "ja_semeada"})
            with root.cursor() as c:
                c.execute("USE `%s`" % self.BANCO)
                c.execute("SELECT i.codigo_referencia, p.preco_fabrica IS NULL, p.preco_maximo_consumidor IS NULL"
                          " FROM preco_referencia_matmed p JOIN item_referencia_matmed i ON i.id=p.item_referencia_matmed_id"
                          " JOIN edicao_referencia_matmed e ON e.id=p.edicao_referencia_matmed_id WHERE"
                          " i.fonte_referencia='simpro' AND e.numero_edicao='2025-03-01' ORDER BY 1")
                self.assertEqual([tuple(x) for x in c.fetchall()], [("501", 0, 1), ("502", 1, 0), ("503", 1, 0)])
                c.execute("SELECT COUNT(*) FROM edicao_referencia_matmed WHERE dados LIKE '%base_do_cliente%'")
                self.assertEqual(c.fetchone()[0], 4)
                c.execute("SELECT COUNT(*) FROM item_referencia_matmed WHERE origem='migracao'")
                self.assertEqual(c.fetchone()[0], 0)  # o _espelho_carregado reconhece os itens da semente
        finally:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
            root.close()


@unittest.skipUnless(NO_CONTAINER and os.path.isdir("/app/db/migracoes"), "só no container do conector, com o MariaDB")
class CoberturaDaFicha(unittest.TestCase):
    BANCO, CTL = "c1b_cobertura_teste", "c1b_cobertura_ctl_teste"

    def test_cobertura_do_par_adota_cria_e_nao_repete(self):
        from sante_conector import banco, controle
        root = banco.conectar(None, multi=True)
        hoje = datetime.date.today()
        try:
            _banco_ddl(root, self.BANCO, ["fonte_pagadora", "cobertura_paciente", "cobertura_atendimento",
                                          "titular_cobertura"],
                       "CREATE TABLE atendimento (id BIGINT UNSIGNED PRIMARY KEY, paciente_id BIGINT UNSIGNED NULL);"
                       "INSERT INTO atendimento VALUES (1,100),(2,100),(3,100),(4,200),(5,300)")
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.CTL)
                c.execute("CREATE DATABASE `%s`" % self.CTL)
                for st in controle.DDL.format(b="`%s`" % self.CTL).split(";\n"):
                    if st.strip():
                        c.execute(st)
            cx = banco.conectar(self.BANCO, autocommit=False)
            h = b"\x01" * 16
            fichas = [("11", {"CONV": 1, "MATRICULA": "A1", "DT_ATE": hoje - datetime.timedelta(10)}, h, 1),
                      ("12", {"CONV": 1, "MATRICULA": "A2 ", "DT_ATE": hoje - datetime.timedelta(5)}, h, 2),
                      ("13", {"CONV": 2, "MATRICULA": None, "DT_ATE": hoje - datetime.timedelta(1000)}, h, 3),
                      ("14", {"CONV": 2, "MATRICULA": "B", "DT_ATE": None}, h, 4),
                      ("15", {"CONV": None, "MATRICULA": "C", "DT_ATE": hoje}, h, 5)]
            try:
                c1 = carga.Carga(None, cx, self.CTL, 1, 1)
                c1.existente = {"RECADATE": {}, "TBCONVEN": {}, "TBCBOPRO": {}}
                f1 = c1._fonte("1")
                with cx.cursor() as c:  # o vínculo paciente-convênio já carregado, sem carteira
                    c.execute("INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, vigencia_inicio, origem,"
                              " criado_em) VALUES (100, %s, '2020-01-01', 'migracao', UTC_TIMESTAMP(3))", (f1,))
                c1._coberturas(fichas)
                c1._commit()
                cont = c1.cont
                self.assertEqual([cont[k] for k in ("coberturas_criadas", "coberturas_adotadas", "coberturas_vencidas",
                                                    "carteiras_divergentes", "cobertura_atendimento_criadas")],
                                 [2, 1, 1, 1, 4])
                with cx.cursor() as c:
                    c.execute("SELECT COUNT(*), SUM(situacao='vencida'), SUM(numero_carteira='A2'),"
                              " SUM(origem='migracao') FROM cobertura_paciente")
                    self.assertEqual([int(x) for x in c.fetchone()], [3, 1, 1, 3])
                    c.execute("SELECT atendimento_id, numero_carteira FROM cobertura_atendimento ORDER BY 1")
                    self.assertEqual([tuple(x) for x in c.fetchall()], [(1, "A1"), (2, "A2"), (3, None), (4, "B")])
                    c.execute("SELECT regra, COUNT(*) FROM `%s`.pendencia GROUP BY regra ORDER BY regra" % self.CTL)
                    self.assertEqual({r: n for r, n in c.fetchall()},
                                     {"cadastro_provisorio_a_completar": 2, "carteira_divergente": 1,
                                      "cobertura_sem_convenio": 2, "valor_presumido": 1})
                    c.execute("SELECT COUNT(*), COUNT(id_destino) FROM `%s`.conector_origem WHERE tabela_origem="
                              "'RECADATE' AND chave_original LIKE '%%/cobertura_paciente'" % self.CTL)
                    self.assertEqual(list(c.fetchone()), [5, 4])
                    c.execute("SELECT id FROM cobertura_paciente WHERE fonte_pagadora_id=%s", (f1,))
                    (cob1,) = c.fetchone()
                    c.execute("INSERT INTO titular_cobertura (cobertura_paciente_id, nome, criado_em) VALUES"
                              " (%s, 'Titular exemplo', UTC_TIMESTAMP(3))", (cob1,))
                    self.assertEqual(carga.ligar_titular_cobertura(c), 2)
                cx.commit()
                # reexecução: tudo registrado, nada novo
                c2 = carga.Carga(None, cx, self.CTL, 2, 1)
                for t in ("RECADATE", "TBCONVEN", "TBCBOPRO"):
                    c2._carregar_existente(t)
                c2._coberturas(fichas)
                c2._commit()
                with cx.cursor() as c:
                    c.execute("SELECT (SELECT COUNT(*) FROM cobertura_paciente), (SELECT COUNT(*) FROM"
                              " cobertura_atendimento), (SELECT COUNT(*) FROM `%s`.pendencia WHERE execucao_id=2)"
                              % self.CTL)
                    self.assertEqual(list(c.fetchone()), [3, 4, 0])
            finally:
                cx.close()
        finally:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.CTL)
            root.close()


@unittest.skipUnless(NO_CONTAINER and os.path.isdir("/app/db/migracoes"), "só no container do conector, com o MariaDB")
class SequenciaPeloMaximo(unittest.TestCase):
    BANCO = "c1b_sequencia_teste"

    def test_max_migrado_sem_recuar(self):
        from sante_conector import banco, controle
        root = banco.conectar(None, multi=True)
        try:
            _banco_ddl(root, self.BANCO, ["sequencia_negocio"],
                       "CREATE TABLE documento_estoque (id BIGINT UNSIGNED PRIMARY KEY, numero BIGINT UNSIGNED);"
                       "INSERT INTO documento_estoque VALUES (1, 7), (2, 1655);"
                       "CREATE TABLE requisicao_material (id BIGINT UNSIGNED PRIMARY KEY, numero BIGINT UNSIGNED);"
                       "INSERT INTO requisicao_material VALUES (1, 10);"
                       "INSERT INTO sequencia_negocio (tipo, proximo_valor, criado_em) VALUES"
                       " ('requisicao_material', 9000, UTC_TIMESTAMP(3))")
            with root.cursor() as c:
                for st in controle.DDL.format(b="`%s`" % self.BANCO).split(";\n"):
                    if st.strip() and "conector_generator" in st:
                        c.execute(st)
            cx = banco.conectar(self.BANCO, autocommit=False)

            class Gen:
                def generators(self):
                    return {"GEN_EXEMPLO": 41}

            class CM:
                ctl, eid, lt = "`%s`" % self.BANCO, 1, Gen()
                pend, sinc_res = [], {"sequencias": {}}
                mapa_exec = {"sequencias": [
                    {"generator": "#max:documento_estoque.numero", "tipo": "documento_estoque"},
                    {"generator": "#max:requisicao_material.numero", "tipo": "requisicao_material"},
                    {"generator": "#max:inexistente.numero", "tipo": "x"},
                    {"generator": "GEN_EXEMPLO", "tipo": "exemplo"}]}

                def _c(self):
                    return cx.cursor()

                def _todas(self, sql, args=()):
                    with cx.cursor() as c:
                        c.execute(sql, args)
                        return c.fetchall()

                def _pendencia(self, *a):
                    self.pend.append(a[2])

                def _commit(self):
                    cx.commit()
            try:
                cm = CM()
                sincronizar.sequencias(cm)
                self.assertEqual(cm.sinc_res["sequencias"], {"documento_estoque": 1656, "requisicao_material": 9000,
                                                             "exemplo": 42})
                self.assertEqual(cm.pend, ["sequencia_maximo_invalido"])
                self.assertIsNone(sincronizar.proximo_pelo_maximo(cm, "documento_estoque.numero; DROP"))
            finally:
                cx.close()
        finally:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
            root.close()


if __name__ == "__main__":
    unittest.main()
