"""Carrega o catálogo de ações do sistema (acao_sistema) no banco de um cliente, a partir dos contratos do produto
(@sgh/contratos), pela regra de tools/db/acoes-sistema.ts. Decisão do dono (2026-11-20, a): o comando "criar novo
cliente" (tools/db/criar_cliente.py) chama este carregador; ele também serve para atualizar um cliente existente
depois de uma versão nova do produto.

uso: python3 -I tools/db/carregar_acoes.py <codigo-cliente>

Idempotente: inclui o que falta, atualiza descrição, tipo e ordem do que mudou e reativa o que voltou; a ação que
saiu do catálogo fica inativa (nunca é apagada: perfil_acao pode apontá-la). Tudo numa transação. A saída é só de
contagens.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
GERADOR = ["node", "--import", "./tools/verificadores/src/caminhos-sgh.ts", "tools/db/acoes-sistema.ts"]
TAMANHO_CODIGO = 120
TAMANHO_DESCRICAO = 255
TIPOS = {"ver", "incluir", "alterar", "excluir", "aprovar", "imprimir", "exportar", "executar", "assinar", "liberar"}
LOTE = 500


def q(texto: str) -> str:
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def sql(banco: str, entrada: str | None = None, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([str(SQL), banco, *args], input=entrada, capture_output=True, text=True)


def acoes_do_produto() -> list[dict]:
    r = subprocess.run(GERADOR, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"catálogo de ações: o gerador falhou: {r.stderr.strip()[:400]}")
    acoes = json.loads(r.stdout)
    for a in acoes:
        if not (0 < len(a["codigo"]) <= TAMANHO_CODIGO and 0 < len(a["descricao"]) <= TAMANHO_DESCRICAO
                and a["tipoAcao"] in TIPOS and 0 < a["ordem"] <= 65535):
            raise SystemExit(f"catálogo de ações: linha fora das regras: {a['codigo'][:60]}")
    return acoes


def conferir_colunas(banco: str) -> None:
    r = sql(banco, None, "-N", "-e",
            "select column_name, character_maximum_length from information_schema.columns "
            f"where table_schema={q(banco)} and table_name='acao_sistema' and column_name in ('codigo','descricao')")
    if r.returncode:
        raise SystemExit(f"catálogo de ações: {r.stderr.strip()[:300]}")
    tam = {l.split("\t")[0]: int(l.split("\t")[1]) for l in r.stdout.strip().splitlines() if l}
    if tam.get("codigo", 0) < TAMANHO_CODIGO or tam.get("descricao", 0) < TAMANHO_DESCRICAO:
        raise SystemExit(
            f"catálogo de ações: {banco}.acao_sistema foi criado antes da migração que alargou codigo "
            f"({TAMANHO_CODIGO}) e descricao ({TAMANHO_DESCRICAO}); recrie o cliente ou aplique a mudança da coluna.")


def montar_sql(acoes: list[dict]) -> str:
    partes = [
        "SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES');",
        "START TRANSACTION;",
        "CREATE TEMPORARY TABLE carga_acao (codigo VARCHAR(120) NOT NULL PRIMARY KEY, descricao VARCHAR(255) NOT NULL,"
        " tipo_acao VARCHAR(30) NOT NULL, ordem SMALLINT UNSIGNED NOT NULL);",
    ]
    for i in range(0, len(acoes), LOTE):
        valores = ",".join(f"({q(a['codigo'])},{q(a['descricao'])},{q(a['tipoAcao'])},{int(a['ordem'])})"
                           for a in acoes[i:i + LOTE])
        partes.append(f"INSERT INTO carga_acao (codigo, descricao, tipo_acao, ordem) VALUES {valores};")
    partes += [
        # Mudou ou voltou: atualiza (com versão e data de alteração).
        "UPDATE acao_sistema a JOIN carga_acao c ON c.codigo = a.codigo SET a.versao = a.versao + 1,"
        " a.alterado_em = UTC_TIMESTAMP(3), a.descricao = c.descricao, a.tipo_acao = c.tipo_acao, a.ordem = c.ordem,"
        " a.ativo = TRUE WHERE a.descricao <> c.descricao OR a.tipo_acao <> c.tipo_acao OR a.ordem <> c.ordem"
        " OR NOT a.ativo;",
        "SET @atualizadas = ROW_COUNT();",
        "INSERT INTO acao_sistema (codigo, descricao, tipo_acao, ordem, criado_em)"
        " SELECT c.codigo, c.descricao, c.tipo_acao, c.ordem, UTC_TIMESTAMP(3) FROM carga_acao c"
        " LEFT JOIN acao_sistema a ON a.codigo = c.codigo WHERE a.id IS NULL ORDER BY c.ordem;",
        "SET @incluidas = ROW_COUNT();",
        # Saiu do catálogo: inativa (perfil_acao pode apontá-la; nada é apagado).
        "UPDATE acao_sistema a LEFT JOIN carga_acao c ON c.codigo = a.codigo SET a.ativo = FALSE,"
        " a.versao = a.versao + 1, a.alterado_em = UTC_TIMESTAMP(3) WHERE c.codigo IS NULL AND a.ativo;",
        "SET @inativadas = ROW_COUNT();",
        "COMMIT;",
        "SELECT @incluidas, @atualizadas, @inativadas, (SELECT COUNT(*) FROM acao_sistema WHERE ativo);",
    ]
    return "\n".join(partes) + "\n"


def carregar(banco: str) -> dict:
    """Carrega no banco (cliente_<codigo>); devolve as contagens. Erro: SystemExit, nada gravado."""
    if not re.fullmatch(r"cliente_[a-z][a-z0-9_]{1,39}", banco):
        raise SystemExit("catálogo de ações: banco de cliente inválido")
    conferir_colunas(banco)
    acoes = acoes_do_produto()
    r = sql(banco, montar_sql(acoes), "-N")
    if r.returncode:
        raise SystemExit(f"catálogo de ações: a carga falhou (nada gravado): {r.stderr.strip()[:400]}")
    inc, atu, ina, ativas = (int(x) for x in r.stdout.strip().splitlines()[-1].split("\t"))
    if ativas != len(acoes):
        raise SystemExit(f"catálogo de ações: {ativas} ativas no banco, {len(acoes)} no produto")
    return {"acoes_produto": len(acoes), "incluidas": inc, "atualizadas": atu, "inativadas": ina, "ativas": ativas}


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", sys.argv[1]):
        raise SystemExit(__doc__)
    print(json.dumps({"cliente": sys.argv[1], **carregar(f"cliente_{sys.argv[1]}")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
