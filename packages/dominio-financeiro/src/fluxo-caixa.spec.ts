// Fluxo de caixa realizado e projetado (M32; ficha, seção 10): a glosa histórica e o atraso do convênio no projetado.
import { describe, expect, it } from 'vitest';
import { chavePeriodo, dentroDoHorizonte, montarFluxo, projetarRecebivel } from './index.js';

describe('fluxo de caixa', () => {
  it('saldo 1.000 + 500 recebidos − 200 pagos + 900 projetados (1.000 × 90% de glosa histórica 10%) − 300 a pagar', () => {
    const h = new Map([[32, { convenio: 32, taxaGlosa: 0.1, atrasoMedioDias: 5 }]]);
    const f = montarFluxo(
      1_000,
      [
        { data: '2026-03-02', valor: 500, sentido: 'entrada', origem: 'movimento', realizado: true },
        { data: '2026-03-03', valor: 200, sentido: 'saida', origem: 'pagar', realizado: true },
        {
          data: '2026-03-26',
          valor: 1_000,
          sentido: 'entrada',
          origem: 'receber',
          realizado: false,
          convenio: 32,
        },
        { data: '2026-04-05', valor: 300, sentido: 'saida', origem: 'pagar', realizado: false },
      ],
      'mes',
      h,
    );
    expect(f).toEqual([
      {
        periodo: '2026-03',
        entradasRealizadas: 500,
        saidasRealizadas: 200,
        entradasProjetadas: 900,
        saidasProjetadas: 0,
        saldo: 2_200,
      },
      {
        periodo: '2026-04',
        entradasRealizadas: 0,
        saidasRealizadas: 0,
        entradasProjetadas: 0,
        saidasProjetadas: 300,
        saldo: 1_900,
      },
    ]);
  });
  it('o recebível projetado anda o atraso médio (26/03 + 5 = 31/03) e o realizado não muda', () => {
    const h = new Map([[32, { convenio: 32, taxaGlosa: 0.2, atrasoMedioDias: 5 }]]);
    const l = {
      data: '2026-03-26',
      valor: 100,
      sentido: 'entrada' as const,
      origem: 'receber' as const,
      realizado: false,
      convenio: 32,
    };
    expect(projetarRecebivel(l, h)).toEqual({ ...l, data: '2026-03-31', valor: 80 });
    expect(projetarRecebivel({ ...l, realizado: true }, h)).toEqual({ ...l, realizado: true });
    expect(projetarRecebivel({ ...l, convenio: 99 }, h)).toEqual({ ...l, convenio: 99 });
  });
  it('agrupa por dia, semana (segunda-feira) e mês; horizonte de 90 dias', () => {
    expect(chavePeriodo('2026-03-05', 'dia')).toBe('2026-03-05');
    expect(chavePeriodo('2026-03-05', 'semana')).toBe('2026-03-02');
    expect(chavePeriodo('2026-03-08', 'semana')).toBe('2026-03-02');
    expect(chavePeriodo('2026-03-05', 'mes')).toBe('2026-03');
    expect(dentroDoHorizonte('2026-03-01', '2026-05-30')).toBe(true);
    expect(dentroDoHorizonte('2026-03-01', '2026-06-01')).toBe(false);
    const semanal = montarFluxo(
      0,
      [{ data: '2026-03-04', valor: 10, sentido: 'entrada', origem: 'movimento', realizado: true }],
      'semana',
    );
    expect(semanal[0]?.periodo).toBe('2026-03-02');
  });
});
