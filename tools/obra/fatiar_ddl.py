"""Gera as fatias da modelagem física (F1.3), pelo protocolo de tokens.

uso: python3 -I tools/obra/fatiar_ddl.py

Para cada módulo do catálogo final, lotes de até ~45 tabelas (ou ~70 KB). Para cada tabela: a linha do
catálogo, as tabelas de origem que caem nela (MV e SPDATA) com as colunas e tipos (só metadado) e o
destino de mecanismo. Saída em docs/obra/fatias/ddl/: <NN>_<MOD>-<k>.md, indice.tsv e nucleo-hubs.txt.
"""
import csv
import re
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
OUT = RAIZ / "docs/obra/fatias/ddl"
OUT.mkdir(parents=True, exist_ok=True)
FIN = RAIZ / "docs/analise/rodada2/final"
ORDEM = ["SIS", "ADM", "CAD", "REC", "AGE", "PEP", "INT", "CC", "HOT", "SADT", "SUP", "FAT", "SUS", "FIN", "RH",
         "SGO", "INTG", "QUA", "REL"]
CONTRATOS = {
    "ADM": "acesso administracao auditoria parametros config menu assinatura documento-assinatura liberacao permissoes sessao.ts suporte",
    "SIS": "config implantacao sistema.ts suporte", "REL": "relatorio consultas prontidao",
    "CAD": "cadastro catalogo dominios rede pessoas", "REC": "recepcao atendimento inicio",
    "AGE": "agenda telemedicina", "PEP": "pep enfermagem documento problema.ts",
    "INT": "internacao", "CC": "cirurgia", "HOT": "hotelaria manutencao rouparia patrimonio",
    "SADT": "sadt", "SUP": "suprimentos farmacia", "FAT": "faturamento preco repasse portal-medico",
    "SUS": "faturamento", "FIN": "financeiro contabil custos orcamento patrimonio", "RH": "pessoas",
    "SGO": "operadora portal", "INTG": "integracao", "QUA": "qualidade",
}
FB = {7: "SMALLINT", 8: "INT", 16: "BIGINT", 10: "FLOAT", 27: "DOUBLE", 12: "DATE", 13: "TIME", 35: "TIMESTAMP",
      37: "VARCHAR", 14: "CHAR", 261: "BLOB", 23: "BOOLEAN"}


def ler(p):
    return list(csv.DictReader(open(p, encoding="utf-8", errors="replace"), delimiter="\t"))


