// Regra 6: duas réguas de permanência, com nomes distintos: as diárias faturáveis (a coluna do faturamento: a
// entrada e a alta contam, um dia a mais que a diferença de datas em cerca de metade dos casos) e a média da
// Portaria 312 (paciente-dia ÷ saídas). Casos de `sante-api: test/gestao.test.js` (as duas réguas lado a lado).
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

describe('duas réguas de permanência', () => {
  const mov = movimento([
    // 3 noites; o faturamento conta 4 diárias.
    {
      entrada: ['2026-06-01', '10:00'],
      alta: ['2026-06-04', '15:00'],
      permanencia: 4,
      trechos: [{ unidade: 'ENF', de: ['2026-06-01', '10:00'], ate: ['2026-06-04', '15:00'] }],
    },
    // 5 noites; o faturamento conta 5 (a diferença de datas).
    {
      entrada: ['2026-06-10', '08:00'],
      alta: ['2026-06-15', '07:00'],
      permanencia: 5,
      trechos: [{ unidade: 'APTO', de: ['2026-06-10', '08:00'], ate: ['2026-06-15', '07:00'] }],
    },
  ]);
  const motor = new MotorInternacao(mov, { horaFechamento: 24, intensivas: [], agora: em('2026-07-02') });
  const [junho] = motor.basesMensais('2026-06', '2026-06');

  it('as diárias faturáveis somam a coluna do faturamento; o paciente-dia, os fechamentos', () => {
    expect(junho?.grandezas.diariasFaturadas).toBe(9);
    expect(junho?.grandezas.pacientesDia).toBe(8);
    expect(junho?.grandezas.saidas).toBe(2);
  });

  it('as médias divergem e cada uma tem o seu nome', () => {
    const g = junho!.grandezas;
    expect(g.diariasFaturadas / g.saidas).toBe(4.5);
    expect(g.pacientesDia / g.saidas).toBe(4);
  });

  it('permanência sem valor (nula ou zero) não entra na soma das diárias', () => {
    const m = new MotorInternacao(
      movimento([
        {
          entrada: ['2026-06-01', '10:00'],
          alta: ['2026-06-02', '10:00'],
          trechos: [{ unidade: 'ENF', de: ['2026-06-01', '10:00'], ate: ['2026-06-02', '10:00'] }],
        },
        {
          entrada: ['2026-06-01', '10:00'],
          alta: ['2026-06-02', '10:00'],
          permanencia: 0,
          trechos: [{ unidade: 'ENF', de: ['2026-06-01', '10:00'], ate: ['2026-06-02', '10:00'] }],
        },
      ]),
      { horaFechamento: 24, intensivas: [], agora: em('2026-07-02') },
    );
    expect(m.basesMensais('2026-06', '2026-06')[0]?.grandezas.diariasFaturadas).toBe(0);
  });
});

// M21 (regras 5 e 7): as diárias faturáveis como o legado grava na saída (a diferença de dias, mais uma quando a saída
// é às 12h ou depois; 1 no mesmo dia: 1.316 de 1.322 altas da cópia), a permanência da Portaria 312 com nome distinto, e
// a reinternação calculada por paciente até 30 dias (o legado grava REINT30 'F' em 100%).
describe('M21: diárias faturáveis, Portaria 312 e reinternação', () => {
  it('a diária vence às 12h; o mesmo dia é 1', async () => {
    const { diariasFaturaveis, permanenciaPortaria312 } = await import('./adt.js');
    expect(diariasFaturaveis('2026-06-01', '2026-06-01', '09:00')).toBe(1);
    expect(diariasFaturaveis('2026-06-01', '2026-06-01', '18:00')).toBe(1);
    expect(diariasFaturaveis('2026-06-01', '2026-06-04', '11:59')).toBe(3);
    expect(diariasFaturaveis('2026-06-01', '2026-06-04', '12:00')).toBe(4);
    expect(diariasFaturaveis('2026-06-01', '2026-06-04', '930')).toBe(3);
    expect(diariasFaturaveis('2026-06-04', '2026-06-01', '15:00')).toBe(1);
    expect(permanenciaPortaria312('2026-06-01', '2026-06-04')).toBe(3);
    expect(permanenciaPortaria312('2026-06-01', '2026-06-01')).toBe(1);
    expect(permanenciaPortaria312('2026-06-04', '2026-06-01')).toBe(0);
  });

  it('reinternação até 30 dias depois da alta anterior; óbito e alta futura não contam', async () => {
    const { ehReinternacao, reinternacaoEm30Dias } = await import('./adt.js');
    expect(reinternacaoEm30Dias('2026-06-01', '2026-07-01')).toBe(true);
    expect(reinternacaoEm30Dias('2026-06-01', '2026-07-02')).toBe(false);
    expect(reinternacaoEm30Dias(null, '2026-07-01')).toBe(false);
    expect(reinternacaoEm30Dias('1899-12-30', '2026-07-01')).toBe(false);
    expect(reinternacaoEm30Dias('2026-07-05', '2026-07-01')).toBe(false);
    const hist = [
      { reg: 1, entrada: '2026-05-01', alta: '2026-05-10', motivo: 12 },
      { reg: 2, entrada: '2026-05-20', alta: '2026-05-25', motivo: 41 },
      { reg: 3, entrada: '2026-06-01', alta: null, motivo: null },
    ];
    expect(ehReinternacao(hist.slice(0, 1), { reg: 9, entrada: '2026-06-01' })).toBe(true);
    expect(ehReinternacao(hist, { reg: 9, entrada: '2026-06-01' })).toBe(false);
    expect(ehReinternacao([], { reg: 9, entrada: '2026-06-01' })).toBe(false);
  });
});
