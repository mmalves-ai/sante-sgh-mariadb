"""Mapa declarativo do conector (F4 L4): origem -> modelo, chave, estratégia de diferencial, dependências e ordem.

Arquivos em `conector/mapa/` (o mapa é a única parte que conhece nomes da origem, AGENTS.md regra 1):
- `tabelas.tsv`       GERADO: uma linha por tabela da origem no mapa da análise (destino, descarte ou mecanismo),
                      com chave, estratégia (plano F4, seção 6), lote, ordem topológica e dependências;
- `dependencias.tsv`  GERADO: arestas filha -> pai (FKs da origem entre tabelas carregadas);
- `colunas.tsv`       GERADO pelo dicionário da origem (só nomes e tipos): regra de sentinela, referência e de-para;
- `declarado/*.tsv`   À MÃO (revisado): ciclos quebrados em duas fases, descartes fora do mapa da análise,
                      tabelas que são catálogo oficial e colunas com destino declarado (valem por cima das geradas).

`montar()` é determinístico e não precisa do dicionário: o verificador refaz tabelas e dependências e compara.
Sem banco e sem Firebird: roda na esteira (`python3 -I conector/verificar_mapa.py`).
"""
import csv
import heapq
import re
import sys
from pathlib import Path

from . import depara, sentinela

RAIZ = Path(__file__).resolve().parents[2]
MAPA_ANALISE = "docs/analise/rodada2/final/mapa-spdata.tsv"
VOLUME = "docs/analise/origem-fb/volume-pc-20261019.tsv"
DIR = "conector/mapa"
LIMITE_PEQUENA = 100_000
ESTRATEGIAS = {
    "hash_linha": "< 100 mil registros: hash de cada linha (bytes crus) contra o conector_origem",
    "hash_linha_sem_chave": "< 100 mil, sem PK: multiconjunto de hashes de linha (inclusão/exclusão por contagem)",
    "data_alteracao_hash_bloco": "coluna de alteração como atalho + hash por bloco periódico (a data não é prova)",
    "faixa_id_hash_bloco": "PK inteira crescente: faixa nova + margem de reabertura + hash por bloco de 10 mil IDs",
    "hash_bloco_chave": "PK composta ou não inteira: hash por bloco ordenado pela chave",
    "sem_chave_recarga": "sem PK e >= 100 mil: recarga inteira ou append-only conferido por contagem e hash de bloco",
    "depara_catalogo_oficial": "a tabela é catálogo oficial: nunca gravada; as linhas viram de-para para o catálogo",
    "sem_carga": "mecanismo do produto sem dado a migrar (controle de versão, motor de integração, data mart)",
}
# mecanismos do mapa da análise -> tabelas físicas do modelo (historico_entidade:<t> soma a própria entidade)
MECANISMOS = {"parametro": ["parametro_definicao", "parametro_valor"], "historico_entidade": ["trilha_auditoria"],
              "arquivo": ["arquivo"], "integracao": [], "framework": [], "datamart": []}
# catálogos oficiais (carregador próprio, AGENTS.md regra 7): o conector nunca grava neles
OFICIAIS = {"banco", "municipio_ibge", "unidade_federativa", "pais_referencia", "ocupacao_cbo", "termo_terminologia",
            "terminologia", "capitulo_cid10", "agrupamento_cid10",  # gitleaks:allow (nomes de tabela, não segredo)
            "procedimento_sigtap", "compatibilidade_sigtap", "dominio_sigtap", "grupo_sigtap", "habilitacao_sigtap", "servico_classificacao_sigtap"}
# lotes de domínio (plano F4, seção 8: L5 a L8) por módulo da análise; L3 já carregado
LOTES = [("L5", "cadastros e administração", ["SIS", "ADM", "CAD", "RH"]),
         ("L6", "prontuário, assinatura e assistência", ["REC", "AGE", "PEP", "INT", "CC", "HOT"]),
         ("L7", "SADT e suprimentos", ["SADT", "SUP"]),
         ("L8", "faturamento e restantes", ["FAT", "SUS", "FIN", "SGO", "INTG", "REL", "QUA", ""])]
