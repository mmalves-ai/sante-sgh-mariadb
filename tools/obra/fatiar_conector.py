"""Gera as fatias autossuficientes dos lotes de domínio do conector (F4 L5 a L8), pelo protocolo de tokens.

uso: python3 -I tools/obra/fatiar_conector.py [--conferir]

Lê só o mapa gerado (conector/mapa/*.tsv) e o DDL (db/migracoes). Para cada lote, os módulos em ordem e, em cada
módulo, as tabelas na ordem topológica, em fatias de cerca de 25. Cada fatia traz o trecho do mapa, as dependências
de fora, a forma das colunas de origem (só nomes e tipos, com a regra gerada) e o DDL de destino (CREATE TABLE,
ALTER de colunas e FKs). Saída em docs/obra/fatias/f4/: <lote>-<n>.md e indice.tsv (o brief.md é escrito à mão).
--conferir: refaz em memória e confere cobertura (cada tabela dos lotes em exatamente uma fatia, com colunas e DDL)
e igualdade byte a byte com os arquivos gravados. Nenhum dado de linha: só metadado.
"""
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "conector"))

from sante_conector import mapa  # noqa: E402

OUT = RAIZ / "docs/obra/fatias/f4"
ALVO = 25
LIMITE_BYTES = 160_000
CAMPOS_MAPA = ["ordem", "tabela", "tipo", "destinos", "tabelas_destino", "destinos_oficiais", "registros", "chave", "pk_inteira",
               "col_alteracao", "estrategia", "depende_de", "dep_fora_do_mapa", "motivo"]


def blocos(seq, alvo):
    n = max(1, math.ceil(len(seq) / alvo))
    base, resto = divmod(len(seq), n)
    out, i = [], 0
    for k in range(n):
        tam = base + (1 if k < resto else 0)
        out.append(seq[i:i + tam])
        i += tam
    return [b for b in out if b]


def montar():
    d = mapa.carregar(RAIZ)
    tab = d["tabelas"]
    por = {r["tabela"]: r for r in tab}
    cols = {}
    for c in d["colunas"]:
        cols.setdefault(c["tabela"], []).append(c)
    decl = {}
    for c in d["colunas_decl"]:  # só o colunas.tsv comum: as colunas.d das fatias não mudam a fatia gerada
        if c.get("_arquivo", "declarado/colunas.tsv") != "declarado/colunas.tsv":
            continue
        decl.setdefault(c["tabela"], []).append(c)
    ddl = d["ddl"]
    fatias = []
    for lote, desc, mods in mapa.LOTES:
        for m in mods:
            sel = [r for r in tab if r["lote"] == lote and r["modulo"] == m and r["tabelas_destino"]]
            sel.sort(key=lambda r: int(r["ordem"]))
            for b in blocos(sel, ALVO):
                fatias.append((lote, desc, m, b))
    # numeração por lote; fatia grande demais é dividida ao meio (determinístico)
    final = []
    for lote, desc, m, b in fatias:
        pilha = [b]
        while pilha:
            x = pilha.pop(0)
            txt = texto(lote, desc, m, x, 0, por, cols, decl, ddl)
            if len(txt.encode()) > LIMITE_BYTES and len(x) > 1:
                meio = len(x) // 2
                pilha[:0] = [x[:meio], x[meio:]]
                continue
            final.append((lote, desc, m, x))
    saida, cont = [], {}
    for lote, desc, m, x in final:
        cont[lote] = cont.get(lote, 0) + 1
        nome = "%s-%02d" % (lote, cont[lote])
        saida.append((nome, lote, m, x, texto(lote, desc, m, x, cont[lote], por, cols, decl, ddl)))
    return saida, tab, cols


