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
- dentro da onda, as tabelas vão para os gravadores livres, das maiores para as menores. A tabela grande NÃO é
  dividida por faixa (na dúvida, fica num gravador só);
- onda de uma tabela só roda no próprio coordenador, como antes.

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
_FALTA = object()
# contadores somados entre gravadores (a chave criada no gravador também soma); nos outros dicionários (caches de id)
# o inteiro novo substitui
_CONTADORES = frozenset({"cont", "sinc_res"})
_ATIVO = [False]  # só o gravador anota as chaves alteradas (no coordenador o dicionário é comum)
# atributos que são do processo (conexões, fila do bloco, linha atual) ou caches por tabela: nunca voltam
_FORA = frozenset({"lt", "cr", "progresso", "mapa_exec", "plano", "tabelas", "chaves", "_fila", "_diario", "_buf",
                   "_prox_id", "_bloco", "_atualizar", "_linha", "_grp", "_grupos", "tipos", "seq", "_adiando",
                   "_esvaziando", "_adiar_linha", "chave_cofre", "prop", "_leit", "_filhos", "_col_dest"})


def gravadores():
    try:
        return max(1, int(os.environ.get("CONECTOR_GRAVADORES") or PADRAO))
    except ValueError:
        return PADRAO


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


def _juntar(cm, ops):
    for quem, n, op, k, x in ops:
        dono = cm.prop if quem == "prop" else cm
        if op == "set":
            setattr(dono, n, x)
            continue
        d = getattr(dono, n)
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
def ondas(plano, mapa_exec):
    """Lista de ondas (índices do plano). B depois de A (A antes no plano) quando uma menciona a outra ou as duas
    gravam o mesmo destino; a onda de B é a maior onda dessas A mais um."""
    idx = {p["tabela"]: i for i, p in enumerate(plano)}
    por_dest = {}
    for i, p in enumerate(plano):
        for dt in p["destinos"]:
            por_dest.setdefault(dt, set()).add(i)
    deps = {}
    for d in mapa_exec.get("deps", []):
        deps.setdefault(d.get("tabela"), set()).add(d.get("depende_de"))
    ligados = [set() for _ in plano]
    for i, p in enumerate(plano):
        txt = json.dumps(p, default=str, sort_keys=True)
        nomes = set(re.findall(r"[A-Za-z_][A-Za-z0-9_$]*", txt)) | deps.get(p["tabela"], set())
        outros = {idx[x] for x in nomes if x in idx} | {j for x in nomes for j in por_dest.get(x, ())}
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


def _gravador(cm, con):
    cli = _Cliente(con)
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
        _pre_tocar(cm, frozenset(), tudo_pequeno=True)
        base = _base(cm)
        feito = None
        while True:
            i = cli.chamar("tabela", feito)
            if i is None:
                break
            p = cm.plano[i]
            _pre_tocar(cm, frozenset([p["tabela"]] + list(p["destinos"]) +
                                     [cm._nome_ent(p["tabela"], dt) for dt in p["destinos"]]))
            cm._tabela(p)
            cm._commit()
            feito = i
        con.send((0, "fim", (_delta(cm, base),)))
    except BaseException:
        try:
            con.send((0, "erro", (traceback.format_exc()[-4000:],)))
        except BaseException:
            pass
    finally:
        os._exit(0)


# ----- coordenador -----
def _servir(cm, filhos, fila, ao_feito):
    """Atende os gravadores até todos devolverem o estado: leituras da origem, próxima tabela e o resultado."""
    fluxos, vivos, sid = {}, dict(filhos), itertools.count(1)
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
            elif op == "fim":
                del vivos[con]
                os.waitpid(pid, 0)
                _juntar(cm, a[0])
            elif op == "erro":
                for p in vivos.values():
                    try:
                        os.kill(p, signal.SIGTERM)
                        os.waitpid(p, 0)
                    except OSError:
                        pass
                raise RuntimeError("gravador %d falhou:\n%s" % (pid, a[0]))
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
    ws = ondas(cm.plano, cm.mapa_exec)

    def ao_feito(i):
        feitos[0] += 1
        cm.progresso(feitos[0] / total, "carregando %s (onda %d de %d)" % (cm.plano[i]["destinos"][0], k + 1,
                                                                             len(ws)))
    for k, onda in enumerate(ws):
        if len(onda) == 1:
            p = cm.plano[onda[0]]
            cm.progresso(feitos[0] / total, "carregando %s (onda %d de %d)" % (p["destinos"][0], k + 1, len(ws)))
            cm._tabela(p)
            feitos[0] += 1
            continue
        cm._commit()  # o que a onda anterior gravou fica visível aos gravadores
        _rastrear(cm)
        fila = sorted(onda, key=lambda i: (-int(contagens.get(cm.plano[i]["tabela"], 0) or 0), i))
        cm.progresso(feitos[0] / total, "carregando %d tabelas em paralelo (onda %d de %d)" % (len(onda), k + 1,
                                                                                               len(ws)))
        filhos = {}
        gc.collect()
        gc.freeze()  # o coletor não toca nos objetos herdados (menos cópia de página nos filhos)
        try:
            for _ in range(min(n, len(onda))):
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
            _servir(cm, filhos, fila, ao_feito)
        finally:
            for con in filhos:
                con.close()
