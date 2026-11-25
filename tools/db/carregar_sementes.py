"""Sementes dos domínios básicos de um cliente (F2.4): os vocabulários do modelo que o produto consulta por código fixo
(cores da classificação de risco, ações do fluxo da senha, situações da marcação, da checagem e do pedido de leito,
tipos de transfusão e de reação, parâmetros vitais...) e os do cadastro de pessoa (sexo, estado civil, documento,
telefone, endereço, parentesco). Sem elas, a operação recusa com "não cadastrado".

Não entram aqui: catálogos oficiais (TUSS, SIGTAP, CID-10... têm carregador em catalogos/), licenciados (só por
hospital com licença) e o catálogo de ações do sistema (tools/db/carregar_acoes.py).

As sementes ficam em db/sementes/*.json ({"tabela": [linha, ...]}, na ordem dos arquivos), com a chave natural
`codigo`. A carga é idempotente e nunca sobrescreve o cliente: o que já existe com o mesmo código (inclusive o que o
cliente editou ou inativou, ou o que o conector importou) fica como está; só o que falta é incluído. Tudo numa
transação: erro em uma linha, nada gravado.

uso: python3 -I tools/db/carregar_sementes.py <codigo-cliente> [--conferir]
     (--conferir só confere: devolve as sementes que faltam no banco, sem gravar)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
PASTA = RAIZ / "db/sementes"
NOME = re.compile(r"[a-z][a-z0-9_]{0,63}")
# Chave natural das tabelas que não usam `codigo` (o padrão).
CHAVE = {
    "graduacao_oftalmologica": "sigla",
    # Raça/cor pelo código do IBGE e nacionalidade pelo código do cadastro nacional de usuários do SUS (F3.1-07).
    "classificacao_raca_cor": "codigo_ibge",
    "nacionalidade": "codigo_cadsus",
}


def chave(tabela: str) -> str:
    return CHAVE.get(tabela, "codigo")


def q(texto: str) -> str:
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def sql(banco: str, entrada: str | None = None, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([str(SQL), banco, *args], input=entrada, capture_output=True, text=True)


def valor(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return q(v)
    raise SystemExit(f"sementes: valor de tipo não aceito: {type(v).__name__}")


def ler_sementes() -> list[tuple[str, str, list[dict]]]:
    """(arquivo, tabela, linhas) na ordem dos arquivos. Recusa tabela repetida, nome fora do padrão e linha sem
    código ou com código repetido."""
    vistas, saida = set(), []
    for arq in sorted(PASTA.glob("*.json")):
        for tabela, linhas in json.loads(arq.read_text(encoding="utf-8")).items():
            if not NOME.fullmatch(tabela) or tabela in vistas:
                raise SystemExit(f"sementes: {arq.name}: tabela inválida ou repetida: {tabela}")
            vistas.add(tabela)
            codigos = [l.get(chave(tabela)) for l in linhas]
            if not linhas or any(not isinstance(c, str) or not c for c in codigos) or len(set(codigos)) != len(codigos):
                raise SystemExit(f"sementes: {arq.name}: {tabela}: linha sem código ou código repetido")
            for l in linhas:
                if any(not NOME.fullmatch(c) for c in l):
                    raise SystemExit(f"sementes: {arq.name}: {tabela}: coluna inválida")
            saida.append((arq.name, tabela, linhas))
    return saida


def colunas_do_banco(banco: str, tabelas: list[str]) -> dict[str, set[str]]:
    r = sql(banco, None, "-N", "-e",
            "select table_name, column_name from information_schema.columns "
            f"where table_schema={q(banco)} and table_name in ({','.join(q(t) for t in tabelas)})")
    if r.returncode:
        raise SystemExit(f"sementes: {r.stderr.strip()[:300]}")
    cols: dict[str, set[str]] = {}
    for linha in r.stdout.strip().splitlines():
        t, c = linha.split("\t")
        cols.setdefault(t, set()).add(c)
    return cols


def conferir_modelo(banco: str, sementes) -> None:
    cols = colunas_do_banco(banco, [t for _, t, _ in sementes])
    erros = []
    for arq, t, linhas in sementes:
        if t not in cols:
            erros.append(f"{arq}: a tabela {t} não existe no modelo")
            continue
        sobra = sorted({c for l in linhas for c in l} - cols[t])
        if sobra:
            erros.append(f"{arq}: {t}: colunas fora do modelo: {', '.join(sobra)}")
        if not {chave(t), "criado_em"} <= cols[t]:
            erros.append(f"{arq}: {t}: sem {chave(t)} ou criado_em")
    if erros:
        raise SystemExit("sementes: " + "; ".join(erros))


def montar_sql(sementes) -> str:
    partes = ["SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES');", "START TRANSACTION;"]
    for _, t, linhas in sementes:
        for l in linhas:  # uma linha por INSERT: cada uma com as suas colunas; o resto fica no padrão do modelo
            cols = list(l)
            partes.append(f"INSERT INTO {t} ({', '.join(cols)}, criado_em) VALUES "
                          f"({', '.join(valor(l[c]) for c in cols)}, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id = id;")
    partes.append("COMMIT;")
    return "\n".join(partes)


def contar(banco: str, sementes) -> dict[str, int]:
    """Por tabela, quantos códigos das sementes existem no banco."""
    consulta = " union all ".join(
        f"select {q(t)}, count(*) from {t} where {chave(t)} in ({','.join(q(l[chave(t)]) for l in linhas)})"
        for _, t, linhas in sementes)
    r = sql(banco, None, "-N", "-e", consulta)
    if r.returncode:
        raise SystemExit(f"sementes: contagem falhou: {r.stderr.strip()[:300]}")
    return {l.split("\t")[0]: int(l.split("\t")[1]) for l in r.stdout.strip().splitlines()}


def carregar(banco: str, so_conferir: bool = False) -> dict:
    """Inclui no banco (cliente_<codigo>) as sementes que faltam; devolve as contagens. Erro: SystemExit, nada
    gravado."""
    if not re.fullmatch(r"cliente_[a-z][a-z0-9_]{1,39}", banco):
        raise SystemExit("sementes: banco de cliente inválido")
    sementes = ler_sementes()
    conferir_modelo(banco, sementes)
    antes = contar(banco, sementes)
    esperado = {t: len(l) for _, t, l in sementes}
    if so_conferir:
        faltam = {t: esperado[t] - antes.get(t, 0) for t in esperado if antes.get(t, 0) < esperado[t]}
        return {"tabelas": len(esperado), "sementes": sum(esperado.values()), "faltam": faltam}
    r = sql(banco, montar_sql(sementes))
    if r.returncode:
        raise SystemExit(f"sementes: a carga falhou (nada gravado): {r.stderr.strip()[:400]}")
    depois = contar(banco, sementes)
    faltam = [t for t in esperado if depois.get(t, 0) != esperado[t]]
    if faltam:
        raise SystemExit(f"sementes: depois da carga ainda faltam códigos em {', '.join(faltam)}")
    incluidas = sum(depois[t] - antes.get(t, 0) for t in esperado)
    return {"tabelas": len(esperado), "sementes": sum(esperado.values()), "incluidas": incluidas,
            "ja_existiam": sum(esperado.values()) - incluidas}


def main() -> None:
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(pos) != 1 or not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", pos[0]):
        raise SystemExit(__doc__)
    r = carregar(f"cliente_{pos[0]}", "--conferir" in sys.argv)
    print(json.dumps({"cliente": pos[0], **r}, ensure_ascii=False))


if __name__ == "__main__":
    main()
