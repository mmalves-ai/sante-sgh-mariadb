"""Registro da imagem: arquivo, cabeçalho, horário de corte (mtime), contagem por tabela e confronto com o gstat.

Só metadados e contagens; nenhum valor de linha.
"""
import os
import re
import subprocess
import sys
import time

GSTAT = "/opt/firebird/bin/gstat"
RE_TAB = re.compile(r"^([A-Z][A-Z0-9_$]*) \((\d+)\)\s*$")
RE_TOTAL = re.compile(r"total records:\s*(\d+)")


def gstat_registros(dispositivo):
    """Total de registros por tabela pelo gstat (-d -r), que só lê páginas."""
    r = subprocess.run([GSTAT, "-d", "-r", dispositivo, "-user", os.environ.get("ISC_USER", "SYSDBA")],
                       capture_output=True, text=True, encoding="latin-1")
    if r.returncode != 0:
        raise RuntimeError("gstat falhou (rc=%d): %s" % (r.returncode, r.stderr.strip()[-300:]))
    saida, atual = {}, None
    for linha in r.stdout.splitlines():
        m = RE_TAB.match(linha.strip())
        if m:
            atual = m.group(1)
            continue
        m = RE_TOTAL.search(linha)
        if m and atual and atual not in saida:
            saida[atual] = int(m.group(1))
    return saida


def registrar(leitor, origem, abertura=None, progresso=False):
    """Contagem por tabela (COUNT(*) na transação READ ONLY). O gstat roda depois, com o leitor fechado
    (o Firebird embarcado não divide o arquivo entre dois processos): ver `confrontar_gstat`."""
    t0 = time.time()
    tabelas = leitor.tabelas()
    contagens = {}
    for i, t in enumerate(tabelas, 1):
        contagens[t] = leitor.contar(t)
        if progresso and i % 200 == 0:
            print("contadas %d/%d tabelas (%.0f s)" % (i, len(tabelas), time.time() - t0), file=sys.stderr)
    reg = {
        "arquivo": origem["relativo"],
        "tamanho": origem["tamanho"],
        "corte_mtime": origem["mtime"],
        "ods": origem["ods"],
        "pagina": origem["pagina"],
        "sha256": origem.get("sha256"),
        "somente_leitura_na_abertura": leitor.somente_leitura(),
        "tabelas": len(tabelas),
        "registros_total": sum(contagens.values()),
        "contagens": contagens,
        "generators": len(leitor.generators()),
        "segundos_contagem": round(time.time() - t0, 1),
    }
    if abertura is not None:
        reg["abertura"] = abertura.resumo()
    return reg


def confrontar_gstat(reg, dispositivo, gs=None):
    """Confronto com o gstat: conta como divergência a contagem diferente E a tabela presente num só lado."""
    t1 = time.time()
    if gs is None:
        gs = gstat_registros(dispositivo)
    cont = reg["contagens"]
    diverg = {}
    for t in sorted(set(cont) | set(gs)):  # o conjunto de tabelas também é conferido, nos dois sentidos
        if gs.get(t) != cont.get(t):
            diverg[t] = {"contagem": cont.get(t), "gstat": gs.get(t),
                         "motivo": ("só no gstat (fora do leitor)" if t not in cont else
                                    "só no leitor (o gstat não viu)" if t not in gs else "contagem")}
    reg["gstat"] = {"tabelas": len(gs), "registros_total": sum(gs.values()),
                    "so_no_gstat": sorted(set(gs) - set(cont)), "so_no_leitor": sorted(set(cont) - set(gs)),
                    "divergentes": len(diverg), "divergencias": diverg, "segundos": round(time.time() - t1, 1)}
    return reg
