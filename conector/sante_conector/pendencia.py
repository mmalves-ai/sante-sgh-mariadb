"""Pendências com propagação "pai pendente" (F4 L4, item 6).

Uma linha recusada ou pendente na origem deixa pendentes as linhas que a referenciam (pela `referencia` da coluna
no mapa), em cadeia. A pendência leva só tabela, chave original e regra, nunca valores (AGENTS.md regra 5). Quando
o pai é resolvido numa execução seguinte, `resolver` devolve os filhos a reavaliar.

Cada linha guarda um CONJUNTO de pendências: as próprias (uma por regra) e uma `pai_pendente` por pai pendente. Uma
não apaga a outra: resolver um pai tira só a `pai_pendente` daquele pai, e a pendência própria do filho (ou a que
vem de outro pai) continua.
"""
GRAVIDADES = ("baixa", "media", "alta", "critica")
PAI_PENDENTE = "pai_pendente"


def _g(gravidade):
    return GRAVIDADES.index(gravidade)


class Propagador:
    def __init__(self):
        # (tabela, chave) -> {motivo: {"regra", "gravidade", "raiz"}}; motivo = ("propria", regra) ou ("pai", kp)
        self._pend = {}
        self._filhos = {}  # (tabela_pai, chave_pai) -> {(tabela, chave)}

    def registrar(self, tabela, chave, regra, gravidade):
        if gravidade not in GRAVIDADES:
            raise ValueError("gravidade desconhecida: %s" % gravidade)
        k = (tabela, str(chave))
        ps = self._pend.setdefault(k, {})
        atual = ps.get(("propria", regra))
        if atual is None or _g(gravidade) > _g(atual["gravidade"]):
            ps[("propria", regra)] = {"regra": regra, "gravidade": gravidade, "raiz": (tabela, str(chave), regra)}

    def pendente(self, tabela, chave):
        return bool(self._pend.get((tabela, str(chave))))

    def pendencias(self, tabela, chave):
        """Regras pendentes da linha, em ordem determinística (só regras, nunca valores)."""
        return sorted(p["regra"] for p in self._pend.get((tabela, str(chave)), {}).values())

    def _mais_grave(self, k):
        ps = self._pend.get(k) or {}
        if not ps:
            return None
        return max(ps.values(), key=lambda p: (_g(p["gravidade"]), p["raiz"]))

    def avaliar(self, tabela, chave, referencias):
        """`referencias`: [(coluna, tabela_pai, chave_pai)] da linha. Para cada pai pendente, devolve a pendência
        `pai_pendente` do filho (com a raiz da cadeia e a gravidade da pendência mais grave do pai) e a acrescenta
        às pendências do filho, sem tirar as que ele já tem."""
        saida = []
        k = (tabela, str(chave))
        for coluna, tpai, cpai in referencias:
            if cpai is None:
                continue
            kp = (tpai, str(cpai))
            self._filhos.setdefault(kp, set()).add(k)
            p = self._mais_grave(kp)
            if p is None:
                continue
            saida.append({"tabela_origem": tabela, "chave_original": str(chave), "regra": PAI_PENDENTE,
                          "gravidade": p["gravidade"], "coluna": coluna, "tabela_pai": tpai,
                          "chave_pai": str(cpai), "raiz": p["raiz"]})
            self._pend.setdefault(k, {})[("pai", kp)] = {"regra": PAI_PENDENTE, "gravidade": p["gravidade"],
                                                         "raiz": p["raiz"]}
        return saida

    def resolver(self, tabela, chave):
        """Tira todas as pendências da linha e, em cadeia, a `pai_pendente` que cada descendente tinha por causa dela.
        Devolve, em ordem determinística de visita, os descendentes a reavaliar. Um descendente que segue com outra
        pendência (própria ou de outro pai) continua pendente e não libera os filhos dele."""
        raiz = (tabela, str(chave))
        self._pend.pop(raiz, None)
        fila, vistos, reavaliar = [raiz], {raiz}, []
        while fila:
            kp = fila.pop(0)
            for f in sorted(self._filhos.get(kp, ())):
                ps = self._pend.get(f)
                if not ps or ("pai", kp) not in ps:
                    continue
                del ps[("pai", kp)]
                if f not in vistos:
                    vistos.add(f)
                    reavaliar.append(f)
                if not ps:
                    self._pend.pop(f)
                    fila.append(f)
        return reavaliar
