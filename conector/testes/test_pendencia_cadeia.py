"""Pendência na execução em que nasceu e leitura pela cadeia de continuações (rodada pendencia-cadeia, 2026-11-24).

Sintoma: a continuação copiava as pendências abertas da interrompida (a execução 13 da ProntoCardio copiou 35.980.210
linhas da 11; a 14 levaria mais de um dia). Agora a continuação não copia: o controle guarda a cadeia
(`conector_execucao_cadeia`), `controle.cadeia` a devolve e todo leitor (relatório L10, resolução, resumo herdado,
carga própria) conta a mesma pendência uma vez, na execução mais antiga em que aparece, com a situação mais recente.
Só dados falsos."""
import unittest

from sante_conector import continuar, controle, relatorio


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TEM_BANCO = _mariadb()

# importação inteira (referência): o que a cadeia 10 → 11 → 12 tem de dar, sem dupla contagem
INTEIRA = ([("TAB_A", "a%d" % i, "pai_pendente", "alta", None) for i in range(5)]
           + [("TAB_B", "b%d" % i, "restricao_destino_1048", "critica", "coluna_x") for i in range(3)]
           + [("TAB_C", "c%d" % i, "valor_presumido", "baixa", None) for i in range(2)]
           + [("TAB_C", "c0", "valor_presumido", "baixa", None)]          # repetição legítima dentro da execução
           + [("TAB_X", None, "tabela_sem_mapa", "alta", None)])


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class Cadeia(unittest.TestCase):
    COD = "pq_cadeia"

    def setUp(self):
        from sante_conector import banco
        self.root = banco.conectar(None, multi=True)
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(self.root, self.COD, self.cli)
        self.cn = banco.conectar(self.cli, autocommit=False)
        linhas = [(20,) + x + ("aberta",) for x in INTEIRA]                  # a importação inteira, noutra execução
        linhas += [(5, "TAB_A", "a0", "pai_pendente", "alta", None, "aberta"),  # importação antiga: a0 se repete,
                   (5, "TAB_A", "velha", "pai_pendente", "alta", None, "aberta")]  # "velha" não (é resolvida)
        # 10: carregou A inteira e B pela metade; caiu
        linhas += [(10,) + x + ("aberta",) for x in INTEIRA if x[0] == "TAB_A" or x[1] in ("b0", "b1")]
        linhas += [(10, "TAB_X", None, "tabela_sem_mapa", "alta", None, "aberta"),
                   (10, "TAB_D", "d1", "valor_presumido", "baixa", None, "aberta")]
        # 11 (continua a 10): A pulada (sem cópia); B refeita (b0, b1 reemitidas pela linha "igual", b2 nova); caiu na C
        linhas += [(11,) + x + ("aberta",) for x in INTEIRA if x[0] == "TAB_B"]
        linhas += [(11, "TAB_C", "c0", "valor_presumido", "baixa", None, "aberta")] * 2   # a repetição legítima
        linhas += [
                   (11, "TAB_X", None, "tabela_sem_mapa", "alta", None, "aberta"),
                   (11, "TAB_D", "d1", "valor_presumido", "baixa", None, "resolvida")]   # situação mais recente
        # 12 (continua a 11): A e B puladas; C refeita (c0 duas vezes reemitida, c1 nova)
        linhas += [(12,) + x + ("aberta",) for x in INTEIRA if x[0] == "TAB_C"]
        linhas += [(12, "TAB_X", None, "tabela_sem_mapa", "alta", None, "aberta")]
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, situacao, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,NOW())" % self.ctl, linhas)
        self.cn.commit()
        controle.gravar_cadeia(self.root, self.ctl, 11, 10)
        controle.gravar_cadeia(self.root, self.ctl, 12, 11)
        controle.gravar_cadeia(self.root, self.ctl, 12, 11)   # idempotente
        self.root.commit()

    def tearDown(self):
        self.cn.close()
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _n(self, sql):
        with self.cn.cursor() as c:
            c.execute(sql % {"b": "`%s`" % self.ctl})
            return c.fetchone()[0]

    def test_cadeia_do_controle(self):
        self.assertEqual(controle.cadeia(self.cn, self.ctl, 12), [12, 11, 10])
        self.assertEqual(controle.cadeia(self.cn, self.ctl, 10), [10])
        # elo que o controle ainda não tem: completado pelos contadores da plataforma
        self.assertEqual(controle.cadeia(self.cn, self.ctl, 13, lambda e: {13: {"continuar_de": 12}}.get(e)),
                         [13, 12, 11, 10])

    def test_tres_execucoes_contam_como_a_inteira(self):
        cad = controle.cadeia(self.cn, self.ctl, 12)
        abertas, _ = relatorio._contar(self.cn, self.ctl, 12, cad)
        ref, _ = relatorio._contar(self.cn, self.ctl, 20)
        self.assertEqual(sorted(abertas), sorted(ref))
        self.assertEqual(sum(x[3] for x in abertas), len(INTEIRA))
        # sem a cadeia, a 12 só vê o que ela mesma gravou
        self.assertEqual(sum(x[3] for x in relatorio._contar(self.cn, self.ctl, 12)[0]), 4)
        # a d1 aberta na 10 e resolvida na 11 fica fora (situação mais recente)
        cond = controle.pendencias_da_cadeia(self.ctl, cad, "p", "aberta")
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia p WHERE " + cond + " AND p.tabela_origem='TAB_D'"),
                         0)

    def _marcas(self):
        """A 10 carregou A inteira; a 11 marcou A `continuada` e carregou B (refeita); a 12 pula A e B."""
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, origem,"
                          " criado_em) VALUES (%%s, 1, %%s, %%s, NOW())" % self.ctl,
                          [(10, "TAB_A", "carregada"), (11, "TAB_A", "continuada"), (11, "TAB_B", "carregada")])
        self.cn.commit()
        return {"TAB_A": 11, "TAB_B": 11}

    def test_resolucao_pela_cadeia(self):
        cad, pular = controle.cadeia(self.cn, self.ctl, 12), self._marcas()
        n = relatorio.resolver(self.cn, self.ctl, 12, cad, pular)
        self.cn.commit()
        # a "velha" da importação 5 e a d1 aberta da 10 (tabela D refeita pela 12, que não a repete); a a0 da 5 fica
        # (a 10 a repete, aberta), e nada das tabelas puladas nem do que a 12 repete
        self.assertEqual(n, 2)
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia WHERE resolvida_execucao_id=12"
                                 " AND ((execucao_id=5 AND chave_original='velha') OR (execucao_id=10"
                                 " AND tabela_origem='TAB_D'))"), 2)
        abertas, resolvidas = relatorio._contar(self.cn, self.ctl, 12, cad)
        self.assertEqual(sorted(abertas), sorted(relatorio._contar(self.cn, self.ctl, 20)[0]))
        self.assertEqual(resolvidas, (("TAB_A", "pai_pendente", "alta", 1),))   # a da cadeia é interna: não conta

    def test_carga_parcial_refeita_bate_com_a_inteira(self):
        """Pendência da cadeia que a continuação que conclui não repete: resolvida, e o relatório bate com o da
        importação inteira (achado do revisor: ficava aberta e era reemitida para sempre)."""
        extra = [(10, "TAB_B", "b9", "alteracao_aguarda_sincronizar", "media", None),  # carga parcial de B, não reemitida
                 (10, "TAB_B", "b1", "restricao_destino_1048", "critica", "coluna_y"),  # mesma chave, outro detalhe
                 (10, "TAB_A", "a9", "edicao_no_destino", "media", None),               # a conciliação refaz
                 (11, "TAB_C", "c9", "conflito_origem_venceu", "media", None),          # carga parcial de C (11)
                 (11, "TAB_A", "a0", "pai_pendente", "alta", None)]                     # repetição de vigente
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,NOW())" % self.ctl, extra)
        self.cn.commit()
        cad, pular = controle.cadeia(self.cn, self.ctl, 12), self._marcas()
        ref = sorted(relatorio._contar(self.cn, self.ctl, 20)[0])
        self.assertNotEqual(sorted(relatorio._contar(self.cn, self.ctl, 12, cad)[0]), ref)   # antes: 4 a mais
        # o resumo herdado já conta só as vigentes (sem b9, b1/coluna_y nem a9)
        cm = type("CM", (), {})()
        cm.ctl, cm.eid, cm.pend, cm.pend_repetidas = "`%s`" % self.ctl, 12, [], []
        cm._c = self.cn.cursor
        self.assertEqual(continuar.repetir_pendencias(cm, pular, excluir_regras=continuar.CONCILIACAO_PROPRIA), 8)
        n = relatorio.resolver(self.cn, self.ctl, 12, cad, pular)
        self.cn.commit()
        self.assertEqual(n, 2 + 4)
        abertas, resolvidas = relatorio._contar(self.cn, self.ctl, 12, cad)
        self.assertEqual(sorted(abertas), ref)
        self.assertEqual(sum(x[3] for x in abertas), len(INTEIRA))
        self.assertEqual(resolvidas, (("TAB_A", "pai_pendente", "alta", 1),))
        # nada vigente foi resolvido: A da 10 e da 11 (repetição), B da 11
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia WHERE resolvida_execucao_id=12 AND"
                                 " regra IN ('pai_pendente','restricao_destino_1048') AND COALESCE(detalhe,'')<>'coluna_y'"
                                 " AND execucao_id<>5"), 0)

    def test_heranca_sem_copia_pela_cadeia(self):
        conta = {"insert": 0}
        import pymysql.cursors

        class Contador(pymysql.cursors.Cursor):
            def execute(s, sql, args=None):
                if "pendencia" in sql and sql.lstrip().upper().startswith("INSERT"):
                    conta["insert"] += 1
                return super().execute(sql, args)

        cm = type("CM", (), {})()
        cm.ctl, cm.eid, cm.pend, cm.pend_repetidas = "`%s`" % self.ctl, 12, [], []
        cm._c = lambda: self.cn.cursor(Contador)
        antes = self._n("SELECT COUNT(*) FROM %(b)s.pendencia")
        # a 12 pula A (marcada `continuada` pela 11, que não tem as pendências: estão na 10) e B (concluída pela 11)
        n = continuar.repetir_pendencias(cm, {"TAB_A": 11, "TAB_B": 11})
        self.assertEqual(n, 8)   # 5 da A (na 10) + 3 da B (b0 e b1 uma vez só, b2)
        self.assertEqual(sorted(cm.pend_repetidas), [("TAB_A", "pai_pendente", "alta", None, 5),
                                                     ("TAB_B", "restricao_destino_1048", "critica", "coluna_x", 3)])
        self.assertEqual(conta["insert"], 0)
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia"), antes)

    def test_carga_propria_le_a_alteracao_na_cadeia(self):
        """A alteração à espera do Sincronizar gravada na execução que carregou (10) barra o pulo também quando a
        marca está na continuação (11), que não tem cópia das pendências."""
        with self.cn.cursor() as c:
            c.execute("INSERT INTO `%s`.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                      " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em) VALUES"
                      " (11, 'v.fdb', 1, %%s, NOW(), 12, 8192, 1, 1, 0, 1, NOW())" % self.ctl, ("a" * 64,))
            c.execute("INSERT INTO `%s`.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, origem,"
                      " criado_em) VALUES (11, 1, 'ATCABECATEND', 'continuada', NOW())" % self.ctl)
            c.execute("INSERT INTO `%s`.conector_origem (tabela_origem, chave_original, entidade_destino, hash_linha,"
                      " imagem_id, criado_em) VALUES ('ATCABECATEND', '1', 'atendimento', UNHEX(REPEAT('0', 32)), 1,"
                      " NOW())" % self.ctl)
        self.cn.commit()
        args = (self.cn, self.ctl, 11, ["ATCABECATEND"], {"ATCABECATEND": 1}, "a" * 64)
        self.assertEqual(continuar.concluidas_propria(*args), {"ATCABECATEND": 11})
        with self.cn.cursor() as c:
            c.execute("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                      " criado_em) VALUES (10,'ATCABECATEND','1','alteracao_aguarda_sincronizar','baixa',NOW())"
                      % self.ctl)
        self.cn.commit()
        self.assertEqual(continuar.concluidas_propria(*args), {})


