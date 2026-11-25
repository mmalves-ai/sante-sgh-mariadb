"""Diferencial rápido: salto de blocos iguais e marcas de outra origem com a mesma base (carga-painel, 2026-11-24).

- Salto (carga_mapa.CargaMapa._saltar_bloco): no diferencial, o bloco de 10 mil ids cujo resumo e contagem batem com
  o guardado em `conector_bloco`, e cujas linhas estão todas carregadas com o mesmo hash, é pulado sem passar linha a
  linha. O resultado (conciliação, pendências, contadores do Sincronizar, destino) tem de ser IDÊNTICO ao do caminho
  linha a linha (CONECTOR_SALTO_BLOCOS=0):
  1. bloco igual pulado (Sincronizar da mesma imagem);
  2. bloco com linha alterada desce linha a linha e reaplica (Sincronizar da versão 2);
  3. bloco com recusa aberta grave é reprocessado;
  4. contagem do bloco diferente da guardada (linha nova ou apagada no bloco) desce linha a linha.
- Base declarada (continuar.py, regra 6; plataforma 0094): as marcas de tabela concluída de uma execução de OUTRA
  origem do cliente só valem com `continua_de_origem_id` declarado; prova de identidade que difere recusa.
Só dados falsos (imagem sintética)."""
import glob
import json
import os
import time
import unittest

from sante_conector import carga_mapa, continuar
from sante_conector.sintetica_d import exemplo_l9 as ex


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TEM_BANCO = _mariadb()
NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and TEM_BANCO
CODIGO = "f4dbl"


class _Env:
    def __init__(self, **kw):
        self.kw, self.ant = kw, {}

    def __enter__(self):
        for k, v in self.kw.items():
            self.ant[k] = os.environ.get(k)
            os.environ[k] = v
        return self

    def __exit__(self, *a):
        for k, v in self.ant.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class Liga(unittest.TestCase):
    def test_salto_ligado(self):
        self.assertTrue(carga_mapa.salto_ligado({}))
        self.assertTrue(carga_mapa.salto_ligado({"CONECTOR_SALTO_BLOCOS": "1"}))
        for v in ("0", "nao", "false", "N"):
            self.assertFalse(carga_mapa.salto_ligado({"CONECTOR_SALTO_BLOCOS": v}))


