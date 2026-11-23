"""Carga pelo mapa com UM leitor da origem e N gravadores (orçamento `paralelismo-carga`, 2026-11-22).

O Firebird embarcado não divide o arquivo entre processos: o processo principal (coordenador) é o único leitor. Ele
serve as leituras dos gravadores por um canal (lotes de linhas, com um lote adiantado por fluxo). Cada gravador é um
processo filho (fork) com a própria conexão ao MariaDB, que roda `CargaMapa._tabela` sem nenhuma mudança na regra.

Ordem do plano:
- as tabelas do plano são agrupadas em ONDAS: a tabela B fica numa onda depois da tabela A (anterior no plano) quando
  uma menciona a outra (dependencias.tsv, `ref:`, `cod:`, `@id:`, encadeadas, filtros, opções: qualquer nome de tabela
  da origem ou de destino do plano no texto da especificação) ou quando as duas gravam o MESMO destino. Assim um
  destino nunca recebe dois gravadores ao mesmo tempo (o id reservado MAX+1 do bloco continua seguro) e a ordem entre
  tabelas relacionadas é a do plano, como na carga de um gravador só;
- uma onda só começa quando a anterior terminou, foi commitada e o estado em memória dos gravadores foi juntado;
- dentro da onda, as tarefas vão para os gravadores livres, das maiores para as menores;
- tabela GRANDE (CONECTOR_FAIXA_MIN linhas, padrão 500 mil; CONECTOR_FAIXA=0 desliga) e SEGURA (`divisivel`: chave
  primária inteira de uma coluna, gravação em bloco permitida (sem agrupar, adotar, complementar nem autorreferência),
  sem `#seq:`/`#grupo_*` (posição ou soma que dependem das outras linhas), sem índice único no destino além da
  chave primária, sem `id` declarado e fora dos provisórios) é dividida por FAIXA DE CHAVE: as faixas de 10 mil
  chaves do leitor vão em N partes contíguas, uma tarefa cada, ao lado das tabelas pequenas da mesma onda. O id do
  destino vem de um bloco reservado pelo coordenador a cada gravador (`reservar`), nunca do MAX+1; o hash por bloco
  do Sincronizar só apaga os blocos sumidos dentro da faixa do gravador. Só a 1ª carga da tabela se divide
  (`primeira_carga`): no Sincronizar e na reexecução a tabela vai inteira a um gravador, como antes;
- onda de uma tabela só, sem divisão, roda no próprio coordenador, como antes.

Estado em memória: o gravador nasce do fork com todo o estado do coordenador e devolve só a diferença (chaves tocadas
dos dicionários, cauda das listas, soma dos contadores); o coordenador junta e segue com a fase 2, o Sincronizar, a
conciliação e o relatório exatamente como antes. `CONECTOR_GRAVADORES=1` é a carga de um processo só, sem mudança.
"""
import gc
import inspect
import itertools
import json
import os
import re
import signal
import traceback
from multiprocessing.connection import Pipe, wait

import pymysql

PADRAO = 6
LOTE_LINHAS = 1000
FAIXA_MIN = 500000
RESERVA = 20000  # ids reservados por pedido do gravador, por destino
_FILTRO = {}  # no gravador: (atributo, chave) da tabela dividida -> faixas [lo, hi) cujas chaves voltam ao coordenador
_FALTA = object()
# contadores somados entre gravadores (a chave criada no gravador também soma); nos outros dicionários (caches de id)
# o inteiro novo substitui
_CONTADORES = frozenset({"cont", "sinc_res"})
_ATIVO = [False]  # só o gravador anota as chaves alteradas (no coordenador o dicionário é comum)
# atributos que são do processo (conexões, fila do bloco, linha atual) ou caches por tabela: nunca voltam
_FORA = frozenset({"lt", "cr", "progresso", "mapa_exec", "plano", "tabelas", "chaves", "_fila", "_diario", "_buf",
                   "_prox_id", "_bloco", "_atualizar", "_linha", "_grp", "_grupos", "tipos", "seq", "_adiando",
                   "_esvaziando", "_adiar_linha", "_cab_varrido", "chave_cofre", "prop", "_leit", "_filhos", "_col_dest",
                   "_faixas_so", "_faixa_lim", "_faixa_dts", "_reservar"})


