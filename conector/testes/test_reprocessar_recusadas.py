"""CONECTOR_REPROCESSAR_RECUSADAS=1: passada de reprocesso depois de corrigir a declaração. A linha já vista e RECUSADA
(conector_origem com id_destino nulo e regra) é tratada como nova e tentada de novo, na carga própria (Carga._situacao)
e na carga pelo mapa (CargaMapa._situacao, Importar e Sincronizar); a linha gravada continua pulada como igual; a
pendência antiga da linha fica resolvida quando ela grava. Sem a variável, nada muda (continuidade, ADR 0006).

Sintético (exemplo_r4b, dados 100% falsos): EX5_EST chave 3 tem o código 'X' sem par (exige_dominio) e é recusada na
primeira carga; entre as cargas a declaração ganha o par X -> aberto. Com a variável, a segunda carga grava a linha e
a pendência `valor_fora_do_dominio` dela fica resolvida; sem a variável, a linha continua recusada e a pendência aberta.
"""
import copy
import os
import unittest
from unittest import mock

from sante_conector import carga, carga_mapa


class Variavel(unittest.TestCase):
    def test_valores(self):
        self.assertTrue(carga.reprocessar_recusadas({"CONECTOR_REPROCESSAR_RECUSADAS": "1"}))
        self.assertTrue(carga.reprocessar_recusadas({"CONECTOR_REPROCESSAR_RECUSADAS": " sim "}))
        for v in ({}, {"CONECTOR_REPROCESSAR_RECUSADAS": ""}, {"CONECTOR_REPROCESSAR_RECUSADAS": "0"}):
            self.assertFalse(carga.reprocessar_recusadas(v))


def _carga(cls, reprocessar, sinc=None):
    c = cls.__new__(cls)
    c.reprocessar, c.vistas, c.pend, c._buf, c._reemitidas = reprocessar, {}, [], [], {}
    c.cont = {"puladas_iguais": 0, "alteradas_aguardam": 0}
    c._avisos_ant = {"T": {}}
    c.existente = {"T": {"rec": (None, b"h", None, "valor_fora_do_dominio", "media"),
                         "sem": (None, b"h", None, None, None),  # sem destino por natureza: nunca recusa
                         "ok": (7, b"h", b"d", None, None)}}
    if sinc is not None:
        c.sinc, c._excluidas = sinc, {}
    return c


class Situacao(unittest.TestCase):
    def _casos(self, cls, sinc=None):
        sem = _carga(cls, False, sinc)
        self.assertEqual(sem._situacao("T", "rec", b"h")[0], "igual")          # continuidade: recusa reemitida
        self.assertEqual([p[2] for p in sem.pend], ["valor_fora_do_dominio"])
        com = _carga(cls, True, sinc)
        self.assertEqual(com._situacao("T", "rec", b"h"), ("nova", None))      # recusada: tentada de novo
        self.assertEqual(com.pend, [])                                         # nenhuma pendência repetida
        self.assertEqual(com._situacao("T", "ok", b"h")[0], "igual")           # gravada: pulada como igual
        self.assertEqual(com._situacao("T", "sem", b"h")[0], "igual")          # sem regra: não é recusa
        self.assertEqual((com.cont["recusadas_reprocessadas"], com.cont["puladas_iguais"]), (1, 2))
        self.assertEqual(com.vistas["T"], {"rec", "ok", "sem"})

    def test_carga_propria(self):
        self._casos(carga.Carga)

    def test_carga_pelo_mapa_importar(self):
        self._casos(carga_mapa.CargaMapa, sinc=False)

    def test_carga_pelo_mapa_sincronizar(self):
        self._casos(carga_mapa.CargaMapa, sinc=True)


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ReprocessoNoBanco(unittest.TestCase):
    def _rodar(self, reprocessar):
        from sante_conector import banco, conferencia, controle, relatorio
        from sante_conector.sintetica_d import exemplo_r4b as ex
        original = copy.deepcopy(ex.MAPA_TESTE)
        env = {"CONECTOR_REPROCESSAR_RECUSADAS": "1" if reprocessar else ""}

        def corrigir(cc):  # a declaração ganha o par que faltava; a segunda carga lê o env na construção
            ex.MAPA_TESTE["valores"].append(ex._v(ex.EST, "SIT", "ex5_estado.situacao", "X", "aberto"))
        ctl = controle.nome_ctl("cfexemplo_r4b")
        try:
            with mock.patch.dict(os.environ, env):
                r = conferencia.conferir("exemplo_r4b", manter=True, depois_da_primeira=corrigir)
            cc = banco.conectar(r["cliente"], autocommit=True)
            try:
                relatorio.resolver(cc, ctl, 2)
                with cc.cursor() as c:
                    c.execute("SELECT situacao FROM ex5_estado ORDER BY id")
                    est = [x[0] for x in c.fetchall()]
                    c.execute("SELECT id_destino IS NOT NULL, regra_recusa FROM `%s`.conector_origem"
                              " WHERE tabela_origem=%%s AND chave_original='3'" % ctl, (ex.EST,))
                    co = c.fetchone()
                    c.execute("SELECT execucao_id, situacao FROM `%s`.pendencia WHERE tabela_origem=%%s"
                              " AND chave_original='3' ORDER BY execucao_id" % ctl, (ex.EST,))
                    pend = [tuple(x) for x in c.fetchall()]
            finally:
                cc.close()
        finally:
            ex.MAPA_TESTE.clear()
            ex.MAPA_TESTE.update(original)
            root = banco.conectar(None)
            try:
                with root.cursor() as c:
                    for b in ("cliente_cfexemplo_r4b", ctl):
                        c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            finally:
                root.close()
        return r, est, co, pend

    def test_sem_a_variavel_nada_muda(self):
        r, est, co, pend = self._rodar(False)
        self.assertEqual(r["erros"], [])                       # segunda carga idempotente
        self.assertEqual(est, ["aberto", "fechado"])
        self.assertEqual((co[0], co[1]), (0, "valor_fora_do_dominio"))
        self.assertEqual(pend, [(1, "aberta"), (2, "aberta")])  # recusa reemitida, nunca resolvida em silêncio

    def test_com_a_variavel_grava_e_resolve(self):
        r, est, co, pend = self._rodar(True)
        # a conferência acusa só a segunda carga: a linha corrigida gravou (EX5_EST 3 de 2 esperados, 1 linha nova)
        self.assertTrue(r["erros"])
        self.assertTrue(all(e.startswith("segunda") for e in r["erros"]), r["erros"])
        self.assertEqual(est, ["aberto", "fechado", "aberto"])
        self.assertEqual((co[0], co[1]), (1, None))
        self.assertEqual(pend, [(1, "resolvida")])


if __name__ == "__main__":
    unittest.main()
