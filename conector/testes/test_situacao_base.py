"""Situação da base do painel de carga (situacao_base): fontes em ordem de preferência, subida com as gravadas, fim de
tabela (resumo regravado), reprocessamento das recusadas, nome genérico e a contagem das recusadas em SEGUNDO PLANO
(o início da execução nunca espera contagem pesada). Sem banco: cursor falso; só dados falsos."""
import threading
import time
import unittest

from sante_conector import carga, situacao_base


class _Cur:
    def __init__(self, dono):
        self.dono, self._r = dono, []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        self.dono.sql.append((sql, args))
        if "FROM `ctl`.conector_resumo_tabela" in sql:
            self._r = self.dono.resumo
        elif "FROM `ctl`.imagem " in sql:
            self._r = [(e,) for e in self.dono.execucoes]
        elif "conector_tabela_concluida" in sql:
            self._r = self.dono.concluidas
        elif "SELECT DISTINCT entidade_destino" in sql:
            if self.dono.recusas is None:
                raise RuntimeError("max_statement_time")
            self._r = [(e,) for e in sorted(self.dono.recusas)]
        elif "regra_recusa IS NOT NULL" in sql:
            self.dono.args_recusas.append(args)
            if self.dono.portao is not None:
                self.dono.portao.wait(5)
            if self.dono.demora:
                time.sleep(self.dono.demora)
            if self.dono.recusas is None:
                raise RuntimeError("max_statement_time")
            self._r = list(self.dono.recusas.get(args[0], []))
        else:
            self._r = []

    def fetchall(self):
        return list(self._r)


class _Conn:
    autocommit_mode = True

    def __init__(self, resumo=(), execucoes=(), concluidas=(), recusas=None, portao=None, demora=0):
        # recusas: {entidade de destino: [(tabela da origem, recusadas abertas)]}; None: toda contagem estoura
        self.resumo, self.execucoes, self.concluidas, self.sql = list(resumo), list(execucoes), list(concluidas), []
        self.recusas = None if recusas is None else dict(recusas)
        self.args_recusas, self.portao, self.demora, self.fechada = [], portao, demora, False

    def cursor(self):
        return _Cur(self)

    def close(self):
        self.fechada = True


def _placar():
    pl = carga.Placar()
    pl.planejar({"A": 100, "B": 50, "C": 40, "D": 10}, {"A": "paciente", "B": "atendimento", "C": "exame"})
    return pl