FEITAS_L3 = {"TBTPEMP", "TBHOSPIT", "TBUSERS", "RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"}
# ordem de carga (plano, seção 6): usuários, estabelecimento, catálogos, cadastros, movimento, auditoria
PRIORIDADE = {"TBUSERS": 0, "TBHOSPIT": 1, "TBTPEMP": 1}
_AUDITORIA = re.compile(r"TRILHA|AUDIT|^HT|LOG$|^LOG|HIST")
CAMPOS_TABELAS = ["tabela", "tipo", "destinos", "tabelas_destino", "modulo", "lote", "ordem", "registros", "chave", "pk_inteira",
                  "col_alteracao", "estrategia", "depende_de", "dep_fora_do_mapa", "motivo"]
CAMPOS_COLUNAS = ["tabela", "coluna", "forma", "obrigatoria", "regra", "referencia", "depara"]


def ler_tsv(p):
    with open(p, encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f, delimiter="\t") if not (next(iter(r.values()), "") or "").startswith("#")]


def escrever_tsv(p, campos, linhas):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write("\t".join(campos) + "\n")
        for r in linhas:
            f.write("\t".join(str(r.get(c, "")) for c in campos) + "\n")


# ---------------- DDL do destino ----------------
_RESERV = {"CONSTRAINT", "UNIQUE", "KEY", "PRIMARY", "INDEX", "FULLTEXT", "CHECK", "FOREIGN", "SPATIAL"}


def _arquivos_ddl(raiz):
    return sorted(Path(raiz, "db/migracoes").glob("*/*.sql"))


def ler_ddl(raiz=RAIZ):
    """{tabela: {"colunas": [..], "arquivo": rel, "create": texto, "alter": [textos], "fks": [textos]}}."""
    ddl = {}
    for arq in _arquivos_ddl(raiz):
        txt = arq.read_text(encoding="utf-8")
        rel = str(arq.relative_to(raiz))
        for m in re.finditer(r"^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`? \((.*?)^\)[^;]*;", txt, re.M | re.S):
            cols = []
            for linha in m.group(2).splitlines():
                p = linha.strip().split()
                if p and p[0].strip("`").upper() not in _RESERV and re.fullmatch(r"`?\w+`?", p[0]):
                    cols.append(p[0].strip("`"))
            ddl[m.group(1)] = {"colunas": cols, "arquivo": rel, "create": m.group(0), "alter": [], "fks": []}
        for m in re.finditer(r"^ALTER TABLE `?(\w+)`?\s(.*?);", txt, re.M | re.S):
            t = ddl.get(m.group(1))
            if t is None:
                continue
            corpo = m.group(2)
            if "FOREIGN KEY" in corpo:
                t["fks"].append(m.group(0))
            if re.search(r"\b(ADD|DROP) COLUMN\b", corpo):
                t["alter"].append(m.group(0))
            for c in re.findall(r"\bADD COLUMN (?:IF NOT EXISTS )?`?(\w+)`?", corpo):
                if c not in t["colunas"]:
                    t["colunas"].append(c)
            for c in re.findall(r"\bDROP COLUMN (?:IF EXISTS )?`?(\w+)`?", corpo):
                if c in t["colunas"]:
                    t["colunas"].remove(c)
    return ddl


# ---------------- montagem (determinística) ----------------
def lote_de(tabela, modulo, destinos, estrategia):
    if tabela in FEITAS_L3:
        return "L3"
    if estrategia == "depara_catalogo_oficial":
        return "L4"
    for lote, _, mods in LOTES:
        if modulo in mods:
            return lote
    return "L8"


