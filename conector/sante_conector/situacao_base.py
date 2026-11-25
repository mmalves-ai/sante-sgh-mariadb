"""Situação da base (obra carga-painel): quanto da origem já está no banco do cliente, por execução.

O painel mostra primeiro "Já na base: X de Y linhas" e, à parte, a conferência desta execução. Contar o
`conector_origem` a cada execução não serve: com dezenas de milhões de linhas, o agrupamento por tabela passa de
2 minutos (medido em 24/11: mais de 150 s só pelo índice da chave). Por isso a situação sai de um RESUMO POR TABELA,
mantido aqui no fim de cada tabela (`conector_resumo_tabela`), e, para a tabela que ainda não tem resumo, das
fontes já gravadas pelas execuções anteriores do cliente, em ordem de preferência:

1. `resumo`: o resumo desta tabela (gravado no fim dela, numa execução que a leu inteira);
2. `conciliacao`: a conciliação por entidade da execução mais recente que a trouxe (`contadores.entidades`:
   registros no destino e recusados);
3. `concluida`: a marca de tabela concluída (`conector_tabela_concluida`) com a contagem da imagem daquela execução;
   as recusadas dessas tabelas saem de uma contagem agrupada das linhas RECUSADAS no `conector_origem` (id_destino
   nulo com regra de recusa), pelo índice (entidade_destino, id_destino), só dessas tabelas: na base = contagem -
   recusadas. Se essa contagem falhar, a tabela entra em `tabelas_recusas_desconhecidas` e a tela avisa que o "Já na
   base" dela é aproximado (nunca se afirma em silêncio que as recusadas estão na base);
4. sem situação: conta como faltante (`tabelas_sem_situacao`).

Ao longo da execução, `linhas_na_base` sobe com as gravadas da tabela (limitado à contagem da origem); no fim de
cada tabela lida inteira nesta fotografia, a tabela passa a valer contagem - recusadas, e o resumo é regravado.
Só contagens e nomes de tabela de destino (regra 5); a falha aqui nunca derruba a carga."""
import datetime
import time

DDL = """CREATE TABLE IF NOT EXISTS `{ctl}`.conector_resumo_tabela (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela_origem VARCHAR(63) NOT NULL,
  registros_origem BIGINT UNSIGNED NOT NULL COMMENT 'Contagem da origem na fotografia em que a tabela foi lida inteira',
  na_base BIGINT UNSIGNED NOT NULL COMMENT 'Linhas da origem registradas no destino (gravadas ou iguais)',
  recusadas BIGINT UNSIGNED NOT NULL COMMENT 'Linhas recusadas abertas',
  execucao_id BIGINT UNSIGNED NOT NULL COMMENT 'conector_execucao.id que leu a tabela inteira',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_resumo_tabela (tabela_origem)
) COMMENT='Situação da base por tabela da origem, no fim de cada tabela lida inteira (painel de carga)'"""

TOP = 20


def _cap(x, lim):
    return max(0, min(int(x or 0), int(lim or 0)))


