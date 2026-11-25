"""Carrega os catálogos públicos no banco de um cliente (F1.4; ADR 0002, item 9).

uso: python3 -I catalogos/carregar.py <codigo_cliente> [fonte ...]
     python3 -I catalogos/carregar.py --espelho <banco_espelho> [fonte ...]   (ADR 0006: o caminho padrão)
     fontes, na ordem de dependência: ibge, ddd, logradouro, bcb, cid10, sigtap, cfop, tiss   (sem argumento: todas)

Cada fonte é um módulo em catalogos/carregadores/<fonte>.py com a função carregar(banco: str) -> dict
{tabela: linhas}; a lista AVISOS do módulo, se houver, é impressa e gravada no evento. Os carregadores são idempotentes (rodar de novo não duplica). A carga fica registrada
em plataforma.cliente_evento (tipo catalogo_carregado).
Com --espelho, a carga vai ao ESPELHO PADRÃO DA BASE (tools/db/espelho.py) e fica em edicao_espelho e no manifesto
tabela_espelho; o "criar cliente" leva o espelho a todo cliente novo e "espelho.py atualizar" aos existentes.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
ORDEM = ["ibge", "ddd", "logradouro", "bcb", "cid10", "sigtap", "cfop", "tiss"]


def sql(banco, entrada=None, *args):
    return subprocess.run([str(RAIZ / "tools/db/sql.sh")] + ([banco] if banco else []) + list(args),
                          input=entrada, capture_output=True, text=True)


def _modulo(nome, arq):
    esp = importlib.util.spec_from_file_location(nome, arq)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def carregar_espelho(banco, fontes):
    """Carrega as fontes oficiais no espelho e registra cada edição (versão: a do cache registrado)."""
    espelho = _modulo("espelho_mod", RAIZ / "tools/db/espelho.py")
    if not espelho.existe(banco):
        raise SystemExit(f"{banco} não é um espelho (tools/db/espelho.py criar --espelho {banco})")
    versoes = {}
    reg = RAIZ / "catalogos/cache/registro.tsv"
    if reg.exists():
        for ln in reg.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if len(c) > 5:  # fonte, url, arquivo, bytes, sha256, baixado_em[, versão]
                versoes[c[0].split("_")[0]] = (c[6] if len(c) > 6 and c[6] else c[5])[:40]
    for f in sorted(fontes, key=ORDEM.index):
        mod = _modulo(f"carregador_{f}", RAIZ / "catalogos/carregadores" / f"{f}.py")
        res = mod.carregar(banco)
        avisos = list(getattr(mod, "AVISOS", []))
        r = espelho.registrar_carga(banco, f, "oficial", versoes.get(f) or "sem_versao", res, avisos)
        print(json.dumps({"fonte": f, "linhas": res, **r}, ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == "--espelho":
        import re
        carregar_espelho(re.sub(r"[^a-z0-9_]", "", sys.argv[2]), sys.argv[3:] or ORDEM)
        return
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
        avisos = list(getattr(mod, "AVISOS", []))
        reg = {"fonte": f, "linhas": res, "avisos": avisos}
        print(json.dumps({"fonte": f, "linhas": res}, ensure_ascii=False))
        for a in avisos:
            print(f"  aviso {f}: {a}")
        det = json.dumps(reg, ensure_ascii=False).replace("'", "''")
        sql("plataforma", f"INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, criado_em) "
                          f"VALUES ({cliente_id}, 'catalogo_carregado', '{det}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));")


if __name__ == "__main__":
    main()
