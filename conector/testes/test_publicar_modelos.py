"""Decisão 61 (27/11): os modelos de documento migrados entram em uso, publicados pela conta de migração.

Dados SINTÉTICOS. A parte pura roda em qualquer lugar; a parte com banco roda no container do conector (MariaDB da rede
interna), num banco descartável com o DDL do modelo (db/migracoes, com os CHECKs), e prova: o migrado em rascunho é
publicado (versão, modelo, evento e conta de serviço inativa); o que o hospital mexeu, o banco de perguntas e o modelo
próprio do hospital ficam como estão; a segunda execução não repete nada; o retrato mudado pela origem refaz o selo."""
import os
import unittest
import uuid

from sante_conector import publicar_modelos as pm


class Puro(unittest.TestCase):
    def test_hash_retrato(self):
        self.assertEqual(pm.hash_retrato(None), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        self.assertEqual(pm.hash_retrato("abc"), pm.hash_retrato(b"abc"))
        self.assertEqual(len(pm.hash_retrato('{"a": 1}')), 64)
        self.assertNotEqual(pm.hash_retrato('{"a": 1}'), pm.hash_retrato('{"a": 2}'))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TABS = ("usuario", "tipo_documento_clinico", "modelo_documento_clinico", "modelo_documento_versao",
        "modelo_documento_evento")


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class Banco(unittest.TestCase):
    def test_publica_migrados_e_respeita_o_hospital(self):
        from sante_conector import banco, conferencia, mapa
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        nome = "cliente_dec61_conector_" + uuid.uuid4().hex[:8]
        root = banco.conectar(None, multi=True)
        cc = None
        try:
            with root.cursor() as c:
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
            root.select_db(nome)
            banco.aplicar_script(root, ";\n".join(
                [conferencia._sem_fk(ddl[t]["create"]).rstrip().rstrip(";") for t in TABS]
                + [a.rstrip().rstrip(";") for t in TABS for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]) + ";")
            cc = banco.conectar(nome, autocommit=False)

            def q(sql, args=()):
                with cc.cursor() as c:
                    c.execute(sql, args)
                    return c.fetchall()

            q("INSERT INTO usuario (id, login, nome, dispensa_cpf, criado_em) VALUES (7,'COMISSAO.SINT','COMISSAO"
              " SINTETICA',1,NOW(3))")
            # 1 e 2: migrados em rascunho (vão a uso); 3: migrado que a comissão já pôs em revisão (fica);
            # 4: banco de perguntas da migração (rascunho por desenho); 5: modelo próprio do hospital em rascunho
            for mid, cod, sit, org in [(1, "11", "rascunho", "migracao"), (2, "12", "rascunho", "migracao"),
                                       (3, "13", "revisao", "migracao"), (4, pm.BANCO_PERGUNTAS, "rascunho", "migracao"),
                                       (5, "PROPRIO", "rascunho", "sistema")]:
                q("INSERT INTO modelo_documento_clinico (id, codigo, titulo, tipo_documento_clinico_id, tipo_registro,"
                  " situacao, origem, criado_em) VALUES (%s,%s,%s,1,'outro',%s,%s,NOW(3))",
                  (mid, cod, "MODELO SINTETICO %d" % mid, sit, org))
                q("INSERT INTO modelo_documento_versao (id, modelo_documento_clinico_id, numero_versao, situacao,"
                  " operacao, dados, ocorrido_em, criado_em) VALUES (%s,%s,%s,%s,'inclusao',%s,NOW(3),NOW(3))",
                  (100 + mid, mid, 1 if mid == 4 else pm.NUMERO_ATUAL, "revisao" if mid == 3 else "rascunho",
                   '{"retrato": %d}' % mid))
            # versão histórica do modelo 1 (L6-13): continua como está
            q("INSERT INTO modelo_documento_versao (id, modelo_documento_clinico_id, numero_versao, situacao, operacao,"
              " dados, ocorrido_em, criado_em) VALUES (201,1,1,'rascunho','inclusao','{}',NOW(3),NOW(3))")
            cc.commit()

            r1 = pm.executar(cc)
            self.assertEqual((r1["publicados"], r1["selo_atualizado"], r1["em_uso"], r1["concorrentes"],
                              r1["conta_criada"], r1["nao_publicados"]), (2, 0, 0, 0, True, 1), r1)
            conta = q("SELECT id, tipo_conta, situacao, origem FROM usuario WHERE login=%s", (pm.CONTA_LOGIN,))
            self.assertEqual(conta[0][1:], ("servico", "inativo", "migracao"))
            u = conta[0][0]
            mods = {r[0]: r[1:] for r in q("SELECT id, situacao, publicada_modelo_documento_versao_id FROM"
                                           " modelo_documento_clinico ORDER BY id")}
            self.assertEqual(mods, {1: ("publicado", 101), 2: ("publicado", 102), 3: ("revisao", None),
                                    4: ("rascunho", None), 5: ("rascunho", None)})
            vers = {r[0]: r[1:] for r in q("SELECT id, situacao, publicacao_usuario_id, hash_definicao,"
                                           " publicada_em IS NOT NULL FROM modelo_documento_versao")}
            self.assertEqual(vers[101], ("publicada", u, pm.hash_retrato('{"retrato": 1}'), 1))
            self.assertEqual(vers[102][:3], ("publicada", u, pm.hash_retrato('{"retrato": 2}')))
            for vid in (103, 104, 105, 201):
                self.assertEqual(vers[vid][1:3], (None, None), vid)
            ev = q("SELECT modelo_documento_versao_id, tipo_evento, usuario_id, hash_definicao, texto FROM"
                   " modelo_documento_evento ORDER BY modelo_documento_versao_id")
            self.assertEqual(ev, ((101, "publicado", u, vers[101][2], pm.TEXTO),
                                  (102, "publicado", u, vers[102][2], pm.TEXTO)))

            # segunda execução (outro Sincronizar sem mudança): nada se repete
            r2 = pm.executar(cc)
            self.assertEqual((r2["publicados"], r2["selo_atualizado"], r2["em_uso"], r2["conta_criada"]),
                             (0, 0, 2, False), r2)
            self.assertEqual(q("SELECT COUNT(*) FROM modelo_documento_evento")[0][0], 2)
            self.assertEqual(q("SELECT COUNT(*) FROM usuario WHERE login=%s", (pm.CONTA_LOGIN,))[0][0], 1)

            # a origem mudou o retrato do modelo 2 (o Sincronizar regravou a versão): selo novo e evento novo
            q("UPDATE modelo_documento_versao SET dados='{\"retrato\": 22}' WHERE id=102")
            cc.commit()
            r3 = pm.executar(cc)
            self.assertEqual((r3["publicados"], r3["selo_atualizado"], r3["em_uso"]), (0, 1, 1), r3)
            self.assertEqual(q("SELECT hash_definicao FROM modelo_documento_versao WHERE id=102")[0][0],
                             pm.hash_retrato('{"retrato": 22}'))
            self.assertEqual(q("SELECT texto FROM modelo_documento_evento WHERE modelo_documento_versao_id=102"
                               " ORDER BY id DESC LIMIT 1")[0][0], pm.TEXTO_ATUALIZADA)

            # a comissão publicou nova versão do modelo 1 (a migrada ficou substituída): a migração não mexe mais
            q("INSERT INTO modelo_documento_versao (id, modelo_documento_clinico_id, numero_versao, situacao, operacao,"
              " dados, ocorrido_em, criado_em, publicada_em, publicacao_usuario_id, hash_definicao) VALUES"
              " (301,1,1001,'publicada','inclusao','{\"novo\": 1}',NOW(3),NOW(3),NOW(3),7,%s)", ("f" * 64,))
            q("UPDATE modelo_documento_versao SET situacao='substituida', dados='{\"retrato\": 111}' WHERE id=101")
            q("UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id=301 WHERE id=1")
            cc.commit()
            r4 = pm.executar(cc)
            self.assertEqual((r4["publicados"], r4["selo_atualizado"], r4["em_uso"]), (0, 0, 1), r4)
            self.assertEqual(q("SELECT hash_definicao FROM modelo_documento_versao WHERE id=301")[0][0], "f" * 64)
        finally:
            if cc:
                cc.close()
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
            root.close()

    def test_conta_garantida_antes_e_login_ocupado_nunca_adotado(self):
        from sante_conector import banco, conferencia, mapa
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        nome = "cliente_dec61c_conector_" + uuid.uuid4().hex[:8]
        root = banco.conectar(None, multi=True)
        cc = None
        try:
            with root.cursor() as c:
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
            root.select_db(nome)
            banco.aplicar_script(root, ";\n".join(
                [conferencia._sem_fk(ddl[t]["create"]).rstrip().rstrip(";") for t in TABS]
                + [a.rstrip().rstrip(";") for t in TABS for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]) + ";")
            cc = banco.conectar(nome, autocommit=False)
            # antes da carga: a conta de serviço é criada uma vez e reaproveitada
            self.assertEqual(pm.garantir_conta(cc), {"conta_criada": True})
            self.assertEqual(pm.garantir_conta(cc), {"conta_criada": False})
            with cc.cursor() as c:
                c.execute("SELECT tipo_conta, situacao, origem FROM usuario WHERE login=%s", (pm.CONTA_LOGIN,))
                self.assertEqual(c.fetchall(), (("servico", "inativo", "migracao"),))
                # o login passa a ser de uma pessoa: nunca adotado (a publicação falha visível, nada gravado)
                c.execute("UPDATE usuario SET tipo_conta='pessoa', origem='sistema' WHERE login=%s", (pm.CONTA_LOGIN,))
                c.execute("INSERT INTO modelo_documento_clinico (id, codigo, titulo, tipo_documento_clinico_id,"
                          " tipo_registro, situacao, origem, criado_em) VALUES (1,'EVAM','MODELO SINTETICO',1,"
                          "'outro','rascunho','migracao',NOW(3))")
                c.execute("INSERT INTO modelo_documento_versao (id, modelo_documento_clinico_id, numero_versao,"
                          " situacao, operacao, dados, ocorrido_em, criado_em) VALUES (101,1,%s,'rascunho','inclusao',"
                          "'{}',NOW(3),NOW(3))", (pm.NUMERO_ATUAL,))
            cc.commit()
            with self.assertRaises(pm.ContaMigracaoOcupada):
                pm.executar(cc)
            with self.assertRaises(pm.ContaMigracaoOcupada):
                pm.garantir_conta(cc)
            with cc.cursor() as c:
                c.execute("SELECT situacao FROM modelo_documento_clinico WHERE id=1")
                self.assertEqual(c.fetchone()[0], "rascunho")
        finally:
            if cc:
                cc.close()
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
            root.close()

    def test_sem_modelo_migrado_nao_cria_conta(self):
        from sante_conector import banco, conferencia, mapa
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        nome = "cliente_dec61b_conector_" + uuid.uuid4().hex[:8]
        root = banco.conectar(None, multi=True)
        cc = None
        try:
            with root.cursor() as c:
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
            root.select_db(nome)
            banco.aplicar_script(root, ";\n".join(
                [conferencia._sem_fk(ddl[t]["create"]).rstrip().rstrip(";") for t in TABS]
                + [a.rstrip().rstrip(";") for t in TABS for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]) + ";")
            cc = banco.conectar(nome, autocommit=False)
            self.assertEqual(pm.executar(cc), {"pulado": "nenhum modelo migrado"})
            with cc.cursor() as c:
                c.execute("SELECT COUNT(*) FROM usuario")
                self.assertEqual(c.fetchone()[0], 0)
        finally:
            if cc:
                cc.close()
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
            root.close()
