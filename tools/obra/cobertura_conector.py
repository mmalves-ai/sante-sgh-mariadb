"""Cobertura do conector (F4): para cada tabela CARREGÁVEL do mapa, diz se ela CARREGA, se é DESCARTE com motivo de
produto ou se está BLOQUEADA (e por quê). Só metadado: nomes de tabela e coluna, nunca valores.

uso: python3 -I tools/obra/cobertura_conector.py [--saida <arquivo.tsv>] [--falhar-se-bloqueada] [--fatia <F>]

Carregável: tabela do mapa (`conector/mapa/tabelas.tsv`) com tabela física de destino gravável (`tabelas_destino`).
- CARREGA: a carga própria do L3 (`carga.ORDEM`) ou a carga dirigida pelo mapa a planeja (`carga_mapa.planejar`, com
  as declarações atuais) e toda coluna obrigatória do destino (NOT NULL, sem padrão, sem AUTO_INCREMENT; `criado_em`
  e `origem` são do motor) tem fonte declarada. Destino secundário opcional (`via` com `opcional`) não exige.
- DESCARTE: `conector/mapa/declarado/sem_carga.tsv` com situacao=descarte e causa de produto aceitável
  (`sem_valor`, `duplicado`, `licenciado`, `catalogo_oficial`, `mecanismo_do_produto`), sempre com motivo.
- BLOQUEADA: o resto, com a causa:
  - declarada em `sem_carga.tsv` (situacao=bloqueada; causa e motivo livres, para o dono revisar);
  - `coluna_obrigatoria_sem_fonte:<destino.coluna>` (declarada, mas o destino recusaria toda linha; destino
    `opcional` ou `complementa`, UPDATE da linha que o pai já gravou, não exige);
  - `pai_nao_carregado:<TABELA>` também para tabela DECLARADA cuja coluna obrigatória do destino vem por referência
    (gerada ou `ref:`, a última tabela dos passos) de um pai BLOQUEADO ou DESCARTADO: toda linha seria recusada
    (resolvido até o ponto fixo);
  - `pai_nao_carregado:<TABELA>` (sem declaração e pai obrigatório do mapa que também não carrega);
  - inferida dos pedidos das fatias (`docs/obra/fatias/f4/saida/<fatia>.json`) ou da declaração comentada (`#TABELA`
    em `colunas.d`): `referencia_composta`, `referencia_encadeada`, `vigencia_sem_fonte`, `desdobrar_coluna`,
    `destino_a_rever`, `depara_valores`, `regra_faltante`, `catalogo_oficial_faltante`, `retrato_historico`,
    `segredo`;
  - `sem_declaracao` (a fatia ainda não declarou nenhuma coluna).
Saída: totais e por fatia no terminal; `--saida` grava uma linha por tabela (fatia, tabela, situação, causa).
`--falhar-se-bloqueada`: código 1 se houver tabela BLOQUEADA (esteira).
"""
import csv
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "conector"))

class _Qualquer:
    def __getattr__(self, nome):
        return _Qualquer()

    def __call__(self, *a, **k):
        return _Qualquer()


# no host não há drivers do MariaDB nem do Firebird: o plano não fala com banco (os módulos só são importados)
for _m in ("pymysql", "firebird", "firebird.driver"):
    try:
        __import__(_m)
    except ImportError:
        import types
        _x = types.ModuleType(_m)
        _x.__path__ = []

        def _ga(nome):
            if nome.startswith("__"):
                raise AttributeError(nome)
            return _Qualquer()
        _x.__getattr__ = _ga
        sys.modules[_m] = _x

from sante_conector import carga, carga_mapa, mapa  # noqa: E402

