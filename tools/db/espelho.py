"""Espelho padrão da base (ADR 0006, itens 3 e 4): banco da plataforma com os catálogos oficiais e os licenciados
(Simpro, Brasíndice, CBHPM, CEP), versionados por edição, levado a TODO cliente.

uso: python3 -I tools/db/espelho.py criar      [--espelho BANCO]
     python3 -I tools/db/espelho.py situacao   [--espelho BANCO]
     python3 -I tools/db/espelho.py atualizar  <codigo_cliente>|--todos [--espelho BANCO] [--plataforma BANCO]

Desenho:
- O espelho tem o MESMO desenho de tabelas do banco do cliente (recebe as migrações do cliente) e, por cima, as
  tabelas de controle de db/espelho/*.sql: edicao_espelho (cada edição carregada) e tabela_espelho (manifesto: as
  tabelas que o espelho leva). Nome padrão "espelho" (ESPELHO_BANCO ou --espelho).
- Os catálogos oficiais entram por catalogos/carregar.py --espelho; os licenciados, pelo arquivo do fornecedor em
  catalogos/licenciados/carregar.py (formato em catalogos/licenciados/FORMATO.md). Nunca direto no cliente.
- aplicar(): copia cada tabela do manifesto para o banco do cliente com os MESMOS ids (as FKs entre catálogos
  continuam valendo) por INSERT ... SELECT ... ON DUPLICATE KEY UPDATE; as colunas só do cliente (item do hospital,
  descrição e uso do hospital) nunca são tocadas. O AUTO_INCREMENT das tabelas copiadas vai para BASE_LOCAL
  (10^12): item do hospital criado no cliente nunca colide com id do espelho.
- Conflito (cliente existente): linha do espelho cuja chave única já existe no cliente com outro id (ex.: código
  local do hospital que virou oficial numa edição nova), ou id já usado no cliente por outra chave, NÃO é copiada,
  e as linhas do espelho que dependem dela também não; o resultado conta os conflitos por tabela.
- Prova: contagem do espelho x contagem no cliente por tabela e órfãos de FK (zero) depois da cópia.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
BASE_LOCAL = 10 ** 12
CONTROLE = {"edicao_espelho", "tabela_espelho"}
COLUNAS_DO_CLIENTE = {"item_hospital", "motivo_item_hospital", "descricao_hospital", "mantido_ativo_hospital"}
NAO_ATUALIZA = {"id", "criado_em", "criado_por"} | COLUNAS_DO_CLIENTE


def nome_banco(v: str | None) -> str:
    return re.sub(r"[^a-z0-9_]", "", v or "") or "espelho"


ESPELHO = nome_banco(os.environ.get("ESPELHO_BANCO", "espelho"))


def sql(banco, entrada=None, *args):
    return subprocess.run([str(SQL)] + ([banco] if banco else []) + list(args), input=entrada,
                          capture_output=True, text=True)


def consulta(banco, texto) -> list[list[str]]:
    r = sql(banco, texto, "-N", "-B")
    if r.returncode:
        raise SystemExit(f"consulta falhou: {r.stderr[:400]}")
    return [ln.split("\t") for ln in r.stdout.splitlines() if ln]


def executar(banco, texto):
    r = sql(banco, texto)
    if r.returncode:
        raise SystemExit(f"{banco}: {r.stderr[:600]}")


def q(v) -> str:
    return "NULL" if v is None else "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def existe(banco: str) -> bool:
    return consulta(None, f"select count(*) from information_schema.tables where table_schema={q(banco)} "
                          f"and table_name='edicao_espelho'")[0][0] != "0"


def _criar_cliente():
    spec = importlib.util.spec_from_file_location("criar_cliente_mod", RAIZ / "tools/db/criar_cliente.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def aplicar_controle(banco: str):
    for arq in sorted((RAIZ / "db/espelho").glob("*.sql")):
        executar(banco, arq.read_text(encoding="utf-8"))


def criar(banco: str = None) -> dict:
    """Cria o espelho (migrações do cliente + controle). Já existente: só reaplica o controle (idempotente)."""
    banco = banco or ESPELHO
    ja = consulta(None, f"select count(*) from information_schema.schemata where schema_name={q(banco)}")[0][0] != "0"
    if not ja:
        executar(None, f"CREATE DATABASE {banco} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci")
        n, erros = _criar_cliente().aplicar_migracoes(banco)
        if erros:
            executar(None, f"DROP DATABASE {banco}")
            raise SystemExit("espelho: migrações com erro; banco removido:\n" + "\n".join(erros[:10]))
    aplicar_controle(banco)
    if not ja:
        registrar_tabelas(banco, "migracoes", "semente_migracao")
    return {"espelho": banco, "criado": not ja, "tabelas": len(tabelas_com_linhas(banco))}


def tabelas_com_linhas(banco: str) -> list[str]:
    linhas = consulta(None, f"select table_name from information_schema.tables where table_schema={q(banco)} "
                            f"and table_type='BASE TABLE'")
    tabs = sorted(t for (t,) in linhas if t not in CONTROLE)
    if not tabs:
        return []
    uniao = " UNION ALL ".join(f"select {q(t)}, exists(select 1 from `{t}`)" for t in tabs)
    return [t for t, tem in consulta(banco, uniao) if tem == "1"]


def registrar_tabelas(banco: str, catalogo: str, tipo: str) -> list[str]:
    """Põe no manifesto toda tabela com linhas que ainda não está nele (a primeira fonte que a preencheu)."""
    ja = {t for (t,) in consulta(banco, "select tabela from tabela_espelho")}
    novas = [t for t in tabelas_com_linhas(banco) if t not in ja]
    if novas:
        executar(banco, "INSERT INTO tabela_espelho (tabela, catalogo, tipo, criado_em) VALUES "
                 + ",".join(f"({q(t)}, {q(catalogo)}, {q(tipo)}, UTC_TIMESTAMP(3))" for t in novas) + ";")
    return novas


def registrar_carga(banco: str, catalogo: str, tipo: str, edicao: str, linhas: dict, avisos=None,
                    arquivo_nome=None, sha256=None, vigencia=None, situacao="carregada") -> dict:
    """Grava a edição carregada no espelho e atualiza o manifesto."""
    if not existe(banco):
        raise SystemExit(f"{banco} não é um espelho (crie com tools/db/espelho.py criar)")
    executar(banco, f"""
