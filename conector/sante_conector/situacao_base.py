"""Situação da base (obra carga-painel): quanto da origem já está no banco do cliente, por execução.

O painel mostra primeiro "Já na base: X de Y linhas" e, à parte, a conferência desta execução. Contar o
`conector_origem` a cada execução não serve: com dezenas de milhões de linhas, o agrupamento das recusadas passa de
4 minutos (medido em 25/11: 259 s em 94 M linhas). Por isso NENHUMA contagem pesada roda no início da execução: a
situação sai de um RESUMO POR TABELA, mantido aqui no fim de cada tabela (`conector_resumo_tabela`), e, para a tabela
que ainda não tem resumo, das fontes já gravadas pelas execuções anteriores do cliente, em ordem de preferência:

1. `resumo`: o resumo desta tabela (gravado no fim dela, numa execução que a leu inteira): exato;
2. `conciliacao`: a conciliação por entidade da execução mais recente que a trouxe (`contadores.entidades`:
   registros no destino e recusados);
3. `concluida`: a marca de tabela concluída (`conector_tabela_concluida`) com a contagem da imagem daquela execução.
   As recusadas começam pela fonte barata: as recusas por tabela da execução que concluiu a tabela
   (`contadores.progresso.recusas_por_tabela`, quando o nome de destino é só dela). Essas tabelas ficam em
   `tabelas_recusas_desconhecidas` (a tela avisa que o "Já na base" é aproximado) até a CONTAGEM EM SEGUNDO PLANO
   (uma linha de execução com conexão própria, por ENTIDADE DE DESTINO, pelo índice (entidade_destino, id_destino):
   só o trecho id_destino nulo é lido; no máximo CONSULTA_S por consulta e TOTAL_S no todo) contar as recusadas
   abertas dela; o `contadores.progresso.base` do batimento seguinte já traz o valor exato. Se a contagem estourar,
   a tabela continua aproximada;
4. sem situação: conta como faltante (`tabelas_sem_situacao`).

Ao longo da execução, `linhas_na_base` sobe com as gravadas da tabela (limitado à contagem da origem); no fim de
cada tabela lida inteira nesta fotografia, a tabela passa a valer contagem - recusadas, e o resumo é regravado (com o
tempo a base fica exata). O resumo só é gravado com recusadas EXATAS: sem o reprocessamento, a tabela que ainda está
aproximada não grava o resumo no fim e continua aproximada; se a contagem em segundo plano a confirmar depois, o
resumo é gravado então (pela conexão da contagem). Só contagens e nomes de tabela de destino (regra 5); a falha aqui nunca derruba a carga."""
import datetime
import threading
import time

from . import carga
from .controle import DDL_RESUMO_TABELA

DDL = DDL_RESUMO_TABELA.replace("{b}", "`{ctl}`")

TOP = 20
CONSULTA_S = 10   # limite de cada contagem em segundo plano (max_statement_time)
TOTAL_S = 120     # limite total da contagem em segundo plano


def _cap(x, lim):
    return max(0, min(int(x or 0), int(lim or 0)))


def _clonar(conn):
    """Conexão própria para a contagem em segundo plano, com os mesmos dados de acesso (a conexão do motor não é
    dividida entre linhas de execução). Nunca imprime a senha."""
    import pymysql
    db = getattr(conn, "db", None)
    return pymysql.connect(host=conn.host, port=conn.port, user=conn.user, password=conn.password,
                           database=db.decode() if isinstance(db, bytes) else db, charset="utf8mb4",
                           autocommit=True, connect_timeout=10, read_timeout=CONSULTA_S + 5)