SEM_CARGA = "declarado/sem_carga.tsv"
CAUSAS_DESCARTE = {"sem_valor", "duplicado", "licenciado", "catalogo_oficial", "mecanismo_do_produto"}
AUTOMATICAS = {"id", "criado_em", "origem"}
# causa inferida do texto do pedido da fatia ou do motivo comentado (primeira que casar)
PALAVRAS = [
    ("segredo", r"#cofre|segredo|senha em claro|credencial"),
    ("vigencia_sem_fonte", r"vig[eê]ncia"),
    ("referencia_composta", r"chave composta|ref:\w+\(|chave alternativa"),
    ("referencia_encadeada", r"encadead|ref:\w+\.\w+>|ref:\w+>"),
    ("desdobrar_coluna", r"desdobr|despivot|linha larga|grupo repetido|colunas em linhas"),
    ("retrato_historico", r"#retrato|retrato json|historico_entidade"),
    ("catalogo_oficial_faltante", r"codigo_esocial|tuss|catálogo oficial|de-para oficial"),
    ("depara_valores", r"de-para de valores|depara=valores|valores\.tsv"),
    ("complementa", r"complement|atualiza(r)? o registro do pai|atualiza:|update de|destino de atualiza"),
    ("sem_declaracao", r"sem nenhuma coluna declarada"),
    ("regra_disponivel", r"#sha256|#codigo_derivado|@data_carga|minutos_em_timestamp|piso|texto_resumo|prefixo de dom"
                         r"|inteiro_faixa|faixa|\bcpf\b|cnpj|@estabelecimento|casar pelo c[oó]digo|ado[cç][aã]o"
                         r"|c[oó]digo num[eé]rico|competencia_mes|ano_mes|data composta|#competencia"),
    ("destino_a_rever", r"destino a rever|rever o destino|destino errado|decis[aã]o do dono|modelo"),
    ("pai_nao_carregado", r"pai obrigat|pai n[aã]o carregad|ordem|depend[eê]ncia"),
    ("regra_faltante", r"regra|#sha256|#codigo_derivado|@data_carga|minutos_em_timestamp|piso|faixa|texto_resumo"),
]


# causas que já têm mecanismo genérico no motor (rodada de cobertura) ou decisão registrada em
# docs/obra/passagens/F4-decisoes-destino.md: a fatia só precisa ser REFEITA (declarar), sem esperar ninguém
COM_MECANISMO = {"sem_declaracao", "pai_nao_carregado", "referencia_composta", "referencia_encadeada",
                 "vigencia_sem_fonte", "desdobrar_coluna", "regra_disponivel", "segredo", "depara_valores",
                 "destino_decidido", "declaracao_comentada", "retrato_historico", "catalogo_oficial_faltante",
                 "coluna_obrigatoria_sem_fonte", "complementa"}
DECISOES = "docs/obra/passagens/F4-decisoes-destino.md"


def _colunas_ddl(ddl, t):
    """{coluna: obrigatória sem fonte automática} pelo CREATE e ADD COLUMN do modelo."""
    x = ddl.get(t) or {}
    saida = {}
    for txt in [x.get("create", "")] + x.get("alter", []):
        for linha in txt.splitlines():
            m = re.match(r"\s*(?:ALTER TABLE \S+\s+)?(?:ADD COLUMN (?:IF NOT EXISTS )?)?`?(\w+)`?\s+(\w+)(.*)", linha)
            if not m or m.group(1).upper() in mapa._RESERV or m.group(1).upper() in ("CREATE", "ALTER", "ADD"):
                continue
            resto = m.group(3).upper()
            obrig = ("NOT NULL" in resto and "DEFAULT" not in resto and "AUTO_INCREMENT" not in resto
                     and " AS (" not in resto and "GENERATED" not in resto)
            saida[m.group(1)] = obrig
    return saida


def _indice():
    p = RAIZ / "docs/obra/fatias/f4/indice.tsv"
    fat = {}
    for r in mapa.ler_tsv(p):
        for t in r["tabelas"].split(","):
            fat[t] = r["fatia"]
    return fat


def _pedidos(fatias):
    """{fatia: [texto do pedido]} (mudança + motivo), em minúsculas."""
    saida = {}
    for f in fatias:
        p = RAIZ / ("docs/obra/fatias/f4/saida/%s.json" % f)
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            saida[f] = [(x.get("mudanca", "") + " " + x.get("motivo", "")) for x in d.get("pedidos", [])]
    return saida


def _comentadas():
    """{tabela: motivo} das declarações comentadas (`#TABELA ...`) em colunas.d."""
    saida = {}
    for a in sorted((RAIZ / "conector/mapa" / mapa.COLUNAS_D).glob("*.tsv")):
        for linha in a.read_text(encoding="utf-8").splitlines():
            if linha.startswith("#") and "\t" in linha:
                p = linha[1:].split("\t")
                if re.fullmatch(r"[A-Z0-9_]+", p[0]):
                    saida.setdefault(p[0], []).append(p[-1])
    return saida


