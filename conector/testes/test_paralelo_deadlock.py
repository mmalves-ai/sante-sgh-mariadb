"""Deadlock 1213 na carga paralela (2026-11-23, onda 49 da carga real).

Causa: RPLANEVE_TBCBOPRO COMPLEMENTA lancamento_repasse (UPDATE ... SET profissional_id WHERE id, trava exclusiva na
linha do lançamento) e RPLANEVE_COMPOSICAOBASE grava lancamento_repasse_base, cuja chave estrangeira aponta para o
lançamento (o INSERT do filho toma trava compartilhada na linha do pai, mesmo em READ COMMITTED). As duas só citam
RPLANEVE (onda anterior) e gravam destinos diferentes, então `ondas()` as punha na MESMA onda: dois gravadores
travavam as mesmas linhas de lancamento_repasse em ordens diferentes e o InnoDB matava um deles.

Correção: `ondas()` também separa a tabela que ATUALIZA linhas de um destino (`complementa`/`adotar`) das tabelas
cujo destino referencia esse destino por chave estrangeira. Defesa: o gravador que falha devolve um resumo curto (tabela,
tipo, código do banco, arquivo:linha) que chega ao motivo_falha pelo FIM, e os outros gravadores são mortos com SIGKILL.
Só valores inventados."""
import os
import signal
import tempfile
import threading
import time
import unittest
from multiprocessing.connection import Pipe
from pathlib import Path

import pymysql

from sante_conector import carga_mapa, mapa, paralelo, plataforma


def _p(t, destino, refs=(), opcoes=None):
    cols = [{"coluna": "ID_" + r, "destino": r.lower() + "_id", "via": "ref:" + r} for r in refs]
    return {"tabela": t, "destinos": [destino], "colunas": {destino: cols}, "opcoes": {destino: opcoes or {}},
            "chave": ["ID"]}


def _onda(plano, ws):
    return {plano[i]["tabela"]: k for k, o in enumerate(ws) for i in o}


class Ondas(unittest.TestCase):
    def setUp(self):
        self.plano = [_p("LANC", "lanc"), _p("BASE", "lanc_base", ["LANC"]),
                      _p("COMPL", "lanc", ["LANC"], {"complementa": True}), _p("OUTRA", "outra", ["LANC"])]
        self.fks = {"lanc_base": {"lanc"}, "outra": {"tabela_qualquer"}}

    def test_complemento_e_filho_do_mesmo_pai_em_ondas_diferentes(self):
        w = _onda(self.plano, paralelo.ondas(self.plano, {}, self.fks))
        self.assertLess(w["LANC"], w["BASE"])
        self.assertNotEqual(w["BASE"], w["COMPL"])  # antes: mesma onda (deadlock)
        self.assertEqual(w["OUTRA"], w["BASE"])  # o paralelismo do que não referencia o pai fica

    def test_ordem_do_plano_inversa(self):
        plano = [self.plano[0], self.plano[2], self.plano[1]]  # o complemento antes do filho
        w = _onda(plano, paralelo.ondas(plano, {}, self.fks))
        self.assertLess(w["COMPL"], w["BASE"])

    def test_adotar_tambem_atualiza(self):
        plano = [self.plano[0], self.plano[1], _p("ADOTA", "lanc", ["LANC"], {"adotar": ["codigo"]})]
        w = _onda(plano, paralelo.ondas(plano, {}, self.fks))
        self.assertNotEqual(w["BASE"], w["ADOTA"])

    def test_sem_fks_como_antes(self):
        w = _onda(self.plano, paralelo.ondas(self.plano, {}))
        self.assertEqual(w["BASE"], w["COMPL"])

    def test_fks_pelo_ddl(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "db/migracoes/01_X").mkdir(parents=True)
            (Path(d) / "db/migracoes/01_X/01_chaves.sql").write_text(
                "ALTER TABLE lanc_base\n  ADD CONSTRAINT fk_x FOREIGN KEY (lanc_id) REFERENCES lanc (id),\n"
                "  ADD CONSTRAINT fk_y FOREIGN KEY (t_id) REFERENCES tributo (id);\n")
            (Path(d) / "db/migracoes/01_X/02_tabelas.sql").write_text(
                "CREATE TABLE lanc (\n  id BIGINT,\n  pai_id BIGINT REFERENCES pai (id)\n);\nCREATE TABLE pai (id INT);\n")
            self.assertEqual(paralelo.fks_ddl(d), {"lanc_base": {"lanc", "tributo"}, "lanc": {"pai"}})


class MapaReal(unittest.TestCase):
    def test_complemento_do_lancamento_fora_da_onda_da_base(self):
        m = mapa.carregar_execucao()
        plano = carga_mapa.planejar(m, {r["tabela"] for r in m["tabelas"]})
        raiz = Path("/app") if Path("/app/db/migracoes").is_dir() else mapa.RAIZ
        fks = paralelo.fks_ddl(raiz)
        self.assertIn("lancamento_repasse", fks.get("lancamento_repasse_base", set()))
        antes, depois = paralelo.ondas(plano, m), paralelo.ondas(plano, m, fks)
        self.assertEqual(_onda(plano, antes)["RPLANEVE_TBCBOPRO"], _onda(plano, antes)["RPLANEVE_COMPOSICAOBASE"])
        w = _onda(plano, depois)
        self.assertNotEqual(w["RPLANEVE_TBCBOPRO"], w["RPLANEVE_COMPOSICAOBASE"])
        # o paralelismo continua: a regra nova só separa pares complemento x filho (medida, não teto arbitrário)
        self.assertLessEqual(len(depois), len(antes) + 10, (len(antes), len(depois)))