class SituacaoBase:
    """Um por execução, no coordenador. `placar`: carga.Placar (contagens do plano, nomes de destino, por tabela).
    `conectar`: fábrica da conexão da contagem em segundo plano (padrão: clone da `conn`); `fundo=False` desliga."""

    def __init__(self, conn, ctl, eid, placar, contadores_de=None, reprocessar=False, conectar=None, fundo=True,
                 consulta_s=CONSULTA_S, total_s=TOTAL_S):
        self.conn, self.ctl, self.eid, self.placar = conn, ctl, int(eid), placar
        self.contadores_de = contadores_de or (lambda e: None)
        self.reprocessar = bool(reprocessar)
        self.conectar = conectar or (lambda: _clonar(conn))
        self.fundo, self.consulta_s, self.total_s = bool(fundo), float(consulta_s), float(total_s)
        self.base = {}      # tabela -> [na_base, recusadas] antes desta execução
        self.atual = {}     # tabela -> [na_base, recusadas] das tabelas lidas inteiras nesta execução
        self.fontes = {"resumo": 0, "conciliacao": 0, "concluida": 0, "sem_situacao": 0}
        self.recusas_desconhecidas = set()  # tabelas `concluida` sem a contagem exata das recusadas
        self._concluidas = {}               # tabela -> contagem da imagem (fonte `concluida`)
        self._fim_aprox = {}                # tabela lida inteira ainda aproximada -> recusadas desta execução
        self.contagem = {"estado": "sem_tabelas", "contadas": 0, "estouradas": 0, "ms": None}
        self._trava = threading.Lock()
        self._linha = None
        self.recusas_ms = None
        self.calculo_ms = None
        self.calculada_em = None

    # ----- cálculo inicial (uma vez por execução, sem contagem pesada) -----
    def _cur(self):
        return self.conn.cursor()

    def calcular(self):
        t0 = time.monotonic()
        plano = set(self.placar.contagens)
        with self._cur() as c:
            c.execute(DDL.format(ctl=self.ctl))
            c.execute("SELECT tabela_origem, na_base, recusadas FROM `%s`.conector_resumo_tabela" % self.ctl)
            resumo = {t: [int(n), int(r)] for t, n, r in c.fetchall() if t in plano}
            c.execute("SELECT DISTINCT execucao_id FROM `%s`.imagem WHERE execucao_id<>%%s ORDER BY execucao_id DESC"
                      % self.ctl, (self.eid,))
            anteriores = [int(e) for (e,) in c.fetchall()]
            c.execute("SELECT c.tabela_origem, MAX(it.registros), MAX(c.execucao_id)"
                      " FROM `%s`.conector_tabela_concluida c"
                      " JOIN `%s`.imagem_tabela it ON it.imagem_id=c.imagem_id AND it.tabela_origem=c.tabela_origem"
                      " GROUP BY c.tabela_origem" % (self.ctl, self.ctl))
            concluidas, concluiu = {}, {}
            for row in c.fetchall():
                if row[0] in plano:
                    concluidas[row[0]] = int(row[1] or 0)
                    concluiu[row[0]] = int(row[2]) if len(row) > 2 and row[2] is not None else None
        ctds = {}

        def contadores(e):
            if e not in ctds:
                try:
                    ctds[e] = self.contadores_de(e) or {}
                except Exception:  # noqa: BLE001 - sem os contadores daquela execução, a fonte não vale
                    ctds[e] = {}
            return ctds[e]
        conciliacao = {}
        for e in anteriores:  # da mais recente para a mais antiga: a primeira que traz a tabela vale
            ents = contadores(e).get("entidades") or {}
            vista = {}
            for v in ents.values():
                t = (v or {}).get("tabela_origem")
                if t in plano and t not in conciliacao:
                    a = vista.setdefault(t, [0, 0])
                    a[0] = max(a[0], int(v.get("registros_destino") or 0))
                    a[1] = max(a[1], int(v.get("recusados") or 0))
            conciliacao.update(vista)
        so_concluida = sorted(t for t in concluidas if t not in resumo and t not in conciliacao)
        baratas = self._recusas_baratas(so_concluida, concluiu, contadores)
        for t in plano:
            if t in resumo:
                self.base[t], f = resumo[t], "resumo"
            elif t in conciliacao:
                self.base[t], f = conciliacao[t], "conciliacao"
            elif t in concluidas:
                rec = _cap(baratas.get(t, 0), concluidas[t])
                self.base[t], f = [concluidas[t] - rec, rec], "concluida"
                self.recusas_desconhecidas.add(t)
                self._concluidas[t] = concluidas[t]
            else:
                f = "sem_situacao"
            self.fontes[f] += 1
        self.calculo_ms = int(1000 * (time.monotonic() - t0))
        self.calculada_em = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        if self._concluidas:
            self.contagem["estado"] = "desligada"
            if self.fundo:
                self.iniciar_contagem()
        return self.json()

    def _recusas_baratas(self, tabelas, concluiu, contadores):
        """Recusadas já gravadas nos contadores da execução que concluiu cada tabela: o top de recusas por tabela de
        destino do `contadores.progresso`, só quando o nome de destino pertence a uma tabela só do plano. É estimativa
        (a recusada já vista e pulada não entra na conta daquela execução): a tabela segue aproximada."""
        nomes = {}
        for t, n in (self.placar.nomes or {}).items():
            if t in self.placar.contagens:
                nomes.setdefault(n, []).append(t)
        out = {}
        for t in tabelas:
            e, nome = concluiu.get(t), self.placar.nomes.get(t)
            if e is None or not nome or len(nomes.get(nome, ())) != 1:
                continue
            for r in ((contadores(e).get("progresso") or {}).get("recusas_por_tabela") or []):
                if (r or {}).get("tabela") == nome:
                    out[t] = int(r.get("recusadas") or 0)
        return out

    # ----- contagem em segundo plano -----
    def iniciar_contagem(self):
        if self._linha is not None or not self._concluidas:
            return self._linha
        self.contagem["estado"] = "em_andamento"
        self._linha = threading.Thread(target=self._contar, name="situacao-base-recusas", daemon=True)
        self._linha.start()
        return self._linha

    def esperar_contagem(self, timeout=None):
        if self._linha is not None:
            self._linha.join(timeout)

    def _contar(self):
        """Recusadas abertas (id_destino nulo com regra de recusa, a mesma definição do reprocessamento) por tabela, uma
        consulta por entidade de destino pelo índice (entidade_destino, id_destino): só o trecho id_destino nulo é
        lido, e cada linha recusada uma vez só no todo. Cada consulta com max_statement_time; ao passar do total, as
        entidades que faltam contam como estouradas. A tabela que pode ter linhas numa entidade estourada (o nome de
        destino dela bate com a entidade, ou ela não bate com nenhuma) fica aproximada; as demais ficam exatas."""
        t0 = time.monotonic()
        fim = t0 + self.total_s
        contadas = estouradas = 0
        cn = None
        try:
            cn = self.conectar()
            lim = max(1.0, min(self.consulta_s, fim - time.monotonic()))
            with cn.cursor() as c:  # varredura solta do índice: só os valores distintos do prefixo
                c.execute("SET STATEMENT max_statement_time=%.1f FOR SELECT DISTINCT entidade_destino FROM `%s`."
                          "conector_origem FORCE INDEX (ix_conector_origem_destino)" % (lim, self.ctl))
                ents = sorted(e for (e,) in c.fetchall() if e is not None)
            achadas, falhas = {}, []
            for k, e in enumerate(ents):
                resta = fim - time.monotonic()
                if resta <= 0.5:
                    falhas.extend(ents[k:])
                    break
                lim = max(1.0, min(self.consulta_s, resta))
                try:
                    with cn.cursor() as c:
                        c.execute("SET STATEMENT max_statement_time=%.1f FOR SELECT tabela_origem, COUNT(*) FROM `%s`."
                                  "conector_origem FORCE INDEX (ix_conector_origem_destino) WHERE entidade_destino=%%s"
                                  " AND id_destino IS NULL AND regra_recusa IS NOT NULL GROUP BY tabela_origem"
                                  % (lim, self.ctl), (e,))
                        r = c.fetchall()
                except Exception:  # noqa: BLE001 - estourou o limite (ou falhou): as tabelas dela ficam aproximadas
                    falhas.append(e)
                    continue
                for tab, n in r:
                    achadas[tab] = achadas.get(tab, 0) + int(n or 0)
            estouradas = len(falhas)
            duvida = self._duvidosas(falhas, ents)
            gravar = []
            with self._trava:
                for t, cont in self._concluidas.items():
                    if t in duvida or t not in self.recusas_desconhecidas:
                        continue
                    n = achadas.get(t, 0)
                    if t in self._fim_aprox:  # já lida inteira nesta execução: agora é exata, e o resumo é gravado
                        rec = _cap(max(self._fim_aprox.pop(t), n), cont)
                        self.atual[t] = [cont - rec, rec]
                        gravar.append((t, cont, rec))
                    else:
                        rec = _cap(n, cont)
                        self.base[t] = [cont - rec, rec]
                    self.recusas_desconhecidas.discard(t)
                    contadas += 1
            for t, cont, rec in gravar:
                self._gravar_resumo(cn, t, cont, rec)
        except Exception:  # noqa: BLE001 - sem conexão própria, tudo fica aproximado
            pass
        finally:
            try:
                if cn is not None:
                    cn.close()
            except Exception:  # noqa: BLE001
                pass
            ms = int(1000 * (time.monotonic() - t0))
            with self._trava:
                falta = sum(1 for t in self._concluidas if t in self.recusas_desconhecidas)
                self.contagem = {"estado": "concluida" if not falta else "estourou", "contadas": contadas,
                                 "estouradas": estouradas, "ms": ms}
                self.recusas_ms = ms

    def _duvidosas(self, falhas, ents):
        """Tabelas `concluida` que podem ter recusadas numa entidade não contada (a entidade guarda o destino, às vezes
        com um sufixo depois de '#')."""
        if not falhas:
            return set()
        base_f = {e.split("#", 1)[0] for e in falhas}
        base_t = {e.split("#", 1)[0] for e in ents}
        out = set()
        for t in self._concluidas:
            nomes = {x for x in (self.placar.nomes.get(t), (carga.MAPA.get(t) or {}).get("entidade")) if x}
            if nomes & base_f or not nomes & base_t:
                out.add(t)
        return out

    # ----- fim de tabela -----
    def fim(self, t):
        """Tabela lida inteira nesta fotografia: na base = contagem - recusadas; o resumo é regravado."""
        if t not in self.placar.contagens:
            return
        cont = int(self.placar.contagens.get(t) or 0)
        rec_exec = int(self.placar.tabela(t)["recusadas"])
        rec0 = (self.base.get(t) or [0, 0])[1]
        # com o reprocessamento, toda recusada antiga foi tentada de novo (e a que voltou a falhar foi contada);
        # sem ele, a recusada já vista é pulada e continua aberta
        rec = _cap(rec_exec if self.reprocessar else max(rec_exec, rec0), cont)
        with self._trava:
            self.atual[t] = [cont - rec, rec]
            if not self.reprocessar and t in self.recusas_desconhecidas:
                # rec0 é só estimativa: a tabela continua aproximada e o resumo não é gravado como exato; a contagem
                # em segundo plano, se confirmar a tabela, grava o resumo
                self._fim_aprox[t] = rec_exec
                return
            self.recusas_desconhecidas.discard(t)
            self._fim_aprox.pop(t, None)
        self._gravar_resumo(self.conn, t, cont, rec)

    def _gravar_resumo(self, conn, t, cont, rec):
        try:
            with conn.cursor() as c:
                c.execute("INSERT INTO `%s`.conector_resumo_tabela (tabela_origem, registros_origem, na_base,"
                          " recusadas, execucao_id, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,UTC_TIMESTAMP(3))"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " na_base=VALUES(na_base), recusadas=VALUES(recusadas), execucao_id=VALUES(execucao_id),"
                          " alterado_em=UTC_TIMESTAMP(3), versao=versao+1" % self.ctl,
                          (t, cont, cont - rec, rec, self.eid))
            if not getattr(conn, "autocommit_mode", True):
                conn.commit()
        except Exception:  # noqa: BLE001 - o resumo do painel nunca derruba a carga
            pass

    # ----- leitura -----
    def tabela(self, t):
        cont = int(self.placar.contagens.get(t) or 0)
        if t in self.atual:
            na, rec = self.atual[t]
        else:
            na0, rec0 = self.base.get(t) or [0, 0]
            na = _cap(int(na0) + int(self.placar.tabela(t)["gravadas"]), cont)
            rec = _cap(rec0, cont - na)
        na = _cap(na, cont)
        rec = _cap(rec, cont - na)
        return cont, na, rec

    def json(self):
        with self._trava:
            return self._json()

    def _json(self):
        tot = [0, 0, 0]
        faltantes = []
        for t in self.placar.contagens:
            cont, na, rec = self.tabela(t)
            tot[0] += cont
            tot[1] += na
            tot[2] += rec
            if cont - na - rec > 0:
                faltantes.append((cont - na - rec, self.placar.nomes.get(t) or "tabela sem destino nomeado", cont, na, rec))
        faltantes.sort(key=lambda x: (-x[0], x[1]))
        return {
            "linhas_origem": tot[0], "linhas_na_base": tot[1], "linhas_recusadas": tot[2],
            "linhas_faltam": max(0, tot[0] - tot[1] - tot[2]),
            "tabelas": len(self.placar.contagens), "tabelas_lidas_nesta": len(self.atual),
            "tabelas_sem_situacao": self.fontes["sem_situacao"], "fontes": dict(self.fontes),
            "tabelas_recusas_desconhecidas": len(self.recusas_desconhecidas),
            "calculo_ms": self.calculo_ms, "recusas_ms": self.recusas_ms, "calculada_em": self.calculada_em,
            "recusas_contagem": dict(self.contagem),
            "por_tabela_top": [{"tabela": nome, "linhas_origem": c, "na_base": na, "recusadas": r, "faltam": f}
                               for f, nome, c, na, r in faltantes[:TOP]],
        }