def _causa_texto(txt):
    for causa, rx in PALAVRAS:
        if re.search(rx, txt, re.I):
            return causa
    return ""


def avaliar(raiz=RAIZ):
    d = mapa.carregar(raiz)
    mdir = Path(raiz) / mapa.DIR
    sem_carga = {r["tabela"]: r for r in (mapa.ler_tsv(mdir / SEM_CARGA) if (mdir / SEM_CARGA).exists() else [])}
    ddl = d["ddl"]
    carregaveis = [r for r in d["tabelas"] if r["tabelas_destino"] and r["tipo"] in ("TABELA", "MECANISMO")]
    nomes = {r["tabela"] for r in carregaveis}
    mexec = {"tabelas": d["tabelas"], "colunas": d["colunas"], "colunas_decl": d["colunas_decl"], "deps": d["deps"],
             "valores": d["valores"]}
    plano = {p["tabela"]: p for p in carga_mapa.planejar(mexec, nomes)}
    opcionais = {}
    for c in d["colunas_decl"]:
        via = (c.get("via") or "").split(";")
        if ("opcional" in via or "complementa" in via) and c.get("destino"):
            opcionais.setdefault(c["tabela"], set()).add(c["destino"].split(".")[0])
    fat = _indice()
    for c in d["colunas_decl"]:  # tabela já declarada fica com a fatia que a declarou (o índice pode ter mudado)
        arq = Path(c.get("_arquivo", "")).stem
        if c.get("_arquivo", "").startswith(mapa.COLUNAS_D) and c.get("destino"):
            fat[c["tabela"]] = arq
    pedidos = _pedidos(sorted(set(fat.values())))
    coment = _comentadas()
    dec = Path(raiz) / DECISOES
    decididas = set(re.findall(r"^\| `?([A-Z0-9_]+)`? \|", dec.read_text(encoding="utf-8"), re.M)) if dec.exists() else set()
    pais = {}
    for x in d["deps"]:
        if not x.get("quebra"):
            pais.setdefault(x["tabela"], []).append(x["depende_de"])
    res = {}
    for r in sorted(carregaveis, key=lambda r: int(r["ordem"]) if r["ordem"].isdigit() else 10 ** 9):
        t = r["tabela"]
        f = fat.get(t, r["lote"])
        sc = sem_carga.get(t)
        if t in carga.ORDEM:
            res[t] = (f, "CARREGA", "carga_l3")
            continue
        if sc and sc.get("situacao") == "descarte" and sc.get("causa") in CAUSAS_DESCARTE and sc.get("motivo"):
            res[t] = (f, "DESCARTE", sc["causa"])
            continue
        if t in plano:
            p = plano[t]
            falta = []
            for dt in p["destinos"]:
                if dt in opcionais.get(t, ()):
                    continue
                decl = {c["destino"] for c in p["colunas"][dt]}
                falta += ["%s.%s" % (dt, c) for c, ob in _colunas_ddl(ddl, dt).items()
                          if ob and c not in decl and c not in AUTOMATICAS]
            res[t] = (f, "BLOQUEADA", "coluna_obrigatoria_sem_fonte:" + ",".join(falta)) if falta else \
                (f, "CARREGA", "mapa")
            continue
        if sc:
            res[t] = (f, "BLOQUEADA", (sc.get("causa") or "declarada") + (":descarte_sem_causa_aceita"
                                                                          if sc.get("situacao") == "descarte" else ""))
            continue
        res[t] = (f, "BLOQUEADA", None)
    # causa das sem declaração: comentada, pedido da fatia, pai não carregado, sem declaração
    for t, (f, sit, causa) in list(res.items()):
        if sit != "BLOQUEADA" or causa is not None:
            continue
        c = ""
        if t in coment:
            c = _causa_texto(" ".join(coment[t])) or "declaracao_comentada"
        if not c:
            rx = re.compile(r"(?<![A-Z0-9_])%s(?![A-Z0-9_])" % re.escape(t))
            c = next((x for x in (_causa_texto(p) for p in pedidos.get(f, []) if rx.search(p.upper())) if x), "")
        if not c:
            ruins = [p for p in pais.get(t, []) if p in res and res[p][1] == "BLOQUEADA"]
            c = "pai_nao_carregado:" + ruins[0] if ruins else "sem_declaracao"
        if c == "destino_a_rever" and t in decididas:
            c = "destino_decidido"
        res[t] = (f, sit, c)
    # tabela que carrega, mas cuja coluna obrigatória do destino depende de um pai que não carrega (ponto fixo)
    obrig_pai = {}
    for t, p in plano.items():
        for dt in p["destinos"]:
            if dt in opcionais.get(t, ()):
                continue
            ob = _colunas_ddl(ddl, dt)
            for c in p["colunas"][dt]:
                if not ob.get(c["destino"]):
                    continue
                pai = ""
                if c.get("passos"):
                    tabs = [x for x in c["passos"] if "tabela" in x]
                    pai = tabs[-1]["tabela"] if "tabela" in c["passos"][-1] else ""
                elif c["regra"] == "chave_origem" and c.get("referencia") and c["referencia"] not in p["duas_fases"]:
                    pai = c["referencia"]
                if pai and pai != t:
                    obrig_pai.setdefault(t, []).append(pai)
    mudou = True
    while mudou:
        mudou = False
        for t, ps in obrig_pai.items():
            if res.get(t, (0, ""))[1] != "CARREGA":
                continue
            ruim = next((x for x in ps if x in res and res[x][1] in ("BLOQUEADA", "DESCARTE")), None)
            if ruim:
                res[t] = (res[t][0], "BLOQUEADA", "pai_nao_carregado:" + ruim)
                mudou = True
    return res