def main():
    cat = ler(FIN / "catalogo.tsv")
    orig = defaultdict(list)  # tabela própria -> origens
    for nome, esq_fixo in (("mapa-mv.tsv", None), ("mapa-spdata.tsv", "SPDATA")):
        for r in ler(FIN / nome):
            if r["destino_tipo"] == "TABELA":
                for d in r["destino"].split(";"):
                    orig[d].append((r["esquema"], r["tabela"]))
    mvcols = defaultdict(list)
    for ln in open(RAIZ / "referencias/mv-colunas-raw.tsv", encoding="utf-8", errors="replace"):
        p = ln.rstrip("\n").split("\t")
        if len(p) == 3:
            mvcols[(p[0], p[1])].append(p[2])
    mvdesc = {(r["esquema"], r["tabela"]): r["descritivo"] for r in ler(RAIZ / "referencias/mv-tabelas.tsv")}
    spcols = defaultdict(list)
    for ln in open(RAIZ / "referencias/spdata-colunas-raw.txt", encoding="utf-8", errors="replace"):
        p = ln.strip().split("|")
        if len(p) != 6:
            continue
        t, c, ft, tam, esc, nn = p
        tipo = FB.get(int(ft), ft)
        if tipo in ("VARCHAR", "CHAR"):
            tipo += f"({tam})"
        elif int(esc or 0) < 0:
            tipo = f"NUMERIC(,{-int(esc)})"
        spcols[t].append(f"{c}:{tipo}{'!' if nn == '1' else ''}")
    spdesc = {r["tabela"]: f'{r["tela_funcao"]} | {r["descricao"]} | linhas {r["linhas"]}'
              for r in ler(RAIZ.parent / "new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv")}

    def bloco(r):
        L = [f"### {r['tabela']}  ({r['tipo']}, {r['fase']})", f"Descrição: {r['descricao']}"]
        if r.get("evidencia"):
            L.append(f"Evidência: {r['evidencia'][:300]}")
        for esq, t in orig.get(r["tabela"], [])[:8]:
            if esq == "SPDATA":
                cs = spcols.get(t, [])
                L.append(f"- SPDATA {t} [{spdesc.get(t, '')[:160]}]: " + " ".join(cs[:70]) +
                         (f" (+{len(cs) - 70})" if len(cs) > 70 else ""))
            else:
                cs = mvcols.get((esq, t), [])
                L.append(f"- MV {esq}.{t} [{(mvdesc.get((esq, t)) or '')[:120]}]: " + " ".join(cs[:70]) +
                         (f" (+{len(cs) - 70})" if len(cs) > 70 else ""))
        n = len(orig.get(r["tabela"], []))
        if n > 8:
            L.append(f"- (+{n - 8} origens; grep em docs/analise/rodada2/final/mapa-*.tsv)")
        return "\n".join(L) + "\n"

    por_mod = defaultdict(list)
    for r in cat:
        por_mod[r["modulo"]].append(r)
    indice = []
    for i, m in enumerate(ORDEM, 1):
        rows = sorted(por_mod.get(m, []), key=lambda r: r["tabela"])
        lotes, atual, tam = [], [], 0
        for r in rows:
            b = bloco(r)
            if atual and (len(atual) >= 45 or tam + len(b) > 70000):
                lotes.append(atual); atual, tam = [], 0
            atual.append((r, b)); tam += len(b)
        if atual:
            lotes.append(atual)
        for k, lote in enumerate(lotes, 1):
            nome = f"{i:02d}_{m}-{k:02d}"
            cab = [f"# Fatia {nome}: módulo {m}, {len(lote)} tabelas",
                   f"Pasta de saída: db/migracoes/{i:02d}_{m}/ — arquivos {k:02d}_tabelas.sql e {k:02d}_chaves.sql",
                   f"Contratos do new-sgh deste módulo (grep, não leia inteiro): "
                   + " ".join(f"../new-sgh/packages/contratos/src/{d}" for d in CONTRATOS.get(m, "").split()),
                   f"Tabelas deste lote: {', '.join(r['tabela'] for r, _ in lote)}", ""]
            (OUT / f"{nome}.md").write_text("\n".join(cab) + "\n".join(b for _, b in lote), encoding="utf-8")
            indice.append((nome, m, f"{i:02d}_{m}", k, len(lote)))
    with open(OUT / "indice.tsv", "w", encoding="utf-8") as f:
        f.write("lote\tmodulo\tpasta\tk\ttabelas\n")
        for x in indice:
            f.write("\t".join(map(str, x)) + "\n")
    # tabelas-eixo (principais F3 dos cadastros e do fluxo), para o brief
    hubs = sorted(r["tabela"] for r in cat if r["tipo"] == "principal" and r["modulo"] in
                  ("ADM", "CAD", "REC", "AGE", "INT", "FAT", "SUP", "PEP", "FIN") and r["fase"] == "F3")
    (OUT / "nucleo-hubs.txt").write_text("\n".join(hubs) + "\n", encoding="utf-8")
    with open(OUT / "catalogo-compacto.tsv", "w", encoding="utf-8") as f:
        for r in sorted(cat, key=lambda r: r["tabela"]):
            f.write(f"{r['tabela']}\t{r['modulo']}\t{r['tipo']}\n")
    print("lotes:", len(indice), "| hubs:", len(hubs), "| maior lote KB:",
          max((OUT / f"{x[0]}.md").stat().st_size for x in indice) // 1024)


if __name__ == "__main__":
    main()