def fisicos(tipo, destinos):
    """Tabelas do modelo que recebem a tabela da origem (mecanismo resolvido); [] = nada a gravar."""
    if tipo != "MECANISMO":
        return list(destinos)
    saida = []
    for d in destinos:
        nome, _, alvo = d.partition(":")
        saida += MECANISMOS.get(nome, ["?" + nome]) + ([alvo] if alvo else [])
    return saida


def estrategia_de(v, destinos, tipo):
    if tipo == "MECANISMO" and not destinos:
        return "sem_carga"
    if tipo != "NAO" and destinos and all(d in OFICIAIS for d in destinos):
        return "depara_catalogo_oficial"
    n = int(v.get("registros") or 0)
    pk = v.get("pk") or ""
    if n < LIMITE_PEQUENA:
        return "hash_linha" if pk else "hash_linha_sem_chave"
    if not pk:
        return "sem_chave_recarga"
    if v.get("col_alteracao"):
        return "data_alteracao_hash_bloco"
    if v.get("pk_inteira_unica") == "S":
        return "faixa_id_hash_bloco"
    return "hash_bloco_chave"


def _prioridade(t, lote, modulo, estrategia):
    if t in PRIORIDADE:
        p = PRIORIDADE[t]
    elif estrategia == "depara_catalogo_oficial":
        p = 2
    elif _AUDITORIA.search(t):
        p = 5
    else:
        p = 3
    ordem_lote = ["L3", "L4", "L5", "L6", "L7", "L8"].index(lote)
    mods = [m for _, _, ms in LOTES for m in ms]
    return (p, ordem_lote, mods.index(modulo) if modulo in mods else len(mods), t)


def ordenar(nos, arestas, quebras, chave):
    """Kahn com fila de prioridade. `arestas`: {(filha, pai)}; `quebras`: arestas declaradas como duas fases.
    Devolve (ordem, ciclos): ciclos = listas de nós que sobraram (ciclo não declarado)."""
    pais = {n: set() for n in nos}
    filhos = {n: set() for n in nos}
    for f, p in arestas:
        if (f, p) in quebras or f not in pais or p not in pais:
            continue
        pais[f].add(p)
        filhos[p].add(f)
    grau = {n: len(pais[n]) for n in nos}
    fila = [(chave(n), n) for n in nos if grau[n] == 0]
    heapq.heapify(fila)
    ordem = []
    while fila:
        _, n = heapq.heappop(fila)
        ordem.append(n)
        for f in filhos[n]:
            grau[f] -= 1
            if grau[f] == 0:
                heapq.heappush(fila, (chave(f), f))
    resto = {n for n in nos if n not in set(ordem)}
    return ordem, componentes_ciclicas(resto, {(f, p) for f, p in arestas if (f, p) not in quebras})


def componentes_ciclicas(nos, arestas):
    """Componentes fortemente conexas com ciclo (tamanho > 1 ou autorreferência), em ordem determinística."""
    adj = {n: sorted({p for f, p in arestas if f == n and p in nos}) for n in sorted(nos)}
    idx, low, pilha, na_pilha, comps = {}, {}, [], set(), []

    def visitar(n):  # Tarjan (no máximo ~1.500 nós: a recursão cabe)
        idx[n] = low[n] = len(idx)
        pilha.append(n)
        na_pilha.add(n)
        for w in adj[n]:
            if w not in idx:
                visitar(w)
                low[n] = min(low[n], low[w])
            elif w in na_pilha:
                low[n] = min(low[n], idx[w])
        if low[n] == idx[n]:
            c = []
            while True:
                w = pilha.pop()
                na_pilha.discard(w)
                c.append(w)
                if w == n:
                    break
            if len(c) > 1 or n in adj[n]:
                comps.append(sorted(c))

    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))
    for n in sorted(nos):
        if n not in idx:
            visitar(n)
    return sorted(comps)


