import { describe, expect, it } from 'vitest';
import {
  adicionalDaEquipe,
  calcularEquipeItem,
  type FuncaoEquipe,
  type KitCobranca,
  lancamentoDoKit,
  validarDefinicaoKit,
  validarEquipeItem,
  validarTransferencia,
  valorItemComEquipe,
} from './movimentos.js';

const funcao = (id: number, tipo: string, x: Partial<FuncaoEquipe> = {}): FuncaoEquipe => ({
  id,
  tipo,
  ativo: true,
  percentual: null,
  grau: null,
  ordemAuxiliar: null,
  ordemApresentacao: null,
  ...x,
});
const funcoes = new Map<number, FuncaoEquipe>([
  [1, funcao(1, 'cirurgiao', { grau: 10, ordemApresentacao: 1 })],
  [2, funcao(2, 'auxiliar', { percentual: 30, ordemAuxiliar: 1, grau: 11, ordemApresentacao: 2 })],
  [3, funcao(3, 'anestesista', { percentual: 30, ordemApresentacao: 9 })],
  [4, funcao(4, 'outro', { ativo: false })],
]);

describe('equipe do item (06-FAT linha 15)', () => {
  it('aceita a equipe e numera pelo cirurgião primeiro, com o valor do ato pelo percentual da função', () => {
    const ps = [
      { profissional: 20, funcao: 2 },
      { profissional: 10, funcao: 1 },
      { profissional: 30, funcao: 3, percentual: 40, grau: 99 },
    ];
    expect(validarEquipeItem(ps, funcoes)).toEqual({});
    const c = calcularEquipeItem(ps, funcoes, 1000);
    expect(c.map((x) => [x.sequencia, x.profissional, x.percentual, x.valorAto, x.grau])).toEqual([
      [1, 10, 100, 1000, 10],
      [2, 20, 30, 300, 11],
      [3, 30, 40, 400, 99],
    ]);
  });
  it('sem cobrança: valor do ato zero', () => {
    const c = calcularEquipeItem(
      [{ profissional: 1, funcao: 1, formaPagamento: 'sem_cobranca' }],
      funcoes,
      500,
    );
    expect(c[0]!.valorAto).toBe(0);
  });
  it('recusa função inativa, repetição, dois cirurgiões e dois primeiros auxiliares', () => {
    expect(validarEquipeItem([{ profissional: 1, funcao: 4 }], funcoes)).toHaveProperty(
      'participantes.0.funcao',
    );
    expect(validarEquipeItem([{ profissional: 1, funcao: 9 }], funcoes)).toHaveProperty(
      'participantes.0.funcao',
    );
    expect(
      validarEquipeItem(
        [
          { profissional: 1, funcao: 2 },
          { profissional: 1, funcao: 2 },
        ],
        funcoes,
      ),
    ).toHaveProperty(['participantes.1.profissional']);
    expect(
      validarEquipeItem(
        [
          { profissional: 1, funcao: 1 },
          { profissional: 2, funcao: 1 },
        ],
        funcoes,
      ),
    ).toHaveProperty(['participantes.1.funcao']);
    expect(
      validarEquipeItem(
        [
          { profissional: 1, funcao: 2 },
          { profissional: 2, funcao: 2 },
        ],
        funcoes,
      )['participantes.1.funcao'],
    ).toMatch(/1º auxiliar/);
    expect(validarEquipeItem([{ profissional: 1, funcao: 1, percentual: 120 }], funcoes)).toHaveProperty([
      'participantes.0.percentual',
    ]);
  });
  it('lista vazia retira a equipe', () => {
    expect(validarEquipeItem([], funcoes)).toEqual({});
  });
});

