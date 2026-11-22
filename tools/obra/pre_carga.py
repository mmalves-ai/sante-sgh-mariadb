"""Pré-carga por área (apoio de tools/obra/pre-carga.sh). Só contagens, nunca valores da origem.

  python3 -I tools/obra/pre_carga.py recorte <saida.tsv> [AREA ...]
      Gera o recorte de conector.sh medir-carga --recorte (diag_cadeia.py): toda tabela do plano (mapa com destino
      e colunas declaradas, mais a carga própria L3) das áreas pedidas (todas, sem filtro), com os pais delas (fecho de
      dependências). Amostra: tabela folha, as primeiras FOLHA linhas; tabela que é pai de outra, as primeiras PAI
      linhas (o pai pequeno entra inteiro). Filho de um pai truncado entra só se apontar para uma linha do pai que
      entrou (filtro COL>PAI.CHAVE, pela coluna de referência OBRIGATÓRIA do mapa, no pai truncado com mais registros),
      salvo o filho com mais de TETO_FILTRO registros (aí as primeiras linhas; recusa pai_* nele pode ser da amostra).
  python3 -I tools/obra/pre_carga.py tsv <resultado.json> <recorte.tsv> <saida.tsv>
      TSV por tabela da origem: área, fatia, tabela, destino, amostra, gravados, recusados, recusas por regra.
"""
import csv
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MAPA = RAIZ / "conector/mapa"
FOLHA, PAI = 1000, 5000
TETO_FILTRO = 300000  # filho maior que isto não é filtrado: varrer milhões atrás de poucos pais trava a amostra
L3 = ["TBTPEMP", "TBHOSPIT", "TBUSERS", "RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"]


def tsv(p):
    return list(csv.DictReader(open(p, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE))


def mapa():
    tab = {r["tabela"]: r for r in tsv(MAPA / "tabelas.tsv")}
    fatia, decl = {}, set()
    for f in sorted((MAPA / "declarado/colunas.d").glob("*.tsv")):
        for r in tsv(f):
            decl.add(r["tabela"])
            fatia.setdefault(r["tabela"], f.stem)
    for f in [MAPA / "declarado/colunas.tsv"]:
        if f.exists():
            for r in tsv(f):
                decl.add(r["tabela"])
    deps = {}
    for r in tsv(MAPA / "dependencias.tsv"):
        if not r.get("quebra"):
            deps.setdefault(r["tabela"], set()).add(r["depende_de"])
    for t, r in tab.items():
        deps.setdefault(t, set()).update(d for d in (r.get("depende_de") or "").split(",") if d)
    refs = {}
    for r in tsv(MAPA / "colunas.tsv"):
        if r.get("referencia") and r.get("obrigatoria") == "S":  # FK opcional: nulo sairia do filtro
            refs.setdefault(r["tabela"], []).append((r["coluna"], r["referencia"]))
    return tab, fatia, decl, deps, refs


def regs(r):
    v = (r or {}).get("registros") or ""
    return int(v) if v.isdigit() else 0


def recorte(saida, areas):
    tab, fatia, decl, deps, refs = mapa()
    plano = [t for t, r in tab.items() if t in L3 or (r.get("tabelas_destino") and t in decl)]
    pedidas = [t for t in plano if not areas or tab[t]["modulo"] in areas]
    alvo, pilha = set(), list(pedidas)
    while pilha:
        t = pilha.pop()
        if t in alvo or t not in tab:
            continue
        alvo.add(t)
        pilha += list(deps.get(t, ()))
    pais = {d for t in alvo for d in deps.get(t, ()) if d in alvo}
    lim = {t: (PAI if t in pais else FOLHA) for t in alvo}
    linhas = ["# gerado por tools/obra/pre_carga.py (pré-carga por área); tabela\tlimite\tmodulo\tfiltro\tnota"]
    for t in sorted(alvo):
        filtro = ""
        trunc = [(regs(tab.get(p)), c, p) for c, p in refs.get(t, ()) if p in alvo and p != t
                 and regs(tab.get(p)) > lim[p] and "," not in (tab[p].get("chave") or ",")]
        if trunc and regs(tab[t]) <= TETO_FILTRO:
            _, c, p = max(trunc)
            filtro = "%s>%s.%s" % (c, p, tab[p]["chave"])
        linhas.append("%s\t%d\t\t%s\t%s" % (t, lim[t], filtro, tab[t]["modulo"]))
    Path(saida).write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print("recorte: %d tabelas (%d pedidas, %d pais, %d com filtro)"
          % (len(alvo), len(pedidas), len(pais), sum(1 for x in linhas if x.count("\t") == 4 and x.split("\t")[3])))


def gerar_tsv(res_json, rec, saida):
    tab, fatia, _, _, _ = mapa()
    res = json.load(open(res_json, encoding="utf-8"))
    amostra = res.get("recorte_linhas") or {}
    por = {}
    for x in res.get("conector_origem") or []:
        t, regra, n, d = x.rsplit("|", 3) if x.count("|") > 3 else x.split("|")
        e = por.setdefault(t, {"total": 0, "gravados": 0, "regras": {}})
        e["total"] += int(n)
        e["gravados"] += int(d)
        if regra != "-":
            e["regras"][regra] = e["regras"].get(regra, 0) + int(n)
    nomes = [ln.split("\t")[0] for ln in open(rec, encoding="utf-8") if ln.strip() and not ln.startswith("#")]
    with open(saida, "w", encoding="utf-8") as f:
        f.write("area\tfatia\ttabela_origem\tdestino\tregistros_origem\tamostra\tgravados\trecusados\trecusas_por_regra\n")
        for t in sorted(set(nomes) | set(por), key=lambda t: ((tab.get(t) or {}).get("modulo", "?"), t)):
            r = tab.get(t) or {}
            e = por.get(t, {"total": 0, "gravados": 0, "regras": {}})
            rec_n = sum(e["regras"].values())
            regras = ",".join("%s:%d" % kv for kv in sorted(e["regras"].items(), key=lambda kv: -kv[1]))
            f.write("\t".join([r.get("modulo") or "?", fatia.get(t, r.get("lote") or "-"), t,
                               (r.get("tabelas_destino") or "").split(";")[0], str(regs(r)), str(amostra.get(t, 0)),
                               str(e["gravados"]), str(rec_n), regras]) + "\n")
    etapas = {k: (v.get("falhou") or "ok") if isinstance(v, dict) else "?" for k, v in (res.get("etapas") or {}).items()}
    print("tsv: %d tabelas; etapas %s; pendências %d linhas" % (len(set(nomes) | set(por)), etapas,
                                                                len(res.get("pendencias") or [])))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "recorte":
        recorte(sys.argv[2], set(a.upper() for a in sys.argv[3:]))
    elif len(sys.argv) == 5 and sys.argv[1] == "tsv":
        gerar_tsv(*sys.argv[2:])
    else:
        sys.exit(__doc__)
