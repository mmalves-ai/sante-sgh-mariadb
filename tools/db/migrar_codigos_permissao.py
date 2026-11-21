"""Migração dos perfis já gravados quando um código de permissão do produto é renomeado (F2.4, padrão em
docs/obra/fatias/f24/saida/padroes.md). A lista vem de conector/mapa/permissoes-renomeadas.tsv
(codigo_antigo, codigo_novo, descricao_nova, motivo).

Por cliente registrado na plataforma (ou só o informado), numa transação:
- só o antigo existe: renomeia a linha de acao_sistema no lugar (perfil_acao e usuario_acao_excecao seguem pelo id);
- os dois existem (o carregador já incluiu o novo): move perfil_acao e usuario_acao_excecao do antigo para o novo
  (o par que já existir no novo fica como está) e inativa o antigo (nada é apagado: a auditoria aponta para ele);
- só o novo existe: nada a fazer.
Rode ANTES de tools/db/carregar_acoes.py, que inativaria o antigo e incluiria o novo sem os perfis.

uso: python3 -I tools/db/migrar_codigos_permissao.py [--cliente CODIGO] [--aplicar]
Sem --aplicar só conta (simulação). A saída é só de contagens, uma linha JSON por cliente.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
RENOMES = RAIZ / "conector/mapa/permissoes-renomeadas.tsv"
PLAT = re.sub(r"[^a-z0-9_]", "", os.environ.get("PLATAFORMA_BANCO", "plataforma")) or "plataforma"
BANCO_OK = re.compile(r"cliente_[a-z][a-z0-9_]{1,39}")


def q(texto: str) -> str:
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def sql(banco: str | None, entrada: str | None = None, *args: str) -> str:
    r = subprocess.run([str(SQL), *([banco] if banco else []), *args], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"migração de códigos: {r.stderr.strip()[:300]}")
    return r.stdout


def renomes() -> list[tuple[str, str, str]]:
    linhas = RENOMES.read_text(encoding="utf-8").splitlines()[1:]
    out = []
    for l in linhas:
        p = l.split("\t")
        if len(p) >= 3 and p[0] and p[1]:
            out.append((p[0], p[1], p[2]))
    return out


def clientes(so: str | None) -> list[tuple[str, str]]:
    filtro = f" where codigo={q(so)}" if so else ""
    saida = sql(PLAT, None, "-N", "-e", f"select codigo, banco_nome from cliente{filtro} order by codigo")
    out = [tuple(l.split("\t")) for l in saida.strip().splitlines() if l]
    return [(c, b) for c, b in out if BANCO_OK.fullmatch(b)]


def migrar(banco: str, lista: list[tuple[str, str, str]], aplicar: bool) -> dict:
    cont = {"renomeadas": 0, "fundidas": 0, "perfis_movidos": 0, "excecoes_movidas": 0, "ja_no_padrao": 0}
    partes = ["SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES');", "START TRANSACTION;"]
    for antigo, novo, desc in lista:
        ids = sql(banco, None, "-N", "-e",
                  f"select (select id from acao_sistema where codigo={q(antigo)}),"
                  f" (select id from acao_sistema where codigo={q(novo)}),"
                  f" (select count(*) from perfil_acao pa join acao_sistema a on a.id=pa.acao_sistema_id where a.codigo={q(antigo)}),"
                  f" (select count(*) from usuario_acao_excecao e join acao_sistema a on a.id=e.acao_sistema_id where a.codigo={q(antigo)})")
        v, n, perfis, exc = (x for x in ids.strip().split("\t"))
        if v == "NULL":
            cont["ja_no_padrao"] += 1
            continue
        cont["perfis_movidos"] += int(perfis)
        cont["excecoes_movidas"] += int(exc)
        agora = "UTC_TIMESTAMP(3)"
        if n == "NULL":
            cont["renomeadas"] += 1
            partes.append(f"UPDATE acao_sistema SET codigo={q(novo)}, descricao={q(desc)}, versao=versao+1,"
                          f" alterado_em={agora} WHERE id={int(v)};")
        else:
            cont["fundidas"] += 1
            partes += [
                f"UPDATE IGNORE perfil_acao SET acao_sistema_id={int(n)}, versao=versao+1, alterado_em={agora}"
                f" WHERE acao_sistema_id={int(v)};",
                f"UPDATE IGNORE usuario_acao_excecao SET acao_sistema_id={int(n)}, versao=versao+1, alterado_em={agora}"
                f" WHERE acao_sistema_id={int(v)};",
                f"UPDATE acao_sistema SET ativo=FALSE, versao=versao+1, alterado_em={agora} WHERE id={int(v)};",
            ]
    partes.append("COMMIT;")
    if aplicar and (cont["renomeadas"] or cont["fundidas"]):
        sql(banco, "\n".join(partes) + "\n")
    return cont


def main() -> None:
    a = sys.argv[1:]
    so = a[a.index("--cliente") + 1] if "--cliente" in a else None
    if so is not None and not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", so):
        raise SystemExit(__doc__)
    aplicar = "--aplicar" in a
    lista = renomes()
    for codigo, banco in clientes(so):
        existe = sql(None, None, "-N", "-e",
                     f"select count(*) from information_schema.tables where table_schema={q(banco)} and table_name='acao_sistema'")
        if existe.strip() != "1":
            print(json.dumps({"cliente": codigo, "situacao": "sem acao_sistema"}, ensure_ascii=False))
            continue
        print(json.dumps({"cliente": codigo, "modo": "aplicado" if aplicar else "simulacao",
                          **migrar(banco, lista, aplicar)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
