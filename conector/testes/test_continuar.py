"""Continuação de importação interrompida e memória do coordenador (rodada retomar-importacao, 2026-11-23).

Causa: a execução 11 da ProntoCardio foi parada pelo vigia de memória na onda 177 de 218; o sincronizar exige
importação concluída, um importar novo relia tudo e o worker, ao subir, marcava a órfã como `falhou` apagando a etapa.

- Regra das tabelas concluídas (continuar.py): pela marca `conector_tabela_concluida` ou, sem marca, pela dedução
  (n linhas na imagem = n chaves principais com a imagem da interrompida no conector_origem).
- Continuação ponta a ponta (CargaMapa real, leitor real, gravadores em paralelo): a importação falha no meio de uma
  tabela, a continuação pula as concluídas, completa a do meio pelo hash e termina com a MESMA conciliação, as MESMAS
  pendências e o MESMO destino de uma importação inteira; as linhas das tabelas puladas não são regravadas.
- Plataforma: a órfã fica `falhou` continuável (etapa guardada) e o enfileirar --continuar aponta para ela.
- Memória: o estado grande da tabela é compactado/liberado ao fim da onda, e o gravador (fork) que percorre o estado
  herdado suja muito menos páginas (Private_Dirty medido). Só dados falsos."""
import glob
import json
import os
import pickle
import time
import tracemalloc
import unittest
from unittest import mock

from sante_conector import carga_mapa, continuar, paralelo


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TEM_BANCO = _mariadb()
NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and TEM_BANCO


# ------------------------------------------------------------------ memória (sem banco)
class _Prop:
    def __init__(self):
        self._pend, self._filhos = {}, {}


class _CM:
    """Estado sintético com a forma do da CargaMapa: de-para, chaves vistas e soma da origem por tabela."""

    def __init__(self, tabelas, linhas):
        self.plano = [{"tabela": "T%d" % i, "destinos": ["d%d" % i]} for i in range(tabelas)]
        self.existente, self.vistas, self.origem, self.aguardam, self.pend = {}, {}, {}, {}, []
        self.prop = _Prop()
        for i in range(tabelas):
            t = "T%d" % i
            ks = [str(100000 + k) for k in range(linhas)]
            self.existente[t] = {k: (j + 1, bytes(16), bytes(32), None, None) for j, k in enumerate(ks)}
            self.vistas[t] = set(ks)
            self.origem["d%d" % i] = {k: "%064x" % (j * 7919) for j, k in enumerate(ks)}

    def _nome_ent(self, t, dt):
        return dt


def _tamanho(cm):
    """Bytes do estado (pickle das estruturas: proporcional ao que fica em memória) e linhas."""
    return sum(len(pickle.dumps(getattr(cm, n), protocol=pickle.HIGHEST_PROTOCOL))
               for n in ("existente", "vistas", "origem"))