@unittest.skipUnless(NO_CONTAINER, "precisa do Firebird embutido e do MariaDB (conector.sh testes)")
class SaltoDeBlocos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from sante_conector import sintetica
        d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "dbl-" + CODIGO)
        os.makedirs(d, exist_ok=True)
        cls.arqs = {}
        for v in (1, 2):
            cls.arqs[v] = os.path.join(d, "v%d.fdb" % v)
            for x in (cls.arqs[v], cls.arqs[v][:-4] + ".manifesto.json"):
                if os.path.exists(x):
                    os.remove(x)
            ex.VERSAO, ex.DDL = v, ex.ddl(v)
            sintetica.gerar(cls.arqs[v], versao=v, fatias=["exemplo_l9"])
        ex.VERSAO, ex.DDL = 1, ex.ddl(1)
        cls.medidas = {}

    @classmethod
    def tearDownClass(cls):
        print("\nSALTO DE BLOCOS (imagem sintética): %s" % json.dumps(cls.medidas, sort_keys=True))

    def setUp(self):
        from sante_conector import banco, controle
        self.cliente, self.ctl = "cliente_" + CODIGO, controle.nome_ctl(CODIGO)
        self.root = banco.conectar(None, multi=True)
        with self.root.cursor() as c:
            for b in (self.cliente, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % self.cliente)
        controle.preparar(self.root, CODIGO, self.cliente)
        self.root.select_db(self.cliente)
        banco.aplicar_script(self.root, ex.DDL_DESTINO)
        self.root.commit()

    def tearDown(self):
        with self.root.cursor() as c:
            for b in (self.cliente, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _rodar(self, v, eid, sinc, salto):
        from sante_conector import abridor, banco
        from sante_conector.leitor import Leitor
        with _Env(CONECTOR_SALTO_BLOCOS="1" if salto else "0"), \
                abridor.abrir(self.arqs[v], modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
            presentes = set(lt.tabelas())
            contagens = {t: lt.contar(t) for t in presentes}
            cc = banco.conectar(self.cliente, autocommit=False)
            try:
                cm = carga_mapa.CargaMapa(lt, cc, self.ctl, eid, eid, ex.MAPA_TESTE, sincronizar=sinc)
                t0 = time.monotonic()
                res = cm.executar(presentes, contagens)
                seg = time.monotonic() - t0
            finally:
                cc.close()
        ruins = [k for k, r in res["entidades"].items() if not r["conferido"]]
        self.assertEqual(ruins, [], "execução %d: conciliação divergiu" % eid)
        regras = {}
        for _, _, regra, _, _ in cm.pend:
            regras[regra] = regras.get(regra, 0) + 1
        return cm, res, regras, seg

    def _x(self, sql, args=()):
        with self.root.cursor() as c:
            c.execute(sql.replace("{b}", "`%s`" % self.ctl), args)
            r = c.fetchall()
        self.root.commit()
        return r

    def _destino(self):
        return (self._x("SELECT id, nome, telefone, unidade, excluido_em IS NULL FROM ex9_paciente ORDER BY id"),
                self._x("SELECT id, presente, excluido_em IS NULL FROM ex9_consulta ORDER BY id"))

    @staticmethod
    def _sem_tempo(res):
        r = json.loads(json.dumps(res, default=str))
        r["carga"].pop("por_tabela", None)
        for k in list(r["carga"]):
            if "segundo" in k:
                r["carga"].pop(k)
        return {k: r[k] for k in ("entidades", "pendencias", "sincronizar") if k in r}

    def _cenario(self, salto, mexer=None):
        """Importa a v1, sincroniza a v1 (tudo igual) e sincroniza a v2 (alterações): resultados comparáveis."""
        self._rodar(1, 1, False, salto)
        if mexer:
            mexer()
        cm2, r2, reg2, s2 = self._rodar(1, 2, True, salto)
        cm3, r3, reg3, s3 = self._rodar(2, 3, True, salto)
        return {"igual": (cm2.cont, self._sem_tempo(r2), reg2, s2), "v2": (cm3.cont, self._sem_tempo(r3), reg3, s3),
                "destino": self._destino()}

    def _comparar(self, a, b):
        for k in ("igual", "v2"):
            self.assertEqual(a[k][1], b[k][1], k)          # conciliação, pendências e Sincronizar idênticos
            self.assertEqual(a[k][2], b[k][2], k)          # pendências por regra
            self.assertEqual(a[k][0].get("puladas_iguais"), b[k][0].get("puladas_iguais"), k)
        self.assertEqual(a["destino"], b["destino"])

    def test_salto_igual_ao_linha_a_linha(self):
        sem = self._cenario(False)
        self.setUp_novo()
        com = self._cenario(True)
        self._comparar(sem, com)
        # 1) a mesma imagem: os 3 blocos da consulta (e os das outras tabelas de chave inteira) pulados
        self.assertFalse(sem["igual"][0].get("blocos_saltados"))
        self.assertGreaterEqual(com["igual"][0].get("blocos_saltados", 0), 3, com["igual"][0])
        self.assertEqual(com["igual"][1]["sincronizar"]["blocos"][ex.CON], {"total": 3, "iguais": 3, "alterados": 0})
        # 2) a v2: só o bloco igual da consulta é pulado; os 2 alterados descem linha a linha e reaplicam
        self.assertEqual(com["v2"][1]["sincronizar"]["blocos"][ex.CON], {"total": 3, "iguais": 1, "alterados": 2})
        self.assertLess(com["v2"][0].get("blocos_saltados", 0), com["igual"][0]["blocos_saltados"])
        self.assertGreater(com["v2"][1]["sincronizar"]["atualizadas"], 0)
        SaltoDeBlocos.medidas["linhas_por_segundo_igual"] = {
            "sem_salto": round(sum(com["igual"][0].get(k, 0) for k in ("puladas_iguais",)) / max(sem["igual"][3], 1e-6)),
            "com_salto": round(com["igual"][0].get("puladas_iguais", 0) / max(com["igual"][3], 1e-6))}
        SaltoDeBlocos.medidas["segundos_sincronizar_igual"] = {"sem_salto": round(sem["igual"][3], 3),
                                                               "com_salto": round(com["igual"][3], 3)}

    def setUp_novo(self):
        self.tearDown()
        self.setUp()

    def _chaves_con(self):
        return sorted(int(k) for (k,) in self._x("SELECT chave_original FROM {b}.conector_origem WHERE"
                                                 " tabela_origem=%s AND chave_original NOT LIKE '%%/%%'", (ex.CON,)))

    def test_recusa_aberta_reprocessa_o_bloco(self):
        def recusa():  # pendência grave aberta numa chave do primeiro bloco da consulta (execução 1)
            k = self._chaves_con()[0]
            self._x("INSERT INTO {b}.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                    " criado_em) VALUES (1, %s, %s, 'recusa_de_teste', 'critica', UTC_TIMESTAMP(3))", (ex.CON, str(k)))
        sem = self._cenario(False, recusa)
        self.setUp_novo()
        com = self._cenario(True, recusa)
        self._comparar(sem, com)
        self.setUp_novo()
        livre = self._cenario(True)
        self.assertEqual(com["igual"][0].get("blocos_saltados", 0), livre["igual"][0].get("blocos_saltados", 0) - 1)
        self.assertEqual(com["igual"][2].get("recusa_de_teste"), 1)   # reemitida pelo caminho linha a linha

    def test_contagem_do_bloco_diferente_desce_linha_a_linha(self):
        def menos_uma():  # o guardado diz uma linha a menos no bloco: há linha nova no bloco
            self._x("UPDATE {b}.conector_bloco SET linhas=linhas-1 WHERE tabela_origem=%s ORDER BY bloco LIMIT 1",
                    (ex.CON,))
        com = self._cenario(True, menos_uma)
        self.setUp_novo()
        livre = self._cenario(True)
        self.assertEqual(com["igual"][0].get("blocos_saltados", 0), livre["igual"][0].get("blocos_saltados", 0) - 1)
        self._comparar(com, livre)


PLAT = "plataforma_teste_dbl"


@unittest.skipUnless(TEM_BANCO and glob.glob("/db-plataforma/*.sql"), "precisa do MariaDB e das migrações da plataforma")
class BaseDeclarada(unittest.TestCase):
    COD = "f4dbl_base"

    def setUp(self):
        from sante_conector import banco, controle
        c = banco.conectar(None, multi=True)
        banco.aplicar_script(c, "DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s`" % (PLAT, PLAT))
        c.select_db(PLAT)
        for arq in sorted(glob.glob("/db-plataforma/*.sql")):
            with open(arq, encoding="utf-8") as f:
                banco.aplicar_script(c, f.read())
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with c.cursor() as cur:
            for b in (self.cli, self.ctl):
                cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
            cur.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(c, self.COD, self.cli)
        c.close()
        self.c = banco.conectar(PLAT)
        self.ident = {"ods": "12.0", "pagina_bytes": 8192, "criada_em": "2020-01-01T00:00:00", "nome_base": "x.fdb"}
        with self.c.cursor() as cur:
            cur.execute("INSERT INTO cliente (codigo, nome, banco_nome, versao_migracao, origem_dados, criado_em)"
                        " VALUES (%s, 'Cliente de exemplo', %s, 'teste/0001', 'conector_spdata', UTC_TIMESTAMP(3))",
                        (self.COD, self.cli))
            self.cid = cur.lastrowid
            cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, caminho_relativo, tamanho_bytes, sha256,"
                        " modificado_em, ods_versao, pagina_bytes, vinculado_em, ativo, criado_em) VALUES"
                        " (%s, 'firebird_arquivo', 'x.fdb', 8192, %s, UTC_TIMESTAMP(), 12, 8192, UTC_TIMESTAMP(3),"
                        " FALSE, UTC_TIMESTAMP(3))", (self.cid, "a" * 64))
            self.oa = cur.lastrowid
            cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, servidor_host, servidor_porta, servidor_banco,"
                        " servidor_usuario, senha_referencia_cofre, identidade_base, vinculado_em, ativo, criado_em)"
                        " VALUES (%s, 'firebird_servidor', 'fb', 3050, 'base', 'leitor', 'env:X', %s,"
                        " UTC_TIMESTAMP(3), TRUE, UTC_TIMESTAMP(3))", (self.cid, json.dumps(self.ident)))
            self.ob = cur.lastrowid
            self.eid = {}
            for nome, oid, estado in (("antiga", self.oa, "falhou"), ("nova", self.ob, "pausada")):
                cur.execute("INSERT INTO conector_execucao (cliente_id, cliente_origem_id, tipo, estado, etapa,"
                            " solicitado_em, iniciado_em, concluido_em, criado_em) VALUES (%s, %s, 'importar', %s, 'x',"
                            " UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
                            (self.cid, oid, estado))
                self.eid[nome] = cur.lastrowid
        self.c.commit()
        from sante_conector.motor import identidade_sha
        self.sha_b = identidade_sha(self.ident)
        for nome, sha, tabs in (("antiga", "a" * 64, ("A", "B")), ("nova", self.sha_b, ("C",))):
            img = self._x("INSERT INTO {b}.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                          " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                          " (%s, 'x.fdb', 1, %s, UTC_TIMESTAMP(), 12, 8192, 3, 3, 0, 1, UTC_TIMESTAMP(3))",
                          (self.eid[nome], sha))
            for t in tabs:
                self._x("INSERT INTO {b}.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                        " criado_em) VALUES (%s, %s, %s, 0, 'carregada', UTC_TIMESTAMP(3))", (self.eid[nome], img, t))
                self._x("INSERT INTO {b}.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                        " hash_linha, imagem_id, criado_em) VALUES (%s, '1', 'e', 1, %s, %s, UTC_TIMESTAMP(3))",
                        (t, bytes(16), img))
        self.plano = [{"tabela": t, "destinos": ["dest_" + t.lower()]} for t in "ABCD"]
        self.cont = {t: 1 for t in "ABCD"}

    def tearDown(self):
        from sante_conector import banco
        self.c.close()
        c = banco.conectar(None)
        with c.cursor() as cur:
            for b in (PLAT, self.cli, self.ctl):
                cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
        c.close()

    def _x(self, sql, args=()):
        with self.c.cursor() as cur:
            cur.execute(sql.replace("{b}", "`%s`" % self.ctl), args)
            r = cur.lastrowid
        self.c.commit()
        return r

    def _concluidas(self):
        return continuar.concluidas(self.c, self.ctl, self.eid["nova"], self.plano, self.cont, self.sha_b)

    def test_marcas_de_outra_origem_so_com_a_declaracao(self):
        from sante_conector import plataforma as P
        r = self._concluidas()
        self.assertEqual((r["tabelas"], r["regra"]), ({"C"}, "marca"))   # sem declaração: como sempre
        self.assertNotIn("base_equivalente", r)
        self.assertRaises(P.PlataformaErro, P.declarar_continuidade, self.c, self.COD, self.ob, self.ob)
        det = P.declarar_continuidade(self.c, self.COD, self.ob, self.oa, motivo="mesma base servida")
        self.assertEqual(det["prova"]["situacao"], "confere")             # ODS e página batem
        with self.c.cursor() as cur:
            cur.execute("SELECT detalhe FROM cliente_evento WHERE cliente_id=%s AND tipo=%s",
                        (self.cid, P.EVENTO_CONTINUIDADE))
            ev = [json.loads(x[0]) for x in cur.fetchall()]
        self.assertEqual([(e["origem"], e["continua_de_origem"]) for e in ev], [(self.ob, self.oa)])
        r = self._concluidas()
        self.assertEqual(r["tabelas"], {"A", "B", "C"})
        self.assertEqual(r["origem"], {"A": self.eid["antiga"], "B": self.eid["antiga"], "C": self.eid["nova"]})
        self.assertIn("+base_declarada(%d:confere)" % self.oa, r["regra"])
        # prova que difere (página): a herança é recusada, a declaração não basta
        with self.c.cursor() as cur:
            cur.execute("UPDATE cliente_origem SET identidade_base=%s WHERE id=%s",
                        (json.dumps(dict(self.ident, pagina_bytes=4096)), self.ob))
        self.c.commit()
        self.sha_b_novo = None
        r = continuar.concluidas(self.c, self.ctl, self.eid["nova"], self.plano, self.cont, self.sha_b)
        self.assertEqual(r["tabelas"], {"C"})
        self.assertIn("base_declarada_recusada(difere)", r["regra"])
        # desfeita a declaração: como sempre
        with self.c.cursor() as cur:
            cur.execute("UPDATE cliente_origem SET identidade_base=%s WHERE id=%s", (json.dumps(self.ident), self.ob))
        self.c.commit()
        P.declarar_continuidade(self.c, self.COD, self.ob, None)
        self.assertEqual(self._concluidas()["tabelas"], {"C"})

    def test_sem_prova_vale_a_declaracao(self):
        from sante_conector import plataforma as P
        with self.c.cursor() as cur:
            cur.execute("UPDATE cliente_origem SET identidade_base=NULL WHERE id=%s", (self.ob,))
        self.c.commit()
        # a origem nova sem identidade e sem ODS/página: nada a confrontar, vale a declaração (no evento)
        det = P.declarar_continuidade(self.c, self.COD, self.ob, self.oa)
        self.assertEqual(det["prova"]["situacao"], "sem_prova")
        r = self._concluidas()
        self.assertEqual(r["tabelas"], {"A", "B", "C"})
        self.assertEqual(r["base_equivalente"]["prova"], "sem_prova")


if __name__ == "__main__":
    unittest.main()
