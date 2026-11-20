// Regra 11 do M32: o vencimento pelo prazo do contrato do convênio (0 a 90 dias) e o calendário de pagamento.
import { describe, expect, it } from 'vitest';
import { conferirPrazo, proximoDiaUtil, vencimentoConvenio } from './index.js';

describe('vencimento (regra 11)', () => {
  it('apresentação 2026-03-02 (segunda) + 30 dias = 2026-04-01 (quarta)', () => {
    expect(vencimentoConvenio('2026-03-02', { prazoDias: 30, diasDePagamento: [] })).toBe('2026-04-01');
  });
  it('cai no sábado: vai para segunda; feriado também passa', () => {
    // 2026-03-02 + 26 = 2026-03-28 (sábado) → 2026-03-30 (segunda).
    expect(vencimentoConvenio('2026-03-02', { prazoDias: 26, diasDePagamento: [] })).toBe('2026-03-30');
    expect(proximoDiaUtil('2026-03-30', new Set(['2026-03-30']))).toBe('2026-03-31');
  });
  it('calendário do convênio (dias 10 e 25): o primeiro dia de pagamento depois do prazo', () => {
    // 2026-03-02 + 30 = 2026-04-01 → dia 10 de abril (sexta).
    expect(vencimentoConvenio('2026-03-02', { prazoDias: 30, diasDePagamento: [25, 10] })).toBe('2026-04-10');
    // 2026-03-02 + 45 = 2026-04-16 → dia 25 de abril (sábado) → 2026-04-27 (segunda).
    expect(vencimentoConvenio('2026-03-02', { prazoDias: 45, diasDePagamento: [10, 25] })).toBe('2026-04-27');
    // Dia 31 em mês curto: o último dia (30 de abril de 2026, quinta).
    expect(vencimentoConvenio('2026-04-01', { prazoDias: 10, diasDePagamento: [31] })).toBe('2026-04-30');
    // Passa do último dia do mês: vira o mês (2026-12-20 + 15 = 2027-01-04 → dia 1? não; dia 5 de janeiro).
    expect(vencimentoConvenio('2026-12-20', { prazoDias: 15, diasDePagamento: [5] })).toBe('2027-01-05');
  });
  it('prazo de 0 a 90 dias; dias de 1 a 31', () => {
    expect(conferirPrazo({ prazoDias: 0, diasDePagamento: [] })).toBeNull();
    expect(conferirPrazo({ prazoDias: 90, diasDePagamento: [1, 31] })).toBeNull();
    expect(conferirPrazo({ prazoDias: 91, diasDePagamento: [] })?.codigo).toBe('prazo-fora-da-faixa');
    expect(conferirPrazo({ prazoDias: 1.5, diasDePagamento: [] })?.codigo).toBe('prazo-fora-da-faixa');
    expect(conferirPrazo({ prazoDias: 30, diasDePagamento: [32] })?.codigo).toBe('dia-de-pagamento-invalido');
  });
});