describe('kit de cobrança (06-FAT linha 16)', () => {
  const kit = (x: Partial<KitCobranca> = {}): KitCobranca => ({
    id: 1,
    ativo: true,
    modo: 'aberto',
    item: null,
    fontePagadora: null,
    plano: null,
    componentes: [
      { item: 5, equipamento: null, quantidade: 2 },
      { item: 6, equipamento: null, quantidade: 0.5 },
      { item: null, equipamento: 9, quantidade: 1 },
    ],
    ...x,
  });
  const conta = { fontePagadora: 7, plano: 70 };
  it('aberto: cada componente vezes as vezes usadas; equipamento sem item volta como aviso', () => {
    const r = lancamentoDoKit(kit(), conta, 3);
    expect(r.erros).toEqual({});
    expect(r.linhas).toEqual([
      { item: 5, quantidade: 6, papel: 'componente' },
      { item: 6, quantidade: 1.5, papel: 'componente' },
    ]);
    expect(r.avisos).toEqual(['equipamento-sem-item']);
  });
  it('fechado: só o item do kit', () => {
    expect(lancamentoDoKit(kit({ modo: 'fechado', item: 50 }), conta, 2).linhas).toEqual([
      { item: 50, quantidade: 2, papel: 'kit' },
    ]);
  });
  it('recusa kit inativo, de outra fonte ou plano, e vezes inválidas', () => {
    expect(lancamentoDoKit(kit({ ativo: false }), conta, 1).erros).toHaveProperty('kit');
    expect(lancamentoDoKit(kit({ fontePagadora: 8 }), conta, 1).erros['kit']).toMatch(/fonte pagadora/);
    expect(lancamentoDoKit(kit({ fontePagadora: 7, plano: 71 }), conta, 1).erros['kit']).toMatch(/plano/);
    expect(lancamentoDoKit(kit(), conta, 0).erros).toHaveProperty('vezes');
  });
  it('cadastro: fechado exige item, componentes válidos e sem repetição', () => {
    expect(
      validarDefinicaoKit({
        codigo: 'K1',
        descricao: 'Kit curativo',
        modo: 'aberto',
        item: null,
        componentes: [],
      }),
    ).toHaveProperty('componentes');
    const e = validarDefinicaoKit({
      codigo: '',
      descricao: 'Kit',
      modo: 'fechado',
      item: null,
      componentes: [
        { item: 1, equipamento: null, quantidade: 1 },
        { item: 1, equipamento: null, quantidade: 0 },
      ],
    });
    expect(Object.keys(e).sort()).toEqual([
      'codigo',
      'componentes.1.item',
      'componentes.1.quantidade',
      'item',
    ]);
  });
});

describe('transferência de itens entre contas (06-FAT linha 14)', () => {
  const c = (id: number, x: Partial<Parameters<typeof validarTransferencia>[0]> = {}) => ({
    id,
    situacao: 'aberta',
    estabelecimento: 1,
    fontePagadora: 7,
    paciente: 100,
    ...x,
  });
  const itens = [
    { id: 11, conta: 1, situacao: 'lancado' },
    { id: 12, conta: 1, situacao: 'glosado' },
    { id: 13, conta: 2, situacao: 'lancado' },
  ];
  it('diz o tipo: conta, fonte pagadora ou estabelecimento', () => {
    expect(validarTransferencia(c(1), c(2), itens, [11], 'troca de plano').tipo).toBe('conta');
    expect(validarTransferencia(c(1), c(2, { fontePagadora: 8 }), itens, [11], 'troca de plano')).toEqual({
      erros: {},
      tipo: 'fonte_pagadora',
    });
    expect(
      validarTransferencia(c(1), c(2, { estabelecimento: 2, fontePagadora: 8 }), itens, [11], 'mudou').tipo,
    ).toBe('estabelecimento');
  });
  it('recusa mesma conta, outro paciente, conta fechada, item alheio ou glosado e motivo curto', () => {
    expect(validarTransferencia(c(1), c(1), itens, [11], 'motivo ok').erros).toHaveProperty('destino');
    expect(
      validarTransferencia(c(1), c(2, { paciente: 5 }), itens, [11], 'motivo ok').erros['destino'],
    ).toMatch(/outro paciente/);
    expect(
      validarTransferencia(c(1, { situacao: 'fechada' }), c(2), itens, [11], 'motivo ok').erros,
    ).toHaveProperty('origem');
    expect(
      validarTransferencia(c(1), c(2, { situacao: 'enviada' }), itens, [11], 'motivo ok').erros,
    ).toHaveProperty('destino');
    expect(validarTransferencia(c(1), c(2), itens, [13], 'motivo ok').erros['itens']).toMatch(
      /não é da conta/,
    );
    expect(validarTransferencia(c(1), c(2), itens, [12], 'motivo ok').erros['itens']).toMatch(/glosado/);
    expect(validarTransferencia(c(1), c(2), itens, [], 'motivo ok').erros).toHaveProperty('itens');
    expect(validarTransferencia(c(1), c(2), itens, [11], 'abc').erros).toHaveProperty('motivo');
  });
});

