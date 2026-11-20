// Regra 14 (ficha do M28): contagem cega; divergência acima do limite exige recontagem; ajuste aprovado pelo supervisor.
import { describe, expect, it } from 'vitest';
import {
  ajusteDoInventario,
  avaliarItem,
  conferirAprovacao,
  conferirRecontagem,
  divergenciaPct,
  visaoCega,
} from '@sgh/contratos/regras-suprimentos';

const item = (saldo: number, ...cs: [number, string][]) => ({
  item: 1,
  saldoSistema: saldo,
  contagens: cs.map(([quantidade, contador]) => ({ quantidade, contador })),
});

describe('inventário (regra 14)', () => {
  it('divergência em percentual', () => {
    expect(divergenciaPct(100, 95)).toBe(5);
    expect(divergenciaPct(0, 0)).toBe(0);
    expect(divergenciaPct(0, 3)).toBe(100);
  });
  it('pendente, ok, recontar e confirmado', () => {
    expect(avaliarItem(item(100), 2).situacao).toBe('pendente');
    expect(avaliarItem(item(100, [99, 'A']), 2).situacao).toBe('ok');
    expect(avaliarItem(item(100, [90, 'A']), 2).situacao).toBe('recontar');
    expect(avaliarItem(item(100, [90, 'A'], [90, 'B']), 2).situacao).toBe('divergente-confirmado');
    expect(avaliarItem(item(100, [90, 'A'], [91, 'B']), 2).situacao).toBe('recontar');
  });
  it('recontagem por outra pessoa; o contador não vê o saldo', () => {
    expect(conferirRecontagem(item(100, [90, 'A']), 'A')?.codigo).toBe('mesmo-contador');
    expect(conferirRecontagem(item(100, [90, 'A']), 'B')).toBeNull();
    expect(visaoCega(item(100, [90, 'A']))).toEqual({ item: 1, contagens: 1 });
  });
  it('o ajuste só com tudo resolvido, com as diferenças', () => {
    expect(ajusteDoInventario([item(100, [90, 'A'])], 2).recusa?.codigo).toBe('inventario-incompleto');
    expect(
      ajusteDoInventario([item(100, [90, 'A'], [90, 'B']), { ...item(5, [5, 'A']), item: 2 }], 2),
    ).toEqual({
      linhas: [{ item: 1, quantidade: 90, diferenca: -10 }],
      recusa: null,
    });
  });
  it('aprovação: supervisor e não quem contou', () => {
    const its = [item(100, [90, 'A'])];
    expect(conferirAprovacao(its, 'S', false)?.codigo).toBe('sem-permissao-aprovar');
    expect(conferirAprovacao(its, 'A', true)?.codigo).toBe('aprovador-contou');
    expect(conferirAprovacao(its, 'S', true)).toBeNull();
  });
});
