"""Gera as fatias da rodada 2 da análise (rastreio tabela a tabela), pelo protocolo de tokens.

uso: python3 -I tools/obra/fatiar_rodada2.py <raiz_sante_sgh> <raiz_new_sgh>

Saída em docs/obra/fatias/rodada2/:
  mv-NN.tsv        lotes de tabelas do MV (esquema, tabela, bloco, tem_dados, ncol, descritivo, colunas)
  spdata-GG.tsv    tabelas com dados do SPDATA por grupo (da matriz de 1.503)
  sementes-GG.tsv  entidades propostas na rodada 1 por grupo (entidade, funcionalidade, decisão)
  conflitos.md     seções 2.2 e 2.3 do crítico da rodada 1 (mesma entidade em dois grupos, mesmo conceito)
  areas-sem-dono.md seção 1 do crítico (áreas para o grupo 10)
  indice.tsv       lote -> bloco, quantidade, primeiras e últimas tabelas
Só metadados. Nenhum conteúdo de linha.
"""
import csv
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

RAIZ = Path(sys.argv[1]).resolve()
NEW = Path(sys.argv[2]).resolve()
OUT = RAIZ / "docs/obra/fatias/rodada2"
OUT.mkdir(parents=True, exist_ok=True)

GRUPOS = OrderedDict([
    ("01", ("administracao", ["ADM", "SIS", "REL"])),
    ("02", ("cadastro-recepcao-agenda", ["CAD", "REC", "AGE"])),
    ("03", ("prontuario", ["PEP"])),
    ("04", ("internacao-cirurgia-hotelaria", ["INT", "CC", "HOT"])),
    ("05", ("diagnostico-suprimentos", ["SADT", "SUP"])),
    ("06", ("faturamento", ["FAT", "SUS"])),
    ("07", ("financeiro-pessoas", ["FIN", "RH"])),
    ("08", ("operadora-integracoes", ["SGO", "INTG"])),
    ("10", ("qualidade-seguranca", ["QUA"])),
])


def bloco(esq: str, tab: str) -> str:
    if esq == "DBAPS":
        return "operadora"
    if esq == "DBADW":
        return "datawarehouse"
    if esq == "MVINTEGRA" or re.match(r"^(IMV_|INTEGRA_)", tab):
        return "integracao"
    if re.match(r"^(LOG_|AUDIT|HIST_|LOG)|_(LOG|HIST|HISTORICO)$", tab):
        return "log-historico"
    if re.match(r"^(TROCPAC_|BKP)|_(BKP|OLD)$", tab):
        return "copia"
    if re.match(r"^(CONFIG|CONFIGURACAO|PARAM|PARAMETRO)", tab):
        return "configuracao"
    if re.match(r"^(RMI_|EDITOR_|GCM_|VERSAO|PW_QRTZ|BATCH_|REPORTS_|MENU_|CG_)", tab) or esq in (
            "DBASGU", "DBACP", "MVBIKE", "DBATUALIZA", "GCMMV", "MVONEPASS", "CARTORIO"):
        return "tecnico"
    return "negocio"