class _PlatFalsa:
    """Plataforma falsa (só leitura): o cliente e as execuções com `contadores.continuar_de`."""

    def __init__(self, banco_nome, execucoes):
        self.banco_nome, self.execucoes = banco_nome, execucoes

    def cursor(self):
        dono = self

        class C:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            def execute(s, sql, args=()):
                assert sql.lstrip().upper().startswith("SELECT"), "a migração só lê a plataforma"
                s.r = [(7, dono.banco_nome)] if "FROM cliente" in sql else dono.execucoes

            def fetchone(s):
                return s.r[0] if s.r else None

            def fetchall(s):
                return list(s.r)
        return C()


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class Migracao(Cadeia):
    COD = "pq_cadeia_mig"

    def test_migracao_idempotente_indices_e_elos(self):
        with self.root.cursor() as c:   # controle de antes da rodada: os dois índices antigos
            c.execute("ALTER TABLE `%s`.pendencia DROP INDEX ix_pendencia_mesma,"
                      " ADD INDEX ix_pendencia_regra (tabela_origem, regra, chave_original(190)),"
                      " ADD INDEX ix_pendencia_execucao_tabela (execucao_id, situacao, tabela_origem, id)" % self.ctl)
            c.execute("DELETE FROM `%s`.conector_execucao_cadeia" % self.ctl)
        plat = _PlatFalsa(self.cli, [(10, None), (11, '{"continuar_de": 10}'), (12, '{"continuar_de": 11}'),
                                     (20, '{"outro": 1}')])
        for _ in range(2):   # idempotente
            r = controle.migrar(self.root, plat, self.COD)
            self.assertEqual(r["elos_cadeia"], 2)
            self.assertEqual(r["cadeias"], {11: [11, 10], 12: [12, 11, 10]})
            self.assertIn("ix_pendencia_execucao", r["indices_pendencia"])
            self.assertIn("ix_pendencia_mesma", r["indices_pendencia"])
            self.assertNotIn("ix_pendencia_regra", r["indices_pendencia"])
            self.assertNotIn("ix_pendencia_execucao_tabela", r["indices_pendencia"])
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.conector_execucao_cadeia"), 2)
        # o SQL que a leitura pela cadeia gera de fato: as subconsultas da dupla contagem e da situação mais recente
        # escolhem o ix_pendencia_mesma (key, não só possible_keys)
        cond = controle.pendencias_da_cadeia(self.ctl, [10, 11, 12], "p", "aberta")
        with self.cn.cursor() as c:
            c.execute("EXPLAIN SELECT p.tabela_origem, COUNT(*) FROM `%s`.pendencia p WHERE %s GROUP BY 1"
                      % (self.ctl, cond))
            nomes = [d[0] for d in c.description]
            linhas = [dict(zip(nomes, x)) for x in c.fetchall()]
        subs = [x for x in linhas if x["table"] in ("q", "r")]
        self.assertEqual(len(subs), 2, linhas)
        self.assertEqual({x["key"] for x in subs}, {"ix_pendencia_mesma"}, linhas)


