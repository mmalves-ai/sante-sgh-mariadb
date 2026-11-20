// A montagem do resumo e do detalhe do contrato no dia (ficha do M55, etapa 3; regras 5 a 8): o fim vigente pelos
// eventos, a faixa, o saldo com as parcelas, o próximo reajuste, a última avaliação e os avisos (vencido, a vencer,
// saldo excedido, acréscimo acima de 25%, avaliação vencida, fornecedor desqualificado, garantia vencida).
import { describe, expect, it } from 'vitest';
import type { ContratoGravado, EventoContrato, VinculoContrato } from '@sgh/contratos';
import { montarContrato } from '../index.js';

const c: ContratoGravado = {
  id: 7,
  numero: 'CT-1/2026',
  fornecedor: 10,
  tipo: 'servico',
  objeto: 'Serviço sintético de teste',
  critico: true,
  inicio: '2026-01-01',
  fimOriginal: '2026-12-31',
  valorInicial: 10_000,
  indiceReajuste: 'ipca',
  dataBase: '2025-12-01',
  garantia: 'caucao',
  garantiaValor: 500,
  garantiaValidade: '2026-05-31',
  gestor: 'GESTOR',
  fiscal: 'FISCAL',
  centroCusto: null,
  observacao: null,
  situacao: 'ativo',
  versao: 4,
  usuario: 'COMPRAS',
  criadoEm: '2026-01-01T10:00:00',
};
const ev = (
  x: Partial<EventoContrato> & Pick<EventoContrato, 'id' | 'tipo'>,
): EventoContrato & { contrato: number } => ({
  contrato: 7,
  data: null,
  valor: null,
  percentual: null,
  novoFim: null,
  numeroTermo: null,
  notas: null,
  resultado: null,
  descricao: null,
  documento: null,
  usado: false,
  usuario: 'GER',
  criadoEm: '2026-02-01T10:00:00',
  ...x,
});
const vinculo: VinculoContrato = {
  id: 1,
  tipo: 'pedido',
  legado: 500,
  chaveNatural: '2026/77',
  valor: 13_000,
  pedidoDeOrigem: null,
  ativo: true,
  excecao: null,
  usuario: 'C',
  criadoEm: '2026-03-01T10:00:00',
};

describe('montagem do contrato', () => {
  it('o fim vigente, o saldo excedido, o reajuste, a avaliação desqualificada e a garantia vencida', () => {
    const m = montarContrato(
      c,
      'FORNECEDOR SINTÉTICO',
      [
        ev({ id: 1, tipo: 'aditivo', valor: 3_000, novoFim: '2027-03-31' }),
        ev({ id: 2, tipo: 'reajuste', valor: 100, data: '2026-12-01' }),
        ev({
          id: 3,
          tipo: 'avaliacao',
          data: '2026-06-01',
          notas: { qualidade: 1, prazo: 5, atendimento: 5, documentacao: 5 },
          resultado: 'desqualificado',
        }),
      ],
      [vinculo],
      '2026-06-10',
    );
    expect(m.resumo).toMatchObject({ fim: '2027-03-31', faixa: 'vigente', valorTotal: 13_100, saldo: 100 });
    expect(m.detalhe.proximoReajuste).toBe('2027-12-01');
    expect(m.detalhe.ultimaAvaliacao).toEqual({ data: '2026-06-01', resultado: 'desqualificado', media: 4 });
    expect(m.detalhe.proximaAvaliacao).toBe('2026-12-01');
    expect(m.detalhe.avisos.map((a) => a.codigo)).toEqual([
      'acrescimo-acima-do-limite',
      'fornecedor-desqualificado',
      'garantia-vencida',
    ]);
    expect(m.detalhe.eventos[0]).not.toHaveProperty('contrato');
  });
  it('vencido, a vencer, saldo excedido e avaliação vencida', () => {
    const v = montarContrato(
      { ...c, garantia: 'nenhuma' },
      '',
      [],
      [{ ...vinculo, valor: 12_000 }],
      '2027-01-05',
    );
    expect(v.resumo.faixa).toBe('vencido');
    expect(v.detalhe.avisos.map((a) => a.codigo)).toEqual(['vencido', 'saldo-excedido', 'avaliacao-vencida']);
    expect(v.detalhe.ultimaAvaliacao).toBeNull();
    const a = montarContrato({ ...c, garantia: 'nenhuma', critico: false }, '', [], [], '2026-12-10');
    expect(a.detalhe.avisos).toEqual([{ codigo: 'vence-30', mensagem: 'O contrato vence em 21 dia(s).' }]);
  });
});
