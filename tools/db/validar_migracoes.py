"""Valida as migrações num banco vazio (determinístico; protocolo de tokens, regra 7).

uso: python3 -I tools/db/validar_migracoes.py [--banco validacao] [--manter]

1. Recria o banco; aplica todos os */*_tabelas.sql (em ordem) e depois todos os */*_chaves.sql.
   Cada arquivo roda com --force, e os erros são atribuídos ao arquivo.
2. Confere no information_schema, contra docs/analise/rodada2/final/catalogo.tsv:
   tabela do catálogo ausente; tabela fora do catálogo; PK id BIGINT UNSIGNED AUTO_INCREMENT; colunas de
   auditoria; comentário da tabela; nomes (snake_case, sem prefixo críptico de origem); gatilhos;
   colunas *_id sem FK (aviso).
3. Banco plataforma: aplica db/plataforma/*.sql DUAS vezes num banco de validação (idempotência) e confere PK,
   auditoria, comentário, nomes e gatilhos (erros em "plataforma"); o mesmo para db/espelho/*.sql (controle do
   espelho padrão da base).
Saídas: docs/obra/validacao-ddl.md (resumo) e docs/obra/validacao-ddl.json (erros por arquivo e por tabela).
Sai com 1 se houver erro.
"""
import csv
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
MIG = RAIZ / "db/migracoes"
BANCO = sys.argv[sys.argv.index("--banco") + 1] if "--banco" in sys.argv else "validacao"
MANTER = "--manter" in sys.argv
NUCLEO = {"trilha_auditoria", "sequencia_negocio", "arquivo", "pendencia", "integracao_mensagem",
          "idempotencia_operacao"}
AUDIT = ["criado_em", "criado_por", "alterado_em", "alterado_por", "versao"]
NOME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
CRIPTICO = re.compile(r"^(cd|sn|tp|ds|dt|nr|qt|vl|hr|nm|id_|fl|st|cod|dsc)_")
PROIBIDO = re.compile(r"(^|_)(mv|soul|spdata)(_|$)")
SEM_FK_OK = re.compile(r"^(entidade_id|criado_por|alterado_por|excluido_por|resolvida_por|usuario_id_externo|"
                       r".*_externo_id|correlacao_id|referencia_id|origem_id)$")


def sql(banco: str | None, entrada: str | None = None, *args: str) -> subprocess.CompletedProcess:
    cmd = [str(SQL)] + ([banco] if banco else []) + list(args)
    return subprocess.run(cmd, input=entrada, capture_output=True, text=True)


def consulta(q: str) -> list[list[str]]:
    r = sql(BANCO, None, "-N", "-B", "-e", q)
    if r.returncode != 0:
        raise SystemExit(f"consulta falhou: {r.stderr[:500]}")
    return [ln.split("\t") for ln in r.stdout.splitlines() if ln]


def validar_plataforma(pasta: str = "plataforma") -> list[str]:
    """db/<pasta>/*.sql num banco vazio, duas vezes (idempotente), com as mesmas regras estruturais. Vale para o
    banco da plataforma e para as tabelas de controle do espelho padrão da base (db/espelho)."""
    banco = f"{BANCO}_{pasta}"
    sql(None, None, "-e", f"DROP DATABASE IF EXISTS {banco}; CREATE DATABASE {banco}")
    erros = []
    for rodada in (1, 2):
        for arq in sorted((RAIZ / "db" / pasta).glob("*.sql")):
            r = sql(banco, arq.read_text(encoding="utf-8"), "--force")
            erros += [f"{arq.name} (rodada {rodada}): {ln.strip()[:200]}" for ln in r.stderr.splitlines() if ln.strip()]
    tabelas = consulta(f"select table_name, table_comment from information_schema.tables where table_schema='{banco}'")
    cols = defaultdict(dict)
    for tb, c, tipo, extra, chave in consulta(
            f"select table_name, column_name, column_type, extra, column_key from information_schema.columns "
            f"where table_schema='{banco}'"):
        cols[tb][c] = (tipo, extra, chave)
    for tb, comentario in tabelas:
        c = cols[tb]
        if "id" not in c or "unsigned" not in c["id"][0] or "auto_increment" not in c["id"][1] or c["id"][2] != "PRI":
            erros.append(f"{tb}: PK id BIGINT UNSIGNED AUTO_INCREMENT ausente ou errada")
        erros += [f"{tb}: coluna de auditoria ausente: {a}" for a in AUDIT if a not in c]
        if not comentario.strip():
            erros.append(f"{tb}: tabela sem COMMENT")
        erros += [f"{tb}: nome inválido: {n}" for n in [tb, *c] if not NOME.match(n) or PROIBIDO.search(n)]
    if consulta(f"select trigger_name from information_schema.triggers where trigger_schema='{banco}'"):
        erros.append(f"gatilhos no banco {pasta}")
    if not MANTER:
        sql(None, None, "-e", f"DROP DATABASE IF EXISTS {banco}")
    return erros