def gravadores():
    try:
        return max(1, int(os.environ.get("CONECTOR_GRAVADORES") or PADRAO))
    except ValueError:
        return PADRAO


def _faixa_min():
    if os.environ.get("CONECTOR_FAIXA") == "0":
        return None
    try:
        return max(1, int(os.environ.get("CONECTOR_FAIXA_MIN") or FAIXA_MIN))
    except ValueError:
        return FAIXA_MIN


def divisivel_spec(p, linhas):
    """Parte da especificação (também usada na previsão): grande, chave de uma coluna, sem posição/soma de grupo,
    sem `id` declarado, sem agrupar/adotar/complementar, sem autorreferência e fora dos provisórios."""
    from .carga_mapa import PROVISORIO
    m, t, ch = _faixa_min(), p["tabela"], p["chave"]
    if m is None or int(linhas or 0) < m or len(ch) != 1 or t in PROVISORIO:
        return False
    for dt in p["destinos"]:
        op = (p.get("opcoes") or {}).get(dt) or {}
        if op.get("agrupar") or op.get("adotar") or op.get("complementa"):
            return False
        for c in p["colunas"][dt]:
            if c["coluna"].startswith(("#seq:", "#grupo_")) or c.get("destino") == "id":
                return False
    return not re.search(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(t), json.dumps(p["colunas"], default=str))


def primeira_carga(cm, t):
    """Só a 1ª carga da tabela se divide (revisão de 2026-11-22). No Sincronizar ou com a tabela já gravada
    (`existente[t]` herdado, reexecução):
    - cada gravador carregaria o estado da tabela INTEIRA (`estado_destino`, `existente[t]`), multiplicando a memória
      pelo número de partes;
    - o INSERT ... ON DUPLICATE KEY UPDATE de linhas que já existem toma trava next-key no índice único de
      `conector_origem` (chave em texto: as faixas numéricas se intercalam) e dois gravadores podem dar 1213;
    - o produto pode estar em uso no cliente e inserir no destino um id dentro do bloco reservado da onda (1062).
    Na 1ª carga o destino não tem linha da tabela, não há duplicata nem uso concorrente: os três riscos não existem."""
    return not getattr(cm, "sinc", False) and not cm.existente.get(t)


def divisivel(cm, p, contagens):
    """A tabela pode ser dividida por faixa de chave entre gravadores sem mudar o resultado: nenhuma decisão da linha
    depende de outra linha da mesma tabela nem da ordem de gravação no destino (ver o cabeçalho do módulo)."""
    from .carga_mapa import TIPOS_INT
    t, ch = p["tabela"], p["chave"]
    if not divisivel_spec(p, contagens.get(t, 0)) or not primeira_carga(cm, t):
        return False
    if not cm._adiavel(p) or cm.lt.chave_primaria(t) != ch:
        return False
    cols = {c["nome"]: c for c in cm.lt.colunas(t)}
    if ch[0] not in cols or cols[ch[0]]["codigo_tipo"] not in TIPOS_INT:
        return False
    with cm.cr.cursor() as c:
        for dt in p["destinos"]:
            c.execute("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND"
                      " TABLE_NAME=%s AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY'", (dt,))
            if c.fetchone()[0]:
                return False
    return True


def _na_faixa(k, lims):
    try:
        v = int(str(k).split("/", 1)[0])
    except ValueError:
        return True
    return any((lo is None or v >= lo) and (hi is None or v < hi) for lo, hi in lims)