@unittest.skipUnless(TEM_BANCO, "precisa do MariaDB da rede interna")
class DescartarCopiadas(unittest.TestCase):
    COD = "pq_descarte"

    def setUp(self):
        from sante_conector import banco
        self.root = banco.conectar(None, multi=True)
        self.cli, self.ctl = "cliente_" + self.COD, controle.nome_ctl(self.COD)
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            c.execute("CREATE DATABASE `%s`" % self.cli)
        controle.preparar(self.root, self.COD, self.cli)
        self.cn = banco.conectar(None, autocommit=False)
        k = [("TAB_A", "k%d" % i, "pai_pendente", "alta", None) for i in range(3)] + \
            [("TAB_B", "k9", "restricao_destino_1048", "critica", "coluna_x"), ("TAB_X", None, "tabela_sem_mapa", "alta", None)]
        n1 = ("TAB_A", "n1", "valor_presumido", "baixa", None)
        linhas = [(10,) + x for x in k]                                   # a que carregou
        linhas += [(11,) + x for x in k] + [(11,) + n1]                   # cópia (continuação antiga) + própria
        linhas += [(12,) + x for x in k] + [(12,) + n1]                   # cópia da 11 (inclui a n1 da 11)
        linhas += [(12, "TAB_A", "n2", "valor_presumido", "baixa", None),  # só na 12
                   (12, "TAB_B", "k9", "restricao_destino_1048", "critica", "coluna_y"),   # outro detalhe: não é cópia
                   (12, "TAB_A", "k0", "pai_pendente", "media", None)]                    # outra gravidade: idem
        linhas += [(30,) + x for x in k]                                  # outra importação, fora da cadeia
        with self.cn.cursor() as c:
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,NOW())" % self.ctl, linhas)
            # r1: resolvida na 10 (por outra execução concluída) e reemitida aberta pela 12: não é cópia (preservada)
            c.executemany("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " situacao, criado_em) VALUES (%%s,'TAB_A','r1','valor_presumido','baixa',%%s,NOW())"
                          % self.ctl, [(10, "resolvida"), (12, "aberta")])
        self.cn.commit()
        controle.gravar_cadeia(self.cn, self.ctl, 11, 10)
        controle.gravar_cadeia(self.cn, self.ctl, 12, 11)
        self.cn.commit()

    def tearDown(self):
        self.cn.close()
        with self.root.cursor() as c:
            for b in (self.cli, self.ctl):
                c.execute("DROP DATABASE IF EXISTS `%s`" % b)
        self.root.close()

    def _abertas(self):
        return sorted(relatorio._contar(self.cn, self.ctl, 12, controle.cadeia(self.cn, self.ctl, 12))[0])

    def test_conta_e_apaga_so_duplicatas(self):
        from sante_conector import descarte_pendencias as dp
        leitura = self._abertas()
        r = dp.descartar(self.cn, self.ctl, lote=2)             # sem --executar: só conta
        self.assertEqual(r["modo"], "contagem")
        self.assertEqual(r["antes"], {"10": 6, "11": 6, "12": 10})
        self.assertEqual(r["duplicatas"], {"11": 5, "12": 6})
        self.assertEqual(r["preservadas_situacao"], {"11": 0, "12": 1})
        self.assertEqual(r["depois"], r["antes"])
        # a janela de p comanda a leitura (chave primária) e a anterior é procurada pelo ix_pendencia_mesma
        lin = r["plano"]["linhas"]
        self.assertEqual([x["key"] for x in lin if x["table"] == "p"], ["PRIMARY"], lin)
        self.assertEqual([x["key"] for x in lin if x["table"] == "q"], ["ix_pendencia_mesma"], lin)
        self.assertEqual([x["select_type"] for x in lin if x["table"] == "q"], ["DEPENDENT SUBQUERY"], lin)
        self.assertEqual(self._abertas(), leitura)
        passos = []
        r = dp.descartar(self.cn, self.ctl, executar=True, lote=2, progresso=lambda e, z, n: passos.append(e))
        self.assertEqual(r["duplicatas"], {"11": 5, "12": 6})
        self.assertEqual(r["depois"], {"10": 6, "11": 1, "12": 4})
        self.assertGreater(len(passos), 2)                      # em pedaços, com commit a cada um
        with self.cn.cursor() as c:
            c.execute("SELECT execucao_id, chave_original, COALESCE(detalhe,''), gravidade FROM `%s`.pendencia"
                      " WHERE execucao_id IN (11,12) ORDER BY 1,2,3" % self.ctl)
            self.assertEqual(c.fetchall(), ((11, "n1", "", "baixa"), (12, "k0", "", "media"),
                                            (12, "k9", "coluna_y", "critica"), (12, "n2", "", "baixa"),
                                            (12, "r1", "", "baixa")))
            c.execute("SELECT COUNT(*) FROM `%s`.pendencia WHERE execucao_id=30" % self.ctl)
            self.assertEqual(c.fetchone()[0], 5)                # fora da cadeia: intocada
        self.assertEqual(self._abertas(), leitura)              # a leitura pela cadeia não muda
        r = dp.descartar(self.cn, self.ctl, executar=True)      # idempotente
        self.assertEqual(r["duplicatas"], {"11": 0, "12": 0})
