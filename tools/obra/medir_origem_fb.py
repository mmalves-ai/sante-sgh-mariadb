#!/usr/bin/env python3
"""Medição da base Firebird de origem (SPDATA) para o plano da F4. Só metadados e contagens.

Regras (AGENTS 3, 4 e 5):
- só lê: transação READ ONLY no isql; estatística por service manager (gstat remoto), que só lê páginas;
- não toca no container de origem: o cliente roda num container descartável da imagem
  firebirdsql/firebird:3.0.14-jammy, que fala com a porta de loopback;
- a senha vem do .env da pasta banco-dev, passada ao container por --env-file; nunca é lida aqui;
- nenhuma linha de dado é lida: só RDB$*, MON$DATABASE e o resumo do gstat (páginas, nº de registros,
  comprimento médio).

Uso (da raiz do sante-sgh):
  python3 -I tools/obra/medir_origem_fb.py meta   [--porta 3351] [--saida DIR]
  python3 -I tools/obra/medir_origem_fb.py stats  [--porta 3351] [--saida DIR]   # lê todas as páginas (~10 min)
  python3 -I tools/obra/medir_origem_fb.py resumo [--saida DIR] [--tsv referencias/spdata-volume-pc.tsv]
"""
import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict

IMAGEM = "firebirdsql/firebird:3.0.14-jammy"
BANCO = "/var/lib/firebird/data/pc.fdb"
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV = os.path.join(os.path.dirname(RAIZ), "banco-dev", ".env")

# largura em bytes por tipo do Firebird (RDB$FIELD_TYPE) quando não é texto
LARG = {7: 2, 8: 4, 16: 8, 10: 4, 27: 8, 12: 4, 13: 4, 35: 8, 23: 1, 261: 8}
NOME_TIPO = {7: "smallint", 8: "int", 16: "bigint", 10: "float", 27: "double", 12: "date", 13: "time",
             35: "timestamp", 14: "char", 37: "varchar", 261: "blob", 23: "boolean"}
# nomes de coluna que sugerem marca de alteração (para a estratégia de diferencial)
RE_ALT = re.compile(r"(ALT|ATUALIZ|MODIF|ULTALT|DTHR|LASTUPD|DTUPD)", re.I)


def docker(args_cli, entrada=None, timeout=3600):
    cmd = ["docker", "run", "--rm", "-i", "--network", "host", "--env-file", ENV,
           "--entrypoint", "bash", IMAGEM, "-c", args_cli]
    r = subprocess.run(cmd, input=entrada, capture_output=True, text=True, timeout=timeout,
                       encoding="latin-1")
    if r.returncode != 0 and not r.stdout:
        sys.exit("falha no cliente Firebird (rc=%d): %s" % (r.returncode, r.stderr[-400:]))
    return r.stdout


def isql(porta, sql):
    cli = ('/opt/firebird/bin/isql -q -ch NONE -u SYSDBA -p "$FB_PC_SENHA" 127.0.0.1/%d:%s'
           % (porta, BANCO))
    corpo = "SET HEADING OFF;\nSET TRANSACTION READ ONLY;\n" + sql
    return [l.strip() for l in docker(cli, corpo).splitlines() if "|" in l]


