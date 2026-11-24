"""Tela "Carga e sincronismo" (obra carga-painel): progresso ao vivo, pausa, log por execução, modos e leitura direta.

- Placar e log (sem banco): contadores, percentual por linhas, top de recusas, log sem mensagem de exceção.
- Plataforma (MariaDB): modos completa e diferencial, retomar, pedido de pausa (Painel), órfã em `pausando`.
- Carga pelo mapa (Firebird embarcado + MariaDB, no container): o placar conta igual com 1 e com 3 gravadores e bate
  com o conector_origem tabela a tabela; a reexecução pula as iguais; a pausa no meio de uma onda para depois de um
  commit e a continuação fica igual à importação inteira.
- Motor com origem `firebird_servidor` (leitor simulado sobre a imagem sintética): leitura direta sem abridor nem
  gstat, conciliação da leitura pela transação, log em arquivo, pausa até `pausada` e retomada.
Só dados falsos; nada imprime valor de linha."""
import contextlib
import glob
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from sante_conector import carga, registro_log


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TEM_BANCO = _mariadb()
NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and TEM_BANCO
PLAT = "plataforma_teste_painel"


# ------------------------------------------------------------------ sem banco
class PlacarTeste(unittest.TestCase):
    def test_contadores_percentual_e_top(self):
        pl = carga.Placar()
        pl.planejar({"A": 100, "B": 50, "C": 10}, {"A": "destino_a", "B": "destino_b", "C": "destino_c"})
        pl.inicio("A")
        pl.somar({"t": {"A": [40, 30, 5, 5, 2]}, "r": {"restricao_destino_1048": 5}})
        pl.somar({"t": {"A": [10, 10, 0, 0, 0]}, "r": {}})
        j = pl.json()
        self.assertEqual((j["tabela_atual"], j["tabela_origem_linhas"], j["tabela_processadas"]), ("destino_a", 100, 50))
        self.assertEqual((j["linhas_total"], j["linhas_processadas"]), (160, 50))
        self.assertEqual((j["gravadas"], j["puladas_iguais"], j["recusadas"], j["pendencias_aviso"]), (40, 5, 5, 2))
        self.assertEqual(j["recusas_por_tabela"], [{"tabela": "destino_a", "recusadas": 5}])
        pl.fim("A")
        pl.fim("C", evento=False)  # continuação: concluída antes, conta inteira
        self.assertEqual(pl.linhas_processadas(), 110)
        self.assertEqual(pl.json()["tabelas_feitas"], 2)
        pl.recusadas_conciliacao = 9  # a conciliação final manda quando é maior
        self.assertEqual(pl.json()["recusadas"], 9)
        self.assertFalse(pl.pausa_pedida)
        pl.pedir_pausa()
        self.assertTrue(pl.pausa_pedida)

    def test_commit_conta_so_principal_e_desfeito_nao_conta(self):
        pl = carga.Placar()

        class _Cr:
            def commit(self):
                pass

        c = carga.Carga.__new__(carga.Carga)
        c.cr, c._buf, c.pend, c.cont, c.placar = _Cr(), [], [], {"puladas_iguais": 0}, pl
        c.vistas = {"T": {"1", "2", "3"}}
        c.existente = {"T": {"1": (10, b"", None, None, None), "2": (None, b"", None, "regra_x", "alta"),
                             "3": (11, b"", None, None, None), "1/destino": (12, b"", None, None, None)}}
        c._diario = [("T", "1", None), ("T", "2", None), ("T", "1/destino", None), ("T", "3", None),
                     ("T", "3", None)]
        c.pend = [("T", "2", "regra_x", "alta", None), ("T", "3", "aviso_y", "baixa", None)]
        c.cont["puladas_iguais"] = 4
        c._tab_atual = "T"
        c._commit()
        self.assertEqual(pl.tabela("T"), {"processadas": 3, "gravadas": 2, "puladas_iguais": 4, "recusadas": 1,
                                          "pendencias_aviso": 1})
        self.assertEqual(pl.regras, {"regra_x": 1})
        c._commit()  # nada novo: nada somado
        self.assertEqual(pl.tabela("T")["processadas"], 3)
        pl.pedir_pausa()
        self.assertRaises(carga.PausaPedida, c._commit)  # depois do commit
        c._commit()  # o commit seguinte (marca) não levanta de novo