describe('equipe na cobrança e na validação (correção F3.7-4)', () => {
  const fs = new Map<number, FuncaoEquipe>([
    ...funcoes,
    [5, funcao(5, 'auxiliar', { percentual: 20, ordemAuxiliar: 2, ordemApresentacao: 2 })],
    [6, funcao(6, 'instrumentador', { ordemApresentacao: 5 })],
  ]);
  it('1º e 2º auxiliar na mesma equipe são aceitos, na ordem do auxiliar', () => {
    const ps = [
      { profissional: 30, funcao: 5 },
      { profissional: 20, funcao: 2 },
      { profissional: 10, funcao: 1 },
    ];
    expect(validarEquipeItem(ps, fs)).toEqual({});
    expect(calcularEquipeItem(ps, fs, 100).map((p) => [p.funcao, p.sequencia, p.valorAto])).toEqual([
      [1, 1, 100],
      [2, 2, 30],
      [5, 3, 20],
    ]);
  });
  it('função sem percentual: pede o percentual em vez de zerar (o informado ou sem cobrança passam)', () => {
    expect(validarEquipeItem([{ profissional: 1, funcao: 6 }], fs)).toHaveProperty(
      'participantes.0.percentual',
    );
    expect(validarEquipeItem([{ profissional: 1, funcao: 6, percentual: 10 }], fs)).toEqual({});
    expect(validarEquipeItem([{ profissional: 1, funcao: 6, formaPagamento: 'sem_cobranca' }], fs)).toEqual(
      {},
    );
  });
  it('o ato dos demais participantes cobrados pelo hospital soma ao item; o titular já está no honorário', () => {
    const calc = calcularEquipeItem(
      [
        { profissional: 10, funcao: 1 },
        { profissional: 20, funcao: 2 },
        { profissional: 30, funcao: 3, formaPagamento: 'direto_fonte_pagadora' },
      ],
      fs,
      80,
    );
    expect(adicionalDaEquipe(calc, fs)).toBe(24);
    expect(adicionalDaEquipe([], fs)).toBe(0);
    expect(valorItemComEquipe(124, 24, 36)).toBe(136);
    expect(valorItemComEquipe(100, 0, 24)).toBe(124);
  });
  it('transferência: item fora do período da conta de destino é recusado', () => {
    const base = { situacao: 'aberta', estabelecimento: 1, fontePagadora: 7, paciente: 100 };
    const its = [{ id: 11, conta: 1, situacao: 'lancado', realizado: '2026-01-21' }];
    expect(
      validarTransferencia(
        { id: 1, ...base },
        { id: 2, ...base, inicio: '2026-02-01' },
        its,
        [11],
        'motivo ok',
      ).erros['itens'],
    ).toMatch(/período/);
    expect(
      validarTransferencia(
        { id: 1, ...base },
        { id: 2, ...base, inicio: '2026-01-01', fim: '2026-01-31' },
        its,
        [11],
        'motivo ok',
      ).erros,
    ).toEqual({});
  });
});