INSERT INTO edicao_espelho (catalogo, tipo, edicao, vigencia_inicio, arquivo_nome, arquivo_sha256, linhas, avisos,
  situacao, carregada_em, criado_em)
VALUES ({q(catalogo)}, {q(tipo)}, {q(edicao)}, {q(vigencia)}, {q(arquivo_nome)}, {q(sha256)},
  {q(json.dumps(linhas, ensure_ascii=False))}, {q(json.dumps(avisos or [], ensure_ascii=False))}, {q(situacao)},
  UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE linhas = VALUES(linhas), avisos = VALUES(avisos), situacao = VALUES(situacao),
  arquivo_sha256 = VALUES(arquivo_sha256), carregada_em = VALUES(carregada_em), alterado_em = UTC_TIMESTAMP(3),
  versao = versao + 1;""")
    novas = registrar_tabelas(banco, catalogo, tipo)
    return {"catalogo": catalogo, "edicao": edicao, "tabelas_novas_no_manifesto": novas}


def _colunas(banco: str, tabelas: list[str]) -> dict:
    cols = {}
    for t, c, extra in consulta(None, f"select table_name, column_name, extra from information_schema.columns "
                                      f"where table_schema={q(banco)} order by table_name, ordinal_position"):
        if t in tabelas and "GENERATED" not in extra.upper():
            cols.setdefault(t, []).append(c)
    return cols


def _unicas(banco: str, tabelas: list[str]) -> dict:
    """Chaves únicas (menos a PK) por tabela: {tabela: [[colunas], ...]}."""
    idx = {}
    for t, nome, col in consulta(None, f"select table_name, index_name, column_name from information_schema.statistics "
                                       f"where table_schema={q(banco)} and non_unique=0 and index_name<>'PRIMARY' "
                                       f"order by table_name, index_name, seq_in_index"):
        if t in tabelas:
            idx.setdefault(t, {}).setdefault(nome, []).append(col)
    return {t: list(v.values()) for t, v in idx.items()}


def _fks(banco: str) -> list[tuple[str, str, str, str]]:
    return [tuple(r) for r in consulta(None, f"select table_name, column_name, referenced_table_name, "
                                             f"referenced_column_name from information_schema.key_column_usage "
                                             f"where table_schema={q(banco)} and referenced_table_name is not null")]


def _ids(banco: str, texto: str) -> set[int]:
    return {int(r[0]) for r in consulta(banco, texto)}


def aplicar(cliente: str, espelho: str = None) -> dict:
    """Leva o espelho ao banco do cliente (novo ou existente). Devolve as contagens por tabela, os conflitos e os
    órfãos de FK (a prova). Recusa (SystemExit) se o espelho não existir ou tiver id na faixa local."""
    espelho = espelho or ESPELHO
    if not existe(espelho):
        raise SystemExit(f"espelho {espelho} não existe")
    manifesto = [t for (t,) in consulta(espelho, "select tabela from tabela_espelho order by id")]
    cli_tabs = {t for (t,) in consulta(None, f"select table_name from information_schema.tables "
                                             f"where table_schema={q(cliente)}")}
    faltam = [t for t in manifesto if t not in cli_tabs]
    manifesto = [t for t in manifesto if t in cli_tabs]
    ce, cc = _colunas(espelho, manifesto), _colunas(cliente, manifesto)
    unicas = _unicas(cliente, manifesto)
    fks = [f for f in _fks(cliente) if f[0] in manifesto]
    if manifesto:
        maximos = consulta(espelho, " UNION ALL ".join(f"select {q(t)}, coalesce(max(id),0) from `{t}`" for t in manifesto))
        fora = [t for t, m in maximos if int(m) >= BASE_LOCAL]
        if fora:
            raise SystemExit(f"espelho com id na faixa local (>= {BASE_LOCAL}): {fora}")
    # conflitos: chave única com outro id, ou id com outra chave (a primeira única)
    excl: dict[str, set[int]] = {t: set() for t in manifesto}
    for t in manifesto:
        for k in unicas.get(t, []):
            on = " AND ".join(f"c.`{c}` = e.`{c}`" for c in k)
            excl[t] |= _ids(None, f"select e.id from `{espelho}`.`{t}` e join `{cliente}`.`{t}` c on {on} "
                                  f"where c.id <> e.id")
        if unicas.get(t):
            igual = " AND ".join(f"c.`{c}` <=> e.`{c}`" for c in unicas[t][0])
            excl[t] |= _ids(None, f"select e.id from `{espelho}`.`{t}` e join `{cliente}`.`{t}` c on c.id = e.id "
                                  f"where not ({igual})")
    conflitos = {t: len(v) for t, v in excl.items() if v}
    mudou = True
    while mudou:
        mudou = False
        for filho, col, pai, pcol in fks:
            if pai in excl and excl[pai] and pcol == "id":
                lista = sorted(excl[pai])
                for i in range(0, len(lista), 5000):
                    novos = _ids(espelho, f"select id from `{filho}` where `{col}` in "
                                          f"({','.join(map(str, lista[i:i + 5000]))})") - excl[filho]
                    if novos:
                        excl[filho] |= novos
                        mudou = True
    partes = ["SET SESSION foreign_key_checks = 0;",
              "CREATE TEMPORARY TABLE tmp_excluida_espelho (tabela VARCHAR(64) NOT NULL, id BIGINT UNSIGNED NOT NULL,"
              " PRIMARY KEY (tabela, id));"]
    for t, ids in excl.items():
        lista = sorted(ids)
        for i in range(0, len(lista), 5000):
            partes.append("INSERT INTO tmp_excluida_espelho VALUES "
                          + ",".join(f"({q(t)},{x})" for x in lista[i:i + 5000]) + ";")
    for t in manifesto:
        cols = [c for c in ce.get(t, []) if c in cc.get(t, []) and c not in COLUNAS_DO_CLIENTE]
        lista = ", ".join(f"`{c}`" for c in cols)
        upd = ", ".join(f"`{c}` = VALUES(`{c}`)" for c in cols if c not in NAO_ATUALIZA) or "id = id"
        partes.append(f"INSERT INTO `{cliente}`.`{t}` ({lista}) SELECT {', '.join('e.`' + c + '`' for c in cols)} "
                      f"FROM `{espelho}`.`{t}` e WHERE NOT EXISTS (SELECT 1 FROM tmp_excluida_espelho x "
                      f"WHERE x.tabela = {q(t)} AND x.id = e.id) ON DUPLICATE KEY UPDATE {upd};")
        partes.append(f"ALTER TABLE `{cliente}`.`{t}` AUTO_INCREMENT = {BASE_LOCAL};")
    partes.append("SET SESSION foreign_key_checks = 1;")
    executar(cliente, "\n".join(partes))
    # prova: contagem por tabela e órfãos de FK
    tabelas = {}
    if manifesto:
        cont = consulta(None, " UNION ALL ".join(
            f"select {q(t)}, (select count(*) from `{espelho}`.`{t}`), (select count(*) from `{cliente}`.`{t}` c "
            f"join `{espelho}`.`{t}` e on e.id = c.id) " for t in manifesto))
        for t, n_esp, n_cli in cont:
            tabelas[t] = {"espelho": int(n_esp), "no_cliente": int(n_cli), "nao_copiadas": len(excl[t])}
    orfaos = []
    for filho, col, pai, pcol in fks:
        n = consulta(cliente, f"select count(*) from `{filho}` c left join `{pai}` p on p.`{pcol}` = c.`{col}` "
                              f"where c.`{col}` is not null and p.`{pcol}` is null")[0][0]
        if n != "0":
            orfaos.append(f"{filho}.{col} -> {pai}: {n}")
    divergentes = [t for t, v in tabelas.items() if v["espelho"] - v["nao_copiadas"] != v["no_cliente"]]
    edicoes = consulta(espelho, "select catalogo, edicao from edicao_espelho where situacao='carregada' order by id")
    return {"espelho": espelho, "cliente": cliente, "tabelas": tabelas, "conflitos": conflitos,
            "linhas_espelho": sum(v["espelho"] for v in tabelas.values()),
            "linhas_no_cliente": sum(v["no_cliente"] for v in tabelas.values()),
            "edicoes": [f"{c}:{e}" for c, e in edicoes], "fora_do_modelo_do_cliente": faltam,
            "orfaos": orfaos, "divergentes": divergentes}


def _arg(nome):
    return sys.argv[sys.argv.index(nome) + 1] if nome in sys.argv else None


def main():
    esp = nome_banco(_arg("--espelho")) if _arg("--espelho") else ESPELHO
    acao = sys.argv[1] if len(sys.argv) > 1 else ""
    if acao == "criar":
        print(json.dumps(criar(esp), ensure_ascii=False))
    elif acao == "situacao":
        if not existe(esp):
            raise SystemExit(f"espelho {esp} não existe")
        print(json.dumps({"espelho": esp, "edicoes": consulta(esp, "select catalogo, tipo, edicao, situacao from edicao_espelho"),
                          "manifesto": consulta(esp, "select tabela, catalogo, tipo from tabela_espelho")},
                         ensure_ascii=False))
    elif acao == "atualizar":
        plat = nome_banco(_arg("--plataforma") or os.environ.get("PLATAFORMA_BANCO", "plataforma"))
        alvo = [a for a in sys.argv[2:] if not a.startswith("--") and a not in (_arg("--espelho"), _arg("--plataforma"))]
        filtro = "" if "--todos" in sys.argv else f" where codigo = {q(alvo[0] if alvo else '')}"
        clientes = consulta(plat, f"select id, codigo, banco_nome from cliente{filtro}")
        if not clientes:
            raise SystemExit("nenhum cliente encontrado")
        falhou = False
        for cid, cod, banco in clientes:
            r = aplicar(banco, esp)
            resumo = {k: r[k] for k in ("espelho", "linhas_espelho", "linhas_no_cliente", "conflitos", "edicoes",
                                        "orfaos", "divergentes")}
            falhou |= bool(r["orfaos"] or r["divergentes"])
            executar(plat, f"INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, criado_em) VALUES "
                           f"({cid}, 'espelho_atualizado', {q(json.dumps(resumo, ensure_ascii=False))}, "
                           f"UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));")
            print(json.dumps({"cliente": cod, **resumo}, ensure_ascii=False))
        raise SystemExit(1 if falhou else 0)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
