import { describe, expect, it } from 'vitest';
import {
  cirurgiaoDoGasto,
  conferirGastoSala,
  diferencasDaSugestao,
  type ItemGastoSala,
  type LinhaListaMaterial,
  linhasQueValem,
  sugerirGastoSala,
  transicaoGastoSala,
} from './gasto-sala.js';

const linha = (
  o: Partial<LinhaListaMaterial> & { id: number; procedimento: number },
): LinhaListaMaterial => ({
  cirurgiao: null,
  tipoAnestesia: null,
  insumo: null,
  kit: null,
  quantidade: 1,
  obrigatorio: false,
  ativo: true,
  ...o,
});
const item = (o: Partial<ItemGastoSala> & { insumo: number }): ItemGastoSala => ({
  quantidade: 1,
  lote: null,
  implantePermanente: false,
  faturar: true,
  ...o,
});

describe('lista padrão de material por procedimento', () => {
  const lista = [
    linha({ id: 1, procedimento: 10, insumo: 100, quantidade: 2 }),
    linha({ id: 2, procedimento: 10, insumo: 101, quantidade: 1, obrigatorio: true }),
    linha({ id: 3, procedimento: 10, cirurgiao: 7, insumo: 100, quantidade: 4 }),
    linha({ id: 4, procedimento: 10, tipoAnestesia: 3, insumo: 102, quantidade: 1 }),
    linha({ id: 5, procedimento: 10, insumo: 103, ativo: false }),
  ];

  it('usa a lista do cirurgião quando ele tem uma e a do serviço quando não tem', () => {
    expect(
      linhasQueValem(lista, 10, { procedimentos: [10], cirurgiao: 7, tipoAnestesia: null }).map((l) => l.id),
    ).toEqual([3]);
    expect(
      linhasQueValem(lista, 10, { procedimentos: [10], cirurgiao: 8, tipoAnestesia: null }).map((l) => l.id),
    ).toEqual([1, 2]);
  });

  it('junta a linha do tipo de anestesia do ato e ignora a inativa', () => {
    expect(
      linhasQueValem(lista, 10, { procedimentos: [10], cirurgiao: null, tipoAnestesia: 3 }).map((l) => l.id),
    ).toEqual([1, 2, 4]);
  });

  it('abre o kit, soma no procedimento e fica com a maior quantidade entre procedimentos', () => {
    const l = [
      linha({ id: 1, procedimento: 10, kit: 50, quantidade: 2 }),
      linha({ id: 2, procedimento: 10, insumo: 100, quantidade: 1 }),
      linha({ id: 3, procedimento: 11, insumo: 100, quantidade: 2, obrigatorio: true }),
    ];
    const kits = [
      { kit: 50, insumo: 100, quantidade: 1 },
      { kit: 50, insumo: 200, quantidade: 3 },
    ];
    expect(
      sugerirGastoSala(l, kits, { procedimentos: [10, 11], cirurgiao: null, tipoAnestesia: null }),
    ).toEqual([
      { insumo: 100, quantidade: 3, obrigatorio: true, linhas: [1, 2, 3] },
      { insumo: 200, quantidade: 6, obrigatorio: false, linhas: [1] },
    ]);
  });
});

