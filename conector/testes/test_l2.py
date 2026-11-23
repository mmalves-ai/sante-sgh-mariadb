"""Autoconferência do L2 (fila, plataforma e motor) sobre a imagem SINTÉTICA do cliente de exemplo.

Roda no container do conector, privilegiado, só na rede interna sante-sgh-conector-int (alcança apenas o MariaDB):
`conector/conector.sh testes`. Usa um banco de plataforma DE TESTE (plataforma_teste_conector) e clientes de
exemplo com bancos vazios; apaga tudo no fim. Nunca toca no banco `plataforma` real.
"""
import glob
import json
import os
import secrets
import shutil
import subprocess
import sys
import unittest
from unittest import mock

import pymysql

from sante_conector import banco, caminho, controle, disco, plataforma, separado, sintetica
from sante_conector.leitor import Leitor
from sante_conector.trabalhador import Trabalhador

PLAT = "plataforma_teste_conector"
TRAB = os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho")
ORIG = os.path.join(TRAB, "origens-l2")
ARQ = "exemplo-l2.fdb"
CLIENTES = ("exemplo_l2a", "exemplo_l2b", "ex_l2", "exxl2")  # ex_l2 x exxl2: casariam pelo curinga `_` do GRANT
MANIF = None
SHA = None
ABRIDOR = None


def _raiz():
    return banco.conectar(None)


def _limpar():
    c = _raiz()
    with c.cursor() as cur:
        for b in [PLAT] + ["cliente_" + x for x in CLIENTES] + ["conector_ctl_" + x for x in CLIENTES]:
            cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
        cur.execute("SELECT user, host FROM mysql.user WHERE user LIKE %s", ("sscon\\_%\\_" + banco.ficha_plataforma(),))
        for u, h in cur.fetchall():
            cur.execute("DROP USER IF EXISTS %s@%s", (u, h))
    c.close()


def setUpModule():
    global MANIF, SHA
    os.environ["CONECTOR_PLATAFORMA_BANCO"] = PLAT
    os.environ["CONECTOR_MAX_PARALELO"] = "1"
    os.environ["CONECTOR_RESERVA_GB"] = "1"
    _limpar()
    c = banco.conectar(None, multi=True)
    banco.aplicar_script(c, "CREATE DATABASE `%s`" % PLAT)
    c.select_db(PLAT)
    for rodada in (1, 2):  # idempotente
        for arq in sorted(glob.glob("/db-plataforma/*.sql")):
            with open(arq, encoding="utf-8") as f:
                banco.aplicar_script(c, f.read())
    for i, cod in enumerate(CLIENTES, 1):
        banco.aplicar_script(c, "CREATE DATABASE `cliente_%s`; CREATE TABLE `cliente_%s`.marca (id INT PRIMARY KEY);"
                             % (cod, cod))
        with c.cursor() as cur:
            cur.execute("INSERT INTO cliente (codigo, nome, banco_nome, versao_migracao, origem_dados, criado_em)"
                        " VALUES (%s, %s, %s, 'teste/0001', 'conector_spdata', UTC_TIMESTAMP(3))",
                        (cod, "Cliente de exemplo %d" % i, "cliente_" + cod))
    c.close()
    shutil.rmtree(ORIG, ignore_errors=True)
    os.makedirs(ORIG)
    MANIF = sintetica.gerar(os.path.join(ORIG, ARQ))
    os.environ["CONECTOR_ORIGENS_DIR"] = ORIG
    SHA = caminho.sha256_arquivo(os.path.join(ORIG, ARQ))
    global ABRIDOR  # o motor nunca abre o arquivo: pede ao abridor separado (rede vazia, sem credencial)
    sock = os.path.join(TRAB, "abridor-teste.sock")
    ABRIDOR = separado.iniciar_abridor(sock, 0, 0)
    os.environ["CONECTOR_ABRIDOR_SOCKET"] = sock


def tearDownModule():
    if ABRIDOR:
        ABRIDOR.terminate(); ABRIDOR.wait(60)
    _limpar()
    shutil.rmtree(ORIG, ignore_errors=True)


def _conn():
    return banco.conectar(PLAT)


