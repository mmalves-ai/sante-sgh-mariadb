#!/usr/bin/env python3
# Fecho de imports de um conjunto de arquivos TypeScript (F2-L): segue os imports relativos (.js -> .ts), conta os
# arquivos alcançados e lista os que importam @sgh/legado. Inclui os imports só de tipo, porque o typecheck também
# os resolve. Só lê código; não abre banco nem .env.
#
# Uso: python3 -I tools/obra/fecho-imports.py <raiz> <arquivo.ts> [<arquivo.ts> ...] [--lista]
#   <raiz>: pasta a que os arquivos são relativos (ex.: apps/api/src). --lista imprime todos os arquivos do fecho.
# Saída: "<n> arquivos no fecho; <m> importam @sgh/legado", os pacotes @sgh/ alcançados e os arquivos com legado.
# Código de saída: 0 sem legado no fecho; 1 com legado; 2 uso errado ou arquivo inicial inexistente.
import os
import re
import sys

RX = re.compile(r"""(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)""", re.S)


def main(argv):
    lista = '--lista' in argv
    args = [a for a in argv if a != '--lista']
    if len(args) < 2:
        print(__doc__ or 'uso: fecho-imports.py <raiz> <arquivo.ts>...', file=sys.stderr)
        return 2
    raiz, iniciais = args[0], args[1:]
    fila = [os.path.normpath(os.path.join(raiz, f)) for f in iniciais]
    faltam = [f for f in fila if not os.path.exists(f)]
    if faltam:
        print('arquivo inicial inexistente: ' + ', '.join(os.path.relpath(f, raiz) for f in faltam), file=sys.stderr)
        return 2
    vistos, legado, pacotes = set(), {}, set()
    while fila:
        f = fila.pop()
        if f in vistos or not os.path.exists(f):
            continue
        vistos.add(f)
        with open(f, encoding='utf-8') as h:
            s = h.read()
        for m in RX.finditer(s):
            p = m.group(1) or m.group(2)
            if p.startswith('.'):
                q = os.path.normpath(os.path.join(os.path.dirname(f), p))
                fila.append(q[:-3] + '.ts' if q.endswith('.js') else q)
            elif p.startswith('@sgh/'):
                pacotes.add(p)
                if p == '@sgh/legado' or p.startswith('@sgh/legado/'):
                    legado[f] = legado.get(f, 0) + 1
    print(len(vistos), 'arquivos no fecho;', len(legado), 'importam @sgh/legado')
    print(sorted(pacotes))
    for f in sorted(legado):
        print('  legado:', os.path.relpath(f, raiz))
    if lista:
        for f in sorted(vistos):
            print('  ', os.path.relpath(f, raiz))
    return 1 if legado else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