class _Rastreado(dict):
    """Dicionário que anota cada chave alterada (valor anterior, tamanho anterior da lista, inteiro anterior)."""
    __slots__ = ("ant",)

    def __init__(self, *a):
        super().__init__(*a)
        self.ant = {}

    def tocar(self, k):
        if _ATIVO[0] and k not in self.ant:
            v = dict.get(self, k, _FALTA)
            self.ant[k] = (v, len(v) if isinstance(v, list) else None,
                           v if isinstance(v, int) and not isinstance(v, bool) else None)

    def __setitem__(self, k, v):
        self.tocar(k)
        dict.__setitem__(self, k, v)

    def __delitem__(self, k):
        self.tocar(k)
        dict.__delitem__(self, k)

    def setdefault(self, k, v=None):
        self.tocar(k)  # sempre: o valor devolvido costuma ser alterado no lugar
        return dict.setdefault(self, k, v)

    def pop(self, k, *d):
        self.tocar(k)
        return dict.pop(self, k, *d)

    def update(self, *a, **kw):
        for k in dict(*a, **kw):
            self.tocar(k)
        dict.update(self, *a, **kw)

    def __reduce__(self):  # volta ao coordenador como dicionário comum
        return dict, (dict(self),)


def _alvos(cm):
    """(dono, nome, valor) de todo atributo de estado: o da carga e os dois mapas do propagador de pendências."""
    for n, v in list(vars(cm).items()):
        if n not in _FORA:
            yield cm, n, v
    for n in ("_pend", "_filhos"):
        yield cm.prop, n, getattr(cm.prop, n)


def _rastrear(cm):
    """No coordenador, antes de cada onda: todo dicionário de estado passa a anotar as chaves alteradas."""
    for dono, n, v in _alvos(cm):
        if type(v) is dict:
            setattr(dono, n, _Rastreado(v))
        elif isinstance(v, _Rastreado):
            v.ant = {}


def _base(cm):
    # cópia rasa dos dicionários pequenos: o contador refeito por atribuição (self.cont = marca, na recusa por
    # restrição) volta como soma por chave, e não como o dicionário inteiro (que apagaria a soma dos outros gravadores)
    return {(id(dono), n): (id(v), len(v) if isinstance(v, (list, set)) else None,
                            v if not isinstance(v, (dict, list, set)) else None,
                            dict(v) if isinstance(v, dict) and len(v) <= 256 else None)
            for dono, n, v in _alvos(cm)}


def _por_chave(quem, n, velho, novo):
    ops = []
    for k, x in novo.items():
        a = velho.get(k, _FALTA)
        if a is _FALTA and n in _CONTADORES and isinstance(x, int) and not isinstance(x, bool):
            a = 0  # contador criado no gravador (cont.get(k, 0) + 1): soma, não substitui
        if isinstance(x, int) and not isinstance(x, bool) and isinstance(a, int) and not isinstance(a, bool):
            if x != a:
                ops.append((quem, n, "add", k, x - a))
        elif isinstance(x, list) and isinstance(a, list) and x[:len(a)] == a:
            if len(x) > len(a):
                ops.append((quem, n, "ext", k, x[len(a):]))
        elif isinstance(x, set):
            ops.append((quem, n, "uni", k, x))
        elif isinstance(x, dict):
            ops.append((quem, n, "upd", k, x))
        elif a is _FALTA or a is not x:
            ops.append((quem, n, "put", k, x))
    ops += [(quem, n, "del", k, None) for k in velho if k not in novo]
    return ops


def _pre_tocar(cm, chaves_proprias, tudo_pequeno=False):
    """Chave alterada no lugar sem passar pelo dicionário de cima (existente[t][chave] = ...): as chaves da tabela em
    gravação (origem, entidade, destino) e, no início, toda entrada pequena ficam anotadas antes da gravação."""
    for _, _, v in _alvos(cm):
        if not isinstance(v, _Rastreado) or len(v) > 50000:
            continue
        for k, x in list(dict.items(v)):
            if k in chaves_proprias or (isinstance(k, tuple) and any(isinstance(e, str) and e in chaves_proprias
                                                                      for e in k)):
                v.tocar(k)
            elif tudo_pequeno and not (isinstance(x, (dict, set)) and len(x) > 256):
                v.tocar(k)