def _um(conn, sql, args=()):
    with conn.cursor() as c:
        c.execute(sql, args)
        return c.fetchone()


def _eventos(conn, eid):
    with conn.cursor() as c:
        c.execute("SELECT tipo, JSON_VALUE(detalhe, '$.estado') FROM cliente_evento"
                  " WHERE JSON_VALUE(detalhe, '$.execucao_id')=%s ORDER BY id", (eid,))
        return c.fetchall()


def _encerrar_ativas(conn):
    with conn.cursor() as c:
        c.execute("SELECT id, estado FROM conector_execucao WHERE cliente_ativo IS NOT NULL")
        for eid, est in c.fetchall():
            plataforma.mudar_estado(conn, eid, "cancelada" if est == "fila" else "falhou", motivo="limpeza do teste")


class Plataforma(unittest.TestCase):
    def setUp(self):
        self.c = _conn()

    def tearDown(self):
        _encerrar_ativas(self.c)
        self.c.close()

    def test_1_vinculo_e_trava_por_cliente(self):
        with self.assertRaises(plataforma.PlataformaErro):
            plataforma.enfileirar(self.c, "exemplo_l2a", "importar")        # sem origem
        for cod in CLIENTES:
            v = plataforma.vincular_origem(self.c, cod, ARQ, sha256=SHA if cod == "exemplo_l2b" else None)
            self.assertEqual(v["sha256"], SHA)
        plataforma.vincular_origem(self.c, "exemplo_l2a", ARQ)               # revincular: a anterior fica inativa
        cid = _um(self.c, "SELECT id FROM cliente WHERE codigo='exemplo_l2a'")[0]
        self.assertEqual(_um(self.c, "SELECT SUM(ativo), COUNT(*) FROM cliente_origem WHERE cliente_id=%s", (cid,)),
                         (1, 2))
        self.assertEqual(_um(self.c, "SELECT COUNT(*) FROM cliente_evento WHERE cliente_id=%s AND tipo='conector_vinculo'",
                             (cid,))[0], 2)
        with self.assertRaises(pymysql.err.IntegrityError):                   # o banco também trava a origem
            with self.c.cursor() as cur:
                cur.execute("UPDATE cliente_origem SET ativo=TRUE WHERE cliente_id=%s", (cid,))
        with self.assertRaises(plataforma.PlataformaErro):
            plataforma.enfileirar(self.c, "exemplo_l2a", "sincronizar")     # sem importação concluída
        e1 = plataforma.enfileirar(self.c, "exemplo_l2a", "importar")
        with self.assertRaises(plataforma.ExecucaoAtiva):
            plataforma.enfileirar(self.c, "exemplo_l2a", "importar")
        with self.assertRaises(plataforma.ExecucaoAtiva):
            plataforma.vincular_origem(self.c, "exemplo_l2a", ARQ, sha256=SHA)
        e2 = plataforma.enfileirar(self.c, "exemplo_l2b", "importar")         # outro cliente: livre
        plataforma.cancelar(self.c, e1)
        with self.assertRaises(plataforma.PlataformaErro):
            plataforma.cancelar(self.c, e1)                                   # transição inválida
        self.assertEqual([e[1] for e in _eventos(self.c, e1)], ["fila", "cancelada"])
        self.assertEqual({e[0] for e in _eventos(self.c, e1)}, {"conector_carga"})
        e3 = plataforma.enfileirar(self.c, "exemplo_l2a", "importar")         # liberou a trava
        self.assertGreater(e3, e2)
        with self.assertRaises(pymysql.err.OperationalError):                 # CHECK de estado no banco
            with self.c.cursor() as cur:
                cur.execute("UPDATE conector_execucao SET estado='inventado' WHERE id=%s", (e3,))

    def test_2_skip_locked_e_limite_de_paralelo(self):
        ea = plataforma.enfileirar(self.c, "exemplo_l2a", "importar")
        eb = plataforma.enfileirar(self.c, "exemplo_l2b", "importar")
        x = _conn()
        t1, t2 = Trabalhador("t1", max_paralelo=1), Trabalhador("t2", max_paralelo=1)
        try:
            self.assertEqual(t1.tomar_vaga(), 1)
            self.assertIsNone(t2.tomar_vaga())                                # limite 1: a segunda espera
            self.assertEqual(t2.laco(uma=True)["resultado"], "sem vaga de paralelo")
            x.begin()
            with x.cursor() as cur:                                           # outra sessão segura a primeira
                cur.execute("SELECT id FROM conector_execucao WHERE id=%s FOR UPDATE", (ea,))
            self.assertEqual(t1.reivindicar(), eb)                            # SKIP LOCKED: pula a travada
            x.rollback()
            self.assertEqual(plataforma.consultar(self.c, eb)["estado"], "abrindo")
            self.assertEqual(plataforma.consultar(self.c, eb)["trabalhador"], "t1")
            self.assertEqual(t2.recuperar_orfas(), [])                        # t1 segura a trava da execução
            t1.soltar_vaga()
            self.assertEqual(t2.tomar_vaga(), 1)
        finally:
            x.close(); t1.fechar(); t2.fechar()
        t3 = Trabalhador("t3")
        try:
            self.assertEqual(t3.recuperar_orfas(), [eb])                      # t1 caiu: órfã vira falhou
        finally:
            t3.fechar()
        ex = plataforma.consultar(self.c, eb)
        self.assertEqual(ex["estado"], "falhou")
        self.assertIn("interrompido", ex["motivo_falha"])
        self.assertEqual([e[1] for e in _eventos(self.c, eb)], ["fila", "abrindo", "falhou"])

    def test_3_guarda_de_disco(self):
        self.assertRaises(disco.DiscoInsuficiente, disco.verificar, "importar", 10**9, TRAB, 10**7)
        r = disco.verificar("importar", 10**9, TRAB, 1)
        self.assertEqual(r["necessario_gb"], 1.6)
        eid = plataforma.enfileirar(self.c, "exemplo_l2a", "importar")
        os.environ["CONECTOR_RESERVA_GB"] = str(10**7)
        t = Trabalhador("t-disco")
        try:
            ex = t.laco(uma=True)
        finally:
            t.fechar()
            os.environ["CONECTOR_RESERVA_GB"] = "1"
        self.assertEqual((ex["id"], ex["estado"]), (eid, "falhou"))
        self.assertIn("guarda de disco", ex["motivo_falha"])
        self.assertEqual(caminho.sha256_arquivo(os.path.join(ORIG, ARQ)), SHA)

    def test_4_isolamento_do_usuario_da_execucao(self):
        ctl = controle.preparar(self.c, "exemplo_l2a", "cliente_exemplo_l2a")
        host = controle.host_do_motor(self.c)
        nome = "sscon_e999999_" + banco.ficha_plataforma()
        senha = controle.criar_usuario(self.c, nome, "cliente_exemplo_l2a", ctl, host)
        u = banco.conectar(None, usuario=nome, senha=senha)
        try:
            with u.cursor() as cur:
                cur.execute("SHOW DATABASES")
                self.assertEqual({r[0] for r in cur.fetchall()},
                                 {"information_schema", "cliente_exemplo_l2a", "conector_ctl_exemplo_l2a"})
                cur.execute("INSERT INTO cliente_exemplo_l2a.marca VALUES (1)")
                cur.execute("SELECT COUNT(*) FROM conector_ctl_exemplo_l2a.pendencia")
                for proibido in ("SELECT * FROM cliente_exemplo_l2b.marca", "SELECT * FROM %s.cliente" % PLAT,
                                 "CREATE DATABASE cliente_intruso", "SELECT * FROM mysql.user",
                                 "CREATE USER intruso IDENTIFIED BY 'x'"):
                    with self.assertRaises(pymysql.err.MySQLError, msg=proibido):
                        cur.execute(proibido)
        finally:
            u.close()
            controle.remover_usuario(self.c, nome, host)
        self.assertEqual(_um(self.c, "SELECT COUNT(*) FROM mysql.user WHERE user=%s", (nome,))[0], 0)
        # `_` no nome é literal no GRANT: o usuário de ex_l2 não alcança exxl2 (casaria pelo curinga)
        ctl = controle.preparar(self.c, "ex_l2", "cliente_ex_l2")
        controle.preparar(self.c, "exxl2", "cliente_exxl2")
        senha = controle.criar_usuario(self.c, nome, "cliente_ex_l2", ctl, host)
        u = banco.conectar(None, usuario=nome, senha=senha)
        try:
            with u.cursor() as cur:
                cur.execute("SHOW DATABASES")
                self.assertEqual({r[0] for r in cur.fetchall()},
                                 {"information_schema", "cliente_ex_l2", "conector_ctl_ex_l2"})
                cur.execute("INSERT INTO cliente_ex_l2.marca VALUES (1)")
                for proibido in ("INSERT INTO cliente_exxl2.marca VALUES (1)", "SELECT * FROM cliente_exxl2.marca",
                                 "SELECT COUNT(*) FROM conector_ctl_exxl2.pendencia", "DROP DATABASE cliente_ex_l2"):
                    with self.assertRaises(pymysql.err.MySQLError, msg=proibido):
                        cur.execute(proibido)
        finally:
            u.close()
            controle.remover_usuario(self.c, nome, host)
        with self.assertRaises(RuntimeError):                                 # banco fora de cliente_<codigo>
            controle.preparar(self.c, "ex_l2", "cliente_exxl2")

    def test_5_ponta_a_ponta_importar_e_sincronizar(self):
        eid = plataforma.enfileirar(self.c, "exemplo_l2a", "importar")
        t = Trabalhador("t-motor")
        try:
            ex = t.laco(uma=True)
            self.assertEqual(ex["estado"], "concluida", ex.get("motivo_falha"))
            self.assertEqual(ex["percentual"], 100.0)
            k = ex["contadores"]
            self.assertEqual(k["registros_lidos"], MANIF["registros_total"])
            self.assertEqual(k["tabelas"], len(MANIF["contagens"]))
            self.assertTrue(k["somente_leitura"] and k["arquivo_inalterado"] and k["conciliacao"]["conferido"])
            self.assertEqual((k["conciliacao"]["fonte_origem"], k["conciliacao"]["registros_origem"],
                              k["gstat"]["divergentes"]), ("gstat", MANIF["registros_total"], 0))
            self.assertTrue(k["abertura"]["separado"])
            self.assertEqual(ex["imagem_sha256"], SHA)
            self.assertEqual(k["abertura"]["modo"], "snapshot")
            self.assertEqual([e[1] for e in _eventos(self.c, eid)],
                             ["fila", "abrindo", "lendo", "gravando", "conciliando", "concluida"])
            ctl = _um(self.c, "SELECT registros_total, tabelas FROM conector_ctl_exemplo_l2a.imagem WHERE execucao_id=%s",
                      (eid,))
            self.assertEqual(ctl, (MANIF["registros_total"], len(MANIF["contagens"])))
            with self.c.cursor() as cur:
                cur.execute("SELECT t.tabela_origem, t.registros FROM conector_ctl_exemplo_l2a.imagem_tabela t"
                            " JOIN conector_ctl_exemplo_l2a.imagem i ON i.id=t.imagem_id WHERE i.execucao_id=%s", (eid,))
                soma = dict(cur.fetchall())
            self.assertEqual(soma, MANIF["contagens"])
            self.assertEqual(_um(self.c, "SELECT COUNT(*) FROM mysql.user WHERE user LIKE %s",
                                 ("sscon\\_e%d\\_%s" % (eid, banco.ficha_plataforma()),))[0], 0)
            # usuário da execução removido (o desta plataforma: o servidor é compartilhado por várias plataformas,
            # e outra pode ter uma execução de mesmo número em andamento)
            es = plataforma.enfileirar(self.c, "exemplo_l2a", "sincronizar")
            ex2 = t.laco(uma=True)
            self.assertEqual((ex2["id"], ex2["estado"]), (es, "concluida"), ex2.get("motivo_falha"))
            self.assertEqual({e[0] for e in _eventos(self.c, es)}, {"conector_diferencial"})
            self.assertEqual(t.laco(uma=True)["resultado"], "fila vazia")
        finally:
            t.fechar()
        self.assertEqual(caminho.sha256_arquivo(os.path.join(ORIG, ARQ)), SHA)

    def test_6_conciliacao_pega_leitura_errada(self):
        """A conciliação confronta o gravado com o gstat: uma contagem errada na leitura não sai conferida."""
        eid = plataforma.enfileirar(self.c, "exemplo_l2a", "sincronizar")
        original = Leitor.contar
        alvo = sorted(MANIF["contagens"])[0]
        t = Trabalhador("t-erro")
        try:
            with mock.patch.object(Leitor, "contar", lambda lt, tab: original(lt, tab) + (tab == alvo)):
                ex = t.laco(uma=True)
        finally:
            t.fechar()
        self.assertEqual((ex["id"], ex["estado"]), (eid, "falhou"))
        self.assertIn("gstat", ex["motivo_falha"])
        self.assertFalse(ex["contadores"]["conciliacao"]["conferido"])
        self.assertEqual(_um(self.c, "SELECT conferido, pendencias FROM conector_ctl_exemplo_l2a.conciliacao"
                                     " WHERE execucao_id=%s", (eid,)), (0, 1))
        self.assertEqual(caminho.sha256_arquivo(os.path.join(ORIG, ARQ)), SHA)

    def test_7_trabalhador_separado(self):
        """conector.sh worker: abridor privilegiado sem rede e sem credencial; motor sem privilégio, conta restrita."""
        uid = int(os.environ.get("CONECTOR_UID") or 1000) or 1000
        os.chown(os.path.join(ORIG, ARQ), uid, uid)                          # dono do arquivo = usuário do motor
        senha = secrets.token_urlsafe(24)
        conta = controle.criar_conta_motor(self.c, PLAT, senha, controle.host_do_motor(self.c))
        self.assertEqual(conta, banco.nome_conta_motor(PLAT))
        eid = plataforma.enfileirar(self.c, "exemplo_l2b", "importar")
        env = {k: v for k, v in os.environ.items() if k not in ("CONECTOR_MARIADB_SENHA", "CONECTOR_ABRIDOR_SOCKET")}
        env.update(CONECTOR_MOTOR_SENHA=senha, CONECTOR_MOTOR_UID=str(uid), CONECTOR_MOTOR_GID=str(uid))
        r = subprocess.run([sys.executable, "-s", "-m", "sante_conector.cli", "worker-separado", "--uma"], env=env,
                           capture_output=True, text=True, timeout=600)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        ex = json.loads(r.stdout)
        self.assertEqual((ex["id"], ex["estado"]), (eid, "concluida"), ex.get("motivo_falha"))
        self.assertTrue(ex["contadores"]["arquivo_inalterado"] and ex["contadores"]["conciliacao"]["conferido"])
        m, a = ex["separacao"]["motor"], ex["separacao"]["abridor"]
        self.assertEqual((m["uid"], m["cap_efetivas"], m["cap_limite"], m["no_new_privs"], m["conta_mariadb"]),
                         (uid, "0" * 16, "0" * 16, "1", conta))
        self.assertEqual((a["uid"], a["interfaces"], a["segredo_no_ambiente"]), (0, ["lo"], False))
        self.assertEqual(_um(self.c, "SELECT COUNT(*) FROM mysql.user WHERE user LIKE %s",
                             ("sscon\\_e%d\\_%s" % (eid, banco.ficha_plataforma()),))[0], 0)  # só desta plataforma
        u = banco.conectar(None, usuario=conta, senha=senha)                  # a conta do motor é restrita
        try:
            with u.cursor() as cur:
                for proibido in ("SELECT * FROM mysql.user", "DROP DATABASE cliente_exemplo_l2b",
                                 "CREATE DATABASE intruso", "DELETE FROM %s.cliente" % PLAT,
                                 "CREATE TABLE %s.intrusa (id INT)" % PLAT):
                    with self.assertRaises(pymysql.err.MySQLError, msg=proibido):
                        cur.execute(proibido)
        finally:
            u.close()
        self.assertEqual(caminho.sha256_arquivo(os.path.join(ORIG, ARQ)), SHA)
