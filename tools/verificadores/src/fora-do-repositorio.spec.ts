import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logsDoNpmDoRepositorio, mudancas, pastasVigiadas } from './fora-do-repositorio.ts';

describe('prova de escrita fora do repositório (POL-4)', () => {
  it('vigia os caches globais de npm, pnpm, Nx e Node', () => {
    const p = pastasVigiadas('/home/x', 1000);
    expect(p).toContain('/home/x/.npm/_cacache');
    expect(p).toContain('/home/x/.local/share/pnpm/store');
    expect(p).toContain('/tmp/.nx');
    expect(p).toContain('/home/x/.docker');
    expect(p).toContain('/run/user/1000/pnpm-store-operation-locks-1000');
  });

  it('acusa pasta com data nova ou que passou a existir', () => {
    expect(mudancas({ a: 1, b: null, c: 3 }, { a: 1, b: 5, c: 4 })).toEqual(['b', 'c']);
    expect(mudancas({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('log do npm com cwd no repositório (ou subpasta) é rastro; outra árvore com prefixo parecido não', () => {
    const base = resolve(import.meta.dirname, '../../../.tmp');
    mkdirSync(base, { recursive: true });
    const pasta = mkdtempSync(join(base, 'npm-logs-'));
    try {
      writeFileSync(join(pasta, 'a-debug-0.log'), '13 verbose cwd /w/new-sgh/apps/web\n');
      writeFileSync(join(pasta, 'b-debug-0.log'), '13 verbose cwd /w/new-sgh\n');
      writeFileSync(join(pasta, 'c-debug-0.log'), '13 verbose cwd /w/new-sgh-wt/M03\n');
      writeFileSync(join(pasta, 'd.txt'), '13 verbose cwd /w/new-sgh\n');
      expect(logsDoNpmDoRepositorio('/w/new-sgh', pasta).sort()).toEqual(['a-debug-0.log', 'b-debug-0.log']);
      expect(logsDoNpmDoRepositorio('/w/new-sgh', join(pasta, 'nao-existe'))).toEqual([]);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
