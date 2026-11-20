// Regra 11 do M54 (ficha, seção 8): o bem nasce da nota fiscal de entrada; sem documento de origem, só a doação com o
// termo registrado. Dados sintéticos.
import { type CadastrarBem, esquemaCadastrarBem } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type ContextoCadastro,
  competenciaDe,
  disponiveisDoItem,
  mesSeguinte,
  problemasDoCadastro,
  unidadesDoItem,
  valoresDasUnidades,
  valoresDoCadastro,
  vidaUtilPadrao,
} from './origem.js';

const ctx = (extra: Partial<ContextoCadastro> = {}): ContextoCadastro => ({
  origens: new Map([
    [1, { depreciar: true }],
    [2, { depreciar: true }],
    [3, { depreciar: false }],
  ]),
  tiposResponsavel: new Set([1, 2]),
  coeficientes: new Set([1, 2, 3]),
  centrosAtivos: new Set([10, 20]),
  empresas: new Set([1]),
  item: { id: 500, nota: 50, quantidade: 3, valorTotalCent: 1_000_00, jaCadastrados: 0 },
  dataNota: '2026-03-10',
  hoje: '2026-10-29',
  ...extra,
});

const daNota = (extra: Record<string, unknown> = {}): CadastrarBem =>
  esquemaCadastrarBem.parse({
    documento: 'nota',
    nota: 50,
    itemNota: 500,
    descricao: 'Monitor multiparamétrico',
    grupo: 'equipamentoMedico',
    origem: 1,
    centro: 10,
    ...extra,
  });

const doacao = (extra: Record<string, unknown> = {}): CadastrarBem =>
  esquemaCadastrarBem.parse({
    documento: 'termo',
    termoNumero: 'TD-1/2026',
    termoData: '2026-04-01',
    doador: 'Associação sintética',
    empresa: 1,
    dataAquisicao: '2026-04-01',
    valorCent: 250_00,
    descricao: 'Cadeira de rodas',
    grupo: 'moveis',
    origem: 2,
    centro: 20,
    ...extra,
  });

const codigos = (x: CadastrarBem, c = ctx()) => problemasDoCadastro(x, c).map((p) => p.codigo);

describe('regra 11: origem do bem', () => {
  it('da nota fiscal de entrada: sem problema', () => {
    expect(codigos(daNota())).toEqual([]);
  });

  it('sem nota, só a doação com o termo: outra origem é recusada', () => {
    expect(codigos(doacao())).toEqual([]);
    expect(codigos(doacao({ origem: 1 }))).toEqual(['sem-nota']);
  });

  it('o termo de doação exige número, data e doador (o esquema recusa sem eles)', () => {
    expect(esquemaCadastrarBem.safeParse({ ...doacao(), termoNumero: '' }).success).toBe(false);
    expect(codigos(doacao({ termoData: '2026-13-01' }))).toContain('termo-data');
    expect(codigos(doacao({ termoData: '2027-01-01' }))).toContain('termo-data');
    expect(codigos(doacao({ dataAquisicao: '2027-01-01' }))).toContain('aquisicao-data');
    expect(codigos(doacao({ empresa: 9 }))).toContain('empresa');
  });

  it('o item tem de ser da nota, ter unidades livres e valor', () => {
    expect(codigos(daNota(), ctx({ item: null }))).toEqual(['item-nota']);
    expect(codigos(daNota({ nota: 51 }))).toEqual(['item-nota']);
    expect(codigos(daNota({ quantidade: 4 }))).toEqual(['item-quantidade']);
    const esgotado = ctx({
      item: { id: 500, nota: 50, quantidade: 3, valorTotalCent: 100, jaCadastrados: 3 },
    });
    expect(codigos(daNota(), esgotado)).toEqual(['item-esgotado']);
    const semValor = ctx({ item: { id: 500, nota: 50, quantidade: 1, valorTotalCent: 0, jaCadastrados: 0 } });
    expect(codigos(daNota(), semValor)).toContain('item-valor');
    expect(codigos(daNota(), ctx({ dataNota: null }))).toContain('nota-data');
  });

  it('domínios do banco: origem, setor ativo, tipo de responsável e coeficiente', () => {
    expect(
      codigos(daNota({ origem: 9, centro: 99, tipoResponsavel: 9, responsavel: 'Fulano', coeficiente: 9 })),
    ).toEqual(['origem', 'centro', 'tipo-responsavel', 'coeficiente']);
  });

  it('residual menor que o valor e início da depreciação não antes da aquisição', () => {
    // 1.000,00 em 3 unidades: 333,33 cada (a primeira com 1 centavo a mais)
    expect(codigos(daNota({ residualCent: 333_33 }))).toEqual(['residual']);
    expect(codigos(daNota({ residualCent: 333_32 }))).toEqual([]);
    expect(codigos(daNota({ inicioDepreciacao: '2026-02' }))).toEqual(['inicio']);
    expect(codigos(daNota({ inicioDepreciacao: '2026-03' }))).toEqual([]);
    expect(codigos(doacao({ residualCent: 250_00 }))).toEqual(['residual']);
  });

  it('o esquema recusa série e plaqueta com mais de uma unidade e responsável sem tipo', () => {
    expect(esquemaCadastrarBem.safeParse({ ...daNota(), quantidade: 2, numeroSerie: 'S1' }).success).toBe(
      false,
    );
    expect(esquemaCadastrarBem.safeParse({ ...daNota(), quantidade: 2, plaqueta: 'X1' }).success).toBe(false);
    expect(esquemaCadastrarBem.safeParse({ ...daNota(), responsavel: 'Fulano' }).success).toBe(false);
    expect(daNota({ plaqueta: 'ab-12' }).plaqueta).toBe('AB-12');
  });
});

