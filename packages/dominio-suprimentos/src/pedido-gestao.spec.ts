// F3.6 (05-SUP linha 20): gestão do pedido de compra emitido (entregas programadas, acompanhamento e cancelamento).
import {
  conferirAcompanhamentoPedido,
  conferirCancelamentoCompra,
  conferirEntregasProgramadas,
  entregaAtrasada,
  repartirEntregas,
  situacaoAposCancelamento,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';

const cod = (r: ReadonlyArray<{ codigo: string }>) => r.map((x) => x.codigo);

describe('conferirEntregasProgramadas', () => {
  const base = {
    situacaoPedido: 'aprovado',
    dataPedido: '2026-11-10',
    quantidadeValida: 100,
    quantidadeFixa: 0,
    entregas: [
      { dataPrevista: '2026-11-20', dataLimite: '2026-11-22', quantidade: 60 },
      { dataPrevista: '2026-12-20', dataLimite: null, quantidade: 40 },
    ],
  };
  it('aceita entregas em datas distintas que cabem no item', () => {
    expect(conferirEntregasProgramadas(base)).toEqual([]);
  });
  it('recusa passar do que falta programar (descontada a parte que já recebeu)', () => {
    expect(cod(conferirEntregasProgramadas({ ...base, quantidadeFixa: 10 }))).toEqual([
      'entrega-acima-do-pedido',
    ]);
  });
  it('recusa dia repetido, data antes do pedido e limite antes da previsão, apontando a linha', () => {
    const r = conferirEntregasProgramadas({
      ...base,
      entregas: [
        { dataPrevista: '2026-11-01', dataLimite: null, quantidade: 10 },
        { dataPrevista: '2026-11-20', dataLimite: '2026-11-19', quantidade: 10 },
        { dataPrevista: '2026-11-20', dataLimite: null, quantidade: 10 },
      ],
    });
    expect(cod(r)).toEqual(['entrega-antes-do-pedido', 'limite-antes-da-previsao', 'entrega-repetida']);
    expect(r[2]!.campos).toEqual(['entregas.2.dataPrevista']);
  });
  it('recusa pedido encerrado e lista vazia', () => {
    expect(cod(conferirEntregasProgramadas({ ...base, situacaoPedido: 'cancelado' }))).toEqual([
      'pedido-encerrado',
    ]);
    expect(cod(conferirEntregasProgramadas({ ...base, entregas: [] }))).toEqual(['sem-entrega']);
  });
});

describe('conferirCancelamentoCompra', () => {
  const motivo = { ativo: true, aplicaPedido: true, aplicaItem: true, exigeJustificativa: true };
  const itens = [
    { id: 1, quantidade: 10, recebida: 4, cancelada: 0 },
    { id: 2, quantidade: 5, recebida: 5, cancelada: 0 },
    { id: 3, quantidade: 8, recebida: 0, cancelada: 2 },
  ];
  const base = {
    situacaoPedido: 'parcialmente_recebido',
    item: null,
    quantidade: null,
    motivo,
    justificativa: 'Fornecedor sem estoque até o fim do ano',
    itens,
  };
  it('o pedido inteiro cancela só o que falta chegar de cada item', () => {
    const r = conferirCancelamentoCompra(base);
    expect(r.recusas).toEqual([]);
    expect(r.cancelar).toEqual([
      { item: 1, quantidade: 6 },
      { item: 3, quantidade: 6 },
    ]);
  });
  it('o item cancela parte do pendente; acima do pendente é recusado', () => {
    expect(conferirCancelamentoCompra({ ...base, item: 1, quantidade: 2 }).cancelar).toEqual([
      { item: 1, quantidade: 2 },
    ]);
    expect(cod(conferirCancelamentoCompra({ ...base, item: 1, quantidade: 7 }).recusas)).toEqual([
      'quantidade-invalida',
    ]);
    expect(cod(conferirCancelamentoCompra({ ...base, item: 2, quantidade: null }).recusas)).toEqual([
      'item-sem-saldo',
    ]);
    expect(cod(conferirCancelamentoCompra({ ...base, item: 9, quantidade: null }).recusas)).toEqual([
      'item-inexistente',
    ]);
  });
  it('exige motivo ativo, que valha para o alvo, e a justificativa quando o motivo pede', () => {
    expect(cod(conferirCancelamentoCompra({ ...base, motivo: null }).recusas)).toEqual(['motivo-invalido']);
    expect(
      cod(conferirCancelamentoCompra({ ...base, motivo: { ...motivo, aplicaPedido: false } }).recusas),
    ).toEqual(['motivo-nao-se-aplica']);
    expect(cod(conferirCancelamentoCompra({ ...base, justificativa: ' curta ' }).recusas)).toEqual([
      'justificativa-obrigatoria',
    ]);
    expect(
      conferirCancelamentoCompra({
        ...base,
        justificativa: null,
        motivo: { ...motivo, exigeJustificativa: false },
      }).recusas,
    ).toEqual([]);
  });
  it('pedido fechado não se cancela', () => {
    expect(cod(conferirCancelamentoCompra({ ...base, situacaoPedido: 'recebido' }).recusas)).toEqual([
      'pedido-encerrado',
    ]);
  });
});

describe('situacaoAposCancelamento e repartirEntregas', () => {
  it('sem nada a chegar: cancelado se nada veio, encerrado se algo veio; com pendente, mantém', () => {
    expect(situacaoAposCancelamento('aprovado', [{ id: 1, quantidade: 5, recebida: 0, cancelada: 5 }])).toBe(
      'cancelado',
    );
    expect(
      situacaoAposCancelamento('parcialmente_recebido', [
        { id: 1, quantidade: 5, recebida: 2, cancelada: 3 },
      ]),
    ).toBe('encerrado');
    expect(situacaoAposCancelamento('aprovado', [{ id: 1, quantidade: 5, recebida: 0, cancelada: 1 }])).toBe(
      'aprovado',
    );
  });
  const ents = [
    { id: 1, dataPrevista: '2026-11-20', quantidade: 6, recebida: 2, cancelada: 0 },
    { id: 2, dataPrevista: '2026-12-20', quantidade: 4, recebida: 0, cancelada: 0 },
  ];
  it('o recebimento abate da entrega mais antiga; o cancelamento, da mais nova', () => {
    expect(repartirEntregas(ents, 5, 'recebimento')).toEqual([
      { id: 1, quantidade: 4 },
      { id: 2, quantidade: 1 },
    ]);
    expect(repartirEntregas(ents, 5, 'cancelamento')).toEqual([
      { id: 2, quantidade: 4 },
      { id: 1, quantidade: 1 },
    ]);
    expect(repartirEntregas(ents, 50, 'recebimento').reduce((s, x) => s + x.quantidade, 0)).toBe(8);
  });
  it('atraso: passou o limite (ou o dia previsto) e ainda falta algo', () => {
    expect(entregaAtrasada({ ...ents[0]!, dataLimite: '2026-11-22' }, '2026-11-23')).toBe(true);
    expect(entregaAtrasada({ ...ents[0]!, dataLimite: '2026-11-22' }, '2026-11-22')).toBe(false);
    expect(entregaAtrasada({ ...ents[0]!, recebida: 6, dataLimite: null }, '2026-12-01')).toBe(false);
  });
});

describe('conferirAcompanhamentoPedido', () => {
  it('exige o relato, previsão depois do pedido e pedido não cancelado', () => {
    const a = {
      situacaoPedido: 'enviado',
      dataPedido: '2026-11-10',
      previsaoEntrega: '2026-11-30',
      andamento: 'Ligou e confirmou',
    };
    expect(conferirAcompanhamentoPedido(a)).toEqual([]);
    expect(
      cod(conferirAcompanhamentoPedido({ ...a, previsaoEntrega: '2026-11-01', andamento: ' ' })),
    ).toEqual(['andamento-obrigatorio', 'previsao-antes-do-pedido']);
    expect(cod(conferirAcompanhamentoPedido({ ...a, situacaoPedido: 'cancelado' }))).toEqual([
      'pedido-encerrado',
    ]);
  });
});