def meta(a):
    os.makedirs(a.saida, exist_ok=True)
    col = isql(a.porta, """
SELECT TRIM(rf.RDB$RELATION_NAME)||'|'||TRIM(rf.RDB$FIELD_NAME)||'|'||f.RDB$FIELD_TYPE||'|'||
       COALESCE(f.RDB$FIELD_LENGTH,0)||'|'||COALESCE(rf.RDB$NULL_FLAG,0)
  FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME=rf.RDB$FIELD_SOURCE
  JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME=rf.RDB$RELATION_NAME
 WHERE r.RDB$SYSTEM_FLAG=0 AND r.RDB$VIEW_BLR IS NULL AND f.RDB$COMPUTED_BLR IS NULL;
""")
    chv = isql(a.porta, """
SELECT TRIM(c.RDB$RELATION_NAME)||'|'||TRIM(c.RDB$CONSTRAINT_TYPE)||'|'||TRIM(s.RDB$FIELD_NAME)||'|'||
       s.RDB$FIELD_POSITION||'|'||TRIM(c.RDB$CONSTRAINT_NAME)
  FROM RDB$RELATION_CONSTRAINTS c JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME=c.RDB$INDEX_NAME
 WHERE c.RDB$CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE','FOREIGN KEY');
""")
    fk = isql(a.porta, """
SELECT TRIM(c.RDB$RELATION_NAME)||'|'||TRIM(p.RDB$RELATION_NAME)
  FROM RDB$RELATION_CONSTRAINTS c JOIN RDB$REF_CONSTRAINTS rc ON rc.RDB$CONSTRAINT_NAME=c.RDB$CONSTRAINT_NAME
  JOIN RDB$RELATION_CONSTRAINTS p ON p.RDB$CONSTRAINT_NAME=rc.RDB$CONST_NAME_UQ;
""")
    ger = isql(a.porta, """
SELECT 'G|'||COUNT(*) FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0;
SELECT 'T|'||COUNT(*) FROM RDB$TRIGGERS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0;
SELECT 'P|'||COUNT(*) FROM RDB$PROCEDURES WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0;
SELECT 'D|'||MON$PAGE_SIZE||'|'||MON$PAGES||'|'||MON$READ_ONLY FROM MON$DATABASE;
""")
    for nome, linhas in (("colunas", col), ("chaves", chv), ("fks", fk), ("geral", ger)):
        with open(os.path.join(a.saida, nome + ".txt"), "w") as f:
            f.write("\n".join(linhas) + "\n")
    print("meta: %d colunas, %d segmentos de chave, %d FKs; %s" % (len(col), len(chv), len(fk), " ".join(ger)))


def stats(a):
    os.makedirs(a.saida, exist_ok=True)
    cli = ('/opt/firebird/bin/fbsvcmgr 127.0.0.1/%d:service_mgr user SYSDBA password "$FB_PC_SENHA" '
           'action_db_stats dbname %s sts_data_pages sts_record_versions' % (a.porta, BANCO))
    out = docker(cli, "", timeout=4 * 3600)
    with open(os.path.join(a.saida, "gstat.txt"), "w") as f:
        f.write(out)
    print("stats: %d linhas de gstat gravadas" % out.count("\n"))


def ler_gstat(caminho):
    t, atual = {}, None
    for l in open(caminho, encoding="latin-1"):
        m = re.match(r"^(\S+) \((\d+)\)\s*$", l)
        if m:
            atual = m.group(1)
            t[atual] = {"reg": 0, "lmed": 0.0, "pag": 0, "blobs": 0, "blob_bytes": 0, "versoes": 0}
            continue
        if not atual:
            continue
        m = re.search(r"Average record length: ([\d.]+), total records: (\d+)", l)
        if m:
            t[atual]["lmed"], t[atual]["reg"] = float(m.group(1)), int(m.group(2))
        m = re.search(r"total versions: (\d+)", l)
        if m:
            t[atual]["versoes"] = int(m.group(1))
        m = re.search(r"Data pages: (\d+)", l)
        if m:
            t[atual]["pag"] = int(m.group(1))
        m = re.search(r"Blobs: (\d+), total length: (\d+)", l)
        if m:
            t[atual]["blobs"], t[atual]["blob_bytes"] = int(m.group(1)), int(m.group(2))
    return t


