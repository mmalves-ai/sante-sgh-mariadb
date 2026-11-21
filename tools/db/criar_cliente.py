"""Comando "criar novo cliente" (ADR 0002, item 9): cria o banco vazio do cliente, aplica as migrações e o
registra no banco de controle da plataforma. O catálogo de ações do sistema (acao_sistema) é carregado aqui, dos
contratos do produto (tools/db/carregar_acoes.py; decisão do dono 2026-11-20, a). A carga dos catálogos públicos é um passo seguinte
(catalogos/carregar.py), e a importação do SPDATA é do conector (só para cliente com origem conector_spdata).

uso: python3 -I tools/db/criar_cliente.py <codigo> "<nome>" [--origem vazio|conector_spdata] [--cnpj N]
     python3 -I tools/db/criar_cliente.py --listar

O banco do cliente se chama cliente_<codigo>. O comando é idempotente: recusa se o cliente já existir.
"""
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
MIG = RAIZ / "db/migracoes"
PLAT = "plataforma"


def sql(banco, entrada=None, *args):
    r = subprocess.run([str(SQL)] + ([banco] if banco else []) + list(args), input=entrada,
                       capture_output=True, text=True)
    return r


def q(texto: str) -> str:
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def garantir_plataforma():
    sql(None, None, "-e", f"CREATE DATABASE IF NOT EXISTS {PLAT}")
    for arq in sorted((RAIZ / "db/plataforma").glob("*.sql")):
        r = sql(PLAT, arq.read_text(encoding="utf-8"))
        if r.returncode:
            raise SystemExit(f"plataforma: {arq.name}: {r.stderr[:400]}")


def aplicar_migracoes(banco: str) -> tuple[int, list[str]]:
    erros, n = [], 0
    for sufixo in ("_tabelas.sql", "_chaves.sql"):
        for arq in sorted(MIG.glob(f"*/*{sufixo}")):
            r = sql(banco, arq.read_text(encoding="utf-8"))
            n += 1
            if r.returncode:
                erros.append(f"{arq.relative_to(RAIZ)}: {r.stderr.strip()[:300]}")
    return n, erros


def carregador_de_acoes():
    """tools/db/carregar_acoes.py (com -I, a pasta do script não entra no sys.path: carrega pelo caminho)."""
    spec = importlib.util.spec_from_file_location("carregar_acoes", RAIZ / "tools/db/carregar_acoes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    garantir_plataforma()
    if "--listar" in sys.argv:
        print(sql(PLAT, None, "-e", "select id, codigo, nome, situacao, origem_dados, banco_nome, versao_migracao from cliente").stdout)
        return
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    codigo, nome = sys.argv[1], sys.argv[2]
    origem = sys.argv[sys.argv.index("--origem") + 1] if "--origem" in sys.argv else "vazio"
    cnpj = sys.argv[sys.argv.index("--cnpj") + 1] if "--cnpj" in sys.argv else None
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", codigo):
        raise SystemExit("código inválido: minúsculas, dígitos e _, começando por letra")
    banco = f"cliente_{codigo}"
    ja = sql(PLAT, None, "-N", "-e", f"select count(*) from cliente where codigo={q(codigo)}").stdout.strip()
    if ja != "0":
        raise SystemExit(f"cliente {codigo} já existe")
    existe = sql(None, None, "-N", "-e", f"select count(*) from information_schema.schemata where schema_name={q(banco)}").stdout.strip()
    if existe != "0":
        raise SystemExit(f"o banco {banco} já existe; não sobrescrevo")
    sql(None, None, "-e", f"CREATE DATABASE {banco} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci")
    n, erros = aplicar_migracoes(banco)
    if erros:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise SystemExit("migrações com erro; banco removido:\n" + "\n".join(erros[:20]))
    try:
        acoes = carregador_de_acoes().carregar(banco)
    except SystemExit as e:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise SystemExit(f"{e}; banco removido")
    tabelas = sql(None, None, "-N", "-e", f"select count(*) from information_schema.tables where table_schema={q(banco)}").stdout.strip()
    versao = sorted(p.parent.name + "/" + p.name for p in MIG.glob("*/*_chaves.sql"))[-1]
    agora = "UTC_TIMESTAMP(3)"
    r = sql(PLAT, f"""
INSERT INTO cliente (codigo, nome, documento_cnpj, situacao, banco_nome, versao_migracao, origem_dados, criado_em)
VALUES ({q(codigo)}, {q(nome)}, {q(cnpj) if cnpj else 'NULL'}, 'implantacao', {q(banco)}, {q(versao)}, {q(origem)}, {agora});
INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, criado_em)
VALUES (LAST_INSERT_ID(), 'criado', {q(json.dumps({'arquivos_migracao': n, 'tabelas': int(tabelas or 0), 'acoes_sistema': acoes['ativas'], 'origem': origem}))}, {agora}, {agora});
""")
    if r.returncode:
        raise SystemExit(f"registro na plataforma falhou: {r.stderr[:400]}")
    print(json.dumps({"cliente": codigo, "banco": banco, "tabelas": int(tabelas or 0), "acoes_sistema": acoes["ativas"],
                      "origem": origem,
                      "proximo_passo": "catalogos/carregar.py " + codigo + (" e conector" if origem == "conector_spdata" else "")},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