def montar(analise, volume, ciclos_declarados):
    """Linhas de tabelas.tsv e dependencias.tsv a partir do mapa da análise, do volume e dos ciclos declarados."""
    vol = {r["tabela"]: r for r in volume}
    linhas, carregaveis = {}, set()
    for r in analise:
        t = r["tabela"]
        v = vol.get(t, {})
        destinos = [d for d in (r["destino"] or "").split(";") if d]
        fis = fisicos(r["destino_tipo"], destinos) if r["destino_tipo"] != "NAO" else []
        est = estrategia_de(v, fis, r["destino_tipo"]) if r["destino_tipo"] != "NAO" else "descartada"
        linhas[t] = {"tabela": t, "tipo": r["destino_tipo"], "destinos": ";".join(destinos),
                     "tabelas_destino": ";".join(fis),
                     "modulo": r["modulo"], "registros": v.get("registros", "0"), "chave": v.get("pk", ""),
                     "pk_inteira": v.get("pk_inteira_unica", ""), "col_alteracao": v.get("col_alteracao", ""),
                     "estrategia": est, "motivo": (r.get("motivo") or "").replace("\t", " ").strip()}
        linhas[t]["lote"] = lote_de(t, r["modulo"], destinos, est) if est not in ("descartada", "sem_carga") else "-"
        if fis:
            carregaveis.add(t)
    arestas = set()
    for t in sorted(carregaveis):
        deps = [d for d in (vol.get(t, {}).get("depende_de") or "").split(",") if d]
        dentro = sorted(d for d in deps if d in carregaveis)
        fora = sorted(d for d in deps if d not in carregaveis)
        linhas[t]["depende_de"] = ",".join(dentro)
        linhas[t]["dep_fora_do_mapa"] = ",".join(fora)
        arestas.update((t, d) for d in dentro)
    quebras = {(c["tabela"], c["depende_de"]) for c in ciclos_declarados}
    base = {n: _prioridade(n, linhas[n]["lote"], linhas[n]["modulo"], linhas[n]["estrategia"]) for n in carregaveis}
    # o pai herda a prioridade do filho mais urgente (ex.: o perfil que o usuário exige vem logo antes dele)
    efetiva = {n: base[n][0] for n in carregaveis}
    mudou = True
    while mudou:
        mudou = False
        for f, p in sorted(arestas):
            if (f, p) not in quebras and efetiva[f] < efetiva[p]:
                efetiva[p] = efetiva[f]
                mudou = True
    chave = lambda n: (efetiva[n],) + base[n]  # noqa: E731
    ordem, ciclos = ordenar(sorted(carregaveis), arestas, quebras, chave)
    for i, t in enumerate(ordem, 1):
        linhas[t]["ordem"] = str(i)
    for t in linhas:
        linhas[t].setdefault("ordem", "-" if t not in carregaveis else "?")
    tab = sorted(linhas.values(), key=lambda r: (r["ordem"] in ("-", "?"), int(r["ordem"]) if r["ordem"].isdigit()
                                                else 0, r["tabela"]))
    deps = [{"tabela": f, "depende_de": p, "quebra": "duas_fases" if (f, p) in quebras else ""}
            for f, p in sorted(arestas)]
    return tab, deps, ciclos, arestas


def propor_quebras(ciclos, arestas, linhas):
    """Proposta inicial de quebra (o dono/agente revisa): em cada ciclo, a aresta para o pai que vem DEPOIS na
    ordem de prioridade é carregada em duas fases (insere sem a FK e atualiza no fim do domínio)."""
    por = {r["tabela"]: r for r in linhas}
    chave = lambda n: _prioridade(n, por[n]["lote"], por[n]["modulo"], por[n]["estrategia"])  # noqa: E731
    saida = []
    for comp in ciclos:
        pos = {n: i for i, n in enumerate(sorted(comp, key=chave))}
        for f, p in sorted(arestas):
            if f in pos and p in pos and pos[p] >= pos[f]:
                motivo = ("autorreferência (hierarquia na própria tabela)" if f == p else
                          "ciclo entre %d tabelas (%s): o pai vem depois na ordem de carga" % (
                              len(comp), ",".join(comp) if len(comp) <= 6 else ",".join(comp[:6]) + ",..."))
                saida.append({"tabela": f, "depende_de": p, "tratamento": "duas_fases", "motivo": motivo})
    return saida


