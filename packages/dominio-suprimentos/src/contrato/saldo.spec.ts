// Regra 6 da ficha do M55 (etapa 3): saldo contratual = valor + aditivos + reajustes + renovações − pedidos − títulos
// sem pedido, com as parcelas impressas; o título que paga pedido ligado não abate de novo; o vínculo inativo
// (pedido cancelado, título excluído) não abate; o aviso do acréscimo acima de 25%.
import { describe, expect, it } from 'vitest';
import { acrescimoAcimaDoLimite, saldoContrato } from '../index.js';

describe('saldo do contrato', () => {
  const eventos = [
    { tipo: 'aditivo' as const, valor: 10_000 },
    { tipo: 'aditivo' as const, valor: -2_000 },
    { tipo: 'reajuste' as const, valor: 5_544 },
    { tipo: 'renovacao' as const, valor: 0 },
    { tipo: 'ocorrencia' as const, valor: null },
  ];
  const vinculos = [
    { id: 1, tipo: 'pedido' as const, valor: 30_000, ativo: true, pedidoDeOrigem: null },
    { id: 2, tipo: 'titulo' as const, valor: 15_000, ativo: true, pedidoDeOrigem: 1 },
    { id: 3, tipo: 'titulo' as const, valor: 4_000.5, ativo: true, pedidoDeOrigem: null },
    { id: 4, tipo: 'pedido' as const, valor: 9_999, ativo: false, pedidoDeOrigem: null },
  ];
  it('as parcelas e a conta', () => {
    const s = saldoContrato(120_000, eventos, vinculos);
    expect(s).toMatchObject({
      valorInicial: 120_000,
      aditivos: 8_000,
      reajustes: 5_544,
      renovacoes: 0,
      valorTotal: 133_544,
      pedidos: 30_000,
      titulosAvulsos: 4_000.5,
      titulosDePedidos: 15_000,
      consumido: 34_000.5,
      saldo: 99_543.5,
      percentualConsumido: 25.46,
    });
    expect(s.conta).toBe(
      '120.000,00 + 8.000,00 (aditivos) + 5.544,00 (reajustes) + 0,00 (renovações) − 30.000,00 (pedidos) − 4.000,50 (títulos sem pedido) = 99.543,50',
    );
  });
  it('sem eventos nem vínculos: o saldo é o valor; valor zero sem divisão', () => {
    expect(saldoContrato(500, [], []).saldo).toBe(500);
    expect(saldoContrato(0, [], []).percentualConsumido).toBe(0);
  });
  it('o aviso do acréscimo acumulado acima de 25% do inicial', () => {
    expect(acrescimoAcimaDoLimite(100_000, 25_000)).toBe(false);
    expect(acrescimoAcimaDoLimite(100_000, 25_000.01)).toBe(true);
    expect(acrescimoAcimaDoLimite(0, 10)).toBe(false);
  });
});
