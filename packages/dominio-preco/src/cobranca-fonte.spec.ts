import { describe, expect, it } from 'vitest';
import {
  type CredenciamentoCobranca,
  conferirCobranca,
  diaAnterior,
  type EquivalenciaItemFonte,
  escolherEquivalencia,
  type ExcecaoCredenciamento,
  type PedidoCobranca,
  precoReferenciaNaData,
  quantidadeNaFonte,
  validarCredenciamentoCobranca,
  validarEquivalencia,
  validarExcecaoCredenciamento,
  valorDaReferencia,
} from './cobranca-fonte.js';

const eq = (o: Partial<EquivalenciaItemFonte>): EquivalenciaItemFonte => ({
  id: 1,
  itemId: null,
  grupoId: null,
  planoId: null,
  tipoContaId: null,
  tipoAtendimento: 'todos',
  codigo: 'X',
  descricao: null,
  fatorMultiplicacao: 1,
  fatorDivisao: 1,
  percentual: null,
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});

const ped = {
  itemId: 10,
  grupoId: 3,
  planoId: 7,
  planoSuperiorId: 6,
  tipoContaId: 2,
  tipoAtendimento: 'internacao' as const,
  data: '2026-05-10',
};

describe('de-para do item para a fonte pagadora', () => {
  it('item vence grupo; plano do paciente vence o superior; específico vence "todos"', () => {
    const c = [
      eq({ id: 1, grupoId: 3, codigo: 'G' }),
      eq({ id: 2, itemId: 10, codigo: 'I' }),
      eq({ id: 3, itemId: 10, planoId: 6, codigo: 'SUP' }),
      eq({ id: 4, itemId: 10, planoId: 7, codigo: 'PL' }),
      eq({ id: 5, itemId: 10, planoId: 7, tipoAtendimento: 'internacao', codigo: 'PL-INT' }),
      eq({ id: 6, itemId: 10, planoId: 7, tipoAtendimento: 'ambulatorial', codigo: 'PL-AMB' }),
    ];
    expect(escolherEquivalencia(c, ped)?.codigo).toBe('PL-INT');
    expect(escolherEquivalencia(c.slice(0, 4), ped)?.codigo).toBe('PL');
    expect(escolherEquivalencia(c.slice(0, 3), ped)?.codigo).toBe('SUP');
    expect(escolherEquivalencia(c.slice(0, 1), ped)?.codigo).toBe('G');
    expect(escolherEquivalencia(c.slice(0, 1), { ...ped, grupoId: 99 })).toBeNull();
  });

  it('fora da vigência ou de outro tipo de conta não vale; a vigência mais nova desempata', () => {
    expect(escolherEquivalencia([eq({ itemId: 10, vigenciaFim: '2026-01-01' })], ped)).toBeNull();
    expect(escolherEquivalencia([eq({ itemId: 10, tipoContaId: 9 })], ped)).toBeNull();
    const r = escolherEquivalencia(
      [
        eq({ id: 1, itemId: 10, codigo: 'A' }),
        eq({ id: 2, itemId: 10, codigo: 'B', vigenciaInicio: '2026-01-01' }),
      ],
      ped,
    );
    expect(r?.codigo).toBe('B');
  });

  it('quantidade pelos fatores e validação na hora', () => {
    expect(quantidadeNaFonte(3, { fatorMultiplicacao: 10, fatorDivisao: 4 })).toBe(7.5);
    expect(
      validarEquivalencia({
        itemId: 1,
        grupoId: 2,
        codigo: ' ',
        tipoAtendimento: 'x',
        fatorMultiplicacao: 0,
        fatorDivisao: 1,
        percentual: null,
        vigenciaInicio: '2026-02-01',
        vigenciaFim: '2026-01-01',
      }),
    ).toEqual({
      itemId: expect.any(String),
      codigo: expect.any(String),
      tipoAtendimento: expect.any(String),
      fatorMultiplicacao: expect.any(String),
      vigenciaFim: expect.any(String),
    });
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });
});

