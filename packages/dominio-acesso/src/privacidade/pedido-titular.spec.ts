import { describe, expect, it } from 'vitest';
import {
  conferirCancelamento,
  conferirTransicao,
  mensagemCancelamento,
  mensagemTransicao,
  pedidoAtrasado,
  prazoDoPedido,
  protocoloDoPedido,
  type PedidoTitular,
} from './pedido-titular.js';

const base: PedidoTitular = {
  situacao: 'aberto',
  tipo: 'acesso',
  abertoEm: new Date('2026-10-01T12:00:00Z'),
  identidadeVerificada: false,
};

describe('pedidos do titular (LGPD, cap-08 §8.13)', () => {
  it('prazo de 15 dias e atraso só enquanto aberto', () => {
    expect(prazoDoPedido(base.abertoEm).toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(pedidoAtrasado(base, new Date('2026-10-17T00:00:00Z'))).toBe(true);
    expect(pedidoAtrasado(base, new Date('2026-10-10T00:00:00Z'))).toBe(false);
    expect(pedidoAtrasado({ ...base, situacao: 'atendido' }, new Date('2027-01-01'))).toBe(false);
  });
  it('identidade antes da decisão; negativa com fundamento', () => {
    expect(conferirTransicao(base, { para: 'atendido' })).toBe('identidade-primeiro');
    expect(conferirTransicao(base, { para: 'negado', fundamento: 'identidade-nao-confirmada' })).toBeNull();
    expect(conferirTransicao(base, { para: 'identidade-verificada' })).toBeNull();
    const v = { ...base, identidadeVerificada: true, situacao: 'identidade-verificada' as const };
    expect(conferirTransicao(v, { para: 'identidade-verificada' })).toBe('repetido');
    expect(conferirTransicao(v, { para: 'atendido' })).toBeNull();
    expect(conferirTransicao(v, { para: 'negado', fundamento: 'obrigacao-legal' })).toBeNull();
    expect(
      conferirTransicao(v, { para: 'negado' } as unknown as Parameters<typeof conferirTransicao>[1]),
    ).toBe('fundamento-obrigatorio');
    expect(conferirTransicao({ ...v, situacao: 'negado' }, { para: 'atendido' })).toBe('ja-encerrado');
  });
  it('eliminação de prontuário: guarda legal', () => {
    const e = { ...base, tipo: 'eliminacao' as const, identidadeVerificada: true };
    expect(conferirTransicao(e, { para: 'atendido' })).toBe('eliminacao-de-prontuario');
    expect(conferirTransicao(e, { para: 'negado', fundamento: 'guarda-legal-prontuario' })).toBeNull();
  });
  it('mensagens e protocolo', () => {
    for (const r of [
      'ja-encerrado',
      'identidade-primeiro',
      'fundamento-obrigatorio',
      'eliminacao-de-prontuario',
      'repetido',
    ] as const)
      expect(mensagemTransicao(r)).not.toMatch(/spdata|legado/i);
    expect(protocoloDoPedido(2026, 123)).toBe('2026-000123');
    expect(() => protocoloDoPedido(2026, 0)).toThrow();
  });

  it('W0-10: o titular cancela o pedido não respondido; o respondido ou cancelado não se altera', () => {
    expect(conferirCancelamento({ situacao: 'aberto' })).toBeNull();
    expect(conferirCancelamento({ situacao: 'identidade-verificada' })).toBeNull();
    expect(conferirCancelamento({ situacao: 'atendido' })).toBe('ja-respondido');
    expect(conferirCancelamento({ situacao: 'negado' })).toBe('ja-respondido');
    expect(conferirCancelamento({ situacao: 'cancelado' })).toBe('ja-cancelado');
    expect(mensagemCancelamento('ja-respondido')).toMatch(/protocolado não se altera/);
    // O cancelado não recebe decisão nem atraso.
    expect(conferirTransicao({ ...base, situacao: 'cancelado' }, { para: 'identidade-verificada' })).toBe(
      'ja-encerrado',
    );
    expect(pedidoAtrasado({ situacao: 'cancelado', abertoEm: base.abertoEm }, new Date('2027-01-01'))).toBe(
      false,
    );
  });
});

describe('listas do pedido iguais às do CHECK dos scripts 1141/1142', () => {
  it('fixadas também em packages/legado/src/auditoria/script-1141.spec.ts', async () => {
    const m = await import('./pedido-titular.js');
    expect([...m.SITUACOES_PEDIDO]).toEqual([
      'aberto',
      'identidade-verificada',
      'atendido',
      'negado',
      'cancelado',
    ]);
    expect([...m.MOTIVOS_CANCELAMENTO_PEDIDO]).toEqual([
      'desistencia',
      'aberto-por-engano',
      'em-duplicidade',
      'resolvido-de-outra-forma',
    ]);
  });
});
