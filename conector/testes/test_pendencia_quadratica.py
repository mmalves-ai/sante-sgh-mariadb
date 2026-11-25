"""Pendências gravadas uma vez, continuação e batimento (rodada pendencia-quadratica, 2026-11-23).

Sintoma: na execução 12 da ProntoCardio (continuação da 11) o MariaDB recebeu ~9.400 INSERTs/s em `pendencia` por
50 min e o AUTO_INCREMENT subiu ~23 milhões sem as linhas. Causa: `continuar.repetir_pendencias` copiava as 46 milhões
de pendências abertas da execução 11 com `executemany` (um INSERT por linha, porque o VALUES tem a função de data),
numa transação só e sem batimento; a carga parada desfez tudo. O `_commit` das cargas (carga.py e carga_mapa.py) já
esvaziava a lista depois de gravar: aqui fica provado que N lotes com k pendências são N·k linhas, não N²·k/2.
Só dados falsos."""
import os
import unittest
import unittest.mock

from sante_conector import carga, carga_mapa, continuar


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TEM_BANCO = _mariadb()


class _Cur:
    """Cursor falso: conta as linhas de pendência enviadas ao banco (executemany e INSERT de várias linhas)."""

    def __init__(self, conta):
        self.conta, self._result = conta, None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=()):
        if ".pendencia" in sql and sql.lstrip().upper().startswith("INSERT"):
            self.conta["comandos"] += 1
            self.conta["linhas"] += sql.count("UTC_TIMESTAMP(3)") if "VALUES" in sql else 0

    def executemany(self, sql, linhas):
        for _ in linhas:
            self.conta["comandos"] += 1
            self.conta["linhas"] += 1


class _Con:
    def __init__(self):
        self.conta = {"comandos": 0, "linhas": 0, "commits": 0}

    def cursor(self, *a):
        return _Cur(self.conta)

    def commit(self):
        self.conta["commits"] += 1


def _lotes(cg, n, k):
    for i in range(n):
        for j in range(k):
            cg._pendencia("ATCABECATEND", "%d-%d" % (i, j), "carater_estimado", "baixa")
        cg._commit()


class PendenciaUmaVez(unittest.TestCase):
    N, K = 40, 25

    def _carga(self, cls):
        cg = object.__new__(cls)
        cg.cr, cg.ctl, cg.eid = _Con(), "`ctl`", 1
        cg.pend, cg._buf, cg._diario, cg._reemitidas = [], [], [], {}
        return cg

    def test_carga_propria_linear(self):
        cg = self._carga(carga.Carga)
        _lotes(cg, self.N, self.K)
        self.assertEqual(cg.cr.conta["linhas"], self.N * self.K)  # quadrático seria N(N+1)/2 · k = 20.500
        self.assertEqual(len(cg.pend), self.N * self.K)
        self.assertEqual(cg._buf, [])

    def test_carga_mapa_linear(self):
        cg = self._carga(carga_mapa.CargaMapa)
        cg._fila, cg._esvaziando = [], False
        _lotes(cg, self.N, self.K)
        self.assertEqual(cg.cr.conta["linhas"], self.N * self.K)
        self.assertLessEqual(cg.cr.conta["comandos"], self.N * 2)  # INSERT de várias linhas por lote
        self.assertEqual(cg._buf, [])


