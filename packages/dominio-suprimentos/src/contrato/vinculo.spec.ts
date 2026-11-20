// Regra 7 da ficha do M55 (etapa 3): o contrato vencido (ou não iniciado) recusa o pedido ou o título ligado, salvo a
// exceção aprovada pela alçada (do mesmo contrato, não usada, até 30 dias, de outra pessoa); encerrado recusa sempre;
// só o fornecedor do contrato; o pedido exige saldo; o título até o saldo; um vínculo por pedido ou título.
import { describe, expect, it } from 'vitest';
import { esquemaContratoDoVinculo, esquemaVincularContrato } from '@sgh/contratos';
import { conferirVinculoContrato } from '../index.js';

const contrato = {
  id: 7,
  situacao: 'ativo' as const,
  inicio: '2026-01-01',
  fim: '2026-12-31',
  fornecedor: 10,
};
const base = {
  contrato,
  hoje: '2026-06-01',
  tipo: 'pedido' as const,
  fornecedores: [10],
  valor: 0,
  saldo: 1000,
  excecao: null,
  solicitante: 'COMPRADOR',
  jaVinculado: false,
};
const excecao = { id: 99, contrato: 7, aprovador: 'GERENTE', criadoEm: '2027-01-05T10:00:00', usada: false };
const codigo = (o: Partial<Parameters<typeof conferirVinculoContrato>[0]>) =>
  conferirVinculoContrato({ ...base, ...o })?.codigo ?? null;

describe('vínculo de pedido ou título ao contrato', () => {
  it('aceita o pedido do fornecedor no contrato vigente com saldo e o título até o saldo', () => {
    expect(codigo({})).toBeNull();
    expect(codigo({ fornecedores: [] })).toBeNull();
    expect(codigo({ tipo: 'titulo', valor: 1000 })).toBeNull();
  });
  it('recusa o vencido e o não iniciado sem exceção', () => {
    expect(codigo({ hoje: '2027-01-10' })).toBe('contrato-vencido');
    expect(codigo({ hoje: '2025-12-31' })).toBe('contrato-nao-iniciado');
  });
  it('aceita o vencido com a exceção válida de outra pessoa', () => {
    expect(codigo({ hoje: '2027-01-10', excecao })).toBeNull();
  });
  it('recusa a exceção de outro contrato, usada, expirada, do próprio aprovador ou desnecessária', () => {
    expect(codigo({ hoje: '2027-01-10', excecao: { ...excecao, contrato: 8 } })).toBe(
      'excecao-de-outro-contrato',
    );
    expect(codigo({ hoje: '2027-01-10', excecao: { ...excecao, usada: true } })).toBe('excecao-usada');
    expect(codigo({ hoje: '2027-02-05', excecao })).toBe('excecao-expirada');
    expect(codigo({ hoje: '2027-01-10', excecao, solicitante: 'gerente' })).toBe('excecao-do-proprio');
    expect(codigo({ excecao })).toBe('excecao-desnecessaria');
  });
  it('recusa encerrado, outro fornecedor, já ligado, pedido de origem inválido, sem saldo e título acima do saldo', () => {
    expect(codigo({ contrato: { ...contrato, situacao: 'encerrado' } })).toBe('contrato-encerrado');
    expect(codigo({ fornecedores: [10, 11] })).toBe('fornecedor-diferente');
    expect(codigo({ jaVinculado: true })).toBe('ja-vinculado');
    expect(codigo({ tipo: 'titulo', pedidoDeOrigemValido: false })).toBe('pedido-de-origem-invalido');
    expect(codigo({ saldo: 0 })).toBe('sem-saldo');
    expect(conferirVinculoContrato({ ...base, tipo: 'titulo', valor: 1000.01 })?.mensagem).toBe(
      'O título (1.000,01) é maior que o saldo do contrato (1.000,00).',
    );
  });
});

describe('entradas do vínculo', () => {
  it('o contrato no pedido ou no título, com os padrões', () => {
    expect(esquemaContratoDoVinculo.parse({ contrato: 7 })).toEqual({
      contrato: 7,
      excecao: null,
      pedidoDeOrigem: null,
    });
  });
  it('um pedido por vez; o pedido de origem só no título', () => {
    const v = { chave: 'vinculo-0001', tipo: 'pedido', ids: [1] };
    expect(esquemaVincularContrato.safeParse(v).success).toBe(true);
    expect(esquemaVincularContrato.safeParse({ ...v, ids: [1, 2] }).success).toBe(false);
    expect(esquemaVincularContrato.safeParse({ ...v, pedidoDeOrigem: 3 }).success).toBe(false);
    expect(
      esquemaVincularContrato.safeParse({ ...v, tipo: 'titulo', ids: [1, 2], pedidoDeOrigem: 3 }).success,
    ).toBe(true);
  });
});
