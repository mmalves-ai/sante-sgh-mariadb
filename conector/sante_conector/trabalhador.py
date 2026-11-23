"""Trabalhador (worker) do conector: retira execuções da fila da plataforma.

- Limite de paralelo: CONECTOR_MAX_PARALELO vagas (padrão 1). Cada trabalhador segura uma vaga por trava nomeada
  do MariaDB (`GET_LOCK`), que o servidor solta sozinho se o processo cair.
- Retirada: `SELECT ... FOR UPDATE SKIP LOCKED` sobre a fila; a passagem para `abrindo` e o evento vão na mesma
  transação. Durante a execução, o trabalhador segura a trava nomeada da execução.
- Uma execução por cliente: índice único `uq_conector_execucao_cliente_ativo` (estados ativos), já no enfileirar.
- Órfãs: execução rodando cuja trava ninguém segura (trabalhador caiu) vira `falhou` CONTINUÁVEL: a etapa em que
  parou fica (`interrompida: <etapa>` e `contadores.interrompida`), e a importação continua por
  `enfileirar <cliente> importar --continuar` (continuar.py); snapshot `sscon-e<id>-<ficha>`
  sem dono é desmontado pelo abridor separado (o trabalhador não tem privilégio: `separado.py`).
"""
import os
import socket
import time
import uuid

from . import banco, motor, plataforma, servico_abridor


class Trabalhador:
    def __init__(self, nome=None, max_paralelo=None):
        self.plat = banco.plataforma_banco()
        self.ficha = banco.ficha_plataforma()
        self.conn = banco.conectar(self.plat, autocommit=True)
        self.nome = (nome or "%s-%d-%s" % (socket.gethostname(), os.getpid(), uuid.uuid4().hex[:4]))[:80]
        self.max = int(max_paralelo or os.environ.get("CONECTOR_MAX_PARALELO", 1))
        self.vaga = None

    def fechar(self):
        try:
            self.conn.close()
        except Exception:
            pass

    def _trava(self, nome, espera=0):
        with self.conn.cursor() as c:
            c.execute("SELECT GET_LOCK(%s, %s)", (nome, espera))
            return c.fetchone()[0] == 1

    def _soltar(self, nome):
        with self.conn.cursor() as c:
            c.execute("SELECT RELEASE_LOCK(%s)", (nome,))

    def _livre(self, nome):
        with self.conn.cursor() as c:
            c.execute("SELECT IS_FREE_LOCK(%s)", (nome,))
            return c.fetchone()[0] == 1

    def trava_execucao(self, eid):
        return "sscon:%s:exec:%d" % (self.ficha, eid)

    def tomar_vaga(self):
        if self.vaga:
            return self.vaga
        for k in range(1, self.max + 1):
            if self._trava("sscon:%s:vaga:%d" % (self.ficha, k)):
                self.vaga = k
                return k
        return None

    def soltar_vaga(self):
        if self.vaga:
            self._soltar("sscon:%s:vaga:%d" % (self.ficha, self.vaga))
            self.vaga = None

    def reivindicar(self):
        """Retira a próxima execução da fila (pula as travadas por outro trabalhador). Exige vaga."""
        if not self.vaga:
            raise RuntimeError("sem vaga de paralelo")
        self.conn.begin()
        try:
            with self.conn.cursor() as c:
                c.execute("SELECT id FROM conector_execucao WHERE estado='fila' ORDER BY id LIMIT 1"
                          " FOR UPDATE SKIP LOCKED")
                r = c.fetchone()
                if not r:
                    self.conn.commit()
                    return None
                eid = r[0]
                if not self._trava(self.trava_execucao(eid)):
                    self.conn.rollback()
                    return None
                plataforma.transicao(c, eid, "abrindo", etapa="abrindo a origem", trabalhador=self.nome,
                                     percentual=0)
            self.conn.commit()
            return eid
        except Exception:
            self.conn.rollback()
            raise

    def recuperar_orfas(self):
        """Execução rodando sem trava viva = trabalhador caiu: vira `falhou` (com evento)."""
        with self.conn.cursor() as c:
            c.execute("SELECT id FROM conector_execucao WHERE estado IN %s", (plataforma.RODANDO,))
            ids = [r[0] for r in c.fetchall()]
        feitas = []
        for eid in ids:
            if self._livre(self.trava_execucao(eid)) and self._trava(self.trava_execucao(eid)):
                try:
                    ex = plataforma.consultar(self.conn, eid)
                    cont = dict(ex["contadores"] or {})
                    cont["interrompida"] = {"etapa": ex["etapa"], "percentual": ex["percentual"],
                                            "continuavel": ex["tipo"] == "importar"}
                    motivo = "trabalhador interrompido (sem trava viva)"
                    if ex["tipo"] == "importar":
                        motivo += "; continuável: enfileirar %s importar --continuar" % ex["codigo"]
                    plataforma.mudar_estado(self.conn, eid, "falhou", etapa=("interrompida: %s" % (ex["etapa"] or ""))[:120],
                                            motivo=motivo, contadores=cont)
                    feitas.append(eid)
                except plataforma.PlataformaErro:
                    pass
                finally:
                    self._soltar(self.trava_execucao(eid))
        return feitas

    def limpar_snapshots_orfaos(self):
        """Desmonta (pelo abridor separado) `sscon-e<id>-<ficha>` desta plataforma cuja execução não tem dono vivo."""
        try:
            nomes = servico_abridor.pedir("listar")["nomes"]
        except Exception:
            return []
        feitos = []
        for nome in nomes:
            if not nome.endswith("-" + self.ficha):
                continue
            try:
                eid = int(nome[len("sscon-e"):-len(self.ficha) - 1])
            except ValueError:
                continue
            if not self._livre(self.trava_execucao(eid)):
                continue
            try:
                servico_abridor.pedir("remover", nome=nome)
                feitos.append(nome)
            except Exception:
                pass
        return feitos

    def diagnostico(self):
        """Prova de separação, sem segredos: o motor (este processo) e o abridor."""
        with self.conn.cursor() as c:
            c.execute("SELECT SUBSTRING_INDEX(CURRENT_USER(), '@', 1)")
            conta = c.fetchone()[0]
        try:
            ab = servico_abridor.pedir("diagnostico")
            ab.pop("ok", None)
        except Exception as e:
            ab = {"erro": str(e)[:200]}
        return {"motor": dict(servico_abridor.diagnostico(), conta_mariadb=conta), "abridor": ab}

    def executar(self, eid):
        try:
            return motor.executar(self, eid)
        finally:
            self._soltar(self.trava_execucao(eid))

    def laco(self, uma=False, espera=5):
        """Laço do trabalhador. `uma`: processa no máximo uma execução e devolve o resultado (ou o motivo)."""
        self.recuperar_orfas()
        self.limpar_snapshots_orfaos()
        while True:
            if not self.tomar_vaga():
                if uma:
                    return {"resultado": "sem vaga de paralelo", "max_paralelo": self.max}
                time.sleep(espera)
                continue
            eid = self.reivindicar()
            if eid:
                r = self.executar(eid)
                if uma:
                    self.soltar_vaga()
                    return r
            elif uma:
                self.soltar_vaga()
                return {"resultado": "fila vazia"}
            else:
                time.sleep(espera)
