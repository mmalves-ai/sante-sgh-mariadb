// Regra 9 do M31: competência fechada não recebe conta; fechar duas vezes, mês inválido e competência futura são
// recusados; reabrir exige supervisor e motivo.
import { describe, expect, it } from 'vitest';
import {
  chaveCompetencia,
  conferirCompetenciaAberta,
  conferirFechamentoCompetencia,
  conferirReaberturaCompetencia,
} from '@sgh/contratos/regras-faturamento';

describe('competência', () => {
  it('fecha a competência aberta e passada', () => {
    expect(
      conferirFechamentoCompetencia({ jaFechada: false, ano: 2026, mes: 9, hoje: '2026-10-23' }),
    ).toBeNull();
    expect(
      conferirFechamentoCompetencia({ jaFechada: false, ano: 2026, mes: 10, hoje: '2026-10-23' }),
    ).toBeNull();
  });
  it.each([
    [{ jaFechada: true, ano: 2026, mes: 9 }, 'ja-fechada'],
    [{ jaFechada: false, ano: 2026, mes: 13 }, 'competencia-invalida'],
    [{ jaFechada: false, ano: 2026, mes: 11 }, 'competencia-futura'],
  ])('%j → %s', (x, codigo) => {
    expect(conferirFechamentoCompetencia({ ...x, hoje: '2026-10-23' })?.codigo).toBe(codigo);
  });
  it('competência fechada não recebe conta', () => {
    expect(conferirCompetenciaAberta(true)?.codigo).toBe('competencia-fechada');
    expect(conferirCompetenciaAberta(false)).toBeNull();
  });
  it('reabrir: supervisor e motivo', () => {
    expect(
      conferirReaberturaCompetencia({ fechada: true, supervisor: true, motivo: 'erro no fechamento' }),
    ).toBeNull();
    expect(conferirReaberturaCompetencia({ fechada: false, supervisor: true, motivo: 'x' })?.codigo).toBe(
      'competencia-aberta',
    );
    expect(
      conferirReaberturaCompetencia({ fechada: true, supervisor: false, motivo: 'motivo ok' })?.codigo,
    ).toBe('sem-supervisor');
    expect(conferirReaberturaCompetencia({ fechada: true, supervisor: true, motivo: 'x' })?.codigo).toBe(
      'motivo-obrigatorio',
    );
  });
  it('chave da competência', () => {
    expect(chaveCompetencia(301, 2026, 9)).toBe('301/2026/09');
  });
});