def _delta(cm, base):
    ops = []
    for dono, n, v in _alvos(cm):
        quem = "prop" if dono is cm.prop else ""
        b = base.get((id(dono), n))
        if b is not None and b[0] != id(v) and b[3] is not None and isinstance(v, dict):
            ops += _por_chave(quem, n, b[3], v)
        elif b is None or b[0] != id(v):
            ops.append((quem, n, "set", None, v))
        elif isinstance(v, _Rastreado):
            for k, (velho, tam, num) in v.ant.items():
                novo = dict.get(v, k, _FALTA)
                lims = _FILTRO.get((n, k)) if quem == "" else None
                if lims is not None and isinstance(novo, (dict, set)):  # tabela dividida: só as chaves das faixas
                    novo = type(novo)(x for x in (novo.items() if isinstance(novo, dict) else novo)
                                      if _na_faixa(x[0] if isinstance(novo, dict) else x, lims))
                    velho = novo if velho is not _FALTA else velho
                if novo is _FALTA:
                    ops.append((quem, n, "del", k, None))
                elif velho is _FALTA and n in _CONTADORES and isinstance(novo, int) and not isinstance(novo, bool):
                    ops.append((quem, n, "add", k, novo))  # contador criado no gravador
                elif num is not None and isinstance(novo, int) and not isinstance(novo, bool):
                    if novo != num:
                        ops.append((quem, n, "add", k, novo - num))
                elif isinstance(novo, list) and novo is velho:
                    if len(novo) > tam:
                        ops.append((quem, n, "ext", k, novo[tam:]))
                elif isinstance(novo, set):
                    ops.append((quem, n, "uni", k, novo))
                elif isinstance(novo, dict) and (velho is novo or velho is _FALTA):
                    ops.append((quem, n, "upd", k, novo))
                elif novo is not velho:
                    ops.append((quem, n, "put", k, novo))
        elif isinstance(v, list):
            if len(v) > b[1]:
                ops.append((quem, n, "ext", None, v[b[1]:]))
        elif isinstance(v, set):
            ops.append((quem, n, "uni", None, v))
        elif not isinstance(v, dict) and b[2] is not v and b[2] != v:
            ops.append((quem, n, "set", None, v))
    return ops


def _juntar(cm, ops, somar=frozenset()):
    for quem, n, op, k, x in ops:
        dono = cm.prop if quem == "prop" else cm
        if op == "set":
            setattr(dono, n, x)
            continue
        d = getattr(dono, n)
        if somar and quem == "":  # tabela dividida: medida e blocos de cada gravador somados
            if n == "por_tabela" and op in ("put", "upd") and k in somar and d.get(k):
                li, sg = d[k]["linhas"] + x["linhas"], max(d[k]["segundos"], x["segundos"])
                d[k] = {"linhas": li, "segundos": sg, "linhas_por_segundo": round(li / sg, 1) if sg > 0 else None}
                continue
            if n == "sinc_res" and k == "blocos" and op == "upd" and isinstance(d.get(k), dict):
                for tt, b in x.items():
                    a = d[k].get(tt)
                    d[k][tt] = {c: b[c] + a[c] for c in b} if tt in somar and a else b
                continue
        if k is None:  # lista ou conjunto no próprio atributo
            d.extend(x) if op == "ext" else d.update(x)
        elif op == "del":
            d.pop(k, None)
        elif op == "add":
            d[k] = d.get(k, 0) + x
        elif op == "ext":
            d.setdefault(k, []).extend(x)
        elif op == "uni":
            d.setdefault(k, set()).update(x)
        elif op == "upd" and isinstance(d.get(k), dict):
            d[k].update(x)
        else:
            d[k] = x


# ----- ondas -----
def fks_banco(cr):
    """{tabela: tabelas que as chaves estrangeiras dela referenciam} no banco de destino (information_schema)."""
    with cr.cursor() as c:
        c.execute("SELECT DISTINCT TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE"
                  " WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL")
        fks = {}
        for t, r in c.fetchall():
            fks.setdefault(t, set()).add(r)
    return fks


