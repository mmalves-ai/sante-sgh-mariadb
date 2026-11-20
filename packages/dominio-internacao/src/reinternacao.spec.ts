// Regra 9: reinternação calculada (mesmo paciente com nova internação até 7 ou 30 dias da saída viva anterior);
// a coluna constante do legado não é usada. Caso da `sante-api` (13 de 143 altas = 9,1%) reproduzido em escala.
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

const estada = (paciente: number, ini: string, fim?: string, motivo = 12) => ({
  paciente,
  entrada: [ini, '1000'] as [string, string],
  ...(fim ? { alta: [fim, '1000'] as [string, string] } : {}),
  motivo,
  trechos: [
    {
      unidade: 'ENF' as const,
      de: [ini, '1000'] as [string, string],
      ...(fim ? { ate: [fim, '1000'] as [string, string] } : {}),
    },
  ],
});

describe('reinternação calculada', () => {
  const mov = movimento([
    estada(1, '2026-01-02', '2026-01-05'),
    estada(1, '2026-01-10'), // 5 dias depois: 7 e 30
    estada(2, '2026-01-02', '2026-01-04'),
    estada(2, '2026-01-25', '2026-01-27'), // 21 dias: só 30
    estada(2, '2026-03-10', '2026-03-12'), // 42 dias: não
    estada(3, '2026-01-03', '2026-01-04', 41), // óbito: não reinterna
    estada(4, '2026-01-05', '2026-01-06'),
  ]);
  const motor = new MotorInternacao(mov, { horaFechamento: 24, intensivas: [], agora: em('2026-04-01') });
  const [jan] = motor.basesMensais('2026-01', '2026-01');

  it('conta na saída anterior, em 7 e em 30 dias', () => {
    expect(jan?.grandezas.reinternacoes7).toBe(1);
    expect(jan?.grandezas.reinternacoes30).toBe(2);
    expect(jan?.grandezas.saidasVivas).toBe(4);
  });

  it('a saída de janeiro reinternada em março não conta', () => {
    const [mar] = motor.basesMensais('2026-03', '2026-03');
    expect(mar?.grandezas.reinternacoes30).toBe(0);
  });
});
