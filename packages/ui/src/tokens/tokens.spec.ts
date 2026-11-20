import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { folhaDeTokens } from '../tema/css.js';
import { NOMES_TOKENS, tokensDoTema } from './cores.js';
import { CORES_REDE_SANTE } from './marcas.js';

const raiz = resolve(import.meta.dirname, '../../../..');
const HEX = /#[0-9a-f]{3,8}\b/i;

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n);
    if (statSync(c).isDirectory()) return n === 'node_modules' || n === 'dist' ? [] : arquivos(c);
    return /\.(ts|vue|css)$/.test(n) ? [c] : [];
  });
}

describe('nenhuma cor solta (regra 1)', () => {
  it('todo token existe nos dois temas e é uma cor hexadecimal', () => {
    const t = tokensDoTema(CORES_REDE_SANTE);
    for (const n of NOMES_TOKENS) {
      expect(t.claro[n], n).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      expect(t.escuro[n], n).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });

  it('a folha gerada declara cada token como variável --sgh-*', () => {
    const css = folhaDeTokens(CORES_REDE_SANTE);
    for (const n of NOMES_TOKENS) expect(css).toContain(`--sgh-${n}:`);
  });

  it('nenhum hexadecimal de cor fora de packages/ui/src/tokens/ (ui e web, inclusive .ts e .vue)', () => {
    const pastas = ['packages/ui/src', 'packages/ui/catalogo', 'apps/web/src'].map((p) => resolve(raiz, p));
    const soltos = pastas
      .flatMap(arquivos)
      .filter((a) => !a.includes(`${join('packages', 'ui', 'src', 'tokens')}`))
      .filter((a) => !a.endsWith('.spec.ts'))
      .filter((a) =>
        readFileSync(a, 'utf8')
          .split('\n')
          .some((l) => HEX.test(l.replace(/&#\d+;|&#x[0-9a-f]+;/gi, ''))),
      )
      .map((a) => relative(raiz, a));
    expect(soltos).toEqual([]);
  });
});