def main(argv):
    saida = argv[argv.index("--saida") + 1] if "--saida" in argv else None
    so = argv[argv.index("--fatia") + 1] if "--fatia" in argv else None
    res = avaliar()
    if so:
        res = {t: v for t, v in res.items() if v[0] == so}
    tot, por_fatia, causas = {}, {}, {}
    for t, (f, sit, causa) in res.items():
        tot[sit] = tot.get(sit, 0) + 1
        por_fatia.setdefault(f, {}).setdefault(sit, 0)
        por_fatia[f][sit] += 1
        if sit == "BLOQUEADA":
            k = causa.split(":")[0]
            causas[k] = causas.get(k, 0) + 1
    print("cobertura do conector: %d carregáveis; CARREGA %d, DESCARTE %d, BLOQUEADA %d" % (
        len(res), tot.get("CARREGA", 0), tot.get("DESCARTE", 0), tot.get("BLOQUEADA", 0)))
    if causas:
        print("bloqueadas por causa: " + ", ".join("%s %d" % kv for kv in sorted(causas.items(), key=lambda x: -x[1])))
        sem = {k: n for k, n in causas.items() if k not in COM_MECANISMO}
        print("bloqueadas que só pedem refazer a fatia (mecanismo ou decisão já disponível): %d; sem mecanismo: %d%s" % (
            sum(causas.values()) - sum(sem.values()), sum(sem.values()),
            (" (" + ", ".join(sorted(sem)) + ")") if sem else ""))
    refazer = sorted({v[0] for v in res.values() if v[1] == "BLOQUEADA"})
    print("fatias a refazer (%d): %s" % (len(refazer), " ".join(refazer)))
    print("por fatia (carrega/descarte/bloqueada):")
    for f in sorted(por_fatia):
        x = por_fatia[f]
        print("  %s %d/%d/%d" % (f, x.get("CARREGA", 0), x.get("DESCARTE", 0), x.get("BLOQUEADA", 0)))
    if saida:
        with open(saida, "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh, delimiter="\t", lineterminator="\n")
            w.writerow(["fatia", "tabela", "situacao", "causa"])
            for t, (f, sit, causa) in sorted(res.items(), key=lambda kv: (kv[1][0], kv[0])):
                w.writerow([f, t, sit, causa])
    if "--falhar-se-bloqueada" in argv and tot.get("BLOQUEADA", 0):
        print("FALHA: %d tabela(s) BLOQUEADA(s)" % tot["BLOQUEADA"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