class RegistroLogTeste(unittest.TestCase):
    def test_arquivo_linhas_e_sem_mensagem(self):
        with tempfile.TemporaryDirectory() as d:
            lg = registro_log.RegistroLog("cli_teste", 7, raiz=d)
            self.assertEqual(lg.relativo, "cli_teste/execucao-7.log")
            lg.etapa("lendo", "contando")
            lg.tabela_inicio("TAB", "destino", 10)
            lg.tabela_fim("TAB", "destino", 10, {"processadas": 10, "gravadas": 9, "recusadas": 1})
            lg.batimento({"linhas_total": 10, "linhas_processadas": 5, "tabela_atual": "destino"})
            lg.recusas({"restricao_destino_1062": 1})
            try:
                raise ValueError("VALOR-SECRETO-DA-LINHA")
            except ValueError as e:
                lg.excecao(e, "ValueError (mensagem omitida)")
            lg.fechar()
            with open(os.path.join(d, lg.relativo), encoding="utf-8") as f:
                txt = f.read()
        self.assertNotIn("VALOR-SECRETO-DA-LINHA", txt)
        for k in ("etapa: lendo", "tabela inicio: destino", "gravadas=9", "batimento: 50.0%", "restricao_destino_1062",
                  "erro: ValueError", "pilha:"):
            self.assertIn(k, txt)
        self.assertTrue(all(ln[:4].isdigit() for ln in txt.splitlines()))  # toda linha com a hora

    def test_sem_pasta_desligado(self):
        lg = registro_log.RegistroLog("x", 1, raiz="")
        self.assertIsNone(lg.relativo)
        lg.linha("nada")


# ------------------------------------------------------------------ plataforma (MariaDB)
def _plataforma():
    from sante_conector import banco
    os.environ["CONECTOR_PLATAFORMA_BANCO"] = PLAT
    c = banco.conectar(None, multi=True)
    banco.aplicar_script(c, "DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s`" % (PLAT, PLAT))
    c.select_db(PLAT)
    for arq in sorted(glob.glob("/db-plataforma/*.sql")):
        with open(arq, encoding="utf-8") as f:
            banco.aplicar_script(c, f.read())
    c.close()


def _cliente(c, cod, servidor=False):
    with c.cursor() as cur:
        cur.execute("INSERT INTO cliente (codigo, nome, banco_nome, versao_migracao, origem_dados, criado_em)"
                    " VALUES (%s, 'Cliente de exemplo', %s, 'teste/0001', 'conector_spdata', UTC_TIMESTAMP(3))",
                    (cod, "cliente_" + cod))
        cid = cur.lastrowid
        if servidor:
            cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, nome_exibicao, servidor_host, servidor_porta,"
                        " servidor_banco, servidor_usuario, senha_referencia_cofre, vinculado_em, ativo, criado_em)"
                        " VALUES (%s, 'firebird_servidor', 'Servidor de teste', 'fb-teste', 3050, 'teste',"
                        " 'LEITOR', 'env:SENHA_QUE_NAO_EXISTE', UTC_TIMESTAMP(3), TRUE, UTC_TIMESTAMP(3))", (cid,))
        else:
            cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, caminho_relativo, tamanho_bytes, sha256,"
                        " modificado_em, ods_versao, pagina_bytes, vinculado_em, ativo, criado_em) VALUES"
                        " (%s, 'firebird_arquivo', 'x.fdb', 8192, %s, UTC_TIMESTAMP(), 12, 8192, UTC_TIMESTAMP(3),"
                        " TRUE, UTC_TIMESTAMP(3))", (cid, "a" * 64))
    return cid


def _limpar_plataforma():
    from sante_conector import banco
    c = banco.conectar(None)
    with c.cursor() as cur:
        cur.execute("DROP DATABASE IF EXISTS `%s`" % PLAT)
    c.close()