const cred = (o: Partial<CredenciamentoCobranca>): CredenciamentoCobranca => ({
  id: 1,
  profissionalId: 50,
  prestadorId: null,
  planoId: null,
  tipoContaId: null,
  grupoAtoId: null,
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});
const exc = (o: Partial<ExcecaoCredenciamento>): ExcecaoCredenciamento => ({
  id: 100,
  credenciamentoId: null,
  profissionalId: 50,
  prestadorId: null,
  equipeId: null,
  fonteId: null,
  planoId: null,
  tipoAtendimento: 'todos',
  grupoId: null,
  itemId: null,
  efeito: 'proibe',
  motivo: 'fora do contrato',
  vigenciaInicio: '2025-01-01',
  vigenciaFim: null,
  ...o,
});
const pc: PedidoCobranca = {
  fonteId: 1,
  particular: false,
  profissionalId: 50,
  prestadorId: null,
  equipeIds: [70],
  planoId: 7,
  planoSuperiorId: null,
  tipoContaId: 2,
  tipoAtendimento: 'internacao',
  itemId: 10,
  grupoId: 3,
  grupoAtoId: 4,
  data: '2026-05-10',
};

describe('credenciamento de cobrança com exceção', () => {
  it('credenciado vigente pode; sem credenciamento não pode; particular sempre pode', () => {
    expect(conferirCobranca([cred({})], [], pc)).toMatchObject({ permitido: true, origem: 'credenciamento' });
    expect(conferirCobranca([cred({ grupoAtoId: 9 })], [], pc)).toMatchObject({
      permitido: false,
      origem: 'sem-credenciamento',
    });
    expect(conferirCobranca([cred({ vigenciaFim: '2026-01-01' })], [], pc).permitido).toBe(false);
    expect(conferirCobranca([], [], { ...pc, particular: true }).permitido).toBe(true);
  });

  it('exceção por procedimento proíbe; a da equipe permite sem credenciamento; proibição vence empate', () => {
    const r = conferirCobranca([cred({})], [exc({ itemId: 10 })], pc);
    expect(r).toMatchObject({ permitido: false, origem: 'excecao', excecaoId: 100 });
    expect(r.motivo).toContain('fora do contrato');
    expect(conferirCobranca([cred({})], [exc({ itemId: 11 })], pc).permitido).toBe(true);
    expect(
      conferirCobranca([], [exc({ profissionalId: null, equipeId: 70, efeito: 'permite', grupoId: 3 })], pc),
    ).toMatchObject({ permitido: true, origem: 'excecao' });
    expect(
      conferirCobranca(
        [cred({})],
        [exc({ id: 1, efeito: 'permite', itemId: 10 }), exc({ id: 2, efeito: 'proibe', itemId: 10 })],
        pc,
      ).permitido,
    ).toBe(false);
    // A exceção do item vence a do grupo, mesmo permitindo.
    expect(
      conferirCobranca(
        [cred({})],
        [exc({ id: 1, grupoId: 3 }), exc({ id: 2, efeito: 'permite', itemId: 10 })],
        pc,
      ).permitido,
    ).toBe(true);
    // Exceção de outra fonte pagadora não vale.
    expect(conferirCobranca([cred({})], [exc({ fonteId: 2, itemId: 10 })], pc).permitido).toBe(true);
  });

  it('validações', () => {
    expect(
      validarCredenciamentoCobranca({
        profissionalId: null,
        prestadorId: null,
        codigoNaFonte: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toHaveProperty('profissionalId');
    expect(
      validarExcecaoCredenciamento({
        credenciamentoId: 1,
        profissionalId: null,
        prestadorId: null,
        equipeId: null,
        tipoAtendimento: 'todos',
        efeito: 'proibe',
        motivo: '',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toEqual({ motivo: expect.any(String) });
  });
});

describe('referência de mercado de mat/med', () => {
  const precos = [
    { edicaoId: 1, vigenciaInicio: '2025-01-01', operacao: 'inclusao', pf: 10, pmc: 13 },
    { edicaoId: 2, vigenciaInicio: '2026-01-01', operacao: 'alteracao', pf: 11, pmc: 14.5 },
    { edicaoId: 3, vigenciaInicio: '2026-06-01', operacao: 'exclusao', pf: null, pmc: null },
  ];
  it('a maior vigência até a data; a exclusão retira; a tabela escolhe PF ou PMC', () => {
    expect(precoReferenciaNaData(precos, '2025-06-01')?.pf).toBe(10);
    expect(valorDaReferencia(precoReferenciaNaData(precos, '2026-03-01'), 'pmc')).toBe(14.5);
    expect(valorDaReferencia(precoReferenciaNaData(precos, '2026-03-01'), 'pf')).toBe(11);
    expect(precoReferenciaNaData(precos, '2026-07-01')).toBeNull();
    expect(precoReferenciaNaData(precos, '2024-01-01')).toBeNull();
  });
});
