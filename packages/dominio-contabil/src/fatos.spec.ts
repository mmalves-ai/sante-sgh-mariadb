import { describe, expect, it } from 'vitest';
import { linha } from './fixtures.spec-util.js';
import {
  classificarLinha,
  conteudoCanonico,
  estadoDepoisDoCiclo,
  impressaoDaLinha,
  planoDoCiclo,
  separarLote,
} from './fatos.js';

const o = { lote: 500, folga: 100, faixaVarredura: 1000 };

describe('leitura incremental (seção 10: sem perder linha alterada durante a leitura)', () => {
  it('primeiro ciclo: só novos', () => {
    const p = planoDoCiclo({ tabela: 'MFCONPAG', marca: 0, varredura: 1 }, o);
    expect(p).toEqual({ novos: { acimaDe: 0, lote: 500 }, revisao: null, varredura: null });
  });

  it('janela de revisão logo abaixo da marca e varredura abaixo dela', () => {
    const p = planoDoCiclo({ tabela: 'MFCONPAG', marca: 5000, varredura: 1 }, o);
    expect(p.revisao).toEqual({ de: 4901, ate: 5000 });
    expect(p.varredura).toEqual({ de: 1, ate: 1000 });
  });

  it('marca menor que a folga: a revisão começa em 1 e não há varredura', () => {
    const p = planoDoCiclo({ tabela: 'X', marca: 50, varredura: 1 }, o);
    expect(p.revisao).toEqual({ de: 1, ate: 50 });
    expect(p.varredura).toBeNull();
  });

  it('sem folga, a varredura cobre até a marca', () => {
    const p = planoDoCiclo({ tabela: 'X', marca: 300, varredura: 1 }, { ...o, folga: 0 });
    expect(p.revisao).toBeNull();
    expect(p.varredura).toEqual({ de: 1, ate: 300 });
  });

  it('a varredura anda em rodízio e volta ao início', () => {
    let e = { tabela: 'X', marca: 2500, varredura: 1 };
    const faixas: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = planoDoCiclo(e, o);
      faixas.push(`${p.varredura?.de}-${p.varredura?.ate}`);
      e = estadoDepoisDoCiclo(e, p, []);
    }
    expect(faixas).toEqual(['1-1000', '1001-2000', '2001-2400', '1-1000']);
  });

  it('a marca sobe à maior chave nova e nunca desce', () => {
    const e = { tabela: 'X', marca: 10, varredura: 1 };
    const p = planoDoCiclo(e, o);
    expect(estadoDepoisDoCiclo(e, p, [12, 15, 11]).marca).toBe(15);
    expect(estadoDepoisDoCiclo(e, p, []).marca).toBe(10);
  });

  it('opções inválidas', () => {
    expect(() => planoDoCiclo({ tabela: 'X', marca: 1, varredura: 1 }, { ...o, lote: 0 })).toThrow(
      RangeError,
    );
  });

  it('a linha que confirmou depois do lote (chave abaixo da marca) entra pela revisão como nova', () => {
    // Lote 1 leu 101 e 102 (a 100 ainda não estava confirmada); a marca foi a 102.
    const conhecidas = new Map([
      [101, impressaoDaLinha({ V: 1 })],
      [102, impressaoDaLinha({ V: 2 })],
    ]);
    const p = planoDoCiclo({ tabela: 'X', marca: 102, varredura: 1 }, o);
    expect(p.revisao!.de).toBeLessThanOrEqual(100);
    const r = separarLote(
      [
        linha('X', 100, { V: 0 }),
        linha('X', 101, { V: 1 }),
        linha('X', 102, { V: 9 }),
        linha('X', 101, { V: 1 }),
      ],
      conhecidas,
    );
    expect(r.novos.map((l) => l.id)).toEqual([100]);
    expect(r.alterados.map((l) => l.id)).toEqual([102]);
    expect(r.iguais).toBe(1);
  });
});

describe('impressão do conteúdo', () => {
  it('independe da ordem das colunas e distingue nulo de vazio', () => {
    expect(impressaoDaLinha({ A: 1, B: 'x' })).toBe(impressaoDaLinha({ B: 'x', A: 1 }));
    expect(impressaoDaLinha({ A: null })).not.toBe(impressaoDaLinha({ A: '' }));
    expect(impressaoDaLinha({ A: 1 })).toMatch(/^[0-9a-f]{16}$/);
    expect(conteudoCanonico({ B: 2, A: null })).toBe('A=∅|B=2');
  });

  it('classifica nova, alterada e igual', () => {
    const l = linha('X', 1, { A: 1 });
    expect(classificarLinha(l, new Map())).toBe('novo');
    expect(classificarLinha(l, new Map([[1, impressaoDaLinha({ A: 1 })]]))).toBe('igual');
    expect(classificarLinha(l, new Map([[1, 'outra']]))).toBe('alterado');
  });
});