def fks_ddl(raiz):
    """O mesmo de `fks_banco`, pelos scripts do modelo (db/migracoes), para a previsão e os testes sem banco. Lê os
    arquivos direto: o ALTER de chaves de um arquivo que vem antes do CREATE na ordem dos nomes também conta."""
    from .mapa import _arquivos_ddl
    fks = {}
    for arq in _arquivos_ddl(raiz):
        for st in re.split(r";\s*$", arq.read_text(encoding="utf-8"), flags=re.M):
            m = re.search(r"^\s*(?:CREATE|ALTER) TABLE (?:IF NOT EXISTS )?`?(\w+)`?", st, re.M)
            if m:
                for r in re.findall(r"\bREFERENCES\s+`?(\w+)`?", st):
                    fks.setdefault(m.group(1), set()).add(r)
    return fks


def _atualiza(p):
    """Destinos em que a tabela ATUALIZA linhas que não criou (UPDATE de linha de outra tabela do plano):
    `complementa` (a linha do pai recebe as colunas) e `adotar` (a linha existente é mesclada)."""
    ops = p.get("opcoes") or {}
    return {dt for dt in p["destinos"] if (ops.get(dt) or {}).get("complementa") or (ops.get(dt) or {}).get("adotar")}


def ondas(plano, mapa_exec, fks=None):
    """Lista de ondas (índices do plano). B depois de A (A antes no plano) quando uma menciona a outra, as duas
    gravam o mesmo destino ou uma ATUALIZA (`complementa`/`adotar`) linhas de um destino que a outra referencia por
    chave estrangeira (`fks`: {tabela: referenciadas}); a onda de B é a maior onda dessas A mais um.

    A terceira regra evita o 1213 (deadlock) do InnoDB: o INSERT do filho toma trava compartilhada na linha do pai
    (verificação da chave estrangeira, mesmo em READ COMMITTED) e o UPDATE do complemento toma trava exclusiva nas
    mesmas linhas, em ordens diferentes nos dois gravadores (caso real: RPLANEVE_TBCBOPRO complementa
    lancamento_repasse enquanto RPLANEVE_COMPOSICAOBASE grava lancamento_repasse_base, filho dele, na mesma onda)."""
    idx = {p["tabela"]: i for i, p in enumerate(plano)}
    por_dest, por_ref = {}, {}
    for i, p in enumerate(plano):
        for dt in p["destinos"]:
            por_dest.setdefault(dt, set()).add(i)
            for r in (fks or {}).get(dt, ()):
                por_ref.setdefault(r, set()).add(i)
    deps = {}
    for d in mapa_exec.get("deps", []):
        deps.setdefault(d.get("tabela"), set()).add(d.get("depende_de"))
    ligados = [set() for _ in plano]
    for i, p in enumerate(plano):
        txt = json.dumps(p, default=str, sort_keys=True)
        nomes = set(re.findall(r"[A-Za-z_][A-Za-z0-9_$]*", txt)) | deps.get(p["tabela"], set())
        outros = {idx[x] for x in nomes if x in idx} | {j for x in nomes for j in por_dest.get(x, ())}
        outros |= {j for dt in _atualiza(p) for j in por_ref.get(dt, ())}  # filho de linha que esta atualiza
        outros |= {j for dt in p["destinos"] for r in (fks or {}).get(dt, ())
                   for j in por_dest.get(r, ()) if r in _atualiza(plano[j])}  # pai que outra atualiza
        for j in outros - {i}:
            ligados[max(i, j)].add(min(i, j))
    onda = []
    for i in range(len(plano)):
        onda.append(max((onda[j] + 1 for j in ligados[i]), default=0))
    saida = [[] for _ in range(max(onda, default=-1) + 1)]
    for i, w in enumerate(onda):
        saida[w].append(i)
    return saida