describe('unidades e valores do item da nota', () => {
  it('a quantidade inteira vira unidades; fração ou menos de 1, um bem só', () => {
    expect(unidadesDoItem(3)).toBe(3);
    expect(unidadesDoItem(2.5)).toBe(2);
    expect(unidadesDoItem(0.5)).toBe(1);
    expect(disponiveisDoItem({ quantidade: 3, jaCadastrados: 1 })).toBe(2);
    expect(disponiveisDoItem({ quantidade: 3, jaCadastrados: 5 })).toBe(0);
  });

  it('o total repartido: a sobra na primeira unidade e a soma igual à nota, em qualquer ordem de cadastro', () => {
    const item = { quantidade: 3, valorTotalCent: 1_000_00, jaCadastrados: 0 };
    expect(valoresDasUnidades(item, 1)).toEqual([333_34]);
    expect(valoresDasUnidades({ ...item, jaCadastrados: 1 }, 2)).toEqual([333_33, 333_33]);
    const parcelas = [
      ...valoresDasUnidades(item, 1),
      ...valoresDasUnidades({ ...item, jaCadastrados: 1 }, 2),
    ];
    expect(parcelas.reduce((s, v) => s + v, 0)).toBe(1_000_00);
  });

  it('padrões: vida útil do grupo, início no mês seguinte à aquisição, a marca de depreciar da origem', () => {
    expect(vidaUtilPadrao('informatica')).toBe(60);
    expect(mesSeguinte('2026-03-10')).toBe('2026-04');
    expect(mesSeguinte('2026-12')).toBe('2027-01');
    expect(competenciaDe('2026-03-10')).toBe('2026-03');
    const c = ctx();
    const v = valoresDoCadastro(daNota({ quantidade: 2 }), c, 1);
    expect(v).toEqual({
      empresa: 1,
      dataAquisicao: '2026-03-10',
      valores: [333_34, 333_33],
      vidaUtilMeses: 120,
      inicioDepreciacao: '2026-04',
      depreciavel: true,
    });
    const t = valoresDoCadastro(
      doacao({ quantidade: 2, origem: 3, vidaUtilMeses: 24, depreciavel: null }),
      c,
      null,
    );
    expect(t).toMatchObject({ empresa: 1, valores: [250_00, 250_00], vidaUtilMeses: 24, depreciavel: false });
    expect(valoresDoCadastro(daNota(), ctx({ item: null, dataNota: null }), null).valores).toEqual([]);
    expect(valoresDoCadastro(daNota({ origem: 9 }), c, 1).depreciavel).toBe(false);
    expect(
      valoresDoCadastro(daNota({ depreciavel: false, inicioDepreciacao: '2026-06' }), c, 1),
    ).toMatchObject({
      depreciavel: false,
      inicioDepreciacao: '2026-06',
    });
  });
});
