// Regra 3: a ocupação e o paciente-dia vêm da trajetória (os trechos), nunca da posição atual da internação. Uma
// trajetória sintética que passa pela terapia intensiva e volta: a posição atual (enfermaria) subconta a UTI.
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

const ida = movimento([
  {
    entrada: ['2026-05-01', '10:00'],
    alta: ['2026-05-11', '10:00'],
    trechos: [
      { unidade: 'ENF', de: ['2026-05-01', '10:00'], ate: ['2026-05-03', '10:00'] },
      { unidade: 'UTI', de: ['2026-05-03', '10:00'], ate: ['2026-05-08', '10:00'] },
      { unidade: 'ENF', de: ['2026-05-08', '10:00'], ate: ['2026-05-11', '10:00'] },
    ],
  },
]);

describe('ocupação pela trajetória', () => {
  const motor = new MotorInternacao(ida, { horaFechamento: 24, intensivas: [3], agora: em('2026-06-15') });
  const [maio] = motor.basesMensais('2026-05', '2026-05');

  it('paciente-dia: 10 dias, 5 deles na terapia intensiva', () => {
    expect(maio?.grandezas.pacientesDia).toBe(10);
    expect(maio?.grandezas.pacientesDiaIntensiva).toBe(5);
  });

  it('a posição atual (enfermaria) daria 0 dia de UTI: o recorte por acomodação mostra a trajetória', () => {
    const uti = motor.basesMensais('2026-05', '2026-05', 'acomodacao', '2/UTI')[0];
    const enf = motor.basesMensais('2026-05', '2026-05', 'acomodacao', '1/ENF')[0];
    expect(uti?.grandezas.pacientesDia).toBe(5);
    expect(enf?.grandezas.pacientesDia).toBe(5);
    // Admissão na unidade do primeiro trecho, saída na do último.
    expect(enf?.grandezas.admissoes).toBe(1);
    expect(enf?.grandezas.saidas).toBe(1);
    expect(uti?.grandezas.admissoes).toBe(0);
  });

  it('leito-dia operacional: os leitos ativos de hoje × dias do mês', () => {
    expect(maio?.grandezas.leitosDia).toBe((4 + 2 + 2) * 31);
    expect(maio?.grandezas.leitosDiaIntensiva).toBe(2 * 31);
    expect(maio?.grandezas.leitosOperacionaisMedios).toBe(8);
  });

  it('recortes: acomodação, tipo e clínica (sem leito-dia na clínica)', () => {
    expect(motor.opcoesRecorte('acomodacao').map((o) => o.valor)).toEqual(['1/APTO', '1/ENF', '2/UTI']);
    expect(motor.opcoesRecorte('tipoAcomodacao').map((o) => o.rotulo)).toEqual([
      'Apartamento',
      'Enfermaria',
      'U.T.I.',
    ]);
    const clin = motor.basesMensais('2026-05', '2026-05', 'clinica', 'M')[0];
    expect(clin?.grandezas.pacientesDia).toBe(10);
    expect(clin?.grandezas.leitosDia).toBe(0);
    expect(motor.basesMensais('2026-05', '2026-05', 'clinica', 'X')[0]?.grandezas.pacientesDia).toBe(0);
    const tipo = motor.basesMensais('2026-05', '2026-05', 'tipoAcomodacao', '3')[0];
    expect(tipo?.grandezas.pacientesDia).toBe(5);
    const det = motor.detalhar('2026-05', 'tipoAcomodacao');
    expect(det.map((x) => [x.rotulo, x.base.grandezas.pacientesDia])).toEqual([
      ['Apartamento', 0],
      ['Enfermaria', 5],
      ['U.T.I.', 5],
    ]);
  });
});
