"""Situação da base do painel de carga (situacao_base): fontes em ordem de preferência, subida com as gravadas, fim de
tabela (resumo regravado), reprocessamento das recusadas e nome genérico. Sem banco: cursor falso; só dados falsos."""
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
            self._r = [("paciente",), ("exame",), (None,)]
        elif "regra_recusa IS NOT NULL" in sql:
            if self.dono.recusas is None:
                raise RuntimeError("sem indice")
            self.dono.args_recusas = args
            self._r = self.dono.recusas
        else:
            self._r = []

    def fetchall(self):
        return list(self._r)


class _Conn:
    autocommit_mode = True

    def __init__(self, resumo=(), execucoes=(), concluidas=(), recusas=()):
        self.resumo, self.execucoes, self.concluidas, self.sql = list(resumo), list(execucoes), list(concluidas), []
        self.recusas = None if recusas is None else list(recusas)
        self.args_recusas = None

    def cursor(self):
        return _Cur(self)


def _placar():
    pl = carga.Placar()
    pl.planejar({"A": 100, "B": 50, "C": 40, "D": 10}, {"A": "paciente", "B": "atendimento", "C": "exame"})
    return pl


class SituacaoBaseTeste(unittest.TestCase):
    def _sb(self, reprocessar=False, recusas=()):
        conn = _Conn(resumo=[("A", 90, 10)], execucoes=[12, 11], concluidas=[("C", 40), ("B", 1)], recusas=recusas)
        ctds = {12: {"entidades": {"x": {"tabela_origem": "B", "registros_destino": 45, "recusados": 2}}},
                11: {"entidades": {"y": {"tabela_origem": "B", "registros_destino": 1, "recusados": 0}}}}
        pl = _placar()
        return situacao_base.SituacaoBase(conn, "ctl", 20, pl, ctds.get, reprocessar=reprocessar), pl, conn

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

    def test_concluida_com_recusadas_nao_conta_como_na_base(self):
        sb, _, conn = self._sb(recusas=[("C", 7)])
        b = sb.calcular()
        self.assertEqual(sb.tabela("C"), (40, 33, 7))
        self.assertEqual((b["linhas_na_base"], b["linhas_recusadas"]), (168, 19))
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 0)
        # a contagem só pede as tabelas que dependem da marca de concluída (B veio da conciliação)
        self.assertEqual(conn.args_recusas, ("paciente", "exame", "C"))

    def test_concluida_sem_contagem_de_recusadas_fica_aproximada(self):
        sb, _, _ = self._sb(recusas=None)
        b = sb.calcular()
        self.assertEqual(b["tabelas_recusas_desconhecidas"], 1)
        self.assertEqual(b["fontes"]["concluida"], 1)
        sb.fim("C")  # lida inteira nesta execução: deixa de ser aproximada
        self.assertEqual(sb.json()["tabelas_recusas_desconhecidas"], 0)

    def test_nome_na_contagem(self):
        from sante_conector import motor
        t = next(iter(carga.MAPA))
        self.assertEqual(motor.nome_na_contagem(t, 1, 3), carga.MAPA[t]["entidade"])
        self.assertEqual(motor.nome_na_contagem("XYZ_SEM_MAPA", 2, 3), "tabela 2 de 3")


if __name__ == "__main__":
    unittest.main()