def _sujo_no_filho(cm):
    """Fork que faz o que o gravador faz ao nascer (_pre_tocar, _base) e lê o estado herdado; devolve o Private_Dirty
    do filho em MB (páginas copiadas)."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        try:
            os.close(r)
            paralelo._ATIVO[0] = True
            paralelo._pre_tocar(cm, frozenset(), tudo_pequeno=True)
            paralelo._base(cm)
            n = 0
            for d in (cm.existente, cm.vistas, cm.origem):
                for v in d.values():
                    if isinstance(v, (set, dict)):
                        for _ in v:
                            n += 1
            with open("/proc/self/smaps_rollup") as f:
                kb = sum(int(x.split()[1]) for x in f if x.startswith("Private_Dirty:"))
            os.write(w, str(kb).encode())
        finally:
            os._exit(0)
    os.close(w)
    kb = int(os.read(r, 64) or b"0")
    os.close(r)
    os.waitpid(pid, 0)
    return kb / 1024


class Memoria(unittest.TestCase):
    def setUp(self):
        self._env = os.environ.get("CONECTOR_ESTADO_MIN")
        os.environ["CONECTOR_ESTADO_MIN"] = "1000"

    def tearDown(self):
        if self._env is None:
            os.environ.pop("CONECTOR_ESTADO_MIN", None)
        else:
            os.environ["CONECTOR_ESTADO_MIN"] = self._env

    def test_liberado_depois_da_ultima_onda_que_usa(self):
        cm = _CM(3, 5000)
        ref = {t: set(v) for t, v in cm.vistas.items()}
        org = {e: dict(v) for e, v in cm.origem.items()}
        uso = paralelo.ultimo_uso(3, {2: {0}}, [0, 1, 2])  # T2 usa o de-para de T0
        self.assertEqual(uso, [2, 1, 2])
        antes = _tamanho(cm)
        paralelo._fim_onda(cm, 0, [0], uso, log=False)
        self.assertIn("T0", cm.existente)                       # T2 (onda 2) ainda usa
        self.assertIsInstance(cm.vistas["T0"], paralelo.Compacto)
        paralelo._fim_onda(cm, 1, [1], uso, log=False)
        self.assertNotIn("T1", cm.existente)                    # ninguém depois usa
        paralelo._fim_onda(cm, 2, [2], uso, log=False)
        self.assertEqual(set(cm.existente), set())
        depois = _tamanho(cm)
        self.assertLess(depois, antes * 0.35, (antes, depois))
        for t, v in cm.vistas.items():                          # a conciliação reabre exatamente o que era
            self.assertEqual(v.abrir(), ref[t])
        for e, v in cm.origem.items():
            self.assertEqual(v.abrir(), org[e])
        m = cm.memoria["ultima"]
        self.assertEqual((m["existente_linhas"], m["vistas_linhas"], m["origem_linhas"]), (0, 0, 0))
        print("\nMEMORIA estado (3 tabelas x 5000 linhas): antes %.1f MB, depois %.1f MB" % (
            antes / 2 ** 20, depois / 2 ** 20))

    def test_estado_pequeno_fica_como_estava(self):
        os.environ["CONECTOR_ESTADO_MIN"] = "20000"
        cm = _CM(2, 500)
        paralelo._fim_onda(cm, 0, [0], [0, 1], log=False)
        self.assertIsInstance(cm.vistas["T0"], set)
        self.assertIn("T0", cm.existente)

    @unittest.skipUnless(os.path.exists("/proc/self/smaps_rollup"), "precisa de /proc/self/smaps_rollup")
    def test_gravador_herda_menos_paginas(self):
        cm = _CM(3, 150000)
        tracemalloc.start()
        tracemalloc.stop()
        paralelo._rastrear(cm)
        cru = _sujo_no_filho(cm)
        uso = paralelo.ultimo_uso(3, {}, [0, 1, 2])
        for k in range(3):
            paralelo._fim_onda(cm, k, [k], uso, log=False)
        paralelo._rastrear(cm)
        comp = _sujo_no_filho(cm)
        print("\nMEMORIA gravador (fork, 3 tabelas x 150 mil linhas): Private_Dirty antes %.1f MB, depois %.1f MB"
              % (cru, comp))
        self.assertGreater(cru, 20)
        self.assertLess(comp, cru / 4, (cru, comp))


# ------------------------------------------------------------------ regra das concluídas (MariaDB)
@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class RegraConcluidas(unittest.TestCase):
    COD = "f4rc_regra"

    def setUp(self):
        from sante_conector import banco, controle
        self.root = banco.conectar(None, multi=True)
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(self.root, self.COD, self.cli)
        controle.preparar(self.root, self.COD, self.cli)  # idempotente

    def tearDown(self):
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _x(self, sql, args=()):
        with self.root.cursor() as c:
            c.execute(sql.replace("{b}", "`%s`" % self.ctl), args)
            return c.lastrowid

    def test_marca_deducao_e_arquivo(self):
        img = self._x("INSERT INTO {b}.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                      " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                      " (7, 'x.fdb', 1, %s, UTC_TIMESTAMP(), 12, 8192, 5, 10, 0, 1, UTC_TIMESTAMP(3))", ("a" * 64,))
        for t, n in (("A", 3), ("B", 2), ("C", 2), ("D", 0), ("E", 3)):
            self._x("INSERT INTO {b}.imagem_tabela (imagem_id, tabela_origem, registros, criado_em)"
                    " VALUES (%s, %s, %s, UTC_TIMESTAMP(3))", (img, t, n))
        linhas = [("A", "1", img), ("A", "2", img), ("A", "3", img), ("A", "1/dest_a", img), ("A", "2/dest_a/9", img),
                  ("B", "1", img), ("C", "1", img), ("C", "2", img + 99), ("E", "1", img), ("E", "2", img),
                  ("E", "3", img)]
        for t, k, i in linhas:
            self._x("INSERT INTO {b}.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                    " hash_linha, imagem_id, criado_em) VALUES (%s, %s, 'e', 1, %s, %s, UTC_TIMESTAMP(3))",
                    (t, k, bytes(16), i))
        self.root.commit()
        plano = [{"tabela": t, "destinos": ["dest_" + t.lower()]} for t in "ABCDE"]
        cont = {"A": 3, "B": 2, "C": 2, "D": 0, "E": 4}
        r = continuar.concluidas(self.root, self.ctl, 7, plano, cont, "a" * 64)
        # A: 3 linhas = 3 chaves principais da imagem (as secundárias não contam); B: falta linha; C: chave de imagem
        # anterior (linha "igual" de outra importação); D: vazia; E: a contagem de agora difere (outro arquivo)
        self.assertEqual((r["tabelas"], r["regra"]), ({"A"}, "deducao"))
        self.assertRaises(continuar.NaoContinuavel, continuar.concluidas, self.root, self.ctl, 7, plano, cont, "b" * 64)
        self.assertRaises(continuar.NaoContinuavel, continuar.concluidas, self.root, self.ctl, 8, plano, cont, "a" * 64)
        self._x("INSERT INTO {b}.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                " criado_em) VALUES (7, %s, 'B', 0, 'carregada', UTC_TIMESTAMP(3)), (7, %s, 'Z', 0, 'carregada',"
                " UTC_TIMESTAMP(3))", (img, img))
        self.root.commit()
        r = continuar.concluidas(self.root, self.ctl, 7, plano, cont, "a" * 64)
        self.assertEqual((r["tabelas"], r["regra"]), ({"B"}, "marca"))  # com marca, só a marca vale
        # cadeia: a continuação 8 falhou antes de gravar a imagem; a 9 falhou depois da imagem e antes de marcar o que
        # herdou (as chaves têm a imagem da 7): as duas continuam alcançando o que a 7 concluiu
        cadeia = {8: {"continuar_de": 7}, 9: {"continuar_de": 8}}
        r = continuar.concluidas(self.root, self.ctl, 9 - 1, plano, cont, "a" * 64, cadeia.get)
        self.assertEqual((r["tabelas"], r["origem"]), ({"B"}, {"B": 7}))
        self._x("INSERT INTO {b}.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                " (9, 'x.fdb', 1, %s, UTC_TIMESTAMP(), 12, 8192, 5, 10, 0, 1, UTC_TIMESTAMP(3))", ("a" * 64,))
        self.root.commit()
        r = continuar.concluidas(self.root, self.ctl, 9, plano, cont, "a" * 64, cadeia.get)
        self.assertEqual((r["tabelas"], r["origem"]), ({"B"}, {"B": 7}))
        self.assertRaises(continuar.NaoContinuavel, continuar.concluidas, self.root, self.ctl, 8, plano, cont,
                          "a" * 64)  # sem a cadeia, a 8 sem imagem não continua
        # a ponta da cadeia caiu antes da imagem e não continua outra (a 30 não gravou nada): não derruba a cadeia
        r = continuar.concluidas(self.root, self.ctl, 9, plano, cont, "a" * 64, {9: {"continuar_de": 30}}.get)
        self.assertIn("+cadeia(30:sem_imagem)", r["regra"])
        # chave antiga que sumiu do arquivo (imagem anterior) além das n de agora: roda de novo, mesmo marcada
        for k, i in (("1", img), ("2", img), ("velha", img + 99)):
            self._x("INSERT INTO {b}.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                    " hash_linha, imagem_id, criado_em) VALUES ('F', %s, 'e', 1, %s, %s, UTC_TIMESTAMP(3))",
                    (k, bytes(16), i))
        self._x("INSERT INTO {b}.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                " criado_em) VALUES (7, %s, 'F', 0, 'carregada', UTC_TIMESTAMP(3))", (img,))
        self.root.commit()
        plano_f = plano + [{"tabela": "F", "destinos": ["dest_f"]}]
        r = continuar.concluidas(self.root, self.ctl, 7, plano_f, dict(cont, F=2), "a" * 64)
        self.assertEqual(r["tabelas"], {"B"})
        # uma varredura do conector_origem por tabela na continuação inteira: a contagem fica em cache entre os elos
        # da cadeia (antes, cada elo refazia a varredura de todas as tabelas, minutos por elo na base real)
        with self.root.cursor() as c:
            c.execute("SELECT id FROM `%s`.imagem WHERE execucao_id=9" % self.ctl)
            img9 = c.fetchone()[0]
        self._x("INSERT INTO {b}.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                " criado_em) VALUES (9, %s, 'B', 0, 'carregada', UTC_TIMESTAMP(3))", (img9,))
        self.root.commit()
        varreduras = []

        class _Conta:
            def __init__(s, conn):
                s.conn = conn

            def cursor(s):
                cur = s.conn.cursor()
                original = cur.execute

                def execute(sql, args=None):
                    if "conector_origem" in sql:
                        varreduras.append(args[0])
                    return original(sql, args)
                cur.execute = execute
                return cur

            def __getattr__(s, nome):
                return getattr(s.conn, nome)

        r = continuar.concluidas(_Conta(self.root), self.ctl, 9, plano_f, dict(cont, F=2), "a" * 64, cadeia.get)
        self.assertEqual((r["tabelas"], r["origem"]), ({"B"}, {"B": 9}))
        self.assertEqual(sorted(varreduras), ["B", "F"])  # B marcada na 9 e na 7: contada uma vez só
        # coluna em duas fases (autorreferência): a referência adiada só existe na memória até o _fase2; nunca pulada
        plano_b = [dict(p, duas_fases={p["tabela"]}, colunas={"dest_b": [{"coluna": "PAI", "destino": "pai_id",
                                                                         "referencia": "B"}]})
                   if p["tabela"] == "B" else p for p in plano]
        r = continuar.concluidas(self.root, self.ctl, 7, plano_b, cont, "a" * 64)
        self.assertEqual((r["tabelas"], r["duas_fases"]), (set(), ["B"]))


    def _imagem(self, eid, sha, contagens):
        img = self._x("INSERT INTO {b}.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                      " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                      " (%s, 'x.fdb', 1, %s, UTC_TIMESTAMP(), 12, 8192, 5, 10, 0, 1, UTC_TIMESTAMP(3))", (eid, sha))
        for t, n in contagens.items():
            self._x("INSERT INTO {b}.imagem_tabela (imagem_id, tabela_origem, registros, criado_em)"
                    " VALUES (%s, %s, %s, UTC_TIMESTAMP(3))", (img, t, n))
        return img

    def _origem(self, linhas):
        for t, k, i in linhas:
            self._x("INSERT INTO {b}.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                    " hash_linha, imagem_id, criado_em) VALUES (%s, %s, 'e', 1, %s, %s, UTC_TIMESTAMP(3))",
                    (t, k, bytes(16), i))

    def _marcar(self, eid, img, tabelas, origem="carregada"):
        for t in tabelas:
            self._x("INSERT INTO {b}.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                    " criado_em) VALUES (%s, %s, %s, 0, %s, UTC_TIMESTAMP(3))", (eid, img, t, origem))

    def test_prova_da_mesma_base_sem_ler_o_conector_origem(self):
        """Rodada retomada-rapida (a): com toda imagem do controle do MESMO resumo (arquivo idêntico) e a mesma
        contagem da tabela, a tabela marcada é pulada sem nenhuma consulta ao conector_origem (o preparo da execução
        24 da ProntoCardio levava 14,6 min contando 94 M chaves). Resumos diferentes, mesmo aceitos como a base
        declarada, ou contagem diferente: conta pelo índice. Dedução: para na primeira chave de outra imagem."""
        cont = {"A": 2, "B": 2, "C": 2}
        i8 = self._imagem(8, "b" * 64, cont)
        self._origem([("A", "2", i8), ("A", "3", i8), ("B", "1", i8)])
        self._marcar(8, i8, ["A", "B"])
        self.root.commit()
        plano = [{"tabela": t, "destinos": ["dest_" + t.lower()]} for t in "ABC"]
        cache, bat = {}, []
        r = continuar.concluidas(self.root, self.ctl, 8, plano, cont, {"a" * 64, "b" * 64}, _cache=cache,
                                 batimento=lambda i, n: bat.append((i, n)))
        self.assertEqual((r["tabelas"], r["regra"], cache.get("consultas", 0)), ({"A", "B"}, "marca", 0))
        self.assertEqual(bat, [(0, 3), (1, 3), (2, 3)])  # batimento a cada tabela examinada (pausa no preparo)
        # base declarada (imagem 7, outro resumo aceito) com a MESMA contagem e chaves diferentes: A tinha {1,2} na 7
        # e tem {2,3} na 8; o conector_origem fica com 1→7, 2→8, 3→8 (3 chaves para n=2). A prova não vale: conta
        # pelo índice e A roda de novo (a chave 1 sumiu do arquivo)
        i7 = self._imagem(7, "a" * 64, cont)
        self._origem([("A", "1", i7), ("C", "1", i7), ("C", "2", i7)])
        self.root.commit()
        cache = {}
        r = continuar.concluidas(self.root, self.ctl, 8, plano, cont, {"a" * 64, "b" * 64}, _cache=cache)
        self.assertEqual((r["tabelas"], cache["consultas"]), ({"B"}, 2))
        # só o resumo desta execução (a imagem 7 é de outra base para ela): conta pelo índice, mesmo resultado
        cache = {}
        r = continuar.concluidas(self.root, self.ctl, 8, plano, cont, "b" * 64, _cache=cache)
        self.assertEqual((r["tabelas"], cache["consultas"]), ({"B"}, 2))
        # chave a mais em B (linha que sumiu, lida de outra base): a contagem pelo índice recusa a tabela
        i6 = self._imagem(6, "c" * 64, dict(cont, B=3))
        self._origem([("B", "velha", i6), ("B", "2", i8), ("B", "3", i8)])
        self.root.commit()
        cache = {}
        r = continuar.concluidas(self.root, self.ctl, 8, plano, cont, {"a" * 64, "b" * 64}, _cache=cache)
        self.assertEqual((r["tabelas"], cache["consultas"]), (set(), 2))
        # a pausa pedida no preparo sobe do batimento (motor.Painel.batimento_preparo levanta a PausaPedida)
        from sante_conector import carga

        def pausa(i, n):
            if i == 1:
                raise carga.PausaPedida()
        self.assertRaises(carga.PausaPedida, continuar.concluidas, self.root, self.ctl, 8, plano, cont, "b" * 64,
                          batimento=pausa)
        # dedução (a 7 sem marca): C tem as 2 chaves da imagem 7 e nenhuma de outra; A tem chave da imagem 8
        cache = {}
        r = continuar.concluidas(self.root, self.ctl, 7, plano, cont, {"a" * 64, "b" * 64}, _cache=cache)
        self.assertEqual((r["tabelas"], r["regra"]), ({"C"}, "deducao"))

    def test_pendencias_herdadas_por_tabela_e_em_segundo_plano(self):
        """Rodada retomada-rapida (b): as pendências herdadas não são copiadas (ficam na execução que as gerou e todo
        leitor segue a cadeia); a contagem para o resumo sai por tabela, com batimento e pausa entre as tabelas, ou em
        segundo plano (PendenciasHerdadas), com o MESMO resultado; a pausa no meio não grava nada."""
        from sante_conector import banco, carga, controle
        i1 = self._imagem(1, "a" * 64, {"A": 3, "B": 2})
        self._marcar(1, i1, ["A", "B"])
        controle.gravar_cadeia(self.root, self.ctl, 2, 1)
        for t, k, r in (("A", "1", "x"), ("A", "2", "x"), ("A", "3", "y"), ("B", "1", "x"), ("Z", "1", "x")):
            self._x("INSERT INTO {b}.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                    " criado_em) VALUES (1, %s, %s, %s, 'media', UTC_TIMESTAMP(3))", (t, k, r))
        self.root.commit()
        cn = banco.conectar(self.ctl, autocommit=True)
        ctl = "`%s`" % self.ctl

        class _Cm:
            def __init__(s):
                s.ctl, s.cr, s.pend_repetidas = ctl, cn, []

            def _c(s):
                return cn.cursor()
        try:
            origem = {"A": 1, "B": 1}
            m1, prog = _Cm(), []
            self.assertEqual(continuar.repetir_pendencias(m1, origem, prog.append), 4)
            self.assertEqual(prog, [3, 4])  # batimento depois de cada tabela
            esperado = sorted(m1.pend_repetidas)
            self.assertEqual(esperado, [("A", "x", "media", None, 2), ("A", "y", "media", None, 1),
                                        ("B", "x", "media", None, 1)])
            m2 = _Cm()
            h = continuar.PendenciasHerdadas(m2, origem).iniciar()
            self.assertIsNotNone(h._linha)  # conexão própria (mesmas credenciais da conexão da carga)
            self.assertEqual(h.esperar(), 4)
            self.assertEqual(sorted(m2.pend_repetidas), esperado)
            m3 = _Cm()  # sem conexão própria: conta no esperar, na conexão da carga
            h = continuar.PendenciasHerdadas(m3, origem, conectar=lambda: 1 / 0).iniciar()
            self.assertIsNone(h._linha)
            bat3 = []  # a reserva mantém o batimento por tabela (feitas, total)
            self.assertEqual((h.esperar(lambda f, t: bat3.append((f, t))), sorted(m3.pend_repetidas)), (4, esperado))
            self.assertEqual(bat3, [(1, 2), (2, 2)])
            m4 = _Cm()  # cancelada (pausa): nada fica pela metade; quem esperar recebe a contagem inteira

            def pausa():
                raise carga.PausaPedida()
            self.assertRaises(carga.PausaPedida, continuar.repetir_pendencias, m4, origem, None, (), pausa)
            self.assertEqual(m4.pend_repetidas, [])
            h = continuar.PendenciasHerdadas(m4, origem).iniciar()
            h.cancelar()
            self.assertEqual((h.esperar(), sorted(m4.pend_repetidas)), (4, esperado))
            with self.root.cursor() as c:  # nada copiado: só as 5 pendências da execução 1
                c.execute("SELECT COUNT(*), MAX(execucao_id) FROM %s.pendencia" % ctl)
                self.assertEqual(c.fetchone(), (5, 1))
        finally:
            cn.close()


# ------------------------------------------------------------------ plataforma (MariaDB)
PLAT = "plataforma_teste_continuar"


@unittest.skipUnless(TEM_BANCO and glob.glob("/db-plataforma/*.sql"), "precisa do MariaDB e das migrações da plataforma")
class PlataformaContinuar(unittest.TestCase):
    def setUp(self):
        from sante_conector import banco
        self._env = os.environ.get("CONECTOR_PLATAFORMA_BANCO")
        os.environ["CONECTOR_PLATAFORMA_BANCO"] = PLAT
        c = banco.conectar(None, multi=True)
        banco.aplicar_script(c, "DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s`" % (PLAT, PLAT))
        c.select_db(PLAT)
        for arq in sorted(glob.glob("/db-plataforma/*.sql")):
            with open(arq, encoding="utf-8") as f:
                banco.aplicar_script(c, f.read())
        with c.cursor() as cur:
            cur.execute("INSERT INTO cliente (codigo, nome, banco_nome, versao_migracao, origem_dados, criado_em)"
                        " VALUES ('f4rc_plat', 'Cliente de exemplo', 'cliente_f4rc_plat', 'teste/0001',"
                        " 'conector_spdata', UTC_TIMESTAMP(3))")
            cid = cur.lastrowid
            cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, caminho_relativo, tamanho_bytes, sha256,"
                        " modificado_em, ods_versao, pagina_bytes, vinculado_em, ativo, criado_em) VALUES"
                        " (%s, 'firebird_arquivo', 'x.fdb', 8192, %s, UTC_TIMESTAMP(), 12, 8192, UTC_TIMESTAMP(3),"
                        " TRUE, UTC_TIMESTAMP(3))", (cid, "a" * 64))
        c.close()
        self.c = banco.conectar(PLAT)

    def tearDown(self):
        from sante_conector import banco
        self.c.close()
        c = banco.conectar(None)
        with c.cursor() as cur:
            cur.execute("DROP DATABASE IF EXISTS `%s`" % PLAT)
        c.close()
        if self._env is None:
            os.environ.pop("CONECTOR_PLATAFORMA_BANCO", None)
        else:
            os.environ["CONECTOR_PLATAFORMA_BANCO"] = self._env

    def test_orfa_continuavel_e_enfileirar_continuar(self):
        from sante_conector import plataforma
        from sante_conector.trabalhador import Trabalhador
        P = plataforma
        self.assertRaises(P.PlataformaErro, P.enfileirar, self.c, "f4rc_plat", "importar", continuar=True)  # nada
        self.assertRaises(P.PlataformaErro, P.enfileirar, self.c, "f4rc_plat", "sincronizar", continuar=True)
        eid = P.enfileirar(self.c, "f4rc_plat", "importar")
        t1 = Trabalhador("t1")
        self.assertEqual(t1.tomar_vaga(), 1)
        self.assertEqual(t1.reivindicar(), eid)
        P.mudar_estado(self.c, eid, "lendo", etapa="contando")
        P.mudar_estado(self.c, eid, "gravando", etapa="gravando")
        P.progresso(self.c, eid, 70, "carregando 6 tabelas em paralelo (onda 177 de 218)", {"registros_lidos": 5})
        t1.fechar()  # o worker caiu: a trava da execução some com a conexão
        t2 = Trabalhador("t2")
        try:
            self.assertEqual(t2.recuperar_orfas(), [eid])
        finally:
            t2.fechar()
        ex = P.consultar(self.c, eid)
        self.assertEqual(ex["estado"], "falhou")
        self.assertEqual(ex["etapa"], "interrompida: carregando 6 tabelas em paralelo (onda 177 de 218)")
        self.assertIn("interrompido", ex["motivo_falha"])
        self.assertIn("--continuar", ex["motivo_falha"])
        self.assertEqual(ex["contadores"]["interrompida"]["continuavel"], True)
        self.assertEqual(ex["contadores"]["registros_lidos"], 5)
        e2 = P.enfileirar(self.c, "f4rc_plat", "importar", continuar=True)
        self.assertEqual(P.consultar(self.c, e2)["contadores"], {"continuar_de": eid})
        with self.c.cursor() as cur:
            cur.execute("SELECT detalhe FROM cliente_evento WHERE JSON_VALUE(detalhe, '$.execucao_id')=%s"
                        " ORDER BY id DESC LIMIT 1", (e2,))
            self.assertEqual(json.loads(cur.fetchone()[0])["continuar_de"], eid)
        P.cancelar(self.c, e2)
        self.assertRaises(P.PlataformaErro, P.enfileirar, self.c, "f4rc_plat", "importar", continuar=True)  # cancelada


# ------------------------------------------------------------------ continuação ponta a ponta (Firebird + MariaDB)
@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class ContinuacaoPontaAPonta(unittest.TestCase):
    def test_interrompida_no_meio_continua_e_fica_igual_a_inteira(self):
        from sante_conector.sintetica_d import exemplo_l9 as ex

        def escolher(plano, contagens, ws):  # a maior tabela do plano numa onda que não é a primeira, a 60%
            cand = [plano[i]["tabela"] for w in ws[1:] for i in w]
            alvo = max(cand, key=lambda t: contagens.get(t, 0))
            return alvo, int(contagens[alvo] * 0.6)
        self._ponta(ex, "exemplo_l9", escolher)

    def test_duas_fases_refeitas_na_continuacao(self):
        """Autorreferência (ex_grupo.grupo_pai_id, fase 2): a interrompida caiu (a) no _fase2, com todas as ondas
        marcadas, e (b) no meio da própria tabela autorreferente. A continuação refaz a tabela e a fase 2 das linhas
        "iguais" cuja coluna ficou NULL: o pai de cada grupo é o mesmo da importação inteira."""
        from sante_conector.sintetica_d import exemplo as ex

        def pais(um, cli, res_r, res_c):
            sql = ("SELECT g.nome, p.nome FROM `%s`.ex_grupo g LEFT JOIN `%s`.ex_grupo p ON p.id=g.grupo_pai_id"
                   " ORDER BY 1, 2")
            ref = um(sql % ("cliente_f4rc_ref", "cliente_f4rc_ref"))
            self.assertTrue(any(x[1] is not None for x in ref))
            self.assertEqual(um(sql % (cli, cli)), ref)
            sql = ("SELECT i.descricao, g.nome, COUNT(*) FROM `%s`.ex_item i LEFT JOIN `%s`.ex_grupo g ON"
                   " g.id=i.grupo_id GROUP BY 1, 2 ORDER BY 1, 2")
            self.assertEqual(um(sql % (cli, cli)), um(sql % ("cliente_f4rc_ref", "cliente_f4rc_ref")))
            self.assertEqual(res_c["carga"]["fase2_gravadas"], res_r["carga"]["fase2_gravadas"])
            self.assertEqual(res_c["carga"]["fase2_pendentes"], res_r["carga"]["fase2_pendentes"])

        def grupo(plano, contagens, ws):
            t = next(p["tabela"] for p in plano if p["destinos"][0] == "ex_grupo")
            return t, contagens[t] // 2
        self._ponta(ex, "exemplo", lambda *a: "fase2", pais)
        # a tabela do meio é a primeira (nada a pular); as linhas desfeitas na queda consumiram ids (o
        # AUTO_INCREMENT não volta no ROLLBACK): a soma de ex_item, que leva o id do grupo, muda; a ligação pelo
        # nome do grupo tem de ser a mesma (conferida em `pais`)
        self._ponta(ex, "exemplo", grupo, pais, pulada=False, soma=False)

    def _ponta(self, ex, fatia, escolher, extra=None, pulada=True, soma=True):
        self.maxDiff = None
        from sante_conector import abridor, banco, controle, sintetica
        from sante_conector.leitor import Leitor
        d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "continuar-f4rc")
        os.makedirs(d, exist_ok=True)
        arq = os.path.join(d, "v1.fdb")
        for x in (arq, arq[:-4] + ".manifesto.json"):
            if os.path.exists(x):
                os.remove(x)
        if hasattr(ex, "ddl"):
            ex.VERSAO, ex.DDL = 1, ex.ddl(1)
        sintetica.gerar(arq, versao=1, fatias=[fatia])
        root = banco.conectar(None, multi=True)
        sha = "c" * 64

        def um(sql, args=()):
            with root.cursor() as c:
                c.execute(sql, args)
                return c.fetchall()

        def preparar(cod):
            cli, ctl = "cliente_" + cod, controle.nome_ctl(cod)
            with root.cursor() as c:
                for b in (cli, ctl):
                    c.execute("DROP DATABASE IF EXISTS `%s`" % b)
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % cli)
            controle.preparar(root, cod, cli)
            root.select_db(cli)
            banco.aplicar_script(root, ex.DDL_DESTINO)
            return cli, ctl

        def rodar(cod, eid, falhar=None, **kw):
            cli, ctl = "cliente_" + cod, controle.nome_ctl(cod)
            with abridor.abrir(arq, modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
                presentes = set(lt.tabelas())
                contagens = {t: lt.contar(t) for t in presentes}
                with root.cursor() as c:  # a imagem que o motor grava (a continuação confere o arquivo por ela)
                    c.execute("INSERT INTO `%s`.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em,"
                              " ods_versao, pagina_bytes, tabelas, registros_total, generators, somente_leitura,"
                              " criado_em) VALUES (%%s, 'v1.fdb', 1, %%s, UTC_TIMESTAMP(), 12, 8192, %%s, %%s, 0, 1,"
                              " UTC_TIMESTAMP(3))" % ctl, (eid, sha, len(contagens), sum(contagens.values())))
                    img = c.lastrowid
                    c.executemany("INSERT INTO `%s`.imagem_tabela (imagem_id, tabela_origem, registros, criado_em)"
                                  " VALUES (%%s, %%s, %%s, UTC_TIMESTAMP(3))" % ctl,
                                  [(img, t, n) for t, n in contagens.items()])
                root.commit()
                plano = carga_mapa.planejar(ex.MAPA_TESTE, presentes)
                if kw.get("continuar_de"):
                    kw["pular"] = continuar.concluidas(root, ctl, kw["continuar_de"], plano, contagens, sha)["tabelas"]
                cc = banco.conectar(cli, autocommit=False)
                try:
                    cm = carga_mapa.CargaMapa(lt, cc, ctl, eid, img, ex.MAPA_TESTE, **kw)
                    if falhar == "fase2":  # caiu depois de todas as ondas (marcadas), antes da fase 2
                        def fase2(self):
                            raise RuntimeError("interrompida pelo teste no _fase2")
                        with mock.patch.object(carga_mapa.CargaMapa, "_fase2", fase2):
                            self.assertRaises(Exception, cm.executar, presentes, contagens)
                        return cm, None, plano, contagens
                    if falhar:
                        orig = carga_mapa.CargaMapa._linhas_mapa

                        def linhas(self, p):
                            for n, x in enumerate(orig(self, p)):
                                if p["tabela"] == falhar[0] and n == falhar[1]:
                                    raise RuntimeError("interrompida pelo teste")
                                yield x
                        with mock.patch.object(carga_mapa.CargaMapa, "_linhas_mapa", linhas):
                            self.assertRaises(Exception, cm.executar, presentes, contagens)
                        return cm, None, plano, contagens
                    res = cm.executar(presentes, contagens)
                finally:
                    cc.close()
            return cm, res, plano, contagens

        def destino(cli):
            return {t: um("SELECT COUNT(*) FROM `%s`.`%s`" % (cli, t))[0][0]
                    for (t,) in um("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s", (cli,))}

        def regras(cm):
            # as repetidas da interrompida vêm agregadas (pend_repetidas: tabela, regra, gravidade, detalhe, n), nunca
            # linha a linha na memória: a soma por (tabela, regra) tem de ser a mesma da importação inteira
            r = {}
            for t, _, regra, _, _ in cm.pend:
                r[(t, regra)] = r.get((t, regra), 0) + 1
            for t, regra, _, _, n in getattr(cm, "pend_repetidas", ()):
                r[(t, regra)] = r.get((t, regra), 0) + n
            return r
        try:
            preparar("f4rc_ref")
            cm_r, res_r, plano, contagens = rodar("f4rc_ref", 1)
            self.assertEqual([k for k, r in res_r["entidades"].items() if not r["conferido"]], [])
            falha = escolher(plano, contagens, paralelo.ondas(plano, ex.MAPA_TESTE))
            alvo = None if falha == "fase2" else falha[0]
            for legado in (True, False):
                cli, ctl = preparar("f4rc_cont")
                os.environ["CONECTOR_ESTADO_MIN"] = "1"  # (B) compacta e libera tudo: o resultado não muda
                try:
                    rodar("f4rc_cont", 1, falhar=falha)
                    if legado:  # execução anterior à marca (a 11 da ProntoCardio): só a dedução pelo controle
                        um("DELETE FROM `%s`.conector_tabela_concluida" % ctl)
                        root.commit()
                    versao_antes = dict(um("SELECT tabela_origem, SUM(versao) FROM `%s`.conector_origem GROUP BY 1"
                                           % ctl))
                    cm_c, res_c, _, _ = rodar("f4rc_cont", 2, continuar_de=1)
                finally:
                    os.environ.pop("CONECTOR_ESTADO_MIN", None)
                self.assertTrue(cm_c.pular or not pulada, "nenhuma tabela pulada")
                self.assertNotIn(alvo, cm_c.pular)
                ruins = [k for k, r in res_c["entidades"].items() if not r["conferido"]]
                self.assertEqual(ruins, [], {k: (res_c["entidades"][k], res_r["entidades"][k], k in cm_c.pular)
                                             for k in ruins})
                chave = ("registros_origem", "registros_destino", "recusados") + (("soma_destino",) if soma else ())
                self.assertEqual({k: [r[x] for x in chave] for k, r in res_c["entidades"].items()},
                                 {k: [r[x] for x in chave] for k, r in res_r["entidades"].items()})
                self.assertEqual(destino(cli), destino("cliente_f4rc_ref"))
                if extra:
                    extra(um, cli, res_r, res_c)
                self.assertEqual(regras(cm_c), regras(cm_r))
                versao_depois = dict(um("SELECT tabela_origem, SUM(versao) FROM `%s`.conector_origem GROUP BY 1"
                                        % ctl))
                for t in cm_c.pular:  # nunca regravar linha já vista
                    self.assertEqual(versao_depois.get(t), versao_antes.get(t), t)
                marcas = dict(um("SELECT tabela_origem, origem FROM `%s`.conector_tabela_concluida WHERE"
                                 " execucao_id=2" % ctl))
                self.assertEqual({t for t, o in marcas.items() if o == "continuada"}, set(cm_c.pular))
                self.assertEqual(set(marcas), {p["tabela"] for p in plano})
                self.assertIn("pico", res_c["carga"]["memoria"])
                print("\nCONTINUACAO (%s): %d de %d tabelas puladas, alvo interrompido %s" % (
                    "deducao" if legado else "marca", len(cm_c.pular), len(plano), alvo))
        finally:
            with root.cursor() as c:
                for cod in ("f4rc_ref", "f4rc_cont"):
                    for b in ("cliente_" + cod, controle.nome_ctl(cod)):
                        c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            root.close()


if __name__ == "__main__":
    time.sleep(0)
    unittest.main()
