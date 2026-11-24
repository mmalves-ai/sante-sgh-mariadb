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

    def test_resolucao_pela_cadeia(self):
        cad = controle.cadeia(self.cn, self.ctl, 12)
        n = relatorio.resolver(self.cn, self.ctl, 12, cad)
        self.cn.commit()
        self.assertEqual(n, 1)   # só a "velha" da importação 5: nada da cadeia, nem a a0 repetida pela 10
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia WHERE situacao='resolvida'"
                                 " AND resolvida_execucao_id=12"), 1)
        self.assertEqual(self._n("SELECT COUNT(*) FROM %(b)s.pendencia WHERE execucao_id IN (10,11,12)"
                                 " AND resolvida_execucao_id IS NOT NULL"), 0)

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