def resumo(a):
    larg, ncol, alt, ts = defaultdict(int), defaultdict(int), defaultdict(list), defaultdict(int)
    for l in open(os.path.join(a.saida, "colunas.txt")):
        rel, campo, tipo, tam, _ = l.strip().split("|")
        tipo, tam = int(tipo), int(tam)
        larg[rel] += tam if tipo in (14, 37) else LARG.get(tipo, 8)
        ncol[rel] += 1
        if tipo in (12, 35) and RE_ALT.search(campo):
            alt[rel].append(campo)
        if tipo in (12, 35):
            ts[rel] += 1
    pk, pkint = defaultdict(list), {}
    tipos = {}
    for l in open(os.path.join(a.saida, "colunas.txt")):
        rel, campo, tipo, _, _ = l.strip().split("|")
        tipos[(rel, campo)] = int(tipo)
    for l in open(os.path.join(a.saida, "chaves.txt")):
        rel, ct, campo, _, _ = l.strip().split("|")
        if ct == "PRIMARY KEY":
            pk[rel].append(campo)
    for rel, cs in pk.items():
        pkint[rel] = len(cs) == 1 and tipos.get((rel, cs[0])) in (7, 8, 16)
    deps = defaultdict(set)
    for l in open(os.path.join(a.saida, "fks.txt")):
        f, p = l.strip().split("|")
        if f != p:
            deps[f].add(p)
    g = ler_gstat(os.path.join(a.saida, "gstat.txt"))
    tabs = sorted(set(larg) | set(g), key=lambda r: -g.get(r, {}).get("reg", 0))
    com = [r for r in tabs if g.get(r, {}).get("reg", 0) > 0]
    tot = sum(g[r]["reg"] for r in com)
    pag = sum(g[r]["pag"] for r in com)
    blob = sum(g[r]["blob_bytes"] for r in com)
    if a.tsv:
        with open(a.tsv, "w") as f:
            f.write("tabela\tregistros\tpaginas_dados\tlarg_media_gstat\tlarg_ddl\tcolunas\tblob_bytes\t"
                    "pk\tpk_inteira_unica\tcol_data\tcol_alteracao\tdepende_de\n")
            for r in tabs:
                d = g.get(r, {})
                f.write("\t".join(map(str, [r, d.get("reg", 0), d.get("pag", 0), round(d.get("lmed", 0), 1),
                        larg[r], ncol[r], d.get("blob_bytes", 0), ",".join(pk.get(r, [])),
                        "S" if pkint.get(r) else "N", ts[r], ",".join(alt[r]),
                        ",".join(sorted(deps[r]))])) + "\n")
    print("tabelas no dicionário: %d; com registros: %d; registros: %d; páginas de dados: %d (%.1f GB); "
          "blobs: %.1f GB" % (len(larg), len(com), tot, pag, pag * 8192 / 1e9, blob / 1e9))
    print("com PK: %d (inteira única: %d); com coluna de data de alteração: %d; com FK declarada: %d"
          % (sum(1 for r in com if pk.get(r)), sum(1 for r in com if pkint.get(r)),
             sum(1 for r in com if alt[r]), sum(1 for r in com if deps[r])))
    faixas = [(10**7, None), (10**6, 10**7), (10**5, 10**6), (10**4, 10**5), (1, 10**4)]
    for lo, hi in faixas:
        sel = [r for r in com if g[r]["reg"] >= lo and (hi is None or g[r]["reg"] < hi)]
        print("faixa >=%d%s: %d tabelas, %d registros" % (lo, "" if hi is None else " <%d" % hi, len(sel),
              sum(g[r]["reg"] for r in sel)))
    print("top %d:" % a.top)
    for r in com[:a.top]:
        d = g[r]
        print("%-22s %11d reg  %8.1f MB dados  lmed %6.1f  ddl %5d  blob %7.1f MB  pk=%s%s alt=%s" % (
            r, d["reg"], d["pag"] * 8192 / 1e6, d["lmed"], larg[r], d["blob_bytes"] / 1e6,
            "+".join(pk.get(r, [])) or "-", "(int)" if pkint.get(r) else "", ",".join(alt[r]) or "-"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("modo", choices=["meta", "stats", "resumo"])
    p.add_argument("--porta", type=int, default=3351)
    p.add_argument("--saida", default=os.path.join(RAIZ, "tools/obra/.medicao-fb"))
    p.add_argument("--tsv")
    p.add_argument("--top", type=int, default=30)
    a = p.parse_args()
    {"meta": meta, "stats": stats, "resumo": resumo}[a.modo](a)


if __name__ == "__main__":
    main()
