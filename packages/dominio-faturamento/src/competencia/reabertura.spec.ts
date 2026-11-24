// Reabertura da competência do convênio: fechada, com motivo e, havendo conta já apresentada, só com confirmação.
import { describe, expect, it } from 'vitest';
import { conferirReaberturaCompetencia } from './reabertura.js';

const semLote = { contasApresentadas: 0, valorApresentado: 0 };

describe('reabertura da competência', () => {
  it('reabre a fechada com motivo e sem conta apresentada', () => {
    expect(
      conferirReaberturaCompetencia({
        fechada: true,
        motivo: 'erro no fechamento',
        impacto: semLote,
        confirmarImpacto: false,
      }),
    ).toBeNull();
  });

  it('a aberta e o motivo curto recusam', () => {
    expect(
      conferirReaberturaCompetencia({
        fechada: false,
        motivo: 'motivo ok',
        impacto: semLote,
        confirmarImpacto: false,
      })?.codigo,
    ).toBe('competencia-aberta');
    expect(
      conferirReaberturaCompetencia({
        fechada: true,
        motivo: '  x   ',
        impacto: semLote,
        confirmarImpacto: false,
      }),
    ).toMatchObject({ codigo: 'motivo-obrigatorio', campos: ['motivo'] });
  });

  it('conta já apresentada: recusa mostrando quantas e o valor; com a confirmação, reabre', () => {
    const impacto = { contasApresentadas: 2, valorApresentado: 1234.5 };
    const r = conferirReaberturaCompetencia({
      fechada: true,
      motivo: 'conta esquecida',
      impacto,
      confirmarImpacto: false,
    });
    expect(r).toMatchObject({ codigo: 'competencia-apresentada', impacto });
    expect(r?.mensagem).toContain('2 contas');
    expect(r?.mensagem).toContain('R$ 1.234,50');
    expect(
      conferirReaberturaCompetencia({
        fechada: true,
        motivo: 'conta esquecida',
        impacto,
        confirmarImpacto: true,
      }),
    ).toBeNull();
  });
});
