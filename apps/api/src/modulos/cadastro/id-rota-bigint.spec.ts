import { describe, expect, it } from 'vitest';
import { esquemaInternarBanco } from '../adt/esquemas.js';
import { inteiro } from '../precos/base.js';
import { idDaRota } from './comum.js';

/** Item próprio do hospital no espelho do catálogo: a partir de 10^12 (BIGINT UNSIGNED). */
const ITEM_PROPRIO = 10 ** 12 + 1;

describe('id de linha BIGINT nas rotas e consultas da API', () => {
  it('idDaRota aceita 10^12 + 1 e 2^53 - 1; recusa acima, zero, negativo e lixo com 404', () => {
    expect(idDaRota(String(ITEM_PROPRIO))).toBe(ITEM_PROPRIO);
    expect(idDaRota('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const v of ['9007199254740992', '0', '-1', '12345678901234567', 'abc', ''])
      expect(() => idDaRota(v)).toThrow(/não encontrado/);
  });

  it('inteiro() de preços: o id padrão vai até 2^53 - 1; a faixa explícita continua valendo', () => {
    expect(inteiro(String(ITEM_PROPRIO), 'item')).toBe(ITEM_PROPRIO);
    expect(() => inteiro('9007199254740992', 'item')).toThrow();
    expect(() => inteiro('-1', 'item')).toThrow();
    expect(() => inteiro('40000', 'tabela', [0, 32767])).toThrow();
  });

  it('admissão (esquema da API): CID principal e caráter da admissão aceitam item próprio; acima de 2^53 - 1, não', () => {
    const caminhos = (v: unknown) => {
      const r = esquemaInternarBanco.safeParse(v);
      return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    };
    const ok = caminhos({ cidPrincipal: ITEM_PROPRIO, caraterAdmissao: ITEM_PROPRIO });
    expect(ok).not.toContain('cidPrincipal');
    expect(ok).not.toContain('caraterAdmissao');
    const fora = caminhos({ cidPrincipal: Number.MAX_SAFE_INTEGER + 1, caraterAdmissao: 0 });
    expect(fora).toContain('cidPrincipal');
    expect(fora).toContain('caraterAdmissao');
  });
});