# ----- gravador (processo filho) -----
class _Cliente:
    def __init__(self, con):
        self.con, self.n, self.guarda, self.descartar = con, 0, {}, set()

    def pedir(self, op, *a):
        self.n += 1
        self.con.send((self.n, op, a))
        return self.n

    def esperar(self, rid):
        while rid not in self.guarda:
            r, ok, v = self.con.recv()
            if r in self.descartar:
                self.descartar.discard(r)
                continue
            self.guarda[r] = (ok, v)
        ok, v = self.guarda.pop(rid)
        if not ok:
            raise RuntimeError("leitura da origem pelo coordenador: %s" % v)
        return v

    def chamar(self, op, *a):
        return self.esperar(self.pedir(op, *a))


class LeitorRemoto:
    """Mesma interface do Leitor: cada chamada vai ao coordenador; gerador vira fluxo de lotes com um adiantado."""

    def __init__(self, cli):
        self._cli = cli

    def __getattr__(self, nome):
        if nome.startswith("__"):
            raise AttributeError(nome)

        def chamar(*a, **kw):
            v = self._cli.chamar("chamar", nome, a, kw)
            if isinstance(v, tuple) and v[:1] == ("__fluxo__",):
                g = self._fluxo(v[1])
                return (v[3], g) if v[2] else g
            return v
        return chamar

    def _fluxo(self, sid):
        cli = self._cli
        rid, fim = cli.pedir("prox", sid), False
        try:
            while True:
                lote = cli.esperar(rid)
                rid = None
                if lote is None:
                    fim = True
                    return
                rid = cli.pedir("prox", sid)
                yield from lote
        finally:
            if rid is not None:
                if cli.guarda.pop(rid, None) is None:
                    cli.descartar.add(rid)
            if not fim:
                cli.con.send((0, "fechar", (sid,)))


def _resumo_erro(e, tabela):
    """Motivo curto e sem valores de linha: tabela, tipo, código do banco (a mensagem do servidor pode citar valores,
    "Duplicate entry ...") e onde falhou (arquivo e linha)."""
    if isinstance(e, pymysql.err.MySQLError):
        txt = "%s: erro %s do banco de destino" % (type(e).__name__, e.args[0] if e.args else "?")
    else:
        txt = "%s: %s" % (type(e).__name__, str(e)[:300])
    tb = traceback.extract_tb(e.__traceback__)
    if tb:
        txt += " (em %s:%d)" % (os.path.basename(tb[-1].filename), tb[-1].lineno)
    return "tabela %s: %s" % (tabela or "?", txt)


def _gravador(cm, con):
    cli = _Cliente(con)
    tabela = None
    try:
        _ATIVO[0] = True
        cr0 = cm.cr  # a conexão herdada do coordenador nunca é usada nem fechada aqui
        db = cr0.db.decode() if isinstance(cr0.db, bytes) else cr0.db
        cm.cr = pymysql.connect(host=cr0.host, port=cr0.port, user=cr0.user, password=cr0.password,
                                database=db, charset="utf8mb4", autocommit=False, connect_timeout=10)
        with cm.cr.cursor() as c:  # menos trava de intervalo no conector_origem entre gravadores
            c.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
        cm.lt = LeitorRemoto(cli)
        cm.progresso = lambda *a: None
        cm._prox_id, cm._fila, cm._buf, cm._diario = {}, [], [], []
        reserva = {}

        def reservar(dt):
            a = reserva.get(dt)
            if not a or a[0] >= a[1]:
                a = reserva[dt] = list(cli.chamar("reservar", dt, RESERVA))
            a[0] += 1
            return a[0] - 1
        cm._reservar = reservar
        _pre_tocar(cm, frozenset(), tudo_pequeno=True)
        base = _base(cm)
        feito = None
        while True:
            tarefa = cli.chamar("tabela", feito)
            if tarefa is None:
                break
            i = tarefa if isinstance(tarefa, int) else tarefa[0]
            p = cm.plano[i]
            tabela = p["tabela"]
            ents = [cm._nome_ent(p["tabela"], dt) for dt in p["destinos"]]
            _pre_tocar(cm, frozenset([p["tabela"]] + list(p["destinos"]) + ents))
            if not isinstance(tarefa, int):  # uma parte (faixas contíguas) de tabela dividida
                _, _, _, lo, hi, fx = tarefa
                cm._faixas_so, cm._faixa_lim, cm._faixa_dts = fx, (lo, hi), frozenset(p["destinos"])
                for chave in [("existente", p["tabela"]), ("vistas", p["tabela"])] + [("origem", e) for e in ents]:
                    _FILTRO.setdefault(chave, []).append((lo, hi))
            try:
                cm._tabela(p)
                cm._commit()
            finally:
                cm._faixas_so, cm._faixa_lim, cm._faixa_dts = None, None, frozenset()
            feito = tarefa if isinstance(tarefa, int) else (i, tarefa[2])
        con.send((0, "fim", (_delta(cm, base),)))
    except BaseException as e:
        try:  # o resumo (vai ao motivo_falha) e o FIM da pilha (arquivos e linhas, sem a mensagem, que pode ter valores)
            pilha = "".join(traceback.format_list(traceback.extract_tb(e.__traceback__)[-8:]))
            con.send((0, "erro", (_resumo_erro(e, tabela), pilha)))
        except BaseException:
            pass
    finally:
        os._exit(0)


