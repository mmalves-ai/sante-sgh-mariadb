// Regra 6 (ficha do M34): a régua declarada (competência ou data do item), a glosa = VALOR_C − VLR_PG dos itens com
// GLOSADO = 'T', o mês sem baixa sem "0% de glosa" e a conferência contra o número do relatório de origem. Valores
// sintéticos (os casos de `sante-api: test/gestao.test.js` repetidos nas duas réguas).
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirContraOrigem,
  diasDoIntervalo,
  glosaDosItensBaixados,
  linhasDeFaturamento,
  linhasDeGlosa,
  mesesDoIntervalo,
  REGUA_PADRAO,
  reguaDeclarada,
  reguaDoParametro,
  type SomaItens,
} from './reguas-receita.js';

const S = (o: Partial<SomaItens>): SomaItens => ({
  convenio: 1,
  contas: 1,
  itens: 1,
  cobrado: 0,
  pago: 0,
  itensBaixados: 0,
  cobradoBaixado: 0,
  pagoBaixado: 0,
  ...o,
});

describe('réguas da receita e glosa (regra 6)', () => {
  it('glosa = cobrado − pago dos baixados, sobre o cobrado baixado', () => {
    expect(glosaDosItensBaixados({ cobradoBaixado: 27_000_000, pagoBaixado: 22_910_000 })).toEqual({
      glosa: 4_090_000,
      percentual: 15.1,
    });
    expect(glosaDosItensBaixados({ cobradoBaixado: 0, pagoBaixado: 0 })).toEqual({
      glosa: 0,
      percentual: null,
    });
  });

  it('a régua do parâmetro; a padrão é a competência; outra é recusada', () => {
    expect(REGUA_PADRAO).toBe('competencia');
    expect(reguaDoParametro(undefined)).toBe('competencia');
    expect(reguaDoParametro('data-do-item')).toBe('data-do-item');
    expect(() => reguaDoParametro('caixa')).toThrow(/Régua inválida/);
  });

  it('competência pelos meses; data do item pelos dias do intervalo', () => {
    expect(mesesDoIntervalo('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(diasDoIntervalo('2026-01', '2026-02')).toEqual({ inicio: '2026-01-01', fim: '2026-02-28' });
    expect(diasDoIntervalo('2024-02', '2024-02').fim).toBe('2024-02-29');
    expect(() => mesesDoIntervalo('2000-01', '2030-12')).toThrow(/longo/);
  });

  it('linhas da glosa e do faturamento por convênio, em ordem do valor', () => {
    const somas = [
      S({ convenio: 2, cobrado: 100, pago: 90, itensBaixados: 3, cobradoBaixado: 80, pagoBaixado: 60 }),
      S({ convenio: 1, cobrado: 300, pago: 0, itensBaixados: 0, cobradoBaixado: 0, pagoBaixado: 0 }),
    ];
    const nomes = new Map([[2, 'Convênio Sintético']]);
    expect(linhasDeGlosa(somas, nomes)).toEqual([
      {
        convenio: 2,
        nomeConvenio: 'Convênio Sintético',
        itensBaixados: 3,
        cobradoBaixado: 80,
        pagoBaixado: 60,
        glosa: 20,
        percentualGlosa: 25,
      },
      {
        convenio: 1,
        nomeConvenio: null,
        itensBaixados: 0,
        cobradoBaixado: 0,
        pagoBaixado: 0,
        glosa: 0,
        percentualGlosa: null,
      },
    ]);
    expect(linhasDeFaturamento(somas, nomes).map((l) => l['convenio'])).toEqual([1, 2]);
  });

  it('todo relatório do catálogo com dinheiro declara a régua e a fórmula', () => {
    for (const r of RELATORIOS_CATALOGO) expect(reguaDeclarada(r), r.codigo).toBe(true);
    expect(
      reguaDeclarada({
        colunas: [{ campo: 'v', rotulo: 'v', tipo: 'dinheiro', classe: 'comum' }],
        regua: null,
        formula: 'soma de tudo que existe',
      }),
    ).toBe(false);
  });

  it('conferência contra o relatório de origem: até um centavo por linha; linha a mais ou a menos é diferença', () => {
    expect(conferirContraOrigem(new Map([['1', 10.004]]), new Map([['1', 10]])).igual).toBe(true);
    const r = conferirContraOrigem(
      new Map([
        ['1', 10],
        ['2', 5],
      ]),
      new Map([
        ['1', 10.5],
        ['3', 1],
      ]),
    );
    expect(r.igual).toBe(false);
    expect(r.diferencas).toEqual([
      { chave: '1', novo: 10, origem: 10.5 },
      { chave: '2', novo: 5, origem: null },
      { chave: '3', novo: null, origem: 1 },
    ]);
  });
});
