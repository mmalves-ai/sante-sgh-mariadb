#!/usr/bin/env python3
"""Commit para o E2E em lote (25/11): HEAD + arquivos novos ainda sem commit que o HEAD importa (fecho transitivo).

Por quê: com construtores em paralelo na mesma árvore, `git commit --only` de um arquivo compartilhado (modulo.ts,
index.ts) leva linhas que importam arquivos novos de outro agente, ainda sem commit; o HEAD deixa de compilar e o E2E
do integrador nem sobe (integrar-1, 25/11 09h40). Este script monta um commit à parte (ref refs/obra/e2e, índice
temporário), sem tocar no índice nem na branch da pasta, e imprime o sha e os arquivos acrescentados.

Uso: python3 -I tools/obra/commit-e2e.py [--ref HEAD]
"""
import os, re, subprocess, sys, tempfile

RAIZ = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
os.chdir(RAIZ)
REF = sys.argv[sys.argv.index('--ref') + 1] if '--ref' in sys.argv else 'HEAD'


def git(*a, env=None, inp=None):
    return subprocess.run(['git', *a], capture_output=True, text=True, check=True, env=env, input=inp).stdout


st = git('status', '--porcelain', '-uall')
novos = []
for l in st.splitlines():
    s, f = l[:2], l[3:]
    if (s in ('??', ' A', 'A ', 'AM')) and re.search(r'\.(ts|vue|sql|json)$', f) and not f.startswith(('docs/', '.')):
        novos.append(f)
novos_set = set(novos)
IMP = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]""")


def resolve(base, spec):
    p = os.path.normpath(os.path.join(os.path.dirname(base), spec))
    p = re.sub(r'\.js$', '', p)
    for c in (p + '.ts', p + '.vue', p, p + '/index.ts'):
        if c in novos_set:
            return c
    return None


def imports_novos(path, texto):
    return {r for m in IMP.finditer(texto) if (r := resolve(path, m.group(1)))}


# Ponto de partida: arquivos do HEAD que importam arquivo novo.
incluir = set()
for f in novos:
    b = re.escape(os.path.splitext(os.path.basename(f))[0])
    try:
        hits = git('grep', '-lE', r"""['"][^'"]*/""" + b + r"""(\.js)?['"]""", REF, '--', '*.ts', '*.vue').split()
    except subprocess.CalledProcessError:
        hits = []
    for h in hits:
        h = h.split(':', 1)[1]
        txt = git('show', f'{REF}:{h}')
        incluir |= imports_novos(h, txt)
# Fecho: os novos incluídos podem importar outros novos.
fila = list(incluir)
while fila:
    f = fila.pop()
    try:
        txt = open(f, encoding='utf-8').read()
    except OSError:
        continue
    for r in imports_novos(f, txt) - incluir:
        incluir.add(r); fila.append(r)

base = git('rev-parse', f'{REF}^{{commit}}').strip()
if '--arvore' in sys.argv:
    # Foto da árvore de trabalho inteira (o que os construtores compilam), para o E2E em lote com rodada aberta: o HEAD
    # leva linhas de um agente que dependem de arquivo sem commit de outro. A prova final continua o ci-sim do HEAD.
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, GIT_INDEX_FILE=os.path.join(d, 'index'))
        git('read-tree', base, env=env)
        git('add', '-A', '--', 'apps', 'packages', 'db', 'tools', 'conector', 'catalogos', env=env)
        tree = git('write-tree', env=env).strip()
    sha = git('commit-tree', tree, '-p', base, inp=f'E2E: foto da árvore de trabalho sobre {base[:8]} (fora da main)\n').strip()
    git('update-ref', 'refs/obra/e2e', sha)
    print(f'commit-e2e: {sha[:8]} = foto da árvore sobre {base[:8]}')
    print(sha)
    sys.exit(0)
if not incluir:
    print(f'commit-e2e: {base[:8]} (nada a acrescentar)')
    print(base)
    sys.exit(0)
with tempfile.TemporaryDirectory() as d:
    env = dict(os.environ, GIT_INDEX_FILE=os.path.join(d, 'index'))
    git('read-tree', base, env=env)
    git('add', '--', *sorted(incluir), env=env)
    tree = git('write-tree', env=env).strip()
msg = f'E2E: {base[:8]} + {len(incluir)} arquivos novos importados pelo HEAD (commit à parte, fora da main)\n\n' + '\n'.join(sorted(incluir))
sha = git('commit-tree', tree, '-p', base, inp=msg).strip()
git('update-ref', 'refs/obra/e2e', sha)
print(f'commit-e2e: {sha[:8]} = {base[:8]} + {len(incluir)} arquivos')
for f in sorted(incluir):
    print('  +', f)
print(sha)
