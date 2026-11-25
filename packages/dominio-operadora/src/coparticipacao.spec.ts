// F7 (08-SGO linha 98): a coparticipação com os tetos por evento, mês e ano.
import { describe, expect, it } from 'vitest';
import { calcularCoparticipacao, problemasDaCoparticipacao, problemasDosTetos } from './coparticipacao.js';

const nada = { mes: 0, ano: 0 };

describe('coparticipação com tetos', () => {
  it('sem regra ou tipo nenhuma: sem coparticipação, recusa produto-sem-coparticipacao', () => {
    const c = calcularCoparticipacao({ tipo: 1, valor: null }, 100, nada);
    expect(c).toEqual({ calculado: null, valor: null, limitadoPor: null });
    expect(problemasDaCoparticipacao(c)).toEqual(['produto-sem-coparticipacao']);
  });

  it('percentual sem teto: 30% de 250,10 dá 75,03', () => {
    const c = calcularCoparticipacao({ tipo: 2, valor: 30 }, 250.1, nada);
    expect(c).toEqual({ calculado: 75.03, valor: 75.03, limitadoPor: null });
    expect(problemasDaCoparticipacao(c)).toEqual([]);
  });

  it('valor fixo nunca passa do evento', () => {
    expect(calcularCoparticipacao({ tipo: 3, valor: 50 }, 20, nada).valor).toBe(20);
  });

  it('teto por evento reduz o valor', () => {
    const c = calcularCoparticipacao({ tipo: 2, valor: 50, tetoEvento: 80 }, 1000, nada);
    expect(c).toEqual({ calculado: 500, valor: 80, limitadoPor: 'evento' });
  });

  it('teto mensal conta o já lançado no mês; o anual conta o ano', () => {
    const r = { tipo: 2, valor: 50, tetoEvento: 80, tetoMensal: 200, tetoAnual: 1000 };
    expect(calcularCoparticipacao(r, 1000, { mes: 150, ano: 150 })).toEqual({
      calculado: 500,
      valor: 50,
      limitadoPor: 'mensal',
    });
    expect(calcularCoparticipacao(r, 1000, { mes: 0, ano: 990 })).toEqual({
      calculado: 500,
      valor: 10,
      limitadoPor: 'anual',
    });
  });

  it('teto esgotado recusa com coparticipacao-teto-atingido; evento de valor zero recusa com coparticipacao-zero', () => {
    const r = { tipo: 2, valor: 50, tetoMensal: 200 };
    const c = calcularCoparticipacao(r, 1000, { mes: 200, ano: 200 });
    expect(c.valor).toBe(0);
    expect(problemasDaCoparticipacao(c)).toEqual(['coparticipacao-teto-atingido']);
    expect(problemasDaCoparticipacao(calcularCoparticipacao(r, 0, nada))).toEqual(['coparticipacao-zero']);
  });

  it('tetos: positivos, evento ≤ mensal ≤ anual', () => {
    expect(
      problemasDosTetos({ tipo: 2, valor: 30, tetoEvento: 50, tetoMensal: 100, tetoAnual: 900 }),
    ).toEqual([]);
    expect(problemasDosTetos({ tipo: 2, valor: 30, tetoEvento: 0 })).toEqual([
      'coparticipacao-teto-invalido',
    ]);
    expect(problemasDosTetos({ tipo: 2, valor: 30, tetoEvento: 150, tetoMensal: 100 })).toEqual([
      'coparticipacao-teto-invalido',
    ]);
    expect(problemasDosTetos({ tipo: 2, valor: 30, tetoMensal: 1000, tetoAnual: 900 })).toEqual([
      'coparticipacao-teto-invalido',
    ]);
  });
});
