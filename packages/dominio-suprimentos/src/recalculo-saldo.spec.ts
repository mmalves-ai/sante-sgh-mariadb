// F3.6 (05-SUP linha 16): recálculo auditado do saldo e do custo médio pelo razão.
import { conferirRecalculo, diferencaRecalculo, projetarRazao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';

const zero = { quantidade: 0, custo: 0 };

describe('projetarRazao (custo médio ponderado, como o motor)', () => {
  it('refaz a quantidade e o custo médio a partir da abertura', () => {
    const p = projetarRazao(
      zero,
      [
        { natureza: 'entrada', quantidade: 10, valor: 100 },
        { natureza: 'entrada', quantidade: 10, valor: 300 },
        { natureza: 'saida', quantidade: 5, valor: 100 },
      ],
      true,
      999,
    );
    expect(p).toEqual({ quantidade: 15, custo: 20, negativoNoMovimento: null });
  });

  it('parte da posição do último mês fechado', () => {
    const p = projetarRazao(
      { quantidade: 4, custo: 5 },
      [{ natureza: 'entrada', quantidade: 6, valor: 30 }],
      true,
      0,
    );
    expect(p.quantidade).toBe(10);
    expect(p.custo).toBe(5);
  });

  it('o estorno de entrada sai pelo valor dela e desfaz o custo que ela trouxe', () => {
    const p = projetarRazao(
      zero,
      [
        { natureza: 'entrada', quantidade: 10, valor: 100 },
        { natureza: 'entrada', quantidade: 10, valor: 300 },
        { natureza: 'saida', quantidade: 10, valor: 300, valorEstornado: 300 },
      ],
      true,
      0,
    );
    expect(p).toEqual({ quantidade: 10, custo: 10, negativoNoMovimento: null });
  });

  it('sem recalcular o custo, fica o custo gravado', () => {
    expect(projetarRazao(zero, [{ natureza: 'entrada', quantidade: 2, valor: 50 }], false, 7).custo).toBe(7);
  });

  it('aponta o movimento em que o razão ficaria negativo', () => {
    const p = projetarRazao(
      zero,
      [
        { natureza: 'entrada', quantidade: 1, valor: 1 },
        { natureza: 'saida', quantidade: 3, valor: 3 },
        { natureza: 'entrada', quantidade: 5, valor: 5 },
      ],
      true,
      0,
    );
    expect(p.negativoNoMovimento).toBe(2);
    expect(p.quantidade).toBe(3);
  });
});

describe('diferencaRecalculo', () => {
  it('é a projeção menos o gravado, em quantidade e em valor', () => {
    expect(diferencaRecalculo({ quantidade: 12, custo: 20 }, { quantidade: 15, custo: 20 })).toEqual({
      quantidade: 3,
      valor: 60,
    });
  });
});

describe('conferirRecalculo', () => {
  const corrente = { ano: 2026, mes: 11 };
  const motivo = 'Saldo divergente do razão após a carga';

  it('aceita o período em mês aberto com motivo', () => {
    expect(
      conferirRecalculo({ competencia: { ano: 2026, mes: 10 }, motivo }, [{ ano: 2026, mes: 9 }], corrente),
    ).toEqual([]);
  });

  it('recusa começar em mês fechado ou antes dele (reabra antes)', () => {
    const rs = conferirRecalculo(
      { competencia: { ano: 2026, mes: 8 }, motivo },
      [{ ano: 2026, mes: 9 }],
      corrente,
    );
    expect(rs.map((r) => r.codigo)).toEqual(['periodo-fechado']);
    expect(rs[0]?.mensagem).toContain('09/2026');
  });

  it('recusa mês futuro e motivo curto', () => {
    const rs = conferirRecalculo({ competencia: { ano: 2026, mes: 12 }, motivo: 'curto' }, [], corrente);
    expect(rs.map((r) => r.codigo)).toEqual(['competencia-futura', 'motivo-obrigatorio']);
  });
});
