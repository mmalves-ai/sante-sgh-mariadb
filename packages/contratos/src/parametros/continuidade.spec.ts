import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PARAMETROS_CONTINUIDADE } from './continuidade.js';

const SEMENTE = fileURLToPath(
  new URL('../../../../db/migracoes/02_ADM/99za_parametros_continuidade_chaves.sql', import.meta.url),
);

/** Literais SQL de uma linha `SELECT ... AS chave, ...` da semente: texto, NULL ou número, na ordem. */
function literais(linha: string): (string | number | null)[] {
  const corpo = linha.slice(linha.indexOf('SELECT') + 6);
  const saida: (string | number | null)[] = [];
  for (const m of corpo.matchAll(/'((?:[^'\\]|''|\\.)*)'|\bNULL\b|\bTRUE\b|\bFALSE\b|-?\d+(?:\.\d+)?/g)) {
    if (m[1] !== undefined) saida.push(m[1].replace(/''/g, "'").replace(/\\\\/g, '\\'));
    else if (m[0] === 'NULL') saida.push(null);
    else if (m[0] === 'TRUE' || m[0] === 'FALSE') saida.push(m[0]);
    else saida.push(Number(m[0]));
  }
  return saida;
}

describe('parâmetros de continuidade da importação: contrato e semente do banco', () => {
  const linhas = readFileSync(SEMENTE, 'utf8')
    .split('\n')
    .filter((l) => / AS chave, /.test(l));
  const semente = new Map(linhas.map((l) => [literais(l)[0] as string, literais(l)]));

  it('a semente tem exatamente as chaves do contrato, sem repetição', () => {
    expect(linhas.length).toBe(PARAMETROS_CONTINUIDADE.length);
    expect(new Set(semente.keys())).toEqual(new Set(PARAMETROS_CONTINUIDADE.map((d) => d.chave)));
  });

  it('tipo, descrição, padrão, mínimo, máximo, área dona e formato iguais aos do contrato', () => {
    for (const d of PARAMETROS_CONTINUIDADE) {
      const [, , descricao, tipo, padrao, minimo, maximo, dono, formato] = semente.get(d.chave) ?? [];
      expect({ chave: d.chave, descricao, tipo, padrao, minimo, maximo, dono, formato }).toEqual({
        chave: d.chave,
        descricao: d.descricao,
        tipo: d.tipo,
        padrao: d.padrao === '' ? null : d.padrao,
        minimo: d.minimo ?? null,
        maximo: d.maximo ?? null,
        dono: d.dono,
        formato: d.formato?.expressao ?? null,
      });
    }
  });

  it('vocabulário neutro: nada de S/N, hora da origem nem texto da origem na descrição', () => {
    for (const d of PARAMETROS_CONTINUIDADE) {
      expect(d.descricao).not.toMatch(/S ou N|da origem|aguarda regra/);
      if (d.tipo === 'booleano') expect(['true', 'false']).toContain(d.padrao);
    }
  });
});