class SituacaoBase:
    """Um por execução, no coordenador. `placar`: carga.Placar (contagens do plano, nomes de destino, por tabela)."""

    def __init__(self, conn, ctl, eid, placar, contadores_de=None, reprocessar=False):
        self.conn, self.ctl, self.eid, self.placar = conn, ctl, int(eid), placar
        self.contadores_de = contadores_de or (lambda e: None)
        self.reprocessar = bool(reprocessar)
        self.base = {}      # tabela -> [na_base, recusadas] antes desta execução
        self.atual = {}     # tabela -> [na_base, recusadas] das tabelas lidas inteiras nesta execução
        self.fontes = {"resumo": 0, "conciliacao": 0, "concluida": 0, "sem_situacao": 0}
        self.recusas_desconhecidas = set()  # tabelas `concluida` cuja contagem de recusadas falhou
        self.recusas_ms = None
        self.calculo_ms = None
        self.calculada_em = None

    # ----- cálculo inicial (uma vez por execução) -----
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
            c.execute("SELECT c.tabela_origem, MAX(it.registros) FROM `%s`.conector_tabela_concluida c"
                      " JOIN `%s`.imagem_tabela it ON it.imagem_id=c.imagem_id AND it.tabela_origem=c.tabela_origem"
                      " GROUP BY c.tabela_origem" % (self.ctl, self.ctl))
            concluidas = {t: int(n or 0) for t, n in c.fetchall() if t in plano}
        conciliacao = {}
        for e in anteriores:  # da mais recente para a mais antiga: a primeira que traz a tabela vale
            ents = (self.contadores_de(e) or {}).get("entidades") or {}
            vista = {}
            for v in ents.values():
                t = (v or {}).get("tabela_origem")
                if t in plano and t not in conciliacao:
                    a = vista.setdefault(t, [0, 0])
                    a[0] = max(a[0], int(v.get("registros_destino") or 0))
                    a[1] = max(a[1], int(v.get("recusados") or 0))
            conciliacao.update(vista)
        so_concluida = sorted(t for t in concluidas if t not in resumo and t not in conciliacao)
        recusas = self._recusadas_registradas(so_concluida)
        for t in plano:
            if t in resumo:
                self.base[t], f = resumo[t], "resumo"
            elif t in conciliacao:
                self.base[t], f = conciliacao[t], "conciliacao"
            elif t in concluidas:
                rec = _cap((recusas or {}).get(t, 0), concluidas[t])
                self.base[t], f = [concluidas[t] - rec, rec], "concluida"
                if recusas is None:
                    self.recusas_desconhecidas.add(t)
            else:
                f = "sem_situacao"
            self.fontes[f] += 1
        self.calculo_ms = int(1000 * (time.monotonic() - t0))
        self.calculada_em = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        return self.json()

    def _recusadas_registradas(self, tabelas):
        """{tabela: linhas recusadas registradas} das tabelas dadas, ou None se a contagem falhar. Recusada = linha do
        `conector_origem` com id_destino nulo e regra de recusa (a mesma definição do reprocessamento). Pelo índice
        (entidade_destino, id_destino): primeiro as entidades de destino (varredura solta do índice), depois o
        trecho id_destino nulo de cada uma; só as recusadas são lidas na linha."""
        if not tabelas:
            return {}
        t0 = time.monotonic()
        try:
            with self._cur() as c:
                c.execute("SELECT DISTINCT entidade_destino FROM `%s`.conector_origem" % self.ctl)
                ents = [e for (e,) in c.fetchall() if e is not None]
                if not ents:
                    return {}
                c.execute("SELECT tabela_origem, COUNT(*) FROM `%s`.conector_origem"
                          " FORCE INDEX (ix_conector_origem_destino)"
                          " WHERE entidade_destino IN (%s) AND id_destino IS NULL AND regra_recusa IS NOT NULL"
                          " AND tabela_origem IN (%s) GROUP BY tabela_origem"
                          % (self.ctl, ",".join(["%s"] * len(ents)), ",".join(["%s"] * len(tabelas))),
                          tuple(ents) + tuple(tabelas))
                return {t: int(n or 0) for t, n in c.fetchall()}
        except Exception:  # noqa: BLE001 - sem a contagem, as tabelas ficam marcadas como aproximadas
            return None
        finally:
            self.recusas_ms = int(1000 * (time.monotonic() - t0))

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
        self.atual[t] = [cont - rec, rec]
        self.recusas_desconhecidas.discard(t)
        try:
            with self._cur() as c:
                c.execute("INSERT INTO `%s`.conector_resumo_tabela (tabela_origem, registros_origem, na_base,"
                          " recusadas, execucao_id, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,UTC_TIMESTAMP(3))"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " na_base=VALUES(na_base), recusadas=VALUES(recusadas), execucao_id=VALUES(execucao_id),"
                          " alterado_em=UTC_TIMESTAMP(3), versao=versao+1" % self.ctl,
                          (t, cont, cont - rec, rec, self.eid))
            if not getattr(self.conn, "autocommit_mode", True):
                self.conn.commit()
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
            "por_tabela_top": [{"tabela": nome, "linhas_origem": c, "na_base": na, "recusadas": r, "faltam": f}
                               for f, nome, c, na, r in faltantes[:TOP]],
        }
