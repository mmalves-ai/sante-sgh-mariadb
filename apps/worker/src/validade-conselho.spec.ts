// Regra única da validade vigente da inscrição no conselho (lote F2.2 05-16): ordem por (ocorrido em, id), a exclusão
// derruba a conferência, o registro suspenso ou cancelado sai da conta e, sem conferência, vale a validade da inscrição.
import { describe, expect, it } from 'vitest';
import { type ConferenciaConselho, conferenciaVigente, validadeVigente } from './validade-conselho.js';

const c = (id: number, ocorridoEm: string, x: Partial<ConferenciaConselho> = {}): ConferenciaConselho => ({
  id,
  ocorridoEm,
  operacao: 'inclusao',
  dataValidade: '2030-01-01',
  situacaoRegistro: 'ativo',
  ...x,
});
const ins = { ativa: true, validade: '2020-01-01' };

describe('validade vigente do conselho', () => {
  it('sem conferência: a validade da inscrição', () => {
    expect(validadeVigente(ins, [])).toEqual({ ativo: true, validade: '2020-01-01' });
  });

  it('a conferência retroativa (id maior, ocorrido antes) não passa à frente', () => {
    const cs = [c(1, '2026-05-01T00:00:00.000Z', { dataValidade: '2031-01-01' }), c(2, '2026-01-01T00:00:00.000Z')];
    expect(conferenciaVigente(cs)?.id).toBe(1);
    expect(validadeVigente(ins, cs).validade).toBe('2031-01-01');
  });

  it('no mesmo instante, o id maior', () => {
    expect(conferenciaVigente([c(3, '2026-01-01T00:00:00.000Z'), c(4, '2026-01-01T00:00:00.000Z')])?.id).toBe(4);
  });

  it('a exclusão por último derruba a conferência: volta a validade da inscrição', () => {
    const cs = [c(1, '2026-01-01T00:00:00.000Z'), c(2, '2026-02-01T00:00:00.000Z', { operacao: 'exclusao' })];
    expect(conferenciaVigente(cs)).toBeNull();
    expect(validadeVigente(ins, cs)).toEqual({ ativo: true, validade: '2020-01-01' });
  });

  it('registro suspenso ou cancelado sai da conta; inscrição inativa também', () => {
    expect(validadeVigente(ins, [c(1, '2026-01-01T00:00:00.000Z', { situacaoRegistro: 'suspenso' })]).ativo).toBe(false);
    expect(validadeVigente(ins, [c(1, '2026-01-01T00:00:00.000Z', { situacaoRegistro: 'cancelado' })]).ativo).toBe(false);
    expect(validadeVigente({ ativa: false, validade: null }, []).ativo).toBe(false);
  });

  it('conferência sem data: a validade da inscrição', () => {
    expect(validadeVigente(ins, [c(1, '2026-01-01T00:00:00.000Z', { dataValidade: null })]).validade).toBe('2020-01-01');
  });
});
