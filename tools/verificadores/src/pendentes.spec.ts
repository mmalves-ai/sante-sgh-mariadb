import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listarMarcadores, resumoMarcadores } from './pendentes.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const pacote = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('marcadores PENDENTE (regra 4)', () => {
  it('o resumo de pnpm verificar lista cada marcador (desde o M08, o package.json não tem nenhum)', () => {
    // M08: matriz:verificar e matriz:marco eram os últimos marcadores PENDENTE da Fase 0.
    expect(listarMarcadores(pacote.scripts)).toEqual([]);
    expect(resumoMarcadores([])).toBe('Marcadores PENDENTE: nenhum.');
    const marcadores = listarMarcadores({ 'x:y': 'node tools/verificadores/src/pendente.ts M99 x:y' });
    expect(marcadores).toEqual([{ script: 'x:y', marco: 'M99' }]);
    const resumo = resumoMarcadores(marcadores);
    for (const m of marcadores) expect(resumo).toContain(`PENDENTE: ${m.marco}  pnpm ${m.script}`);
    expect(resumo).toContain('NÃO contam como verificação feita');
  });

  it('os comandos reais do M00 não são marcadores', () => {
    const scripts = listarMarcadores(pacote.scripts).map((m) => m.script);
    for (const real of [
      'dev',
      'verificar',
      'verificar:tudo',
      'verificadores:segredos',
      'seguranca:verificar',
      'e2e',
    ])
      expect(scripts).not.toContain(real);
  });

  it('cada marcador aponta o marco que cria o comando', () => {
    expect(listarMarcadores({ x: 'node tools/verificadores/src/pendente.ts M04 x', y: 'eslint .' })).toEqual([
      { script: 'x', marco: 'M04' },
    ]);
  });
});
