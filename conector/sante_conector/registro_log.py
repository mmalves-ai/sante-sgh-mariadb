"""Log de cada execução do conector em arquivo (obra carga-painel, pedido do dono de 24/11).

`CONECTOR_LOG_DIR/<cliente>/execucao-<id>.log`. O conector.sh monta a pasta no container; em dev ela é
`sante-sgh-dados/conector-logs`. A tela baixa o arquivo (API, pelo `arquivo_log` relativo), e o orquestrador o lê no
disco.

Cada linha leva a hora UTC e registra:
- as mudanças de etapa;
- o início e o fim de cada tabela, com lidas, processadas, gravadas, puladas e recusadas;
- um batimento por minuto;
- as recusas por regra;
- os erros, com a pilha (arquivo, linha e código, nunca a mensagem da exceção, que pode citar valor).

Nunca grava valor de linha (regra 5): só nomes de tabela e de regra, contagens e motivos técnicos. Sem a pasta
configurada, ou se ela não aceita escrita, o log fica desligado e a carga segue.
"""
import datetime
import json
import os
import re
import traceback

VAR = "CONECTOR_LOG_DIR"


def _seguro(nome):
    """Nome de pasta do cliente: só letras minúsculas, dígitos, `_` e `-` (o código do cliente já é assim)."""
    n = re.sub(r"[^a-z0-9_-]", "_", str(nome or "").lower())[:80]
    return n or "cliente"


def caminho_relativo(cliente, eid):
    return "%s/execucao-%d.log" % (_seguro(cliente), int(eid))


def _uma_linha(txt):
    return " ".join(str(txt).split())


class RegistroLog:
    def __init__(self, cliente, eid, raiz=None):
        raiz = os.environ.get(VAR) if raiz is None else raiz
        self.relativo, self._f = None, None
        if not raiz:
            return
        rel = caminho_relativo(cliente, eid)
        try:
            os.makedirs(os.path.join(raiz, _seguro(cliente)), exist_ok=True)
            # buffer de linha: o fork dos gravadores não herda nada pendente (nada sai em dobro)
            self._f = open(os.path.join(raiz, rel), "a", encoding="utf-8", buffering=1)
            self.relativo = rel
        except OSError:
            self._f = None

    @property
    def ativo(self):
        return self._f is not None

    def linha(self, texto):
        if self._f is None:
            return
        agora = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        try:
            self._f.write("%s %s\n" % (agora, _uma_linha(texto)))
        except (OSError, ValueError):
            pass

    def etapa(self, estado, etapa=None):
        self.linha("etapa: %s%s" % (estado, (" | " + etapa) if etapa else ""))

    def tabela_inicio(self, origem, destino, linhas):
        self.linha("tabela inicio: %s (origem %s) linhas_origem=%d" % (destino or origem, origem, int(linhas or 0)))

    def tabela_fim(self, origem, destino, linhas, c):
        self.linha("tabela fim: %s (origem %s) lidas=%d processadas=%d gravadas=%d puladas_iguais=%d recusadas=%d"
                   " pendencias_aviso=%d" % (destino or origem, origem, int(linhas or 0), c.get("processadas", 0),
                                             c.get("gravadas", 0), c.get("puladas_iguais", 0), c.get("recusadas", 0),
                                             c.get("pendencias_aviso", 0)))

    def batimento(self, p):
        """`p`: contadores.progresso (só contagens e nomes de tabela)."""
        tot = p.get("linhas_total") or 0
        pct = 100.0 * (p.get("linhas_processadas") or 0) / tot if tot else 0.0
        self.linha("batimento: %.1f%% linhas %d/%d gravadas=%d puladas_iguais=%d recusadas=%d avisos=%d onda=%s/%s"
                   " tabelas=%d/%d atual=%s" % (pct, p.get("linhas_processadas") or 0, tot, p.get("gravadas") or 0,
                                                p.get("puladas_iguais") or 0, p.get("recusadas") or 0,
                                                p.get("pendencias_aviso") or 0, p.get("onda"), p.get("ondas"),
                                                p.get("tabelas_feitas") or 0, p.get("tabelas_total") or 0,
                                                p.get("tabela_atual") or "-"))

    def recusas(self, regras, titulo="recusas por regra"):
        if regras:
            self.linha("%s: %s" % (titulo, json.dumps(regras, sort_keys=True, ensure_ascii=False)))

    def excecao(self, e, motivo=None, pilha=None):
        """Erro com a pilha: tipo, motivo técnico (o mesmo do motivo_falha) e os quadros (arquivo, linha e função,
        sem o texto do código), nunca a mensagem da exceção. `pilha`: o fim da pilha do gravador (GravadorFalhou.detalhe)."""
        self.linha("erro: %s%s" % (type(e).__name__, (" | " + motivo) if motivo else ""))
        if self._f is None:
            return
        for q in traceback.extract_tb(e.__traceback__)[-20:]:  # sem o texto da linha (um literal pode ser valor)
            self.linha("  pilha: %s:%d em %s" % (os.path.basename(q.filename), q.lineno, q.name))
        for ln in (pilha or "").split("\n"):
            if ln.strip():
                self.linha("  pilha do gravador: " + ln.strip())

    def fechar(self):
        if self._f is not None:
            try:
                self._f.close()
            except OSError:
                pass
            self._f = None