describe('conferência do gasto de sala', () => {
  const sugestao = [
    { insumo: 100, quantidade: 2, obrigatorio: false, linhas: [1] },
    { insumo: 101, quantidade: 1, obrigatorio: true, linhas: [2] },
  ];

  it('aceita o gasto completo', () => {
    expect(
      conferirGastoSala([item({ insumo: 100, quantidade: 2 }), item({ insumo: 101 })], sugestao, []),
    ).toEqual([]);
  });

  it('recusa o obrigatório ausente sem justificativa e aceita com ela', () => {
    expect(conferirGastoSala([item({ insumo: 100 })], sugestao, []).map((p) => p.campo)).toEqual([
      'justificativas.101',
    ]);
    expect(
      conferirGastoSala([item({ insumo: 100 })], sugestao, [{ insumo: 101, motivo: 'não precisou' }]),
    ).toEqual([]);
    expect(conferirGastoSala([item({ insumo: 100 })], sugestao, [{ insumo: 101, motivo: 'x' }]).length).toBe(
      2,
    );
  });

  it('recusa quantidade zero, implante sem lote, produto repetido no mesmo lote e justificativa de item usado', () => {
    const p = conferirGastoSala(
      [
        item({ insumo: 101, quantidade: 0 }),
        item({ insumo: 300, implantePermanente: true }),
        item({ insumo: 100, lote: 9 }),
        item({ insumo: 100, lote: 9 }),
      ],
      sugestao,
      [{ insumo: 100, motivo: 'motivo qualquer' }],
    );
    expect(p.map((x) => x.campo)).toEqual([
      'itens.0.quantidade',
      'itens.1.lote',
      'itens.3.insumo',
      'justificativas.100',
    ]);
  });

  it('mostra a diferença para a sugestão', () => {
    expect(
      diferencasDaSugestao([item({ insumo: 100, quantidade: 3 }), item({ insumo: 400 })], sugestao),
    ).toEqual([
      { insumo: 100, sugerido: 2, lancado: 3, tipo: 'a_mais' },
      { insumo: 101, sugerido: 1, lancado: 0, tipo: 'nao_usado' },
      { insumo: 400, sugerido: 0, lancado: 1, tipo: 'fora_da_lista' },
    ]);
  });
});

describe('situação do gasto de sala', () => {
  it('só debita o conferido e não muda o debitado', () => {
    expect(transicaoGastoSala('aberta', 'debitar')).toHaveProperty('problema');
    expect(transicaoGastoSala('aberta', 'conferir')).toEqual({ situacao: 'conferida' });
    expect(transicaoGastoSala('conferida', 'debitar')).toEqual({ situacao: 'debitada' });
    expect(transicaoGastoSala('debitada', 'cancelar', 'motivo longo')).toHaveProperty('problema');
  });

  it('reabre e cancela só com motivo; o conferido não se edita', () => {
    expect(transicaoGastoSala('conferida', 'editar')).toHaveProperty('problema');
    expect(transicaoGastoSala('conferida', 'reabrir', 'ab')).toHaveProperty('problema.campo', 'motivo');
    expect(transicaoGastoSala('conferida', 'reabrir', 'faltou a gaze')).toEqual({ situacao: 'aberta' });
    expect(transicaoGastoSala('aberta', 'cancelar', 'ato lançado errado')).toEqual({ situacao: 'cancelada' });
    expect(transicaoGastoSala('cancelada', 'editar')).toHaveProperty('problema');
  });
});

describe('rastreio e cirurgião do gasto de sala (correção F3.4-5)', () => {
  const it0: ItemGastoSala = {
    insumo: 1,
    quantidade: 1,
    lote: null,
    implantePermanente: false,
    faturar: true,
  };
  it('exige o lote do OPME pelo cadastro, mesmo sem a marca de implante', () => {
    expect(conferirGastoSala([{ ...it0, opme: true }], [], [])).toEqual([
      {
        campo: 'itens.0.lote',
        mensagem: 'Item 1: OPME (órtese, prótese e material especial) exige o lote.',
      },
    ]);
    expect(conferirGastoSala([{ ...it0, opme: true, lote: 9 }], [], [])).toEqual([]);
    expect(conferirGastoSala([it0], [], [])).toEqual([]);
  });
  it('só aceita cirurgião da equipe; sem informar, vale o gravado e depois o primeiro da equipe', () => {
    const equipe = [
      { profissional: 10, cirurgiao: false },
      { profissional: 20, cirurgiao: true },
      { profissional: 30, cirurgiao: true },
    ];
    expect(cirurgiaoDoGasto(equipe, 99, null)).toHaveProperty('problema.campo', 'cirurgiao');
    expect(cirurgiaoDoGasto(equipe, 10, null)).toHaveProperty('problema.campo', 'cirurgiao');
    expect(cirurgiaoDoGasto(equipe, 30, 20)).toEqual({ cirurgiao: 30 });
    expect(cirurgiaoDoGasto(equipe, undefined, 30)).toEqual({ cirurgiao: 30 });
    expect(cirurgiaoDoGasto(equipe, null, 77)).toEqual({ cirurgiao: 20 });
    expect(cirurgiaoDoGasto([{ profissional: 10, cirurgiao: false }], undefined, null)).toEqual({
      cirurgiao: null,
    });
  });
});
