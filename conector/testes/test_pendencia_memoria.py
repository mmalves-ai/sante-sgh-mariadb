"""Pendências na memória da carga (importação inteira da ProntoCardio, execução 25, 27/11/2026).

Sintoma: o gravador da tabela de preços próprios de mat/med (6,2 milhões de linhas, todas "iguais") terminou a tabela e
caiu por memória (cgroup do container, 24 GB) ao devolver o estado ao coordenador. Cada linha igual reemite as
pendências abertas da execução anterior, e três estruturas cresciam com uma entrada por linha e voltavam inteiras pelo
canal: os avisos anteriores da tabela (`_avisos_ant`, um conjunto por chave), a janela das reemitidas (`_reemitidas`)
e a lista `pend`. Correção:
- `_avisos_ant` é cache do processo (relido da base de controle por tabela), com valores compartilhados, e sai ao fim
  da tabela; nunca volta ao coordenador;
- `_reemitidas` vale até o commit (fim de linha); o que a fase 2 ainda recalcula (pai_pendente, pai_inexistente)
  passa a `_reemitidas_fim`, a única parte que volta;
- o coordenador dobra `pend` em contagens depois do commit, passado o limite (CONECTOR_PEND_MEMORIA): toda pendência
  já está gravada na base de controle; o resumo é o mesmo.
Só dados falsos, sem banco."""
import os
import unittest
from unittest import mock

from sante_conector import carga, carga_mapa, paralelo
from testes.test_pendencia_quadratica import _Con

T = "TFALSA"


def _carga(cls=carga.Carga):
    cg = object.__new__(cls)
    cg.cr, cg.ctl, cg.eid = _Con(), "`ctl`", 1
    cg.pend, cg._buf, cg._diario, cg._reemitidas = [], [], [], {}
    if cls is carga_mapa.CargaMapa:
        cg._fila, cg._esvaziando = [], False
    return cg


def _lotes(cg, n, k):
    for i in range(n):
        for j in range(k):
            regra = "regra_a" if j % 3 else "regra_b"
            cg._pendencia(T, "%d-%d" % (i, j), regra, "baixa", "det" if j % 5 == 0 else None)
        cg._commit()


def _resumo(cg):
    return carga.resumo_pendencias(cg.pend, [], lambda t: "ent", cg.__dict__.get("pend_dobradas"))


class DobraDasPendencias(unittest.TestCase):
    N, K = 6, 40

    def _rodar(self, limite, cls=carga.Carga):
        cg = _carga(cls)
        with mock.patch.dict(os.environ, {"CONECTOR_PEND_MEMORIA": str(limite)}):
            _lotes(cg, self.N, self.K)
        return cg

    def test_coordenador_dobra_com_o_mesmo_resumo(self):
        for cls in (carga.Carga, carga_mapa.CargaMapa):
            inteira, dobrada = self._rodar(10 ** 6, cls), self._rodar(50, cls)
            self.assertEqual(len(inteira.pend), self.N * self.K)
            self.assertLessEqual(len(dobrada.pend), 50)  # a lista não passa do limite depois do commit
            self.assertTrue(dobrada.pend_dobradas)
            self.assertEqual(dobrada._pend_total(), self.N * self.K)
            self.assertEqual(_resumo(dobrada), _resumo(inteira))  # total, por regra e por detalhe
            self.assertEqual(dobrada.cr.conta["linhas"], self.N * self.K)  # toda pendência gravada uma vez

    def test_gravador_nao_dobra(self):
        carga.EM_GRAVADOR[0] = True
        try:
            cg = self._rodar(50)
        finally:
            carga.EM_GRAVADOR[0] = False
        self.assertEqual(len(cg.pend), self.N * self.K)  # a diferença devolvida é a cauda da lista
        self.assertFalse(cg.__dict__.get("pend_dobradas"))

    def test_lista_esvaziada_no_lugar(self):
        cg = _carga()
        lista = cg.pend
        with mock.patch.dict(os.environ, {"CONECTOR_PEND_MEMORIA": "10"}):
            _lotes(cg, 2, 20)
        self.assertIs(cg.pend, lista)  # a mesma lista: a base do gravador (tamanho herdado) continua valendo

    def test_placar_conta_pela_soma(self):
        cg = self._rodar(50)
        cg.cont = {"puladas_iguais": 0}
        cg._placar_rebase()
        self.assertEqual(cg._pl_base["pend"], self.N * self.K)


