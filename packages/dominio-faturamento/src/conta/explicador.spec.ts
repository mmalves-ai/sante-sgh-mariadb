// Regra 8 (ficha do M30): o explicador lê as colunas do item e o contrato, na ordem fixa, e termina em "confere" ou
// "diferença de R$ x, regra não identificada"; nunca altera o item. Casos sintéticos na forma dos itens da cópia.
import { describe, expect, it } from 'vitest';
import {
  agregarExplicacoes,
  type BaseContrato,
  ETAPAS_EXPLICACAO,
  explicarPreco,
  type ItemGravado,
} from '../index.js';

const item = (x: Partial<ItemGravado>): ItemGravado => ({
  grupo: 'sadt',
  data: '2026-01-15',
  quantidade: 1,
  unitario: 0,
  valor: 0,
  ch: 0,
  cop: 0,
  filme: 0,
  perc: 0,
  percE: 0,
  formula: 1,
  pacote: 'N',
  codigo: 40302199,
  ...x,
});
const contrato = (x: Partial<BaseContrato>): BaseContrato => ({
  convenio: 625,
  tabela: 53,
  nomeTabela: 'HM_EXT',
  vigencia: '2025-07-01',
  ...x,
});

describe('explicar preço (regra 8)', () => {
  it('ordem fixa das etapas e "confere" no modelo VALOR (componentes com 2 casas)', () => {
    const i = item({ unitario: 566.07, valor: 566.07, ch: 511.82, filme: 54.25 });
    const x = explicarPreco(i, contrato({ valores: { ch: 511.82, co: 0, filme: 54.25 } }));
    expect(x.passos.map((p) => p.etapa)).toEqual([...ETAPAS_EXPLICACAO]);
    expect(x).toMatchObject({ modelo: 'valor', confere: true, causa: 'confere', diferenca: 0 });
    expect(x.conclusao).toContain('Confere');
    expect(i.unitario).toBe(566.07);
  });
  it('filme pelo índice do convênio quando houver m²', () => {
    const x = explicarPreco(
      item({ unitario: 30, valor: 30 }),
      contrato({ valores: { ch: 20, co: 0, filme: 99 }, filme: { m2: 2, indice: 5 } }),
    );
    expect(x.confere).toBe(true);
  });
  it('porte CBHPM (caso do cap-11: porte × fração + UCO × índice)', () => {
    const x = explicarPreco(
      item({ unitario: 4.75, valor: 4.75 }),
      contrato({ porte: { codigo: '1A', valor: 10.5, fracao: 0.01 }, cop: { uco: 0.387, indice: 12 } }),
    );
    expect(x.modelo).toBe('porte');
    expect(x.confere).toBe(true);
  });
  it('CH × índice', () => {
    const x = explicarPreco(
      item({ grupo: 'honorarios', unitario: 80, valor: 80 }),
      contrato({ ch: { quantidade: 100, indice: 0.8 } }),
    );
    expect(x).toMatchObject({ modelo: 'ch', confere: true });
  });
  it('mat/med: referência com o acréscimo do item (4 casas no unitário)', () => {
    const x = explicarPreco(
      item({ grupo: 'matmed', unitario: 14.445, valor: 14.45, perc: 38.23, codigo: 310165 }),
      contrato({ referencia: { valor: 10.4493, pmc: null, pf: null } }),
    );
    expect(x).toMatchObject({ modelo: 'referencia', confere: true });
    expect(x.passos.find((p) => p.etapa === 'modificadores')?.texto).toContain('acréscimo');
  });
  it('via de acesso: o percentual como fração do valor', () => {
    const x = explicarPreco(
      item({ grupo: 'honorarios', unitario: 50, valor: 50, perc: 50 }),
      contrato({ valores: { ch: 100, co: 0, filme: 0 } }),
    );
    expect(x.confere).toBe(true);
    expect(x.passos.find((p) => p.etapa === 'modificadores')?.texto).toContain('via');
  });
  it('diária ou taxa', () => {
    const x = explicarPreco(
      item({ grupo: 'diarias-taxas', unitario: 56.73, valor: 113.46, quantidade: 2 }),
      contrato({ diaria: { valor: 56.73 } }),
    );
    expect(x).toMatchObject({ modelo: 'diaria', confere: true });
  });
  it('diferença: "diferença de R$ x, regra não identificada"', () => {
    const x = explicarPreco(
      item({ grupo: 'diarias-taxas', unitario: 60, valor: 60 }),
      contrato({ diaria: { valor: 56.73 } }),
    );
    expect(x.confere).toBe(false);
    expect(x.diferenca).toBe(-3.27);
    expect(x.conclusao).toBe('Diferença de R$ 3,27, regra não identificada.');
    expect(x.causa).toBe('nao-identificada');
  });
  it('diferença com percentual: causa "modificador"; diferença mínima: "arredondamento"', () => {
    expect(
      explicarPreco(
        item({ grupo: 'matmed', unitario: 20, valor: 20, perc: 10 }),
        contrato({ referencia: { valor: 10, pmc: null, pf: null } }),
      ).causa,
    ).toBe('modificador');
    expect(
      explicarPreco(
        item({ grupo: 'matmed', unitario: 10.01, valor: 30.03, quantidade: 3 }),
        contrato({ referencia: { valor: 10, pmc: null, pf: null } }),
      ).causa,
    ).toBe('arredondamento');
  });
  it('sem tabela vigente: valor digitado, regra não identificada', () => {
    const x = explicarPreco(item({ unitario: 33, valor: 33 }), contrato({ tabela: null }));
    expect(x).toMatchObject({ modelo: 'digitado', confere: false, causa: 'digitado', calculado: null });
    expect(x.conclusao).toContain('regra não identificada');
    expect(explicarPreco(item({ unitario: 33, valor: 33 }), null).passos[0]?.texto).toContain('sem tabela');
  });
  it('pacote: o item incluso fica a zero', () => {
    const z = explicarPreco(
      item({ pacote: 'S', unitario: 0, valor: 0 }),
      contrato({ valores: { ch: 10, co: 0, filme: 0 } }),
    );
    expect(z).toMatchObject({ confere: true });
    expect(z.passos.find((p) => p.etapa === 'pacote')?.texto).toContain('incluso');
    const nz = explicarPreco(
      item({ pacote: 'S', unitario: 10, valor: 10 }),
      contrato({ valores: { ch: 10, co: 0, filme: 0 } }),
    );
    expect(nz.confere).toBe(true);
    const sem = explicarPreco(item({ pacote: 'S', unitario: 0, valor: 0 }), contrato({ tabela: null }));
    expect(sem).toMatchObject({ confere: true, causa: 'confere' });
  });
  it('avisos de faturabilidade entram na etapa 3', () => {
    const x = explicarPreco(item({}), contrato({}), ['Regra "senha": falta senha de autorização.']);
    expect(x.passos[2]?.texto).toContain('senha');
  });
  it('agrega só contagens por grupo e causa', () => {
    const ok = explicarPreco(
      item({ grupo: 'diarias-taxas', unitario: 1, valor: 1 }),
      contrato({ diaria: { valor: 1 } }),
    );
    const ko = explicarPreco(
      item({ grupo: 'diarias-taxas', unitario: 2, valor: 2 }),
      contrato({ diaria: { valor: 1 } }),
    );
    const a = agregarExplicacoes([
      { grupo: 'diarias-taxas', explicacao: ok },
      { grupo: 'diarias-taxas', explicacao: ko },
    ]);
    expect(a['diarias-taxas']).toEqual({
      total: 2,
      conferem: 1,
      causas: { confere: 1, 'nao-identificada': 1 },
    });
    expect(a.matmed.total).toBe(0);
  });
});