class SituacaoBaseTeste(unittest.TestCase):
    def _sb(self, reprocessar=False, recusas=None, fundo=False, ctds_extra=None, concluidas=None, **kw):
        conn = _Conn(resumo=[("A", 90, 10)], execucoes=[12, 11],
                     concluidas=concluidas or [("C", 40, 12), ("B", 1, 11)])
        fundo_conn = _Conn(recusas=recusas, portao=kw.pop("portao", None), demora=kw.pop("demora", 0))
        ctds = {12: {"entidades": {"x": {"tabela_origem": "B", "registros_destino": 45, "recusados": 2}}},
                11: {"entidades": {"y": {"tabela_origem": "B", "registros_destino": 1, "recusados": 0}}}}
        for e, v in (ctds_extra or {}).items():
            ctds.setdefault(e, {}).update(v)
        pl = _placar()
        sb = situacao_base.SituacaoBase(conn, "ctl", 20, pl, ctds.get, reprocessar=reprocessar,
                                        conectar=lambda: fundo_conn, fundo=fundo, **kw)
        sb.fundo_conn = fundo_conn
        return sb, pl, conn

    def test_fontes_em_ordem_e_totais(self):
        sb, _, _ = self._sb()
        b = sb.calcular()
        self.assertEqual(b["fontes"], {"resumo": 1, "conciliacao": 1, "concluida": 1, "sem_situacao": 1})
        self.assertEqual((b["linhas_origem"], b["linhas_na_base"], b["linhas_recusadas"]), (200, 175, 12))
        self.assertEqual(b["linhas_faltam"], 13)
        self.assertEqual(b["tabelas_sem_situacao"], 1)
        # a sem nome de destino nunca mostra o nome da origem
        self.assertEqual([t["tabela"] for t in b["por_tabela_top"]], ["tabela sem destino nomeado", "atendimento"])
        self.assertIsNotNone(b["calculo_ms"])

    def test_gravadas_sobem_e_fim_regrava_o_resumo(self):
        sb, pl, conn = self._sb()
        sb.calcular()
        pl.somar({"t": {"D": [10, 6, 0, 1, 0]}})
        self.assertEqual(sb.tabela("D"), (10, 6, 0))
        pl.somar({"t": {"B": [50, 20, 30, 0, 0]}})
        self.assertEqual(sb.tabela("B"), (50, 50, 0))  # limitado à contagem da origem
        sb.fim("D")
        self.assertEqual(sb.tabela("D"), (10, 9, 1))
        ins = [a for s, a in conn.sql if "INSERT INTO `ctl`.conector_resumo_tabela" in s]
        self.assertEqual(ins, [("D", 10, 9, 1, 20)])

    def test_recusadas_antigas_ficam_sem_reprocessar(self):
        sb, _, _ = self._sb()
        sb.calcular()
        sb.fim("A")
        self.assertEqual(sb.tabela("A"), (100, 90, 10))
        sb2, _, _ = self._sb(reprocessar=True)
        sb2.calcular()
        sb2.fim("A")  # reprocessadas e nenhuma recusada de novo
        self.assertEqual(sb2.tabela("A"), (100, 100, 0))

    def test_resumo_exato_e_concluida_aproximada_sem_contagem_no_inicio(self):
        sb, _, conn = self._sb()
        b = sb.calcular()
        # A (resumo) e B (conciliação) são exatas; só C, que depende da marca de concluída, é aproximada
        self.assertEqual(sb.recusas_desconhecidas, {"C"})
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 1)
        self.assertEqual(b["recusas_contagem"]["estado"], "desligada")
        # nenhuma contagem do conector_origem na conexão do motor
        self.assertFalse([q for q, _ in conn.sql if "conector_origem" in q])

    def test_inicio_nao_espera_a_contagem_de_fundo(self):
        portao = threading.Event()
        sb, _, conn = self._sb(recusas={"exame": [("C", 7)], "paciente": [("A", 3)]}, fundo=True, portao=portao)
        t0 = time.monotonic()
        b = sb.calcular()
        self.assertLess(time.monotonic() - t0, 2.0)
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 1)
        self.assertEqual(b["recusas_contagem"]["estado"], "em_andamento")
        self.assertEqual(sb.tabela("C"), (40, 40, 0))
        portao.set()
        sb.esperar_contagem(5)
        b = sb.json()  # o batimento seguinte (contadores.progresso.base) já traz o exato
        self.assertEqual(sb.tabela("C"), (40, 33, 7))
        self.assertEqual((b["linhas_na_base"], b["linhas_recusadas"]), (168, 19))
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 0)
        self.assertEqual(b["recusas_contagem"]["estado"], "concluida")
        self.assertEqual(sb.fundo_conn.args_recusas, [("exame",), ("paciente",)])  # uma consulta por entidade
        self.assertTrue(sb.fundo_conn.fechada)
        self.assertFalse([q for q, _ in conn.sql if "conector_origem" in q])
        q = [x for x, _ in sb.fundo_conn.sql if "regra_recusa" in x][0]
        self.assertIn("max_statement_time=10.0", q)
        # pelo índice (entidade_destino, id_destino): só o trecho id_destino nulo de cada entidade é lido
        self.assertIn("FORCE INDEX (ix_conector_origem_destino)", q)
        self.assertIn("WHERE entidade_destino=%s AND id_destino IS NULL", q)
        self.assertNotIn("uq_conector_origem_chave", q)

    def test_contagem_de_fundo_que_falha_fica_aproximada(self):
        sb, _, _ = self._sb(recusas=None, fundo=True)
        sb.calcular()
        sb.esperar_contagem(5)
        b = sb.json()
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 1)
        self.assertEqual(b["recusas_contagem"]["estado"], "estourou")
        self.assertEqual(b["fontes"]["concluida"], 1)
        sb.fim("C")  # lida inteira, mas as recusadas antigas seguem sem contagem: continua aproximada
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 1)

    def test_limite_total_da_contagem_de_fundo(self):
        sb, _, _ = self._sb(recusas={"exame": [("C", 7)], "paciente": [("A", 1)]}, fundo=True, demora=0.4,
                            total_s=0.6, concluidas=[("C", 40, 12), ("D", 10, 12)])
        sb.calcular()
        sb.esperar_contagem(5)
        b = sb.json()
        # 'exame' é contada; 'paciente' não cabe no limite total. C (exame) fica exata; D, sem nome de destino que
        # exclua a entidade estourada, fica aproximada
        self.assertEqual(sb.tabela("C"), (40, 33, 7))
        self.assertEqual(sb.recusas_desconhecidas, {"D"})
        self.assertEqual(b["recusas_contagem"]["estouradas"], 1)
        self.assertEqual(b["recusas_contagem"]["estado"], "estourou")
        self.assertEqual(b["recusas_contagem"]["contadas"], 1)

    def test_fim_de_tabela_aproximada_nao_grava_resumo_exato(self):
        prog = {"progresso": {"recusas_por_tabela": [{"tabela": "exame", "recusadas": 5}]}}
        sb, _, conn = self._sb(ctds_extra={12: prog})
        sb.calcular()
        sb.fim("C")  # sem reprocessar, com a recusada só estimada
        self.assertEqual(sb.tabela("C"), (40, 35, 5))
        self.assertIn("C", sb.recusas_desconhecidas)
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 1)
        self.assertFalse([a for s, a in conn.sql if "INSERT INTO `ctl`.conector_resumo_tabela" in s])
        # com o reprocessamento, a recusada desta execução é exata: grava
        sb2, _, conn2 = self._sb(ctds_extra={12: prog}, reprocessar=True)
        sb2.calcular()
        sb2.fim("C")
        self.assertEqual(sb2.json()["tabelas_recusas_desconhecidas"], 0)
        self.assertEqual([a for s, a in conn2.sql if "INSERT INTO `ctl`.conector_resumo_tabela" in s],
                         [("C", 40, 40, 0, 20)])

    def test_contagem_de_fundo_confirma_tabela_ja_lida_e_grava_o_resumo(self):
        portao = threading.Event()
        sb, _, conn = self._sb(recusas={"exame": [("C", 7)]}, fundo=True, portao=portao)
        sb.calcular()
        sb.fim("C")  # antes de a contagem terminar: segue aproximada, sem resumo
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 1)
        portao.set()
        sb.esperar_contagem(5)
        self.assertEqual(sb.tabela("C"), (40, 33, 7))
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 0)
        self.assertFalse([a for s, a in conn.sql if "INSERT INTO `ctl`.conector_resumo_tabela" in s])
        self.assertEqual([a for s, a in sb.fundo_conn.sql if "INSERT INTO `ctl`.conector_resumo_tabela" in s],
                         [("C", 40, 33, 7, 20)])

    def test_recusas_baratas_dos_contadores_da_execucao_que_concluiu(self):
        prog = {"progresso": {"recusas_por_tabela": [{"tabela": "exame", "recusadas": 5}]}}
        sb, _, _ = self._sb(ctds_extra={12: prog})
        sb.calcular()
        self.assertEqual(sb.tabela("C"), (40, 35, 5))
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 1)  # estimativa: segue aproximada

    def test_nome_na_contagem(self):
        from sante_conector import motor
        t = next(iter(carga.MAPA))
        self.assertEqual(motor.nome_na_contagem(t, 1, 3), carga.MAPA[t]["entidade"])
        self.assertEqual(motor.nome_na_contagem("XYZ_SEM_MAPA", 2, 3), "tabela 2 de 3")


if __name__ == "__main__":
    unittest.main()