class JanelaDasReemitidas(unittest.TestCase):
    def test_commit_guarda_so_o_que_a_fase2_recalcula(self):
        cg = _carga(carga_mapa.CargaMapa)
        cg._reemitidas.update({(T, "1", "adotado_existente"): 1, (T, "1", "pai_pendente"): 1,
                               (T, "2", "pai_inexistente"): 1, (T, "3", "pai_pendente"): 0})
        cg._commit()
        self.assertEqual(cg._reemitidas, {})
        self.assertEqual(cg._reemitidas_fim, {(T, "1", "pai_pendente"): 1, (T, "2", "pai_inexistente"): 1})
        # a fase 2 recalcula a pai_pendente reemitida: conta uma vez só
        cg._pendencia(T, "1", "pai_pendente", "media")
        self.assertEqual(cg.pend, [])
        self.assertEqual(cg._reemitidas_fim[(T, "1", "pai_pendente")], 0)
        # a mesma chave volta a ter a pendência (outra vez): agora conta
        cg._pendencia(T, "1", "pai_pendente", "media")
        self.assertEqual([p[2] for p in cg.pend], ["pai_pendente"])

    def test_reemitida_na_propria_linha_conta_uma_vez(self):
        cg = _carga(carga_mapa.CargaMapa)
        cg._reemitidas[(T, "9", "adotado_existente")] = 1
        cg._pendencia(T, "9", "adotado_existente", "baixa")  # a linha recalculou antes do commit
        self.assertEqual(cg.pend, [])

    def test_avisos_anteriores_com_valores_compartilhados(self):
        cg = _carga()
        cg._avisos_ant = {}

        class _CurAvisos:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, *a):
                pass

            def fetchall(self):
                return [(str(i), "adotado_existente", "baixa") for i in range(1000)] + [("7", "pai_pendente", "media")]

        cg._c = lambda: _CurAvisos()
        cg._reemitir_avisos(T, "\x00")
        av = cg._avisos_ant[T]
        self.assertEqual(av["7"], frozenset({("adotado_existente", "baixa"), ("pai_pendente", "media")}))
        self.assertIs(av["1"], av["2"])  # um objeto por combinação, não um por chave
        self.assertEqual(len({id(v) for v in av.values()}), 2)


class DiferencaDoGravador(unittest.TestCase):
    def _cm(self):
        cm = object.__new__(carga_mapa.CargaMapa)
        cm.prop = mock.Mock(_pend={}, _filhos={})
        cm.pend, cm.pend_repetidas, cm.pend_dobradas = [], [], {}
        cm._avisos_ant, cm._reemitidas, cm._reemitidas_fim = {}, {}, {}
        cm.cont, cm.existente, cm.vistas = {}, {}, {}
        return cm

    def test_avisos_e_janela_nao_voltam(self):
        self.assertIn("_avisos_ant", paralelo._FORA)
        self.assertIn("_reemitidas", paralelo._FORA)
        cm = self._cm()
        paralelo._rastrear(cm)
        paralelo._ATIVO[0] = True
        try:
            base = paralelo._base(cm)
            n = 5000
            cm._avisos_ant[T] = {str(i): frozenset({("adotado_existente", "baixa")}) for i in range(n)}
            for i in range(n):
                cm._reemitidas[(T, str(i), "adotado_existente")] = 1
                cm.pend.append((T, str(i), "adotado_existente", "baixa", None))
            cm._reemitidas[(T, "1", "pai_pendente")] = 1
            cm._podar_reemitidas()
            ops = paralelo._delta(cm, base)
        finally:
            paralelo._ATIVO[0] = False
        nomes = {}
        for _, nome, op, k, x in ops:
            nomes.setdefault(nome, []).append((op, k))
        self.assertNotIn("_avisos_ant", nomes)
        self.assertNotIn("_reemitidas", nomes)
        self.assertEqual(nomes["_reemitidas_fim"], [("put", (T, "1", "pai_pendente"))])
        self.assertEqual(nomes["pend"], [("ext", None)])  # a cauda inteira, numa operação
        destino = self._cm()
        paralelo._juntar(destino, ops)
        self.assertEqual(len(destino.pend), n)
        self.assertEqual(destino._reemitidas_fim, {(T, "1", "pai_pendente"): 1})


if __name__ == "__main__":
    unittest.main()
