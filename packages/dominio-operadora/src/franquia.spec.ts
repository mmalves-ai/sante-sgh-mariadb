import { describe, expect, it } from 'vitest';
import { calcularFranquia, janelaDeAcumulo, problemasDaFranquia, type RegraFranquia } from './franquia.js';

const regra = (x: Partial<RegraFranquia> = {}): RegraFranquia => ({
  valor: 300,
  percentual: null,
  fator: null,
  tetoPorGuia: null,
  periodoAcumulo: 'ano',
  diasInternacao: null,
  cobraGuiaAmbulatorialNaInternacao: false,
  inicio: '2026-01-01',
  fim: null,
  ...x,
});

describe('franquia do plano (C2-116, 08-SGO L98)', () => {
  it('cobra o evento inteiro até o limite da janela e avisa o restante', () => {
    expect(calcularFranquia(regra(), { valor: 120, data: '2026-03-10' }, 0)).toEqual({
      cobrado: 120,
      restante: 180,
      motivo: 'cobrada',
    });
    expect(calcularFranquia(regra(), { valor: 250, data: '2026-04-10' }, 120)).toEqual({
      cobrado: 180,
      restante: 0,
      motivo: 'limite-atingido',
    });
    expect(calcularFranquia(regra(), { valor: 90, data: '2026-05-10' }, 300).cobrado).toBe(0);
  });

  it('percentual, fator e teto por guia limitam a parte do evento', () => {
    expect(calcularFranquia(regra({ percentual: 20 }), { valor: 500, data: '2026-03-10' }, 0).cobrado).toBe(
      100,
    );
    expect(
      calcularFranquia(regra({ fator: 0.5, valor: null }), { valor: 81.25, data: '2026-03-10' }, 0),
    ).toEqual({
      cobrado: 40.63,
      restante: null,
      motivo: 'cobrada',
    });
    expect(calcularFranquia(regra({ tetoPorGuia: 50 }), { valor: 200, data: '2026-03-10' }, 0)).toEqual({
      cobrado: 50,
      restante: 250,
      motivo: 'teto-por-guia',
    });
  });

  it('internação: só os dias cobertos; guia ambulatorial na internação só se a regra mandar', () => {
    const r = regra({ valor: null, diasInternacao: 2 });
    expect(calcularFranquia(r, { valor: 1000, data: '2026-03-10', diasInternacao: 5 }, 0)).toEqual({
      cobrado: 400,
      restante: null,
      motivo: 'internacao-alem-dos-dias',
    });
    const amb = { valor: 80, data: '2026-03-11', ambulatorialDuranteInternacao: true };
    expect(calcularFranquia(r, amb, 0)).toMatchObject({ cobrado: 0, motivo: 'ambulatorial-na-internacao' });
    expect(calcularFranquia({ ...r, cobraGuiaAmbulatorialNaInternacao: true }, amb, 0).cobrado).toBe(80);
  });

  it('fora da vigência não cobra', () => {
    const r = regra({ inicio: '2026-06-01', fim: '2026-06-30' });
    expect(calcularFranquia(r, { valor: 100, data: '2026-07-01' }, 0).motivo).toBe('fora-da-vigencia');
  });

  it('janela de acúmulo por dia, mês, ano e vigência do contrato', () => {
    const c = { inicio: '2025-08-15', fim: null };
    expect(janelaDeAcumulo('dia', '2026-02-10', c)).toEqual({ inicio: '2026-02-10', fim: '2026-02-10' });
    expect(janelaDeAcumulo('mes', '2028-02-10', c)).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    expect(janelaDeAcumulo('ano', '2026-02-10', c)).toEqual({ inicio: '2026-01-01', fim: '2026-12-31' });
    expect(janelaDeAcumulo('vigencia_contrato', '2026-02-10', c)).toEqual({
      inicio: '2025-08-15',
      fim: '9999-12-31',
    });
  });

  it('problemas da regra para a recusa e a validação na hora', () => {
    expect(problemasDaFranquia(regra())).toEqual([]);
    expect(
      problemasDaFranquia(
        regra({
          valor: null,
          percentual: null,
          fator: null,
          diasInternacao: 0,
          inicio: '2026-05-01',
          fim: '2026-04-01',
        }),
      ),
    ).toEqual(['franquia-sem-valor', 'franquia-dias-internacao-invalido', 'franquia-fim-antes-do-inicio']);
    expect(problemasDaFranquia(regra({ percentual: 120, fator: 2, tetoPorGuia: 400 }))).toEqual([
      'franquia-percentual-invalido',
      'franquia-fator-invalido',
      'franquia-percentual-ou-fator',
      'franquia-teto-acima-do-limite',
    ]);
  });
});