class Defesa(unittest.TestCase):
    def test_resumo_sem_valores_com_codigo_e_tabela(self):
        try:
            raise pymysql.err.OperationalError(1213, "Deadlock found ... valor 'Fulano'")
        except pymysql.err.MySQLError as e:
            r = paralelo._resumo_erro(e, "RPLANEVE_TBCBOPRO")
        self.assertIn("tabela RPLANEVE_TBCBOPRO", r)
        self.assertIn("erro 1213", r)
        self.assertNotIn("Fulano", r)

    def test_motivo_guarda_o_fim(self):
        m = "Traceback (most recent call last):\n" + "  File x, line 1\n" * 60 + "OperationalError: erro 1213"
        self.assertTrue(plataforma._fim(m).endswith("erro 1213"))
        self.assertEqual(len(plataforma._fim(m)), 500)
        self.assertEqual(plataforma._fim("curto"), "curto")

    def test_erro_de_um_gravador_mata_os_outros_e_chega_ao_coordenador(self):
        """Um gravador falha; o outro, parado (ignora SIGTERM, como o que espera uma leitura), é morto com SIGKILL e o
        coordenador levanta GravadorFalhou com o resumo, sem travar no waitpid."""
        filhos = {}
        for papel in ("parado", "falha"):
            pai, filho = Pipe()
            pid = os.fork()
            if pid == 0:
                pai.close()
                try:
                    if papel == "parado":
                        signal.signal(signal.SIGTERM, signal.SIG_IGN)
                        time.sleep(60)
                    else:
                        time.sleep(0.2)
                        filho.send((0, "erro", ("tabela T: OperationalError: erro 1213 do banco de destino", "pilha")))
                finally:
                    os._exit(0)
            filho.close()
            filhos[pai] = pid
        t0 = time.monotonic()
        with self.assertRaises(paralelo.GravadorFalhou) as cx:
            paralelo._servir(None, filhos, [], lambda f: None)
        self.assertLess(time.monotonic() - t0, 10)
        self.assertIn("erro 1213", str(cx.exception))
        self.assertIn("tabela T", str(cx.exception))
        for con in filhos:
            con.close()


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(_mariadb(), "só no container do conector, com o MariaDB da rede interna")
class MecanismoNoBanco(unittest.TestCase):
    """O mecanismo no InnoDB, com duas conexões como dois gravadores: o filho trava o pai (compartilhada) e o
    complemento o atualiza (exclusiva), em ordens cruzadas: 1213. Banco descartável, valores inventados."""
    BANCO = "teste_deadlock_paralelo"

    def setUp(self):
        from sante_conector import banco
        self.banco = banco
        with banco.conectar(None) as r, r.cursor() as c:
            c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
            c.execute("CREATE DATABASE `%s`" % self.BANCO)
            c.execute("CREATE TABLE `%s`.lanc (id BIGINT PRIMARY KEY, prof INT NULL) ENGINE=InnoDB" % self.BANCO)
            c.execute("CREATE TABLE `%s`.lanc_base (id BIGINT PRIMARY KEY, lanc_id BIGINT NOT NULL,"
                      " FOREIGN KEY (lanc_id) REFERENCES lanc (id)) ENGINE=InnoDB" % self.BANCO)
            c.execute("INSERT INTO `%s`.lanc (id) VALUES (1), (2)" % self.BANCO)

    def tearDown(self):
        with self.banco.conectar(None) as r, r.cursor() as c:
            c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)

    def test_complemento_e_filho_simultaneos_dao_1213(self):
        a, b = (self.banco.conectar(self.BANCO, autocommit=False) for _ in range(2))
        for x in (a, b):
            with x.cursor() as c:
                c.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                c.execute("SET SESSION innodb_lock_wait_timeout=20")
        erros = []

        def em(con, sql):
            try:
                with con.cursor() as c:
                    c.execute(sql)
            except pymysql.err.MySQLError as e:
                erros.append(e.args[0])
        try:
            em(a, "INSERT INTO lanc_base VALUES (10, 1)")  # gravador da base: trava compartilhada no lançamento 1
            em(b, "UPDATE lanc SET prof=7 WHERE id=2")  # gravador do complemento: exclusiva no lançamento 2
            th = threading.Thread(target=em, args=(a, "INSERT INTO lanc_base VALUES (11, 2)"))  # espera b
            th.start()
            time.sleep(0.5)
            em(b, "UPDATE lanc SET prof=7 WHERE id=1")  # espera a: ciclo
            th.join(30)
            self.assertIn(1213, erros)
        finally:
            a.close()
            b.close()


if __name__ == "__main__":
    unittest.main()
