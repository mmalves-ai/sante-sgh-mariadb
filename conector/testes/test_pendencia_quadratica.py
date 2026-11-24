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
        cm.ctl, cm.eid, cm.pend = "`%s`" % self.ctl, 2, []
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

    def test_insert_por_pedaco_e_nao_por_linha(self):
        esperado = self.N - 1 + self.N // 2 - 1
        conta, beats = {"insert": 0, "commits": 0}, []
        antes = self._ai()
        with unittest.mock.patch.object(continuar, "REPETIR_LOTE", 100):
            n = continuar.repetir_pendencias(self._cm(conta), {"TAB_A": 1, "TAB_B": 1}, beats.append)
        self.assertEqual(n, esperado)
        pedacos = -(-esperado // 100)
        self.assertEqual(conta["insert"], pedacos)       # antes: um INSERT por pendência (esperado = 1.498)
        self.assertEqual(len(beats), pedacos)            # batimento a cada pedaço
        self.assertGreaterEqual(conta["commits"], pedacos)
        with self.cn.cursor() as c:
            c.execute("SELECT tabela_origem, regra, gravidade, COALESCE(detalhe,''), COUNT(*),"
                      " COUNT(DISTINCT chave_original) FROM `%s`.pendencia WHERE execucao_id=2 GROUP BY 1,2,3,4"
                      % self.ctl)
            got = sorted(c.fetchall())
        self.assertEqual(got, [("TAB_A", "pai_pendente", "alta", "", self.N - 1, self.N - 1),
                               ("TAB_B", "restricao_destino_1048", "critica", "coluna_x", self.N // 2 - 1,
                                self.N // 2 - 1)])
        # ids: o INSERT ... SELECT reserva em blocos (InnoDB, quantidade desconhecida de linhas): folga limitada a
        # menos que o dobro de cada pedaço (linear), nunca proporcional ao acumulado
        self.assertLess(self._ai() - antes, 2 * esperado)

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


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    unittest.main()