# ----- coordenador -----
class GravadorFalhou(RuntimeError):
    """Falha de um gravador: a mensagem é o resumo (tabela, tipo, código, arquivo:linha) e `detalhe` o fim da pilha
    do gravador (arquivos, linhas e código, sem a mensagem da exceção)."""

    def __init__(self, pid, resumo, detalhe=""):
        super().__init__("gravador %d falhou: %s" % (pid, resumo))
        self.detalhe = detalhe

def _servir(cm, filhos, fila, ao_feito, somar=frozenset()):
    """Atende os gravadores até todos devolverem o estado: leituras da origem, próxima tarefa, reserva de ids do
    destino da tabela dividida e o resultado."""
    fluxos, vivos, sid, prox = {}, dict(filhos), itertools.count(1), {}
    while vivos:
        for con in wait(list(vivos)):
            pid = vivos[con]
            try:
                rid, op, a = con.recv()
            except EOFError:
                raise RuntimeError("gravador %d terminou sem devolver o resultado" % pid)
            if op == "chamar":
                try:
                    v = getattr(cm.lt, a[0])(*a[1], **a[2])
                    if inspect.isgenerator(v) or (isinstance(v, tuple) and len(v) == 2 and inspect.isgenerator(v[1])):
                        s = next(sid)
                        tem = isinstance(v, tuple)
                        fluxos[s] = v[1] if tem else v
                        v = ("__fluxo__", s, tem, v[0] if tem else None)
                    con.send((rid, True, v))
                except Exception as e:  # noqa: BLE001 - devolvido ao gravador, que levanta
                    con.send((rid, False, "%s: %s" % (type(e).__name__, e)))
            elif op == "prox":
                g = fluxos.get(a[0])
                lote = list(itertools.islice(g, LOTE_LINHAS)) if g is not None else []
                if not lote:
                    fluxos.pop(a[0], None)
                con.send((rid, True, lote or None))
            elif op == "fechar":
                g = fluxos.pop(a[0], None)
                if g is not None:
                    g.close()
            elif op == "tabela":
                if a[0] is not None:
                    ao_feito(a[0])
                con.send((rid, True, fila.pop(0) if fila else None))
            elif op == "reservar":  # bloco de ids do destino: começa no MAX+1 do início da onda, nunca repete
                dt, q = a
                if dt not in prox:
                    with cm.cr.cursor() as c:
                        c.execute("SELECT COALESCE(MAX(id), 0) FROM `%s`" % dt)
                        prox[dt] = int(c.fetchone()[0]) + 1
                con.send((rid, True, (prox[dt], prox[dt] + q)))
                prox[dt] += q
            elif op == "fim":
                del vivos[con]
                os.waitpid(pid, 0)
                _juntar(cm, a[0], somar)
            elif op == "erro":
                del vivos[con]
                try:
                    os.waitpid(pid, 0)
                except OSError:
                    pass
                for p in vivos.values():
                    try:  # SIGKILL: o gravador parado na espera de uma leitura não trata SIGTERM e o waitpid travaria
                        os.kill(p, signal.SIGKILL)
                        os.waitpid(p, 0)
                    except OSError:
                        pass
                raise GravadorFalhou(pid, a[0], a[1] if len(a) > 1 else "")
    for g in fluxos.values():
        g.close()


