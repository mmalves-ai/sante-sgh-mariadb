// C1-065 (04-INT linha 75): bloqueio do quarto pela auditoria do isolamento (regra pura).
import { describe, expect, it } from 'vitest';
import { bloqueioDoQuartoPelaAuditoria, type LeitoDoQuarto } from './bloqueio-isolamento.js';

const leito = (id: number, x: Partial<LeitoDoQuarto> = {}): LeitoDoQuarto => ({
  id,
  doIsolado: false,
  comEstadoAberto: false,
  ocupado: false,
  ...x,
});

describe('bloqueio do quarto pela auditoria do isolamento', () => {
  const quarto = [
    leito(1, { doIsolado: true, ocupado: true }),
    leito(2),
    leito(3, { ocupado: true }),
    leito(4, { comEstadoAberto: true }),
    leito(5),
  ];

  it('sem critério "bloquear" não conforme: nada é bloqueado', () => {
    expect(bloqueioDoQuartoPelaAuditoria([], quarto)).toEqual({
      exige: false,
      bloquear: [],
      ocupadosPorOutro: [],
    });
    expect(bloqueioDoQuartoPelaAuditoria([{ acao: 'alertar' }], quarto).bloquear).toEqual([]);
  });

  it('"bloquear": bloqueia os vizinhos livres; o leito do isolado nunca; o ocupado por outro vai para a CCIH', () => {
    expect(bloqueioDoQuartoPelaAuditoria([{ acao: 'alertar' }, { acao: 'bloquear' }], quarto)).toEqual({
      exige: true,
      bloquear: [2, 5],
      ocupadosPorOutro: [3],
    });
  });

  it('o leito do isolado não é bloqueado nem quando está livre (o atendimento dele segue)', () => {
    const r = bloqueioDoQuartoPelaAuditoria([{ acao: 'bloquear' }], [leito(9, { doIsolado: true })]);
    expect(r).toEqual({ exige: true, bloquear: [], ocupadosPorOutro: [] });
  });

  it('leito com estado aberto fica como está', () => {
    const r = bloqueioDoQuartoPelaAuditoria([{ acao: 'bloquear' }], [leito(4, { comEstadoAberto: true })]);
    expect(r.bloquear).toEqual([]);
  });
});
