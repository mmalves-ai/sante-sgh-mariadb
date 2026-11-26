#!/usr/bin/env python3
"""Números do relatório de 50 minutos num comando só (25/11, para o orquestrador gastar 1 turno em vez de 5).

Imprime: hora; gasto por papel (total) e a CADÊNCIA da janela (diferença contra a última execução, guardada em
sante-sgh-dados/obra/relatorio-50.json); orquestrador; fichas recontadas pelo README (F3, F7, F8, total);
workflows com journal recente (encerradas e prontas). Uso: python3 -I tools/obra/relatorio-50.py <pasta da sessão>
"""
import json, os, re, subprocess, sys, time, glob

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EST = os.path.join(RAIZ, '..', 'sante-sgh-dados', 'obra', 'relatorio-50.json')
S = sys.argv[1]
out = subprocess.run(['python3', '-I', os.path.join(RAIZ, 'tools/obra/medir_consumo.py'), S], capture_output=True, text=True).stdout
tot, n, orq = {}, {}, 0.0
for l in out.splitlines():
    m = re.match(r'\s+(\w+)\s+(\d+) agentes\s+([\d.]+) M eq/agente', l)
    if m:
        p, a, g = m.group(1), int(m.group(2)), float(m.group(3)); tot[p] = tot.get(p, 0) + a * g; n[p] = n.get(p, 0) + a
    m = re.match(r'orquestrador: (\d+) turnos, ([\d.]+) M', l)
    if m: orq = float(m.group(2))
agora = time.time(); T = sum(tot.values()) + orq
ant = json.load(open(EST)) if os.path.exists(EST) else None
print(time.strftime('%d/%m %H:%M'))
for p in sorted(tot, key=lambda k: -tot[k]):
    d = tot[p] - (ant['tot'].get(p, 0) if ant else 0)
    print(f'{p:11s} {n[p]:4d} ag {tot[p]/n[p]:.2f} M/ag  janela +{d:.1f} M')
print(f'orquestrador {orq:.1f} M  janela +{orq - (ant["orq"] if ant else 0):.1f} M')
if ant:
    h = (agora - ant['t']) / 3600
    print(f'CADENCIA {(T - ant["T"]) / h:.1f} M/h em {h * 60:.0f} min (total {T - ant["T"]:.1f} M)')
json.dump({'t': agora, 'T': T, 'tot': tot, 'orq': orq}, open(EST, 'w'))
t = open(os.path.join(RAIZ, 'docs/fases/fichas/README.md')).read().split('\n')
f3 = [0, 0]; f7 = [0, 0]; f8 = [0, 0]
for l in t:
    m = re.match(r'\| \[F3\.\d[^|]*\| (\d+) \| (\d+) \|', l)
    if m: f3[0] += int(m.group(1)); f3[1] += int(m.group(2))
    m = re.match(r'\| \[\d\d [^|]*\| \d+ \| (\d+)/(\d+)/(\d+) \| (\d+)/(\d+)/(\d+) \|', l)
    if m:
        g = list(map(int, m.groups())); f7[0] += g[0]; f7[1] += sum(g[:3]); f8[0] += g[3]; f8[1] += sum(g[3:])
c = f3[1] + f7[0] + f8[0]; tt = f3[0] + f7[1] + f8[1]
print(f'FICHAS F3 {f3[1]}/{f3[0]}  F7 {f7[0]}/{f7[1]}  F8 {f8[0]}/{f8[1]}  TOTAL {c}/{tt} ({100*c/tt:.0f}%)')
for j in glob.glob(os.path.join(S, 'subagents/workflows/*/journal.jsonl')):
    if agora - os.path.getmtime(j) > 3600: continue
    st, fe, pr, ini = {}, 0, 0, 0
    for l in open(j):
        d = json.loads(l)
        if d.get('type') == 'started': st[d['key']] = d.get('label', ''); ini += 1
        elif d.get('type') == 'result':
            lab = st.get(d['key'], ''); r = d.get('result') or {}
            if lab.split(':')[0] in ('construir', 'completar') and isinstance(r, dict): fe += 1; pr += bool(r.get('pronta'))
    print(f'WF {j.split("/")[-2]}: agentes {ini}, funções encerradas {fe}, prontas {pr}')