def main() -> int:
    sql(None, None, "-e", f"DROP DATABASE IF EXISTS {BANCO}; CREATE DATABASE {BANCO}")
    erros_arq = defaultdict(list)
    for sufixo in ("_tabelas.sql", "_chaves.sql"):
        for arq in sorted(MIG.glob(f"*/*{sufixo}")):
            r = sql(BANCO, arq.read_text(encoding="utf-8"), "--force")
            for ln in r.stderr.splitlines():
                if ln.strip():
                    erros_arq[str(arq.relative_to(RAIZ))].append(ln.strip()[:300])
    cat = {r["tabela"]: r for r in csv.DictReader(
        open(RAIZ / "docs/analise/rodada2/final/catalogo.tsv", encoding="utf-8"), delimiter="\t")}
    tabelas = {t: c for t, c in consulta(
        f"select table_name, table_comment from information_schema.tables where table_schema='{BANCO}'")}
    cols = defaultdict(dict)
    for t, c, tipo, extra, chave in consulta(
            f"select table_name, column_name, column_type, extra, column_key from information_schema.columns "
            f"where table_schema='{BANCO}'"):
        cols[t][c] = (tipo, extra, chave)
    fks = defaultdict(set)
    for t, c in consulta(f"select table_name, column_name from information_schema.key_column_usage "
                         f"where table_schema='{BANCO}' and referenced_table_name is not null"):
        fks[t].add(c)
    gatilhos = consulta(f"select trigger_name from information_schema.triggers where trigger_schema='{BANCO}'")

    erros_tab = defaultdict(list)
    avisos_tab = defaultdict(list)
    faltam = sorted(set(cat) - set(tabelas))
    sobram = sorted(set(tabelas) - set(cat) - NUCLEO)
    for t in sobram:
        erros_tab[t].append("tabela fora do catálogo")
    for t, comentario in tabelas.items():
        c = cols[t]
        if "id" not in c or not c["id"][0].startswith("bigint") or "unsigned" not in c["id"][0] \
                or "auto_increment" not in c["id"][1] or c["id"][2] != "PRI":
            erros_tab[t].append("PK id BIGINT UNSIGNED AUTO_INCREMENT ausente ou errada")
        for a in AUDIT:
            if a not in c:
                erros_tab[t].append(f"coluna de auditoria ausente: {a}")
        if not comentario.strip():
            erros_tab[t].append("tabela sem COMMENT")
        if not NOME.match(t) or PROIBIDO.search(t):
            erros_tab[t].append("nome de tabela inválido")
        for col in c:
            if not NOME.match(col) or PROIBIDO.search(col):
                erros_tab[t].append(f"nome de coluna inválido: {col}")
            elif CRIPTICO.match(col):
                erros_tab[t].append(f"coluna com prefixo críptico de origem: {col}")
            if col.endswith("_id") and col != "id" and col not in fks[t] and not SEM_FK_OK.match(col):
                avisos_tab[t].append(f"{col} sem FK")
    if gatilhos:
        erros_tab["(banco)"].append(f"gatilhos encontrados: {[g[0] for g in gatilhos]}")

    erros_plataforma = validar_plataforma() + validar_plataforma("espelho")
    total_erros = sum(len(v) for v in erros_arq.values()) + sum(len(v) for v in erros_tab.values()) + len(faltam) \
        + len(erros_plataforma)
    resumo = {
        "banco": BANCO, "tabelas_criadas": len(tabelas), "catalogo": len(cat), "faltam": len(faltam),
        "fora_catalogo": len(sobram), "arquivos_com_erro": len(erros_arq),
        "erros_sql": sum(len(v) for v in erros_arq.values()), "tabelas_com_erro": len(erros_tab),
        "colunas_id_sem_fk": sum(len(v) for v in avisos_tab.values()),
        "fks": sum(len(v) for v in fks.values()), "gatilhos": len(gatilhos),
        "plataforma_erros": len(erros_plataforma), "total_erros": total_erros,
    }
    (RAIZ / "docs/obra").mkdir(parents=True, exist_ok=True)
    (RAIZ / "docs/obra/validacao-ddl.json").write_text(json.dumps({
        "resumo": resumo, "faltam": faltam, "plataforma": erros_plataforma, "erros_arquivo": erros_arq, "erros_tabela": erros_tab,
        "avisos_tabela": avisos_tab}, ensure_ascii=False, indent=1), encoding="utf-8")
    L = ["# Validação do DDL", "", "| Item | Valor |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in resumo.items()]
    L += ["", "## Erros por arquivo (até 5 por arquivo)", ""]
    for a, es in sorted(erros_arq.items()):
        L.append(f"- `{a}`: {len(es)} erro(s). " + " / ".join(es[:5]))
    L += ["", f"## Tabelas do catálogo sem CREATE ({len(faltam)})", "", ", ".join(faltam[:400])]
    (RAIZ / "docs/obra/validacao-ddl.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    if not MANTER:
        sql(None, None, "-e", f"DROP DATABASE IF EXISTS {BANCO}")
    print(json.dumps(resumo, ensure_ascii=False))
    return 1 if total_erros else 0


if __name__ == "__main__":
    sys.exit(main())