def main() -> None:
    # colunas do MV
    cols = defaultdict(list)
    with open(RAIZ / "dump/mv-colunas-raw.tsv", encoding="utf-8", errors="replace") as f:
        for ln in f:
            p = ln.rstrip("\n").split("\t")
            if len(p) == 3:
                cols[(p[0], p[1])].append(p[2])
    tabs = list(csv.DictReader(open(RAIZ / "referencias/mv-tabelas.tsv", encoding="utf-8", errors="replace"),
                               delimiter="\t"))
    por_bloco = defaultdict(list)
    for r in tabs:
        b = bloco(r["esquema"], r["tabela"])
        c = " ".join(cols.get((r["esquema"], r["tabela"]), []))
        if len(c) > 900:
            c = c[:900] + " ..."
        por_bloco[b].append([r["esquema"], r["tabela"], b, r["tem_dados"], r["colunas"],
                             (r["descritivo"] or "")[:200], c])
    # lotes: negócio e operadora em lotes de ~220 (ordenados por esquema e nome, para manter
    # famílias juntas); os demais blocos juntos em lotes de ~400
    lotes = []
    for b, tam in (("negocio", 220), ("operadora", 230)):
        rows = sorted(por_bloco[b], key=lambda x: (x[0], x[1]))
        n = max(1, round(len(rows) / tam))
        passo = -(-len(rows) // n)
        lotes += [rows[i:i + passo] for i in range(0, len(rows), passo)]
    resto = sorted([r for b, v in por_bloco.items() if b not in ("negocio", "operadora") for r in v],
                   key=lambda x: (x[2], x[0], x[1]))
    n = max(1, round(len(resto) / 400))
    passo = -(-len(resto) // n)
    lotes += [resto[i:i + passo] for i in range(0, len(resto), passo)]
    cab = ["esquema", "tabela", "bloco", "tem_dados", "ncol", "descritivo", "colunas"]
    indice = []
    for i, lote in enumerate(lotes, 1):
        nome = f"mv-{i:02d}.tsv"
        with open(OUT / nome, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="\t", lineterminator="\n")
            w.writerow(cab)
            w.writerows(lote)
        blocos = sorted({r[2] for r in lote})
        indice.append([nome, ",".join(blocos), len(lote), f"{lote[0][0]}.{lote[0][1]}", f"{lote[-1][0]}.{lote[-1][1]}"])
    with open(OUT / "indice.tsv", "w", encoding="utf-8") as f:
        f.write("lote\tblocos\ttabelas\tprimeira\tultima\n")
        for r in indice:
            f.write("\t".join(map(str, r)) + "\n")

    # SPDATA por grupo
    mat = list(csv.DictReader(open(NEW / "planejamento/referencias/matriz-cobertura-1503-tabelas.tsv",
                                   encoding="utf-8"), delimiter="\t"))
    mod2g = {m: g for g, (_, ms) in GRUPOS.items() for m in ms}
    sp = defaultdict(list)
    for r in mat:
        sp[mod2g.get(r["modulo"], "01")].append(r)
    for g, rows in sp.items():
        with open(OUT / f"spdata-{g}.tsv", "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="\t", lineterminator="\n")
            w.writerow(["tabela", "linhas", "modulo", "tela_funcao", "natureza", "destino_matriz", "descricao"])
            for r in rows:
                w.writerow([r["tabela"], r["linhas"], r["modulo"], r["tela_funcao"], r["natureza"], r["destino"],
                            r["descricao"]])

    # sementes da rodada 1 (última coluna das tabelas de matriz dos arquivos 0N)
    an = RAIZ / "docs/analise"
    for g, (nome, _) in GRUPOS.items():
        arq = an / f"{g}-{nome}.md"
        linhas = []
        if arq.exists():
            for ln in arq.read_text(encoding="utf-8").splitlines():
                if not ln.startswith("|") or ln.startswith("|---") or "Funcionalidade" in ln:
                    continue
                c = [x.strip() for x in ln.strip().strip("|").split("|")]
                if len(c) >= 6:
                    dec = next((x for x in c if re.fullmatch(r"\**(F3|F7|F8|NAO)\**.*", x)), "")
                    linhas.append([c[0][:120], re.sub(r"\*", "", dec)[:12], c[-1][:400]])
        with open(OUT / f"sementes-{g}.tsv", "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="\t", lineterminator="\n")
            w.writerow(["funcionalidade", "decisao", "entidades_rodada1"])
            w.writerows(linhas)

    crit = (an / "09-completude.md").read_text(encoding="utf-8")
    i1, i2, i3 = crit.find("## 1."), crit.find("## 2."), crit.find("## 3.")
    (OUT / "areas-sem-dono.md").write_text(crit[i1:i2], encoding="utf-8")
    j = crit.find("### 2.2")
    (OUT / "conflitos.md").write_text(crit[j:i3], encoding="utf-8")

    print("lotes MV:", len(lotes), {b: len(v) for b, v in por_bloco.items()})
    print("SPDATA por grupo:", {g: len(v) for g, v in sorted(sp.items())})
    print("sementes:", {g: sum(1 for _ in open(OUT / f'sementes-{g}.tsv')) - 1 for g in GRUPOS})


if __name__ == "__main__":
    main()