describe('preço pela tabela (lançamento manual)', () => {
  it('a mesma cascata do explicador, sem modificador', async () => {
    const { precoDaTabela } = await import('../index.js');
    expect(precoDaTabela('sadt', contrato({ valores: { ch: 10.005, co: 1, filme: 0 } }), 2)).toEqual({
      modelo: 'valor',
      unitario: 11.01,
      ch: 10.01,
      cop: 1,
      filme: 0,
      valor: 22.02,
    });
    expect(
      precoDaTabela(
        'sadt',
        contrato({ valores: { ch: 10, co: 0, filme: 3 }, filme: { m2: 1, indice: 2 } }),
        1,
      )?.unitario,
    ).toBe(12);
    expect(
      precoDaTabela(
        'sadt',
        contrato({ porte: { codigo: '1A', valor: 100, fracao: 0.5 }, cop: { uco: 1, indice: 2 } }),
        1,
      )?.unitario,
    ).toBe(52);
    expect(
      precoDaTabela('sadt', contrato({ porte: { codigo: '1A', valor: 100, fracao: 0.5 } }), 1)?.unitario,
    ).toBe(50);
    expect(precoDaTabela('honorarios', contrato({ ch: { quantidade: 10, indice: 0.5 } }), 1)?.modelo).toBe(
      'ch',
    );
    expect(
      precoDaTabela('matmed', contrato({ referencia: { valor: 1.23456, pmc: null, pf: null } }), 3),
    ).toMatchObject({ unitario: 1.2346, valor: 3.7 });
    expect(precoDaTabela('diarias-taxas', contrato({ diaria: { valor: 56.73 } }), 2)?.valor).toBe(113.46);
    expect(precoDaTabela('matmed', contrato({}), 1)).toBeNull();
    expect(precoDaTabela('diarias-taxas', contrato({}), 1)).toBeNull();
    expect(precoDaTabela('sadt', contrato({}), 1)).toBeNull();
    expect(precoDaTabela('sadt', null, 1)).toBeNull();
  });
});
