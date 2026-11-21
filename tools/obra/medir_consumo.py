"""Mede o consumo de tokens dos workflows e do orquestrador, para o relatório de 50 minutos (protocolo, regra 14).

uso: python3 -I tools/obra/medir_consumo.py <pasta_da_sessao> [wf_id ...]

<pasta_da_sessao> é ~/.claude/projects/<projeto>/<id-da-sessao>; sem wf_id, mede todos os workflows dela.

Custo equivalente, em tokens de entrada:
- entrada = 1;
- cache lido = 0,1;
- cache gravado = 1,25;
- saída = 5.

Por papel (o rótulo do agente antes do ':' — construir, revisar, corrigir, integrar), imprime:
agentes, equivalente por agente e turnos por agente.

Linha de base para o "% de economia":
- construtor da F2.2 antes das regras 20 a 22: 9,51 M equivalentes e 256 turnos por agente
  (ondas 1 e 2, 2026-11-21).
"""
import collections
import glob
import json
import os
import sys

BASE_CONSTRUTOR = 9.51e6


def custo(arq):
    eq = t = 0
    for linha in open(arq, encoding="utf-8"):
        try:
            d = json.loads(linha)
        except ValueError:
            continue
        u = (d.get("message") or {}).get("usage")
        if d.get("type") == "assistant" and u:
            eq += (u.get("input_tokens", 0) + 0.1 * u.get("cache_read_input_tokens", 0)
                   + 1.25 * u.get("cache_creation_input_tokens", 0) + 5 * u.get("output_tokens", 0))
            t += 1
    return eq, t


def rotulos(wf):
    lab = {}
    j = os.path.join(wf, "journal.jsonl")
    if os.path.exists(j):
        for linha in open(j, encoding="utf-8"):
            d = json.loads(linha)
            if d.get("type") == "started":
                lab[d["agentId"]] = d.get("label", "?")
    return lab


def main():
    sessao = sys.argv[1]
    wfs = sys.argv[2:] or sorted(os.path.basename(p) for p in glob.glob(os.path.join(sessao, "subagents/workflows/wf_*")))
    for w in wfs:
        wf = os.path.join(sessao, "subagents/workflows", w)
        lab = rotulos(wf)
        papel = collections.defaultdict(lambda: [0, 0.0, 0])
        for a in glob.glob(os.path.join(wf, "agent-*.jsonl")):
            aid = os.path.basename(a)[6:-6]
            p = lab.get(aid, "?").split(":")[0]
            eq, t = custo(a)
            x = papel[p]
            x[0] += 1
            x[1] += eq
            x[2] += t
        if not papel:
            continue
        print(w)
        for p, (n, eq, t) in sorted(papel.items()):
            extra = ""
            if p == "construir":
                extra = f"  ({100 * (1 - eq / n / BASE_CONSTRUTOR):+.0f}% vs base 9,51 M)"
            print(f"  {p:10} {n:3} agentes  {eq / n / 1e6:6.2f} M eq/agente  {t // n:4} turnos/agente{extra}")
    eq, t = custo(sessao + ".jsonl")
    print(f"orquestrador: {t} turnos, {eq / 1e6:.1f} M eq")


if __name__ == "__main__":
    main()