# ---------------- verificador ----------------
def verificar_dados(analise, volume, ddl, tabelas, deps, ciclos_decl, descartes, colunas, colunas_decl,
                    catalogos_decl):
    """Lista de erros (vazia = mapa válido). Só nomes de tabela/coluna e regras; nunca valores."""
    erros = []
    esperado_tab, esperado_deps, ciclos, arestas = montar(analise, volume, ciclos_decl)
    if ciclos:
        for c in ciclos:
            erros.append("ciclo não declarado em declarado/ciclos.tsv: %s" % ",".join(c))
    if [dict((k, r.get(k, "")) for k in CAMPOS_TABELAS) for r in esperado_tab] != \
            [dict((k, r.get(k, "")) for k in CAMPOS_TABELAS) for r in tabelas]:
        erros.append("tabelas.tsv desatualizado: rode python3 -I tools/obra/gerar_mapa_conector.py")
    if [(d["tabela"], d["depende_de"], d["quebra"]) for d in esperado_deps] != \
            [(d["tabela"], d["depende_de"], d.get("quebra", "")) for d in deps]:
        erros.append("dependencias.tsv desatualizado: rode python3 -I tools/obra/gerar_mapa_conector.py")
    for c in ciclos_decl:
        if (c["tabela"], c["depende_de"]) not in arestas:
            erros.append("ciclo declarado sem a dependência correspondente: %s -> %s" % (c["tabela"], c["depende_de"]))
        if c.get("tratamento") != "duas_fases" or not (c.get("motivo") or "").strip():
            erros.append("ciclo declarado sem tratamento duas_fases ou sem motivo: %s" % c["tabela"])
    por = {r["tabela"]: r for r in tabelas}
    # tabela sem destino nem descarte justificado
    for r in tabelas:
        t = r["tabela"]
        if r["tipo"] not in ("TABELA", "MECANISMO", "NAO"):
            erros.append("tipo de destino desconhecido: %s" % t)
        elif r["tipo"] == "NAO":
            if not r["motivo"]:
                erros.append("descarte sem justificativa: %s" % t)
        elif not r["destinos"]:
            erros.append("tabela sem destino: %s" % t)
        elif r["estrategia"] == "sem_carga" and not r["motivo"]:
            erros.append("mecanismo sem carga e sem justificativa: %s" % t)
        else:
            for d in r["destinos"].split(";"):
                if r["tipo"] == "MECANISMO" and d.partition(":")[0] not in MECANISMOS:
                    erros.append("mecanismo desconhecido: %s -> %s" % (t, d))
            for d in [x for x in r["tabelas_destino"].split(";") if x]:
                if d not in ddl:
                    erros.append("destino inexistente no DDL: %s -> %s" % (t, d))
            if r["estrategia"] not in ESTRATEGIAS:
                erros.append("estratégia desconhecida: %s" % t)
    regs = [(re.compile(d["padrao"]), d) for d in descartes]
    for d in descartes:
        if not (d.get("motivo") or "").strip() or d.get("condicao") not in ("vazia", "qualquer"):
            erros.append("descarte declarado sem motivo ou condição: %s" % d.get("padrao"))
    for v in volume:
        t = v["tabela"]
        if t in por:
            continue
        ok = any(rx.fullmatch(t) and (d["condicao"] == "qualquer" or int(v["registros"] or 0) == 0)
                 for rx, d in regs)
        if not ok:
            erros.append("tabela da origem sem destino nem descarte justificado: %s" % t)
    # colunas: regra conhecida, de-para conhecido, referência a tabela da origem
    vol = {v["tabela"] for v in volume}
    for c in colunas:
        if c["tabela"] not in por or not por[c["tabela"]]["tabelas_destino"]:
            erros.append("coluna de tabela fora do mapa carregável: %s.%s" % (c["tabela"], c["coluna"]))
        if c["regra"] not in sentinela.REGRAS:
            erros.append("regra de coluna desconhecida: %s.%s" % (c["tabela"], c["coluna"]))
        if c.get("depara") and c["depara"] not in depara.CATALOGOS:
            erros.append("de-para desconhecido: %s.%s" % (c["tabela"], c["coluna"]))
        if c.get("referencia") and c["referencia"] not in vol:
            erros.append("referência a tabela inexistente na origem: %s.%s" % (c["tabela"], c["coluna"]))
    # colunas declaradas: destino existe no DDL e pertence aos destinos da tabela
    for c in colunas_decl:
        t = c["tabela"]
        if t not in por or not por[t]["tabelas_destino"]:
            erros.append("coluna declarada de tabela fora do mapa carregável: %s.%s" % (t, c["coluna"]))
            continue
        if c.get("regra") and c["regra"] not in sentinela.REGRAS:
            erros.append("regra declarada desconhecida: %s.%s" % (t, c["coluna"]))
        if c.get("depara") and c["depara"] not in depara.CATALOGOS:
            erros.append("de-para declarado desconhecido: %s.%s" % (t, c["coluna"]))
        dest = c.get("destino") or ""
        if dest:
            dt, _, dc = dest.partition(".")
            if dt not in ddl:
                erros.append("coluna de destino em tabela inexistente no DDL: %s.%s -> %s" % (t, c["coluna"], dest))
            elif dc not in ddl[dt]["colunas"]:
                erros.append("coluna de destino inexistente no DDL: %s.%s -> %s" % (t, c["coluna"], dest))
            elif dt not in por[t]["tabelas_destino"].split(";") and dt not in (c.get("via") or "").split(";"):
                erros.append("coluna de destino fora dos destinos da tabela: %s.%s -> %s" % (t, c["coluna"], dest))
    # catálogos oficiais: alvo existe no DDL; tabelas declaradas existem e são carregáveis
    usados = {c.get("depara") for c in colunas + colunas_decl} | {c["catalogo"] for c in catalogos_decl}
    for nome, cat in depara.CATALOGOS.items():
        if nome not in usados:
            continue
        if cat["tabela"] not in ddl or cat["coluna"] not in ddl[cat["tabela"]]["colunas"]:
            erros.append("catálogo %s aponta coluna inexistente no DDL: %s.%s" % (nome, cat["tabela"], cat["coluna"]))
    for c in catalogos_decl:
        t = c["tabela"]
        if t not in por or por[t]["tipo"] == "NAO":
            erros.append("catálogo declarado fora do mapa: %s" % t)
        elif c["catalogo"] not in depara.CATALOGOS and not (c.get("motivo") or "").strip():
            erros.append("catálogo declarado desconhecido e sem motivo: %s" % t)
    for r in tabelas:
        if r["estrategia"] == "depara_catalogo_oficial" and r["tabela"] not in {c["tabela"] for c in catalogos_decl}:
            erros.append("tabela de catálogo oficial sem declaração em declarado/catalogos.tsv: %s" % r["tabela"])
    return erros


def carregar(raiz=RAIZ):
    raiz = Path(raiz)
    d = raiz / DIR
    ler = lambda n: ler_tsv(d / n) if (d / n).exists() else []  # noqa: E731
    return dict(analise=ler_tsv(raiz / MAPA_ANALISE), volume=ler_tsv(raiz / VOLUME), ddl=ler_ddl(raiz),
                tabelas=ler("tabelas.tsv"), deps=ler("dependencias.tsv"), ciclos_decl=ler("declarado/ciclos.tsv"),
                descartes=ler("declarado/descartes.tsv"), colunas=ler("colunas.tsv"),
                colunas_decl=ler("declarado/colunas.tsv"), catalogos_decl=ler("declarado/catalogos.tsv"))


def verificar(raiz=RAIZ):
    return verificar_dados(**carregar(raiz))
