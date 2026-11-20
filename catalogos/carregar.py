"""Carrega os catálogos públicos no banco de um cliente (F1.4; ADR 0002, item 9).

uso: python3 -I catalogos/carregar.py <codigo_cliente> [fonte ...]
     fontes, na ordem de dependência: ibge, bcb, cid10, sigtap   (sem argumento: todas)

Cada fonte é um módulo em catalogos/carregadores/<fonte>.py com a função carregar(banco: str) -> dict
{tabela: linhas}. Os carregadores são idempotentes (rodar de novo não duplica). A carga fica registrada
em plataforma.cliente_evento (tipo catalogo_carregado).
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
ORDEM = ["ibge", "bcb", "cid10", "sigtap"]


def sql(banco, entrada=None, *args):
    return subprocess.run([str(RAIZ / "tools/db/sql.sh")] + ([banco] if banco else []) + list(args),
                          input=entrada, capture_output=True, text=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    codigo = sys.argv[1]
    fontes = sys.argv[2:] or ORDEM
    r = sql("plataforma", None, "-N", "-e", f"select id, banco_nome from cliente where codigo='{codigo}'")
    if r.returncode or not r.stdout.strip():
        raise SystemExit(f"cliente {codigo} não encontrado na plataforma")
    cliente_id, banco = r.stdout.split()
    for f in sorted(fontes, key=ORDEM.index):
        arq = RAIZ / "catalogos/carregadores" / f"{f}.py"
        esp = importlib.util.spec_from_file_location(f"carregador_{f}", arq)
        mod = importlib.util.module_from_spec(esp)
        esp.loader.exec_module(mod)
        res = mod.carregar(banco)
        print(json.dumps({"fonte": f, "linhas": res}, ensure_ascii=False))
        det = json.dumps({"fonte": f, "linhas": res}, ensure_ascii=False).replace("'", "''")
        sql("plataforma", f"INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, criado_em) "
                          f"VALUES ({cliente_id}, 'catalogo_carregado', '{det}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));")


if __name__ == "__main__":
    main()
