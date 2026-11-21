import { describe, expect, it } from 'vitest';
import type { UsoDaTabela } from './impacto.js';
import {
  casasDecimais,
  componenteValido,
  confirmacoesFaltando,
  fatiar,
  type ItemParaReajuste,
  proporReajuste,
} from './proposta-reajuste.js';

const item = (
  codigo: number,
  ch: number | null,
  extra: Partial<ItemParaReajuste> = {},
): ItemParaReajuste => ({
  codigo,
  nome: `ITEM SINTÉTICO ${codigo}`,
  situacao: 'A',
  ch: 0,
  vigencia: ch === null ? null : '2025-01-01',
  valores: ch === null ? null : { ch, co: 0, filme: 0, anes: 0, outros: 0 },
  ultimaData: ch === null ? null : '2025-01-01',
  temNaData: false,
  ...extra,
});
const uma: UsoDaTabela[] = [{ codigo: 51, nome: 'OPERADORA SINTÉTICA', ativo: true, usos: ['externa'] }];
const ctx = { tabela: 305, data: '2026-10-20', hoje: '2026-10-20', convenios: uma };

describe('proposta de reajuste (preço nunca sobrescrito; vetos e alertas)', () => {
  it('percentual sobre o VALOR_CH vigente, arredondado a centavos; componentes copiados exatos', () => {
    const p = proporReajuste(
      [
        item(1, 100),
        item(2, 89.2008, { valores: { ch: 89.2008, co: 1.2345, filme: 0, anes: 0, outros: 0 } }),
      ],
      { modo: 'percentual', percentual: 10 },
      ctx,
    );
    expect(p.vetos).toEqual([]);
    expect(p.linhas.map((l) => l.novos.ch)).toEqual([110, 98.12]);
    expect(p.linhas[1]?.novos.co).toBe(1.2345);
    expect(p.resumo).toMatchObject({ itens: 2, mudam: 2, somaChAtual: 189.2, transacoes: 1 });
    expect(p.alertas.map((a) => a.codigo)).toEqual(['componentes-copiados', 'muda-agora']);
    expect(p.confirmacoes).toEqual([]);
    expect(p.linhas[0]?.variacao).toBe(10);
  });
  it('veto do modelo CH (AMB), de item inativo e de vigência posterior ou já na data', () => {
    const p = proporReajuste(
      [
        item(1, 10, { ch: 5 }),
        item(2, 10, { situacao: 'I' }),
        item(3, 10, { vigencia: '2026-10-20', temNaData: true }),
        item(4, 10, { vigencia: '2026-10-25' }),
      ],
      { modo: 'percentual', percentual: 5 },
      ctx,
    );
    expect(p.vetos.map((v) => v.codigo).sort()).toEqual(
      ['item-inativo', 'modelo-ch', 'vigencia-na-data', 'vigencia-posterior'].sort(),
    );
    expect(p.vetos.find((v) => v.codigo === 'modelo-ch')?.itens).toEqual([1]);
  });
  it('datas: inválida, retroativa e futura sem decisão (DP-33) são vetadas; futura com decisão passa', () => {
    const base = [item(1, 10)];
    const pct = { modo: 'percentual', percentual: 1 } as const;
    expect(proporReajuste(base, pct, { ...ctx, data: '2026-02-31' }).vetos[0]?.codigo).toBe('data-invalida');
    expect(proporReajuste(base, pct, { ...ctx, data: '2026-10-19' }).vetos[0]?.codigo).toBe(
      'data-anterior-a-hoje',
    );
    expect(proporReajuste(base, pct, { ...ctx, data: '2026-11-01' }).vetos[0]?.codigo).toBe('data-futura');
    const futura = proporReajuste(base, pct, { ...ctx, data: '2026-11-01', vigenciaFuturaPermitida: true });
    expect(futura.vetos).toEqual([]);
    expect(futura.alertas.some((a) => a.codigo === 'muda-agora')).toBe(false);
  });
  it('percentual inválido, sem itens e acima do teto', () => {
    expect(
      proporReajuste([item(1, 10)], { modo: 'percentual', percentual: -100 }, ctx).vetos[0]?.codigo,
    ).toBe('percentual-invalido');
    expect(proporReajuste([], { modo: 'percentual', percentual: 1 }, ctx).vetos.map((v) => v.codigo)).toEqual(
      ['sem-itens'],
    );
    const muitos = Array.from({ length: 6001 }, (_, i) => item(i + 1, 10));
    expect(proporReajuste(muitos, { modo: 'percentual', percentual: 1 }, ctx).vetos[0]?.codigo).toBe(
      'teto-itens',
    );
  });
  it('percentual sem vigência anterior é vetado; valor informado vira primeiro preço', () => {
    const semBase = proporReajuste([item(9, null)], { modo: 'percentual', percentual: 3 }, ctx);
    expect(semBase.vetos.map((v) => v.codigo)).toContain('sem-vigencia-anterior');
    const valor = proporReajuste([item(9, null)], { modo: 'valor', valores: new Map([[9, 55.5]]) }, ctx);
    expect(valor.vetos).toEqual([]);
    expect(valor.alertas.map((a) => a.codigo)).toContain('primeiro-preco');
    expect(valor.linhas[0]?.novos).toEqual({ ch: 55.5, co: 0, filme: 0, anes: 0, outros: 0 });
  });
  it('sem efeito, valor ausente ou inválido, preço zero', () => {
    expect(
      proporReajuste([item(1, 10)], { modo: 'valor', valores: new Map([[1, 10]]) }, ctx).vetos.map(
        (v) => v.codigo,
      ),
    ).toEqual(['sem-efeito']);
    const ruins = proporReajuste(
      [item(1, 10), item(2, 10)],
      { modo: 'valor', valores: new Map([[1, 1.23456]]) },
      ctx,
    );
    expect(ruins.vetos.find((v) => v.codigo === 'valor-invalido')?.itens).toEqual([1, 2]);
    const zero = proporReajuste([item(1, 10)], { modo: 'valor', valores: new Map([[1, 0]]) }, ctx);
    expect(zero.alertas.map((a) => a.codigo)).toContain('preco-zero');
  });
  it('modo arquivo: componentes informados; os ausentes ficam como estão; alguns sem mudança', () => {
    const p = proporReajuste(
      [item(1, 10), item(2, 20, { ultimaData: '2027-01-01' })],
      {
        modo: 'arquivo',
        valores: new Map([
          [1, { ch: 12.3456, co: 2 }],
          [2, { ch: 20 }],
        ]),
      },
      ctx,
    );
    expect(p.vetos).toEqual([]);
    expect(p.linhas[0]?.novos).toEqual({ ch: 12.3456, co: 2, filme: 0, anes: 0, outros: 0 });
    expect(p.resumo.mudam).toBe(1);
    expect(p.alertas.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(['sem-mudanca-em-alguns', 'vigencia-futura-existente']),
    );
  });
  it('tabela compartilhada (10) e com percentual por procedimento exigem confirmação; 625 a confirmar', () => {
    const dois: UsoDaTabela[] = [
      { codigo: 1, nome: 'SUS SINTÉTICO', ativo: true, usos: ['externa'] },
      { codigo: 10, nome: 'PARTICULAR SINTÉTICO', ativo: true, usos: ['externa'] },
    ];
    const p10 = proporReajuste(
      [item(1, 10)],
      { modo: 'percentual', percentual: 2 },
      { ...ctx, tabela: 10, convenios: dois },
    );
    expect(p10.confirmacoes).toEqual(['tabelaCompartilhada']);
    expect(confirmacoesFaltando(p10.confirmacoes, {})).toEqual(['tabelaCompartilhada']);
    expect(confirmacoesFaltando(p10.confirmacoes, { tabelaCompartilhada: true })).toEqual([]);
    const p625 = proporReajuste(
      [item(1, 10)],
      { modo: 'percentual', percentual: 2 },
      { ...ctx, tabela: 625 },
    );
    expect(p625.confirmacoes).toEqual(['percentualTabela']);
    expect(p625.alertas.map((a) => a.codigo)).toContain('percentual-a-confirmar');
  });
  it('mais de 200 itens: transações curtas', () => {
    const muitos = Array.from({ length: 450 }, (_, i) => item(i + 1, 10));
    const p = proporReajuste(muitos, { modo: 'percentual', percentual: 1 }, ctx);
    expect(p.resumo.transacoes).toBe(3);
    expect(p.alertas.map((a) => a.codigo)).toContain('transacoes');
    expect(fatiar([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('precisão: casas decimais e componentes NUMERIC(10,2)', () => {
    expect(casasDecimais(1.2345)).toBe(4);
    expect(casasDecimais(10)).toBe(0);
    expect(casasDecimais(1e-7)).toBe(7);
    expect(casasDecimais(Number.NaN)).toBe(Infinity);
    expect(componenteValido('ch', 1.2345)).toBe(true);
    expect(componenteValido('anes', 1.234)).toBe(false);
    expect(componenteValido('filme', -1)).toBe(false);
    expect(componenteValido('outros', 1e9)).toBe(false);
  });
});
