// C3-025 (07-FIN linha 132): só a referência do empenho no pedido e no título, com a exportação para o ente.
import { describe, expect, it } from 'vitest';
import {
  conferirSemOutroEmpenho,
  conferirVinculoPedidoEmpenho,
  conferirVinculoTituloEmpenho,
  exportacaoEmpenhoCsv,
  saldoReferenciaEmpenho,
} from '../index.js';

const emp = { situacao: 'emitido', credor: 7, valorTotal: 150 };

describe('referência do empenho', () => {
  it('o pedido recebe só empenho em vigor do mesmo credor', () => {
    expect(conferirVinculoPedidoEmpenho(emp, { situacao: 'aprovado', fornecedor: 7 })).toBeNull();
    expect(
      conferirVinculoPedidoEmpenho({ ...emp, situacao: 'parcial' }, { situacao: 'enviado', fornecedor: 7 }),
    ).toBeNull();
    expect(
      conferirVinculoPedidoEmpenho({ ...emp, situacao: 'anulado' }, { situacao: 'aprovado', fornecedor: 7 })
        ?.codigo,
    ).toBe('empenho-fora-de-vigor');
    expect(conferirVinculoPedidoEmpenho(emp, { situacao: 'aprovado', fornecedor: 8 })?.codigo).toBe(
      'empenho-credor-diferente',
    );
    expect(conferirVinculoPedidoEmpenho(emp, { situacao: 'cancelado', fornecedor: 7 })?.codigo).toBe(
      'pedido-sem-empenho',
    );
  });

  it('o título não passa do valor empenhado; cancelado e credor diferente recusam', () => {
    const tit = { situacao: 'aberto', credor: 7, valorLiquido: 100 };
    expect(conferirVinculoTituloEmpenho(emp, tit, 50)).toBeNull();
    expect(conferirVinculoTituloEmpenho(emp, tit, 50.01)?.codigo).toBe('empenho-sem-saldo');
    expect(conferirVinculoTituloEmpenho(emp, { ...tit, situacao: 'cancelado' }, 0)?.codigo).toBe(
      'titulo-cancelado',
    );
    expect(conferirVinculoTituloEmpenho(emp, { ...tit, credor: null }, 0)?.codigo).toBe(
      'empenho-credor-diferente',
    );
    expect(saldoReferenciaEmpenho(150, 100)).toBe(50);
    expect(saldoReferenciaEmpenho(150, 200)).toBe(0);
  });

  it('a exportação sai em CSV com ponto e vírgula, valores com ponto e texto escapado', () => {
    const csv = exportacaoEmpenhoCsv([
      {
        empenho: 'NE1',
        emitidoEm: '2026-11-02',
        fonteRecurso: '1.500',
        naturezaDespesa: null,
        valorEmpenho: 150,
        credorDocumento: '00000000000191',
        credorNome: 'Fornecedor; "Sintético"',
        pedido: '2026/12',
        titulo: 'TP-1',
        documento: '55',
        emissaoDocumento: '2026-11-10',
        valorTitulo: 99.5,
        situacaoTitulo: 'aberto',
      },
    ]);
    const [cab, linha, fim] = csv.split('\r\n');
    expect(cab?.split(';')).toHaveLength(13);
    expect(linha).toBe(
      'NE1;2026-11-02;1.500;;150.00;00000000000191;"Fornecedor; ""Sintético""";2026/12;TP-1;55;2026-11-10;99.50;aberto',
    );
    expect(fim).toBe('');
  });
  it('o já referido a outro empenho não troca de empenho; o mesmo empenho passa', () => {
    expect(conferirSemOutroEmpenho(null, 7)).toBeNull();
    expect(conferirSemOutroEmpenho(7, 7)).toBeNull();
    expect(conferirSemOutroEmpenho(8, 7)?.codigo).toBe('referencia-de-outro-empenho');
  });
});
