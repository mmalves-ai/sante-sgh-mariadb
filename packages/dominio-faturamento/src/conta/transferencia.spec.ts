import { describe, expect, it } from 'vitest';
import {
  avaliarCoberturaDestino,
  itensDaContaInteira,
  MAX_CONTAS_LOTE,
  sugerirTransferenciaPorTroca,
  validarDestinoNovo,
  validarEstornoTransferencia,
  validarLote,
} from './transferencia.js';

const destino = { fontePagadora: 2, plano: null, fonteDoPlano: null, fonteAtiva: true, planoAtivo: true };
const origem = { situacao: 'aberta', fontePagadora: 1, plano: null };

describe('abertura da conta de destino na nova fonte', () => {
  it('aceita outra fonte ativa', () => {
    expect(validarDestinoNovo(origem, destino)).toEqual({});
  });
  it('recusa a mesma fonte e o mesmo plano, fonte inativa e origem fechada', () => {
    expect(validarDestinoNovo(origem, { ...destino, fontePagadora: 1 })).toHaveProperty('fontePagadoraId');
    expect(validarDestinoNovo(origem, { ...destino, fonteAtiva: false })).toHaveProperty('fontePagadoraId');
    expect(validarDestinoNovo({ ...origem, situacao: 'fechada' }, destino)).toHaveProperty('origem');
  });
  it('aceita outro plano da mesma fonte; recusa plano de outra fonte ou inativo', () => {
    expect(validarDestinoNovo(origem, { ...destino, fontePagadora: 1, plano: 9, fonteDoPlano: 1 })).toEqual(
      {},
    );
    expect(validarDestinoNovo(origem, { ...destino, plano: 9, fonteDoPlano: 1 })).toHaveProperty('planoId');
    expect(
      validarDestinoNovo(origem, { ...destino, plano: 9, fonteDoPlano: 2, planoAtivo: false }),
    ).toHaveProperty('planoId');
  });
});

describe('conta inteira', () => {
  const itens = [
    { id: 1, situacao: 'lancado', realizado: '2026-01-10' },
    { id: 2, situacao: 'conferido', realizado: '2026-01-15' },
    { id: 3, situacao: 'glosado', realizado: '2026-01-16' },
    { id: 4, situacao: 'transferido', realizado: '2026-01-16' },
    { id: 5, situacao: 'lancado', realizado: null },
  ];
  it('leva os lançados e conferidos; glosado e transferido ficam', () => {
    expect(itensDaContaInteira(itens)).toEqual([1, 2, 5]);
  });
  it('desde um dia: só os realizados a partir dele (sem data vai junto)', () => {
    expect(itensDaContaInteira(itens, '2026-01-15')).toEqual([2, 5]);
  });
});

describe('cobertura no plano de destino', () => {
  const itens = [
    { id: 1, precoNoDestino: true },
    { id: 2, precoNoDestino: false },
  ];
  it('tudo coberto passa', () => {
    expect(avaliarCoberturaDestino([itens[0]!], false, null)).toEqual({ semCobertura: [], erros: {} });
  });
  it('sem cobertura pede o aceite e depois a justificativa', () => {
    expect(avaliarCoberturaDestino(itens, false, null).erros).toHaveProperty('cobertura');
    expect(avaliarCoberturaDestino(itens, true, 'ok').erros).toHaveProperty('justificativaCobertura');
    expect(avaliarCoberturaDestino(itens, true, 'Plano cobre por pacote')).toEqual({
      semCobertura: [2],
      erros: {},
    });
  });
});

describe('lote', () => {
  it('ao menos uma conta, sem repetir, até o teto, com motivo', () => {
    expect(validarLote([1, 2], 'Troca de convênio')).toEqual({});
    expect(validarLote([], 'Troca de convênio')).toHaveProperty('contas');
    expect(validarLote([1, 1], 'Troca de convênio')).toHaveProperty('contas');
    expect(
      validarLote(
        Array.from({ length: MAX_CONTAS_LOTE + 1 }, (_, k) => k + 1),
        'Troca de convênio',
      ),
    ).toHaveProperty('contas');
    expect(validarLote([1], 'x')).toHaveProperty('motivo');
  });
});

describe('estorno da transferência', () => {
  const t = {
    situacao: 'efetivada',
    contaOrigemSituacao: 'aberta',
    contaDestinoSituacao: 'aberta',
    itensDestino: ['lancado', 'conferido'],
    itensOrigem: ['transferido', 'transferido'],
  };
  it('desfaz o que está como a transferência deixou', () => {
    expect(validarEstornoTransferencia(t, 'Convênio errado')).toEqual({});
  });
  it('recusa a já estornada, conta fechada, item mexido depois e sem motivo', () => {
    expect(validarEstornoTransferencia({ ...t, situacao: 'estornada' }, 'Convênio errado')).toHaveProperty(
      'transferencia',
    );
    expect(
      validarEstornoTransferencia({ ...t, contaDestinoSituacao: 'fechada' }, 'Convênio errado'),
    ).toHaveProperty('destino');
    expect(
      validarEstornoTransferencia({ ...t, contaOrigemSituacao: 'faturada' }, 'Convênio errado'),
    ).toHaveProperty('origem');
    expect(
      validarEstornoTransferencia({ ...t, itensDestino: ['glosado', 'lancado'] }, 'Convênio errado'),
    ).toHaveProperty('itens');
    expect(
      validarEstornoTransferencia({ ...t, itensOrigem: ['lancado', 'transferido'] }, 'Convênio errado'),
    ).toHaveProperty('itens');
    expect(validarEstornoTransferencia(t, '')).toHaveProperty('motivo');
  });
});

describe('sugestão pela troca de convênio da internação', () => {
  const conta = { fontePagadora: 1, plano: null, situacao: 'aberta' };
  const itens = [
    { id: 1, situacao: 'lancado', realizado: '2026-01-10' },
    { id: 2, situacao: 'lancado', realizado: '2026-01-20' },
  ];
  it('a última troca para outra fonte sugere os itens desde o dia dela', () => {
    const trocas = [
      { dia: '2026-01-18', novaFonte: 2, novoPlano: 7 },
      { dia: '2026-01-05', novaFonte: 1, novoPlano: null },
    ];
    expect(sugerirTransferenciaPorTroca(conta, trocas, itens)).toEqual({
      fontePagadora: 2,
      plano: 7,
      desde: '2026-01-18',
      itens: [2],
    });
  });
  it('sem troca, troca para a própria fonte, conta fechada ou nada depois da troca: nenhuma sugestão', () => {
    expect(sugerirTransferenciaPorTroca(conta, [], itens)).toBeNull();
    expect(
      sugerirTransferenciaPorTroca(conta, [{ dia: '2026-01-18', novaFonte: 1, novoPlano: null }], itens),
    ).toBeNull();
    expect(
      sugerirTransferenciaPorTroca(
        { ...conta, situacao: 'fechada' },
        [{ dia: '2026-01-18', novaFonte: 2, novoPlano: null }],
        itens,
      ),
    ).toBeNull();
    expect(
      sugerirTransferenciaPorTroca(conta, [{ dia: '2026-02-01', novaFonte: 2, novoPlano: null }], itens),
    ).toBeNull();
  });
  it('troca só de plano na mesma fonte também sugere', () => {
    expect(
      sugerirTransferenciaPorTroca(conta, [{ dia: '2026-01-01', novaFonte: 1, novoPlano: 8 }], itens)?.plano,
    ).toBe(8);
  });
});