def _eventos(c, eid):
    with c.cursor() as cur:
        cur.execute("SELECT JSON_VALUE(detalhe, '$.estado') FROM cliente_evento"
                    " WHERE JSON_VALUE(detalhe, '$.execucao_id')=%s ORDER BY id", (eid,))
        return [r[0] for r in cur.fetchall()]


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class PlataformaModos(unittest.TestCase):
    def setUp(self):
        from sante_conector import banco
        self._env = os.environ.get("CONECTOR_PLATAFORMA_BANCO")
        _plataforma()
        self.c = banco.conectar(PLAT)
        _cliente(self.c, "painel_a")

    def tearDown(self):
        self.c.close()
        _limpar_plataforma()
        if self._env is None:
            os.environ.pop("CONECTOR_PLATAFORMA_BANCO", None)
        else:
            os.environ["CONECTOR_PLATAFORMA_BANCO"] = self._env

    def _fim(self, eid, estado):
        from sante_conector import plataforma as P
        P.mudar_estado(self.c, eid, "abrindo", etapa="abrindo")
        if estado == "pausada":
            P.mudar_estado(self.c, eid, "pausando", etapa="pausando")
        P.mudar_estado(self.c, eid, estado, etapa=estado, motivo="teste" if estado == "falhou" else None)

    def test_modos_e_retomar(self):
        from sante_conector import plataforma as P
        self.assertRaises(P.PlataformaErro, P.enfileirar_carga, self.c, "painel_a", "tudo")
        e1 = P.enfileirar_carga(self.c, "painel_a", "completa")
        ex = P.consultar(self.c, e1)
        self.assertEqual((ex["tipo"], ex["modo"], ex["contadores"]), ("importar", "completa", {}))
        self.assertRaises(P.ExecucaoAtiva, P.enfileirar_carga, self.c, "painel_a", "diferencial")
        self._fim(e1, "pausada")
        # diferencial sem importação concluída: continua a pausada (mesma origem) e tenta de novo as recusadas
        e2 = P.enfileirar_carga(self.c, "painel_a", "diferencial")
        ex = P.consultar(self.c, e2)
        self.assertEqual((ex["tipo"], ex["modo"], ex["contadores"]),
                         ("importar", "diferencial", {"continuar_de": e1, "reprocessar_recusadas": True}))
        self._fim(e2, "falhou")
        e3 = P.retomar(self.c, "painel_a")  # retomar: o modo e o reprocessamento da retomada
        ex = P.consultar(self.c, e3)
        self.assertEqual((ex["modo"], ex["contadores"]), ("diferencial", {"continuar_de": e2,
                                                                          "reprocessar_recusadas": True}))
        P.mudar_estado(self.c, e3, "abrindo", etapa="x")
        for est in ("lendo", "gravando", "conciliando", "concluida"):
            P.mudar_estado(self.c, e3, est, etapa=est)
        self.assertRaises(P.PlataformaErro, P.retomar, self.c, "painel_a")  # a última concluiu
        # com importação concluída: diferencial = Sincronizar com as recusadas tentadas de novo
        e4 = P.enfileirar_carga(self.c, "painel_a", "diferencial")
        ex = P.consultar(self.c, e4)
        self.assertEqual((ex["tipo"], ex["modo"], ex["contadores"]),
                         ("sincronizar", "diferencial", {"reprocessar_recusadas": True}))
        self._fim(e4, "pausada")
        e5 = P.retomar(self.c, "painel_a")  # Sincronizar pausado: um Sincronizar novo
        self.assertEqual(P.consultar(self.c, e5)["tipo"], "sincronizar")

    def test_painel_pausa_e_orfa_pausando(self):
        from sante_conector import motor, plataforma as P
        from sante_conector.trabalhador import Trabalhador
        eid = P.enfileirar(self.c, "painel_a", "importar", modo="completa")
        t1 = Trabalhador("t1")
        self.assertEqual(t1.tomar_vaga(), 1)
        self.assertEqual(t1.reivindicar(), eid)
        P.mudar_estado(self.c, eid, "lendo", etapa="contando")
        cont = {}
        pn = motor.Painel(self.c, eid, cont, registro_log.RegistroLog("painel_a", eid, raiz=""), "lendo")
        pn.placar.planejar({"T": 10}, {"T": "destino_t"})
        pn.progresso(3, "contando")
        self.assertFalse(pn.pausando)
        self.assertTrue(isinstance(P.consultar(self.c, eid)["contadores"]["progresso"], dict))
        with self.c.cursor() as cur:  # o pedido de pausa (a CLI `pausar` e a API gravam o mesmo campo)
            cur.execute("UPDATE conector_execucao SET pausa_solicitada_em=UTC_TIMESTAMP(3) WHERE id=%s", (eid,))
        self.assertTrue(P.pausa_solicitada(self.c, eid))
        pn._ult_pausa = float("-inf")
        pn.progresso(4, "contando")
        self.assertTrue(pn.pausando and pn.placar.pausa_pedida)
        ex = P.consultar(self.c, eid)
        self.assertEqual(ex["estado"], "pausando")
        pn.progresso(4.5, "contando")  # o batimento continua em `pausando`
        self.assertEqual(P.consultar(self.c, eid)["percentual"], 4.5)
        self.assertRaises(carga.PausaPedida, pn.estado, "gravando", etapa="x")  # ponto seguro: não muda de estado
        t1.fechar()  # o trabalhador caiu em `pausando`: a órfã termina pausada, continuável
        t2 = Trabalhador("t2")
        try:
            self.assertEqual(t2.recuperar_orfas(), [eid])
        finally:
            t2.fechar()
        ex = P.consultar(self.c, eid)
        self.assertEqual((ex["estado"], ex["contadores"]["continuavel"]), ("pausada", True))
        self.assertEqual(_eventos(self.c, eid), ["fila", "abrindo", "lendo", "pausando", "pausada"])
        self.assertEqual(P.consultar(self.c, P.retomar(self.c, "painel_a"))["contadores"], {"continuar_de": eid})

    def test_pausa_tardia_na_conciliacao_conclui(self):
        """Pedido de pausa depois de `conciliando` (carga inteira): o batimento não entra em `pausando` e a
        execução conclui; pausando -> concluida não existe e virava `falhou`."""
        from sante_conector import motor, plataforma as P
        eid = P.enfileirar(self.c, "painel_a", "importar", modo="completa")
        P.mudar_estado(self.c, eid, "abrindo", etapa="abrindo")
        P.mudar_estado(self.c, eid, "lendo", etapa="lendo")
        pn = motor.Painel(self.c, eid, {}, registro_log.RegistroLog("painel_a", eid, raiz=""), "lendo")
        pn.estado("gravando", etapa="gravando")
        pn.estado("conciliando", etapa="conferindo", percentual=95, contadores={})
        with self.c.cursor() as cur:
            cur.execute("UPDATE conector_execucao SET pausa_solicitada_em=UTC_TIMESTAMP(3) WHERE id=%s", (eid,))
        pn._ult_pausa = float("-inf")
        pn.progresso(97, "conferindo o arquivo de origem")
        self.assertFalse(pn.pausando or pn.placar.pausa_pedida)
        self.assertEqual(P.consultar(self.c, eid)["estado"], "conciliando")
        P.mudar_estado(self.c, eid, "concluida", etapa="concluída", percentual=100, contadores={})
        self.assertEqual(_eventos(self.c, eid)[-2:], ["conciliando", "concluida"])

    def test_motivo_do_log_sem_mensagem(self):
        from sante_conector import motor
        try:
            int("VALOR_DA_LINHA")
        except ValueError as e:
            m = motor._motivo_log(e)
        self.assertNotIn("VALOR_DA_LINHA", m)
        self.assertTrue(m.startswith("ValueError (em "))

    def test_filtro_por_tipo_de_origem(self):
        from sante_conector import plataforma as P
        from sante_conector.trabalhador import Trabalhador
        _cliente(self.c, "painel_s", servidor=True)
        ea = P.enfileirar(self.c, "painel_a", "importar")
        es = P.enfileirar(self.c, "painel_s", "importar")
        with mock.patch.dict(os.environ, {"CONECTOR_ORIGEM_TIPOS": "firebird_servidor"}):
            t = Trabalhador("t-servico")
            try:
                t.tomar_vaga()
                self.assertEqual(t.reivindicar(), es)  # o serviço pula a de arquivo
                self.assertIsNone(t.reivindicar())
            finally:
                t.fechar()
        self.assertEqual(P.consultar(self.c, ea)["estado"], "fila")


