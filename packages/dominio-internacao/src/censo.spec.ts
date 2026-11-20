// Regra 7: censo com hora de fechamento única; quem entra um minuto depois conta no dia seguinte; o dia corrente
// aparece em aberto; a conta do dia fecha (internados de ontem + entradas − saídas).
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

const total = (
  linhas: ReturnType<MotorInternacao['censoDoDia']>,
  campo: 'internados' | 'admissoes' | 'saidas',
) => linhas.reduce((s, l) => s + l[campo], 0);

describe('censo pela hora de fechamento', () => {
  const mov = movimento([
    // Entra às 18:00 do dia 10 (fechamento às 18 h): conta no dia 10.
    { entrada: ['2026-03-10', '1800'], trechos: [{ unidade: 'ENF', de: ['2026-03-10', '1800'] }] },
    // Entra às 18:01: conta no dia 11.
    { entrada: ['2026-03-10', '1801'], trechos: [{ unidade: 'ENF', de: ['2026-03-10', '1801'] }] },
    // Entra e sai no mesmo dia do censo: admissão e saída, não internado.
    {
      entrada: ['2026-03-10', '0900'],
      alta: ['2026-03-10', '1500'],
      trechos: [{ unidade: 'APTO', de: ['2026-03-10', '0900'], ate: ['2026-03-10', '1500'] }],
    },
  ]);
  const motor = new MotorInternacao(mov, {
    horaFechamento: 18,
    intensivas: [3],
    agora: em('2026-03-12', '1000'),
  });

  it('quem entra um minuto depois da hora de fechamento conta no dia seguinte', () => {
    const d10 = motor.censoDoDia('2026-03-10');
    const d11 = motor.censoDoDia('2026-03-11');
    expect(total(d10, 'admissoes')).toBe(2);
    expect(total(d10, 'internados')).toBe(1);
    expect(total(d10, 'saidas')).toBe(1);
    expect(total(d11, 'admissoes')).toBe(1);
    expect(total(d11, 'internados')).toBe(2);
  });

  it('o dia corrente é o do censo em curso', () => {
    expect(motor.dataAtual).toBe('2026-03-12');
    expect(total(motor.censoDoDia('2026-03-12'), 'internados')).toBe(2);
  });

  it('fora da janela do motor: zeros, com as unidades e os leitos operacionais', () => {
    const fora = motor.censoDoDia('2018-01-01');
    expect(total(fora, 'internados')).toBe(0);
    expect(fora.find((l) => l.acomodacao === 'APTO' && l.tipo.id === 2)?.leitosOperacionais).toBe(2);
  });

  it('meia-noite (24): o dia de calendário', () => {
    const m = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [],
      agora: em('2026-03-12', '1000'),
    });
    expect(total(m.censoDoDia('2026-03-10'), 'internados')).toBe(2);
    expect(total(m.censoDoDia('2026-03-10'), 'admissoes')).toBe(3);
  });

  it('recusa hora de fechamento fora de 1 a 24', () => {
    expect(() => new MotorInternacao(mov, { horaFechamento: 0, intensivas: [], agora: 0 })).toThrow(
      RangeError,
    );
    expect(() => new MotorInternacao(mov, { horaFechamento: 25, intensivas: [], agora: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('a conta do dia fecha por unidade', () => {
  it('internados(D) = internados(D−1) + admissões + entradas − saídas − transferências de saída', () => {
    const mov = movimento([
      {
        entrada: ['2026-01-01', '1000'],
        alta: ['2026-01-09', '1100'],
        trechos: [
          { unidade: 'ENF', de: ['2026-01-01', '1000'], ate: ['2026-01-03', '0800'] },
          { unidade: 'UTI', de: ['2026-01-03', '0800'], ate: ['2026-01-06', '1200'] },
          { unidade: 'ENF', de: ['2026-01-06', '1200'], ate: ['2026-01-09', '1100'] },
        ],
      },
      {
        entrada: ['2026-01-02', '2300'],
        alta: ['2026-01-04', '0100'],
        motivo: 41,
        trechos: [{ unidade: 'APTO', de: ['2026-01-02', '2300'], ate: ['2026-01-04', '0100'] }],
      },
      { entrada: ['2026-01-05', '0000'], trechos: [{ unidade: 'UTI', de: ['2026-01-05', '0000'] }] },
    ]);
    const motor = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3],
      agora: em('2026-01-12', '1200'),
    });
    let anterior = new Map<string, number>();
    for (let dia = 1; dia <= 11; dia++) {
      const data = `2026-01-${String(dia).padStart(2, '0')}`;
      const linhas = motor.censoDoDia(data);
      for (const l of linhas) {
        const k = `${l.bloco}/${l.acomodacao}/${l.tipo.id}`;
        const esperado =
          (anterior.get(k) ?? 0) + l.admissoes + l.transferenciasEntrada - l.saidas - l.transferenciasSaida;
        expect(l.internados, `${data} ${k}`).toBe(esperado);
      }
      anterior = new Map(linhas.map((l) => [`${l.bloco}/${l.acomodacao}/${l.tipo.id}`, l.internados]));
    }
    const d3 = motor.censoDoDia('2026-01-03');
    expect(d3.find((l) => l.acomodacao === 'UTI')?.transferenciasEntrada).toBe(1);
    expect(d3.find((l) => l.acomodacao === 'ENF')?.transferenciasSaida).toBe(1);
    const d4 = motor.censoDoDia('2026-01-04');
    expect(d4.find((l) => l.acomodacao === 'APTO')?.obitos).toBe(1);
  });
});

describe('série do censo', () => {
  const mov = movimento([
    { entrada: ['2026-02-27', '1000'], trechos: [{ unidade: 'ENF', de: ['2026-02-27', '1000'] }] },
  ]);
  const motor = new MotorInternacao(mov, {
    horaFechamento: 24,
    intensivas: [],
    agora: em('2026-03-02', '0800'),
  });

  it('por dia: paciente-dia, leito-dia e o dia em aberto parcial', () => {
    const s = motor.serieCenso('2026-02-26', '2026-03-05', 'dia');
    expect(s.map((p) => p.periodo)).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(s.map((p) => p.pacientesDia)).toEqual([0, 1, 1, 1, 1]);
    expect(s[0]?.leitosDia).toBe(8);
    expect(s.at(-1)?.parcial).toBe(true);
    expect(s[0]?.parcial).toBe(false);
  });

  it('por mês: o mês corrente é parcial', () => {
    const s = motor.serieCenso('2026-02-01', '2026-03-31', 'mes');
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({
      periodo: '2026-02',
      dias: 28,
      pacientesDia: 2,
      admissoes: 1,
      parcial: false,
    });
    expect(s[1]).toMatchObject({ periodo: '2026-03', dias: 2, pacientesDia: 2, parcial: true });
  });
});