def carregar(cm, contagens):
    """Executa as tabelas do plano (cm.plano). Com um gravador (ou leitor/conexão que não sejam os reais), a ordem do
    plano num processo só, como antes."""
    from .leitor import Leitor
    n = gravadores()
    total = len(cm.plano)
    if n <= 1 or not isinstance(cm.lt, Leitor) or not isinstance(cm.cr, pymysql.connections.Connection):
        for i, p in enumerate(cm.plano):
            cm.progresso(i / total, "carregando %s" % p["destinos"][0])
            cm._tabela(p)
        return
    feitos = [0]
    ws = ondas(cm.plano, cm.mapa_exec, fks_banco(cm.cr))

    def ao_feito(f):
        i = f if isinstance(f, int) else f[0]
        feitos[0] += 1 if isinstance(f, int) else 1 / f[1]
        cm.progresso(feitos[0] / total, "carregando %s (onda %d de %d)" % (cm.plano[i]["destinos"][0], k + 1,
                                                                             len(ws)))
    cm.divididas = getattr(cm, "divididas", {})
    for k, onda in enumerate(ws):
        tarefas = []  # (linhas estimadas, posição no plano, tarefa: índice ou (índice, parte, partes, lo, hi, faixas))
        for i in onda:
            p, est = cm.plano[i], int(contagens.get(cm.plano[i]["tabela"], 0) or 0)
            fx = cm._faixas_divisao(p) if divisivel(cm, p, contagens) else []
            q = min(n, len(fx))
            if q > 1:
                partes = [fx[j * len(fx) // q:(j + 1) * len(fx) // q] for j in range(q)]
                for j, pt in enumerate(partes):
                    lo, hi = (None if j == 0 else pt[0][0]), (None if j == q - 1 else partes[j + 1][0][0])
                    tarefas.append((est / q, i, j, (i, j, q, lo, hi, pt)))
                cm.divididas[p["tabela"]] = q
            else:
                tarefas.append((est, i, 0, i))
        if len(tarefas) == 1:
            p = cm.plano[onda[0]]
            cm.progresso(feitos[0] / total, "carregando %s (onda %d de %d)" % (p["destinos"][0], k + 1, len(ws)))
            cm._tabela(p)
            feitos[0] += 1
            continue
        cm._commit()  # o que a onda anterior gravou fica visível aos gravadores
        _rastrear(cm)
        fila = [x[3] for x in sorted(tarefas, key=lambda x: (-x[0], x[1], x[2]))]
        somar = frozenset(cm.plano[x[0]]["tabela"] for x in fila if not isinstance(x, int))
        cm.progresso(feitos[0] / total, "carregando %d tabelas em paralelo (onda %d de %d)" % (len(onda), k + 1,
                                                                                               len(ws)))
        filhos = {}
        gc.collect()
        gc.freeze()  # o coletor não toca nos objetos herdados (menos cópia de página nos filhos)
        try:
            for _ in range(min(n, len(fila))):
                pai, filho = Pipe()
                pid = os.fork()
                if pid == 0:
                    pai.close()
                    _gravador(cm, filho)
                filho.close()
                filhos[pai] = pid
        finally:
            gc.unfreeze()
        try:
            _servir(cm, filhos, fila, ao_feito, somar)
        finally:
            for con in filhos:
                con.close()