# ------------------------------------------------------------------ carga pelo mapa (Firebird + MariaDB)
@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class PlacarEPausaNaCarga(unittest.TestCase):
    def test_placar_paralelo_igual_ao_sequencial_e_pausa_continua_igual(self):
        self.maxDiff = None
        from sante_conector import abridor, banco, carga_mapa, continuar, controle, paralelo, sintetica
        from sante_conector.leitor import Leitor
        from sante_conector.sintetica_d import exemplo_l9 as ex
        d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "painel-carga")
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        arq = os.path.join(d, "v1.fdb")
        if hasattr(ex, "ddl"):
            ex.VERSAO, ex.DDL = 1, ex.ddl(1)
        sintetica.gerar(arq, versao=1, fatias=["exemplo_l9"])
        root = banco.conectar(None, multi=True)
        sha = "d" * 64

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

        def rodar(cod, eid, gravadores, pausar=None, continuar_de=None):
            cli, ctl = "cliente_" + cod, controle.nome_ctl(cod)
            pl = carga.Placar()
            with mock.patch.dict(os.environ, {"CONECTOR_GRAVADORES": str(gravadores)}), \
                    abridor.abrir(arq, modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
                presentes = set(lt.tabelas())
                contagens = {t: lt.contar(t) for t in presentes}
                with root.cursor() as c:
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
                pl.planejar({p["tabela"]: contagens.get(p["tabela"], 0) for p in plano},
                            {p["tabela"]: p["destinos"][0] for p in plano})
                kw = {}
                if continuar_de:
                    kw["pular"] = continuar.concluidas(root, ctl, continuar_de, plano, contagens, sha)["tabelas"]
                    kw["continuar_de"] = continuar_de
                    for t in kw["pular"]:
                        pl.fim(t, evento=False)
                cc = banco.conectar(cli, autocommit=False)
                try:
                    cm = carga_mapa.CargaMapa(lt, cc, ctl, eid, img, ex.MAPA_TESTE, placar=pl, **kw)
                    if pausar:
                        orig = carga_mapa.CargaMapa._linhas_mapa

                        def linhas(self, p):
                            for n, x in enumerate(orig(self, p)):
                                if p["tabela"] == pausar[0] and n == pausar[1]:
                                    self.placar.pedir_pausa()  # memória compartilhada: vale em todo gravador
                                yield x
                        with mock.patch.object(carga_mapa.CargaMapa, "_linhas_mapa", linhas):
                            with self.assertRaises(carga.PausaPedida):
                                cm.executar(presentes, contagens)
                        return cm, None, pl, plano, contagens
                    res = cm.executar(presentes, contagens)
                finally:
                    cc.close()
            return cm, res, pl, plano, contagens

        def por_tabela_banco(ctl, plano):
            r = {}
            for p in plano:
                cond, args = continuar._sql_principal(p["destinos"])
                g, rc = um("SELECT COALESCE(SUM(id_destino IS NOT NULL), 0), COALESCE(SUM(id_destino IS NULL AND"
                           " regra_recusa IS NOT NULL), 0) FROM `%s`.conector_origem WHERE tabela_origem=%%s AND %s"
                           % (ctl, cond), [p["tabela"]] + args)[0]
                r[p["tabela"]] = (int(g), int(rc))
            return r

        def destino(cli):
            return {t: um("SELECT COUNT(*) FROM `%s`.`%s`" % (cli, t))[0][0]
                    for (t,) in um("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s", (cli,))}

        def resumo(pl):
            j = pl.json()
            return {k: j[k] for k in ("linhas_total", "linhas_processadas", "gravadas", "puladas_iguais", "recusadas",
                                      "pendencias_aviso", "recusas_por_regra", "tabelas_feitas", "tabelas_total")}
        try:
            # 1) placar: 1 gravador x 3 gravadores (contagem pelo canal entre processos) e x conector_origem
            _, res1, pl1, plano, contagens = (preparar("pnl_seq"), rodar("pnl_seq", 1, 1))[1]
            _, res3, pl3, _, _ = (preparar("pnl_par"), rodar("pnl_par", 1, 3))[1]
            r1, r3 = resumo(pl1), resumo(pl3)
            print("\nPLACAR seq: %s" % json.dumps(r1, sort_keys=True))
            self.assertEqual(r1, r3)
            self.assertEqual(r1["linhas_processadas"], r1["linhas_total"])
            self.assertGreater(r1["gravadas"], 0)
            self.assertEqual(sum(r1["recusas_por_regra"].values()), r1["recusadas"])
            banco_t = por_tabela_banco(controle.nome_ctl("pnl_par"), plano)
            self.assertEqual({t: (pl3.tabela(t)["gravadas"], pl3.tabela(t)["recusadas"]) for t in banco_t}, banco_t)
            # 2) reexecução (diferencial): as iguais são puladas pelo hash, nada regravado
            _, _, pl_re, _, _ = rodar("pnl_par", 2, 3)
            rr = resumo(pl_re)
            self.assertEqual(rr["gravadas"], 0)
            self.assertEqual(rr["puladas_iguais"] + rr["recusadas"] + rr["gravadas"] > 0, True)
            self.assertGreaterEqual(rr["puladas_iguais"], r1["gravadas"])
            # 3) pausa no meio de uma onda que não é a primeira; a continuação fica igual à importação inteira
            ws = paralelo.ondas(plano, ex.MAPA_TESTE)
            cand = [plano[i]["tabela"] for w in ws[1:] for i in w]
            alvo = max(cand, key=lambda t: contagens.get(t, 0))
            cli, ctl = preparar("pnl_pausa")
            cm_p, _, pl_p, _, _ = rodar("pnl_pausa", 1, 3, pausar=(alvo, int(contagens[alvo] * 0.5)))
            marcadas = {r[0] for r in um("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE"
                                         " execucao_id=1" % ctl)}
            self.assertNotIn(alvo, marcadas)
            self.assertLess(len(marcadas), len(plano))
            self.assertLess(pl_p.linhas_processadas(), pl_p.linhas_total())
            cm_c, res_c, pl_c, _, _ = rodar("pnl_pausa", 2, 3, continuar_de=1)
            self.assertTrue(cm_c.pular)
            ruins = [k for k, r in res_c["entidades"].items() if not r["conferido"]]
            self.assertEqual(ruins, [])
            chave = ("registros_origem", "registros_destino", "recusados", "soma_destino")
            self.assertEqual({k: [r[x] for x in chave] for k, r in res_c["entidades"].items()},
                             {k: [r[x] for x in chave] for k, r in res3["entidades"].items()})
            self.assertEqual(destino(cli), destino("cliente_pnl_par"))
            self.assertEqual(pl_c.linhas_processadas(), pl_c.linhas_total())
            print("PAUSA: alvo %s, %d de %d tabelas marcadas antes da pausa" % (alvo, len(marcadas), len(plano)))
        finally:
            with root.cursor() as c:
                for cod in ("pnl_seq", "pnl_par", "pnl_pausa"):
                    for b in ("cliente_" + cod, controle.nome_ctl(cod)):
                        c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            root.close()
            shutil.rmtree(d, ignore_errors=True)


# ------------------------------------------------------------------ motor com origem servidor
@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class MotorServidor(unittest.TestCase):
    """O leitor do servidor é simulado por um Leitor sobre a imagem sintética (o servidor real tem dado de pessoa):
    o que se prova aqui é o caminho do motor (sem abridor nem gstat, uma transação, log, pausa e retomada)."""

    def setUp(self):
        from sante_conector import banco, sintetica
        self._env = {k: os.environ.get(k) for k in ("CONECTOR_PLATAFORMA_BANCO", "CONECTOR_RESERVA_GB",
                                                     "CONECTOR_LOG_DIR", "CONECTOR_MAX_PARALELO")}
        _plataforma()
        os.environ.update(CONECTOR_RESERVA_GB="1", CONECTOR_MAX_PARALELO="1")
        self.logs = tempfile.mkdtemp()
        os.environ["CONECTOR_LOG_DIR"] = self.logs
        self.c = banco.conectar(PLAT)
        self.cod = "painel_srv"
        root = banco.conectar(None, multi=True)
        banco.aplicar_script(root, "DROP DATABASE IF EXISTS `cliente_%s`; CREATE DATABASE `cliente_%s`;"
                                   " CREATE TABLE `cliente_%s`.marca (id INT PRIMARY KEY);" % ((self.cod,) * 3))
        root.close()
        _cliente(self.c, self.cod, servidor=True)
        self.d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "painel-srv")
        shutil.rmtree(self.d, ignore_errors=True)
        os.makedirs(self.d)
        self.arq = os.path.join(self.d, "servidor.fdb")
        self.manif = sintetica.gerar(self.arq)

    def tearDown(self):
        from sante_conector import banco, controle
        self.c.close()
        root = banco.conectar(None)
        with root.cursor() as cur:
            for b in ("cliente_" + self.cod, controle.nome_ctl(self.cod)):
                cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
            cur.execute("SELECT user, host FROM mysql.user WHERE user LIKE %s",
                        ("sscon\\_%\\_" + banco.ficha_plataforma(),))
            for u, h in cur.fetchall():
                cur.execute("DROP USER IF EXISTS %s@%s", (u, h))
        root.close()
        _limpar_plataforma()
        shutil.rmtree(self.d, ignore_errors=True)
        shutil.rmtree(self.logs, ignore_errors=True)
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _rodar(self):
        from sante_conector import origem
        from sante_conector.leitor import Leitor
        from sante_conector.trabalhador import Trabalhador
        abertos = []

        @contextlib.contextmanager
        def abrir(org, env=None):
            self.assertIsInstance(org, origem.OrigemServidor)
            abertos.append(org.dsn)
            with Leitor(self.arq) as lt:
                yield lt
        t = Trabalhador("t-srv")
        try:
            with mock.patch.object(origem, "abrir_leitor_servidor", abrir), \
                    mock.patch("sante_conector.motor.abrir_remoto", side_effect=AssertionError("sem abridor")), \
                    mock.patch("sante_conector.imagem.gstat_registros", side_effect=AssertionError("sem gstat")):
                return t.laco(uma=True), abertos
        finally:
            t.fechar()

    def test_leitura_direta_log_pausa_e_retomada(self):
        from sante_conector import motor, plataforma as P
        rep_antes = os.environ.get("CONECTOR_REPROCESSAR_RECUSADAS")  # o container a passa vazia
        eid = P.enfileirar_carga(self.c, self.cod, "completa")
        ex, abertos = self._rodar()
        self.assertEqual((ex["id"], ex["estado"]), (eid, "concluida"), ex.get("motivo_falha"))
        self.assertEqual(abertos, ["fb-teste/3050:teste"])  # uma conexão por execução
        k = ex["contadores"]
        self.assertTrue(k["leitura_direta"])
        self.assertEqual((k["conciliacao_leitura"]["fonte_origem"], k["conciliacao_leitura"]["registros_origem"],
                          k["conciliacao_leitura"]["conferido"]), ("transacao", self.manif["registros_total"], True))
        self.assertNotIn("conciliacao", k)
        self.assertEqual(ex["imagem_sha256"], motor.identidade_sha(k["identidade_base"]))
        with self.c.cursor() as cur:
            cur.execute("SELECT identidade_base FROM cliente_origem WHERE servidor_host='fb-teste'")
            self.assertEqual(json.loads(cur.fetchone()[0]), k["identidade_base"])
        self.assertEqual(ex["arquivo_log"], "%s/execucao-%d.log" % (self.cod, eid))
        with open(os.path.join(self.logs, ex["arquivo_log"]), encoding="utf-8") as f:
            txt = f.read()
        for x in ("origem servidor", "etapa: lendo", "contagem:", "etapa: concluida"):
            self.assertIn(x, txt)
        self.assertEqual(_eventos(self.c, eid), ["fila", "abrindo", "lendo", "gravando", "conciliando", "concluida"])
        # pausa pedida antes de o motor começar: para no primeiro ponto seguro, `pausada`, continuável
        e2 = P.enfileirar_carga(self.c, self.cod, "diferencial")
        self.assertEqual(P.consultar(self.c, e2)["tipo"], "sincronizar")
        with self.c.cursor() as cur:
            cur.execute("UPDATE conector_execucao SET pausa_solicitada_em=UTC_TIMESTAMP(3) WHERE id=%s", (e2,))
        ex2, _ = self._rodar()
        self.assertEqual((ex2["id"], ex2["estado"]), (e2, "pausada"), ex2.get("motivo_falha"))
        self.assertTrue(ex2["contadores"]["continuavel"])
        self.assertEqual(_eventos(self.c, e2)[-2:], ["pausando", "pausada"])
        with open(os.path.join(self.logs, ex2["arquivo_log"]), encoding="utf-8") as f:
            self.assertIn("etapa: pausada", f.read())
        e3 = P.retomar(self.c, self.cod)
        ex3, _ = self._rodar()
        self.assertEqual((ex3["id"], ex3["estado"]), (e3, "concluida"), ex3.get("motivo_falha"))
        self.assertTrue(ex3["contadores"]["reprocessar_recusadas"])
        self.assertEqual(os.environ.get("CONECTOR_REPROCESSAR_RECUSADAS"), rep_antes)  # o pedido vale só na execução


if __name__ == "__main__":
    unittest.main()
