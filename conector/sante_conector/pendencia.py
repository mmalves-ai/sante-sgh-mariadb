"""Pendências com propagação "pai pendente" (F4 L4, item 6).

Uma linha recusada ou pendente na origem deixa pendentes as linhas que a referenciam (pela `referencia` da coluna
no mapa), em cadeia. A pendência leva só tabela, chave original e regra, nunca valores (AGENTS.md regra 5). Quando
o pai é resolvido numa execução seguinte, `resolver` devolve os filhos a reavaliar.
"""
GRAVIDADES = ("baixa", "media", "alta", "critica")
PAI_PENDENTE = "pai_pendente"


class Propagador:
    def __init__(self):
        self._pend = {}  # (tabela, chave) -> {"regra", "gravidade", "raiz": (tabela, chave, regra)}
        self._filhos = {}  # (tabela_pai, chave_pai) -> {(tabela, chave)}

    def registrar(self, tabela, chave, regra, gravidade):
        if gravidade not in GRAVIDADES:
            raise ValueError("gravidade desconhecida: %s" % gravidade)
        k = (tabela, str(chave))
        atual = self._pend.get(k)
        if atual is None or GRAVIDADES.index(gravidade) > GRAVIDADES.index(atual["gravidade"]):
            self._pend[k] = {"regra": regra, "gravidade": gravidade, "raiz": (tabela, str(chave), regra)}

    def pendente(self, tabela, chave):
        return (tabela, str(chave)) in self._pend

    def avaliar(self, tabela, chave, referencias):
        """`referencias`: [(coluna, tabela_pai, chave_pai)] da linha. Para cada pai pendente, devolve a pendência
        `pai_pendente` do filho (com a raiz da cadeia) e registra o filho como pendente, com a gravidade da raiz."""
        saida = []
        for coluna, tpai, cpai in referencias:
            if cpai is None:
                continue
            kp = (tpai, str(cpai))
            self._filhos.setdefault(kp, set()).add((tabela, str(chave)))
            p = self._pend.get(kp)
            if p is None:
                continue
            saida.append({"tabela_origem": tabela, "chave_original": str(chave), "regra": PAI_PENDENTE,
                          "gravidade": p["gravidade"], "coluna": coluna, "tabela_pai": tpai,
                          "chave_pai": str(cpai), "raiz": p["raiz"]})
        for s in saida:
            k = (tabela, str(chave))
            atual = self._pend.get(k)
            if atual is None or GRAVIDADES.index(s["gravidade"]) > GRAVIDADES.index(atual["gravidade"]):
                self._pend[k] = {"regra": PAI_PENDENTE, "gravidade": s["gravidade"], "raiz": s["raiz"]}
        return saida

    def resolver(self, tabela, chave):
        """Tira a pendência da linha e devolve, em ordem determinística, os descendentes que estavam pendentes só
        por causa dela (a reavaliar). Pendência própria do filho (outra regra) continua."""
        raiz = (tabela, str(chave))
        self._pend.pop(raiz, None)
        fila, vistos, reavaliar = [raiz], {raiz}, []
        while fila:
            for f in sorted(self._filhos.get(fila.pop(0), ())):
                p = self._pend.get(f)
                if f in vistos or p is None or p["regra"] != PAI_PENDENTE or p["raiz"][:2] != raiz:
                    continue
                vistos.add(f)
                self._pend.pop(f)
                reavaliar.append(f)
                fila.append(f)
        return reavaliar
