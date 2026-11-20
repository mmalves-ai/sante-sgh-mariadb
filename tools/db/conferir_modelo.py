"""Conferência de qualidade do modelo (além do validador): regras por tipo de tabela e boas práticas.

uso: python3 -I tools/db/conferir_modelo.py [--banco validacao]
Pré-requisito: o banco já validado (tools/db/validar_migracoes.py --manter).
Imprime um resumo por regra (contagem e até 8 exemplos) e grava docs/obra/conferencia-modelo.md.
"""
import csv
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = sys.argv[sys.argv.index("--banco") + 1] if "--banco" in sys.argv else "validacao"


def q(sql):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), BANCO, "-N", "-B", "-e", sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[:400])
    return [l.split("\t") for l in r.stdout.splitlines() if l]


cat = {r["tabela"]: r for r in csv.DictReader(open(RAIZ / "docs/analise/rodada2/final/catalogo.tsv", encoding="utf-8"), delimiter="\t")}
cols = defaultdict(dict)
for t, c, tipo, nulo, chave in q(f"select table_name,column_name,column_type,is_nullable,column_key from information_schema.columns where table_schema='{BANCO}'"):
    cols[t][c] = (tipo, nulo, chave)
fk = defaultdict(dict)   # tabela -> coluna -> alvo
regra_del = {}
for t, c, alvo, nome in q(f"select k.table_name,k.column_name,k.referenced_table_name,k.constraint_name from information_schema.key_column_usage k where k.table_schema='{BANCO}' and k.referenced_table_name is not null"):
    fk[t][c] = alvo
for nome, regra in q(f"select constraint_name, delete_rule from information_schema.referential_constraints where constraint_schema='{BANCO}'"):
    regra_del[nome] = regra
uniq = defaultdict(list)
for t, nome, c in q(f"select table_name,index_name,group_concat(column_name order by seq_in_index) from information_schema.statistics where table_schema='{BANCO}' and non_unique=0 and index_name<>'PRIMARY' group by table_name,index_name"):
    uniq[t].append(c.split(","))
checks = defaultdict(list)
for t, nome in q(f"select table_name, constraint_name from information_schema.table_constraints where constraint_schema='{BANCO}' and constraint_type='CHECK'"):
    checks[t].append(nome)
referenciada = defaultdict(int)
for t in fk:
    for alvo in fk[t].values():
        referenciada[alvo] += 1

R = defaultdict(list)
DINHEIRO = re.compile(r"(valor|preco|custo|saldo|total|desconto|acrescimo|tarifa|honorario)")
for t, r in cat.items():
    c, tipo = cols.get(t, {}), r["tipo"]
    if tipo == "item":
        pais = [a for a in fk[t].values() if t.startswith(a + "_") or a in t]
        if not fk[t]:
            R["item sem nenhuma FK"].append(t)
        elif not any(cols[t].get(col, ("", "YES"))[1] == "NO" for col in fk[t]):
            R["item sem FK obrigatória (NOT NULL) para o pai"].append(t)
    if tipo == "historico":
        if "operacao" not in c: R["histórico sem coluna operacao"].append(t)
        if not fk[t]: R["histórico sem FK para a tabela de origem"].append(t)
    if tipo == "dominio":
        if "codigo" not in c: R["domínio sem coluna codigo"].append(t)
        elif not any(u == ["codigo"] or u[-1] == "codigo" for u in uniq[t]): R["domínio sem UNIQUE no codigo"].append(t)
        if "ativo" not in c: R["domínio sem ativo"].append(t)
    if tipo == "vinculo" and len(fk[t]) < 2:
        R["vínculo com menos de 2 FKs"].append(t)
    if tipo == "vinculo" and not uniq[t]:
        R["vínculo sem UNIQUE do par"].append(t)
    if tipo in ("principal", "item", "vinculo") and "excluido_em" not in c:
        R["principal/item/vínculo sem excluido_em"].append(t)
    if tipo in ("principal", "item") and "origem" not in c:
        R["principal/item sem origem"].append(t)
    if tipo == "principal" and r["modulo"] not in ("CAD", "ADM", "SIS", "SGO", "RH", "INTG", "QUA", "REL") and "estabelecimento_id" not in c:
        R["principal operacional sem estabelecimento_id"].append(t)
    if tipo == "catalogo_publico" and not any(x.startswith("codigo") for x in c):
        R["catálogo público sem coluna codigo_*"].append(t)
    if not fk[t] and referenciada[t] == 0 and tipo not in ("dominio", "catalogo_publico", "configuracao"):
        R["tabela isolada (sem FK e sem ser referenciada)"].append(t)
    for col, (ct, nulo, _) in c.items():
        if ct.startswith(("float", "double")) and DINHEIRO.search(col):
            R["dinheiro em FLOAT/DOUBLE"].append(f"{t}.{col}")
        if ct.startswith("enum"):
            R["ENUM"].append(f"{t}.{col}")
for nome, regra in regra_del.items():
    if regra == "CASCADE":
        R["ON DELETE CASCADE"].append(nome)

L = ["# Conferência de qualidade do modelo", "", f"Banco: `{BANCO}`; tabelas do catálogo: {len(cat)}; FKs: {sum(len(v) for v in fk.values())}; "
     f"tabelas com CHECK: {len(checks)}; com UNIQUE além da PK: {len(uniq)}", "", "| Regra | Ocorrências | Exemplos |", "|---|---:|---|"]
for k in sorted(R, key=lambda k: -len(R[k])):
    L.append(f"| {k} | {len(R[k])} | {', '.join(R[k][:8])} |")
if not R:
    L.append("| (nenhuma violação) | 0 | |")
(RAIZ / "docs/obra/conferencia-modelo.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("\n".join(L))