def texto(lote, desc, modulo, linhas, n, por, cols, decl, ddl):
    nomes = [r["tabela"] for r in linhas]
    dentro = set(nomes)
    L = ["# Fatia F4 %s-%02d: %s, módulo %s (%d tabelas)" % (lote, n, desc, modulo or "sem módulo", len(linhas)), "",
         "Gerada por `tools/obra/fatiar_conector.py` (não editar à mão). Leia antes o brief comum "
         "`docs/obra/fatias/f4/brief.md`. Só metadado: nenhum valor de linha da origem.", "",
         "## 1. Mapa (trecho de `conector/mapa/tabelas.tsv`)", "", "```tsv", "\t".join(CAMPOS_MAPA)]
    L += ["\t".join(r.get(c, "") for c in CAMPOS_MAPA) for r in linhas]
    L += ["```", "", "## 2. Dependências de fora da fatia (já carregadas antes, pela ordem)", ""]
    fora = sorted({(r["tabela"], p) for r in linhas for p in (r["depende_de"] or "").split(",") if p and p not in dentro})
    if fora:
        L += ["| tabela | depende de | lote do pai | ordem do pai | destinos do pai |", "|---|---|---|---|---|"]
        L += ["| %s | %s | %s | %s | %s |" % (f, p, por[p]["lote"], por[p]["ordem"], por[p]["tabelas_destino"])
              for f, p in fora]
    else:
        L.append("Nenhuma.")
    L += ["", "## 3. Colunas de origem (de `conector/mapa/colunas.tsv`; regra e de-para gerados, a confirmar)", ""]
    for r in linhas:
        t = r["tabela"]
        L += ["### %s (%s registros na imagem de referência; chave %s; %s)" % (
            t, r["registros"], r["chave"] or "nenhuma", r["estrategia"]), "", "```tsv",
            "coluna\tforma\tobrigatoria\tregra\treferencia\tdepara"]
        L += ["\t".join(c[k] for k in ("coluna", "forma", "obrigatoria", "regra", "referencia", "depara"))
              for c in cols.get(t, [])]
        L.append("```")
        if decl.get(t):
            L += ["", "Já declaradas em `conector/mapa/declarado/colunas.tsv`:", "", "```tsv",
                  "coluna\tdestino\tregra\tdepara\tvia\tmotivo"]
            L += ["\t".join(c.get(k, "") for k in ("coluna", "destino", "regra", "depara", "via", "motivo"))
                  for c in decl[t]]
            L.append("```")
        L.append("")
    L += ["## 4. DDL de destino (de `db/migracoes`)", ""]
    vistos = []
    for r in linhas:
        for d in r["tabelas_destino"].split(";"):
            if d and d not in vistos:
                vistos.append(d)
    for d in vistos:
        x = ddl[d]
        L += ["### %s (`%s`)" % (d, x["arquivo"]), "", "```sql", x["create"]]
        L += x["alter"] + [f for f in x["fks"] if f not in x["alter"]]
        L += ["```", ""]
    return "\n".join(L).rstrip() + "\n"


def indice(fatias):
    linhas = ["fatia\tlote\tmodulo\ttabelas_n\tregistros\tbytes\ttabelas"]
    for nome, lote, m, x, txt in fatias:
        linhas.append("\t".join([nome, lote, m or "-", str(len(x)), str(sum(int(r["registros"] or 0) for r in x)),
                                 str(len(txt.encode())), ",".join(r["tabela"] for r in x)]))
    return "\n".join(linhas) + "\n"


def conferir(fatias, tab, cols):
    erros = []
    alvo = {r["tabela"] for r in tab if r["lote"] in ("L5", "L6", "L7", "L8") and r["tabelas_destino"]}
    vistas = [r["tabela"] for _, _, _, x, _ in fatias for r in x]
    if sorted(vistas) != sorted(alvo):
        erros.append("cobertura: %d tabelas nas fatias para %d dos lotes" % (len(vistas), len(alvo)))
    for nome, _, _, x, txt in fatias:
        for r in x:
            if "### %s (" % r["tabela"] not in txt or not cols.get(r["tabela"]):
                erros.append("%s: %s sem colunas" % (nome, r["tabela"]))
            for d in r["tabelas_destino"].split(";"):
                if "CREATE TABLE %s (" % d not in txt:
                    erros.append("%s: DDL de %s ausente" % (nome, d))
        arq = OUT / (nome + ".md")
        if not arq.exists() or arq.read_text(encoding="utf-8") != txt:
            erros.append("%s: arquivo diferente do gerado" % nome)
    if not (OUT / "indice.tsv").exists() or (OUT / "indice.tsv").read_text(encoding="utf-8") != indice(fatias):
        erros.append("indice.tsv diferente do gerado")
    return erros


def main():
    fatias, tab, cols = montar()
    if "--conferir" in sys.argv:
        erros = conferir(fatias, tab, cols)
        print("ok" if not erros else "\n".join(erros))
        return 1 if erros else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for velho in OUT.glob("L[5-8]-*.md"):
        velho.unlink()
    for nome, _, _, _, txt in fatias:
        (OUT / (nome + ".md")).write_text(txt, encoding="utf-8")
    (OUT / "indice.tsv").write_text(indice(fatias), encoding="utf-8")
    por = {}
    for _, lote, _, x, txt in fatias:
        a = por.setdefault(lote, [0, 0, 0])
        a[0] += 1
        a[1] += len(x)
        a[2] = max(a[2], len(txt.encode()))
    for lote in sorted(por):
        print("%s: %d fatias, %d tabelas, maior %d KB" % (lote, por[lote][0], por[lote][1], por[lote][2] // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
