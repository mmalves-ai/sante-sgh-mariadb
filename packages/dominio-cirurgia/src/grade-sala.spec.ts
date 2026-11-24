import { describe, expect, it } from 'vitest';
import {
  conferirGradeSala,
  diaSemanaIso,
  type FaixaGradeSala,
  faixasDoDia,
  validarFaixaGrade,
} from './grade-sala.js';

const faixa = (x: Partial<FaixaGradeSala> = {}): FaixaGradeSala => ({
  diaSemana: 1,
  inicio: '07:00',
  fim: '13:00',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  valeFeriado: false,
  especialidade: null,
  profissional: null,
  ativo: true,
  ...x,
});
// 2026-11-23 é segunda-feira.
const pedido = (
  inicio: string,
  duracaoMin: number,
  x: Partial<Parameters<typeof conferirGradeSala>[1]> = {},
) => ({
  inicio,
  duracaoMin,
  feriado: false,
  especialidade: 10,
  cirurgiao: 20,
  excecao: false,
  ...x,
});

describe('grade de funcionamento da sala (04-CC linha 92)', () => {
  it('dia da semana ISO', () => {
    expect(diaSemanaIso('2026-11-23')).toBe(1);
    expect(diaSemanaIso('2026-11-29')).toBe(7);
  });

  it('sala sem faixa ativa não restringe; exceção registrada passa', () => {
    expect(conferirGradeSala([], pedido('2026-11-23 03:00', 60))).toBeNull();
    expect(conferirGradeSala([faixa({ ativo: false })], pedido('2026-11-23 03:00', 60))).toBeNull();
    expect(conferirGradeSala([faixa()], pedido('2026-11-23 03:00', 60, { excecao: true }))).toBeNull();
  });

  it('a cirurgia inteira cabe na faixa; faixas contíguas somam; fora ou passando do fim recusa', () => {
    expect(conferirGradeSala([faixa()], pedido('2026-11-23 07:00', 360))).toBeNull();
    expect(conferirGradeSala([faixa()], pedido('2026-11-23 12:00', 90))?.codigo).toBe(
      'sala-fechada-na-grade',
    );
    expect(conferirGradeSala([faixa()], pedido('2026-11-23 06:30', 60))?.codigo).toBe(
      'sala-fechada-na-grade',
    );
    expect(conferirGradeSala([faixa()], pedido('2026-11-24 08:00', 60))?.codigo).toBe(
      'sala-fechada-na-grade',
    );
    const contiguas = [faixa(), faixa({ inicio: '13:00', fim: '19:00' })];
    expect(conferirGradeSala(contiguas, pedido('2026-11-23 12:00', 120))).toBeNull();
  });

  it('vigência e feriado', () => {
    const vencida = faixa({ vigenciaFim: '2026-10-31' });
    expect(conferirGradeSala([vencida], pedido('2026-11-23 08:00', 60))?.codigo).toBe(
      'sala-fechada-na-grade',
    );
    expect(conferirGradeSala([faixa()], pedido('2026-11-23 08:00', 60, { feriado: true }))?.codigo).toBe(
      'sala-fechada-na-grade',
    );
    expect(
      conferirGradeSala([faixa({ valeFeriado: true })], pedido('2026-11-23 08:00', 60, { feriado: true })),
    ).toBeNull();
    expect(faixasDoDia([faixa(), faixa({ diaSemana: 2 })], '2026-11-24', false)).toHaveLength(1);
  });

  it('virada da meia-noite usa a faixa até 23:59 e a do dia seguinte desde 00:00', () => {
    const noite = [
      faixa({ inicio: '19:00', fim: '23:59' }),
      faixa({ diaSemana: 2, inicio: '00:00', fim: '07:00' }),
    ];
    expect(conferirGradeSala(noite, pedido('2026-11-23 23:00', 120))).toBeNull();
    expect(conferirGradeSala([noite[0]!], pedido('2026-11-23 23:00', 120))?.mensagem).toContain(
      'dia seguinte',
    );
  });

  it('faixa reservada a cirurgião ou especialidade recusa os outros', () => {
    expect(conferirGradeSala([faixa({ profissional: 20 })], pedido('2026-11-23 08:00', 60))).toBeNull();
    expect(conferirGradeSala([faixa({ profissional: 21 })], pedido('2026-11-23 08:00', 60))?.codigo).toBe(
      'grade-reservada-cirurgiao',
    );
    expect(conferirGradeSala([faixa({ especialidade: 11 })], pedido('2026-11-23 08:00', 60))?.codigo).toBe(
      'grade-reservada-especialidade',
    );
  });

  it('valida a faixa ao gravar: horas, vigência, reserva dupla e cruzamento no mesmo dia', () => {
    expect(validarFaixaGrade(faixa(), [])).toBeNull();
    expect(validarFaixaGrade(faixa({ diaSemana: 8 }), [])?.codigo).toBe('grade-dia-invalido');
    expect(validarFaixaGrade(faixa({ fim: '06:00' }), [])?.codigo).toBe('grade-hora-invertida');
    expect(validarFaixaGrade(faixa({ inicio: '7h' }), [])?.codigo).toBe('grade-hora-invalida');
    expect(validarFaixaGrade(faixa({ vigenciaFim: '2025-12-31' }), [])?.codigo).toBe(
      'grade-vigencia-invertida',
    );
    expect(validarFaixaGrade(faixa({ especialidade: 1, profissional: 2 }), [])?.codigo).toBe(
      'grade-reserva-dupla',
    );
    const existente = faixa({ id: 5, inicio: '12:00', fim: '18:00' });
    expect(validarFaixaGrade(faixa(), [existente])?.codigo).toBe('grade-faixa-cruzada');
    expect(validarFaixaGrade(faixa({ id: 5 }), [existente])).toBeNull();
    expect(validarFaixaGrade(faixa(), [faixa({ id: 6, diaSemana: 2 })])).toBeNull();
    expect(
      validarFaixaGrade(faixa({ vigenciaFim: '2026-06-30' }), [
        faixa({ id: 7, vigenciaInicio: '2026-07-01' }),
      ]),
    ).toBeNull();
  });
});