class BatimentoDentroDaTabela(unittest.TestCase):
    """(c) O batimento (plataforma.progresso grava batimento_em) é repetido dentro da tabela longa, com a contagem de
    linhas processadas, nos dois caminhos: commit de lote (carga própria e CargaMapa linha a linha/onda de uma tabela)
    e coordenador da onda em paralelo (paralelo._servir)."""

    def _carga(self, intervalo):
        chamadas = []
        cg = object.__new__(carga.Carga)
        cg.cr, cg.ctl, cg.eid = _Con(), "`ctl`", 1
        cg.pend, cg._buf, cg._diario, cg._reemitidas = [], [], [], {}
        cg.progresso = carga.Batimento(lambda f, e: chamadas.append((f, e)))
        cg.progresso.INTERVALO = intervalo
        cg.vistas, cg._tab_atual = {"ATCABECATEND": set()}, "ATCABECATEND"
        cg.progresso(0.5, "carregando atendimento")
        return cg, chamadas

    def test_carga_pulsa_a_cada_lote_com_contagem(self):
        cg, chamadas = self._carga(0)
        for i in range(5):
            cg.vistas["ATCABECATEND"].update("%d-%d" % (i, j) for j in range(1000))
            cg._commit()
        self.assertEqual(len(chamadas), 6)
        self.assertEqual(chamadas[-1], (0.5, "carregando atendimento: 5000 linhas processadas"))

    def test_carga_limita_pelo_intervalo(self):
        cg, chamadas = self._carga(3600)
        for _ in range(50):
            cg._commit()
        self.assertEqual(len(chamadas), 1)  # só o início da tabela: nenhum UPDATE a mais dentro do intervalo

    def test_carga_mapa_herda_o_batimento(self):
        cm = object.__new__(carga_mapa.CargaMapa)
        carga.Carga.__init__(cm, None, _Con(), "ctl", 1, 1, lambda f, e: None)
        self.assertIsInstance(cm.progresso, carga.Batimento)

    def test_coordenador_da_onda_pulsa(self):
        from multiprocessing import Pipe
        from sante_conector import paralelo
        chamadas = []
        cm = type("CM", (), {})()
        cm.progresso = carga.Batimento(lambda f, e: chamadas.append((f, e)))
        cm.progresso.INTERVALO = 0
        cm.progresso(0.3, "carregando 2 tabelas em paralelo (onda 1 de 1)")
        pai, filho = Pipe()
        filho.send((1, "prox", (99,)))
        filho.send((2, "fim", (None,)))
        with unittest.mock.patch.object(paralelo.os, "waitpid"), unittest.mock.patch.object(paralelo, "_juntar"):
            paralelo._servir(cm, {pai: 12345}, [], lambda f: None)
        self.assertGreaterEqual(len(chamadas), 3)
        self.assertTrue(chamadas[-1][1].startswith("carregando 2 tabelas em paralelo (onda 1 de 1): "))


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class RepetirPendencias(unittest.TestCase):
    COD = "pq_repetir"
    N = 1000

    def setUp(self):
        from sante_conector import banco, controle
        self.root = banco.conectar(None, multi=True)
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(self.root, self.COD, self.cli)
        self.cn = banco.conectar(self.cli, autocommit=False)
        linhas = [(1, "TAB_A", "a%d" % i, "pai_pendente", "alta", None) for i in range(self.N)]
        linhas += [(1, "TAB_B", "b%d" % i, "restricao_destino_1048", "critica", "coluna_x") for i in range(self.N // 2)]
        linhas += [(1, "TAB_C", "c%d" % i, "valor_presumido", "baixa", None) for i in range(77)]  # não pulada
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,NOW())" % self.ctl, linhas)
            c.execute("UPDATE `%s`.pendencia SET situacao='resolvida' WHERE chave_original IN ('a0','b0')" % self.ctl)
        self.cn.commit()

    def tearDown(self):
        self.cn.close()
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _cm(self, conta):
        import pymysql.cursors

        class Contador(pymysql.cursors.Cursor):
            def execute(s, sql, args=None):
                if ".pendencia" in sql and sql.lstrip().upper().startswith("INSERT"):
                    conta["insert"] += 1
                return super().execute(sql, args)

        cm = type("CM", (), {})()
        cm.ctl, cm.eid, cm.pend, cm.pend_repetidas = "`%s`" % self.ctl, 2, [], []
        cm._c = lambda: self.cn.cursor(Contador)

        def commit():
            conta["commits"] += 1
            self.cn.commit()
        cm._commit = commit
        return cm

    def _ai(self):
        with self.cn.cursor() as c:
            c.execute("SELECT MAX(id) FROM `%s`.pendencia" % self.ctl)
            return c.fetchone()[0]

    def test_herda_sem_insert_so_contagem_agregada(self):
        """Rodada pendencia-cadeia: a continuação não copia pendências (nenhum INSERT em pendencia); o resumo recebe
        só a contagem agregada da cadeia (as resolvidas a0 e b0 ficam fora; a TAB_C não pulada também)."""
        esperado = self.N - 1 + self.N // 2 - 1
        conta, beats = {"insert": 0, "commits": 0}, []
        antes = self._ai()
        cm = self._cm(conta)
        n = continuar.repetir_pendencias(cm, {"TAB_A": 1, "TAB_B": 1}, beats.append)
        self.assertEqual(n, esperado)
        self.assertEqual(cm.pend, [])
        self.assertEqual(sorted(cm.pend_repetidas),
                         [("TAB_A", "pai_pendente", "alta", None, self.N - 1),
                          ("TAB_B", "restricao_destino_1048", "critica", "coluna_x", self.N // 2 - 1)])
        res = carga.resumo_pendencias([("TAB_C", "c1", "valor_presumido", "baixa", None)], cm.pend_repetidas,
                                      lambda t: t.lower())
        self.assertEqual(res, {"total": esperado + 1, "criticas": self.N // 2 - 1,
                               "por_regra": {"tab_a:pai_pendente:alta": self.N - 1,
                                             "tab_b:restricao_destino_1048:critica": self.N // 2 - 1,
                                             "tab_c:valor_presumido:baixa": 1},
                               "por_restricao": {"TAB_B:restricao_destino_1048:coluna_x": self.N // 2 - 1}})
        self.assertEqual(conta["insert"], 0)             # antes: um INSERT ... SELECT por pedaço (cópia inteira)
        self.assertEqual(beats, [self.N - 1, esperado])  # batimento acumulado depois de cada tabela (retomada-rapida)
        self.assertEqual(self._ai(), antes)              # nenhuma linha nova na pendencia
        with self.cn.cursor() as c:
            c.execute("SELECT COUNT(*) FROM `%s`.pendencia WHERE execucao_id=2" % self.ctl)
            self.assertEqual(c.fetchone()[0], 0)

    def test_medicao_antiga_um_insert_por_linha(self):
        """Referência da medição "antes": o executemany com UTC_TIMESTAMP(3) no VALUES manda um INSERT por linha."""
        conta = {"insert": 0, "commits": 0}
        cm = self._cm(conta)
        with cm._c() as c:
            c.execute("SELECT tabela_origem, chave_original, regra, gravidade, detalhe FROM `%s`.pendencia"
                      " WHERE execucao_id=1 AND situacao='aberta' AND tabela_origem IN ('TAB_A','TAB_B')" % self.ctl)
            linhas = c.fetchall()
            c.executemany("INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%s)" % (cm.ctl, carga.AGORA),
                          [(3,) + tuple(x) for x in linhas])
        self.cn.rollback()
        self.assertEqual(conta["insert"], len(linhas))


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class ContinuacaoCargaPropria(unittest.TestCase):
    """(b) Continuação: o grupo do atendimento da carga própria concluído (marcado) pela execução anterior é pulado sem
    ler a origem; sem marca, com contagem diferente, com linha alterada ou com outro arquivo, roda de novo."""
    COD = "pq_propria"
    SHA = "a" * 64
    CONT = {"ATCABECATEND": 3, "RECADATE": 2, "REALTA": 1}

    def setUp(self):
        from sante_conector import banco, controle
        self.root = banco.conectar(None, multi=True)
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(self.root, self.COD, self.cli)
        self.cn = banco.conectar(self.cli, autocommit=False)
        h = b"\x01" * 16
        orig = [("ATCABECATEND", "1", "atendimento", 11, h, b"\x0a" * 16, None, None),
                ("ATCABECATEND", "2", "atendimento", 12, h, b"\x0b" * 16, None, None),
                ("ATCABECATEND", "3", "atendimento", None, h, None, "numero_duplicado", "critica"),
                ("RECADATE", "f1", "atendimento", 11, h, b"\x0c" * 16, None, None),
                ("RECADATE", "f2", "atendimento", 12, h, b"\x0d" * 16, None, None),
                ("REALTA", "a1", "atendimento", 11, h, b"\x0e" * 16, None, None)]
        pend = [(1, "ATCABECATEND", "1", "carater_estimado", "baixa"),
                (1, "ATCABECATEND", "2", "carater_estimado", "baixa"),
                (1, "ATCABECATEND", "3", "numero_duplicado", "critica"),
                (1, "ATCABECATEND", "2", "edicao_no_destino", "media"),   # da conciliação: refeita, não repetida
                (1, "RICADPAC", "p1", "cpf_invalido", "media")]           # fora do grupo: não repetida
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.conector_origem (tabela_origem, chave_original, entidade_destino,"
                          " id_destino, hash_linha, hash_destino, regra_recusa, gravidade_recusa, imagem_id, criado_em)"
                          " VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,1,NOW())" % self.ctl, orig)
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,NOW())" % self.ctl, pend)
            for e in (1, 2):
                c.execute("INSERT INTO `%s`.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                          " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                          " (%%s,'x',1,%%s,NOW(),13,8192,1,1,0,1,NOW())" % self.ctl, (e, self.SHA))
        self.cn.commit()

    def tearDown(self):
        self.cn.close()
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _marcar(self, eid, tabelas):
        cm = type("CM", (), {})()
        cm.ctl, cm.eid, cm.img, cm._c, cm._commit = "`%s`" % self.ctl, eid, eid, self.cn.cursor, self.cn.commit
        continuar.marcar(cm, tabelas)

    def _concluidas(self, anterior=1, cont=None, sha=SHA, cadeia=None):
        return continuar.concluidas_propria(self.cn, self.ctl, anterior, list(carga.ORDEM), cont or self.CONT, sha,
                                            (lambda e: (cadeia or {}).get(e)) if cadeia is not None else None)

    def test_nao_pula_sem_marca_e_na_duvida(self):
        self.assertEqual(self._concluidas(), {})                     # execução anterior à marca (como a 11)
        self._marcar(1, ["REALTA", "RECADATE"])
        self.assertEqual(self._concluidas(), {})                     # grupo pela metade
        self._marcar(1, ["ATCABECATEND"])
        self.assertEqual(self._concluidas(sha="b" * 64), {})         # outro arquivo
        self.assertEqual(self._concluidas(cont=dict(self.CONT, ATCABECATEND=4)), {})  # linha que não entrou
        with self.cn.cursor() as c:
            c.execute("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                      " criado_em) VALUES (1,'ATCABECATEND','2','alteracao_aguarda_sincronizar','baixa',NOW())"
                      % self.ctl)
        self.cn.commit()
        self.assertEqual(self._concluidas(), {})                     # alterada: reexecução a tira da soma

    def test_pula_o_grupo_concluido_com_a_cadeia(self):
        self._marcar(1, ["REALTA", "RECADATE", "ATCABECATEND"])
        self.assertEqual(self._concluidas(), {"REALTA": 1, "RECADATE": 1, "ATCABECATEND": 1})
        # a 2 continuou a 1 e caiu antes de marcar: herda da 1 pela cadeia
        self.assertEqual(self._concluidas(2, cadeia={2: {"continuar_de": 1}}),
                         {"REALTA": 1, "RECADATE": 1, "ATCABECATEND": 1})
        self.assertEqual(self._concluidas(2), {})                    # sem a cadeia, a 2 não tem marca

    def test_carga_pula_sem_ler_a_origem_e_refaz_o_estado(self):
        self._marcar(1, ["REALTA", "RECADATE", "ATCABECATEND"])
        pular = self._concluidas()

        lidas = []
        c = carga.Carga(None, self.cn, self.ctl, 3, 2, pular=pular)
        with unittest.mock.patch.object(carga.Carga, "_preparar_catalogos"), \
                unittest.mock.patch.object(carga.Carga, "conciliar", return_value={}), \
                unittest.mock.patch.object(carga.Carga, "_linhas", lambda s, t: lidas.append(t) or iter(())), \
                unittest.mock.patch.object(carga.Carga, "_pacientes", lambda s, ls: list(ls)):
            c.executar(["RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"], self.CONT)
        self.assertEqual(lidas, ["RICADPAC"])   # o paciente sempre roda; o grupo do atendimento não lê a origem
        self.assertEqual(c.vistas, {"ATCABECATEND": {"1", "2", "3"}, "RECADATE": {"f1", "f2"}, "REALTA": {"a1"}})
        hx = {e: {k: v.rstrip("0") for k, v in d.items()} for e, d in c.origem.items()}  # BINARY completa com zeros
        self.assertEqual(hx["atendimento"], {"1": "0a" * 16, "2": "0b" * 16})   # a recusada fica fora da soma
        self.assertEqual(hx["atendimento_ficha"], {"f1": "0c" * 16, "f2": "0d" * 16})
        self.assertEqual(hx["atendimento_alta"], {"a1": "0e" * 16})
        self.assertEqual(c.cont["puladas_continuacao"], 6)
        self.assertEqual(c.cont["pendencias_repetidas"], 3)   # herdadas da cadeia (só contagem)
        self.assertEqual(c.pend, [])
        self.assertEqual(sorted(x[1] for x in c.pend_repetidas), ["carater_estimado", "numero_duplicado"])
        with self.cn.cursor() as cur:   # sem cópia: a execução 3 não grava as pendências da 1
            cur.execute("SELECT COUNT(*) FROM `%s`.pendencia WHERE execucao_id=3" % self.ctl)
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("SELECT tabela_origem, origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=3"
                        % self.ctl)
            self.assertEqual(sorted(cur.fetchall()), [("ATCABECATEND", "continuada"), ("REALTA", "continuada"),
                                                      ("RECADATE", "continuada"), ("RICADPAC", "carregada")])
        # a CargaMapa não confunde a marca da carga própria com a sua (marca × dedução)
        with self.cn.cursor() as cur:
            cur.execute("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=1" % self.ctl)
            self.assertTrue({x[0] for x in cur.fetchall()} <= set(carga.ORDEM))

    def test_carga_sem_pulo_le_a_origem(self):
        c = carga.Carga(None, self.cn, self.ctl, 3, 2, pular={"ATCABECATEND": 1})   # grupo incompleto: não pula
        lidas = []
        with unittest.mock.patch.object(carga.Carga, "_preparar_catalogos"), \
                unittest.mock.patch.object(carga.Carga, "conciliar", return_value={}), \
                unittest.mock.patch.object(carga.Carga, "_linhas", lambda s, t: lidas.append(t) or iter(())), \
                unittest.mock.patch.object(carga.Carga, "_pacientes", lambda s, ls: list(ls)), \
                unittest.mock.patch.object(carga.Carga, "_atendimentos", lambda s, ls: list(ls)):
            c.executar(["RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"], self.CONT)
        self.assertEqual(lidas, ["RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"])
        self.assertNotIn("pendencias_repetidas", c.cont)
        with self.cn.cursor() as cur:   # a execução que carregou marca o grupo (base da próxima continuação)
            cur.execute("SELECT tabela_origem, origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=3"
                        % self.ctl)
            self.assertEqual(sorted(cur.fetchall()), [("ATCABECATEND", "carregada"), ("REALTA", "carregada"),
                                                      ("RECADATE", "carregada"), ("RICADPAC", "carregada")])


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    unittest.main()
