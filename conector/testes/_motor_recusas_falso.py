"""Motor falso para os testes do motor de colunas (recusas-fase2, C1a): só dados falsos, sem banco e sem Firebird."""
from sante_conector import carga_mapa
from sante_conector.pendencia import Propagador

H = b"\x00" * 32


class Leitor:
    def __init__(self, dados):
        self.d = dados  # {tabela: (colunas, [linhas])}

    def tabelas(self):
        return list(self.d)

    def ler_tudo(self, tab, colunas=None):
        nomes, linhas = self.d[tab]
        idx = [nomes.index(c) for c in colunas]
        return list(colunas), iter([tuple(x[i] for i in idx) for x in linhas])


def motor(dados=None, chaves=None, existente=None, um=None, todas=None):
    cm = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
    cm.lt = Leitor(dados or {})
    cm.chaves = chaves or {t: [cs[0]] for t, (cs, _) in (dados or {}).items()}
    cm._origem_pai, cm._alt, cm._alt_lista, cm.existente = {}, {}, {}, existente or {}
    cm.prop = Propagador()
    cm._carregar_existente = lambda tab: cm.existente.setdefault(tab, {})
    cm.subtipo, cm.info, cm._atualizar, cm.seq, cm.pular, cm.cont = {}, {}, None, {}, frozenset(), {}
    cm.ctl = "ctl_falso"
    cm.pendencias = []
    cm._pendencia = lambda *a: cm.pendencias.append(a)
    cm._um = um or (lambda *a: 0)
    cm._todas = todas or (lambda *a: [])
    return cm


def gravada(i):
    return (i, H, None, None, None)


def recusada(regra="restricao_destino_1048"):
    return (None, H, None, regra, "alta")
