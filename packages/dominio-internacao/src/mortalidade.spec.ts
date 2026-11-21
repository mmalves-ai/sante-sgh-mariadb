// Regra 8: motivo de alta agrupado (o grupo do M14) e a mortalidade institucional (óbitos após 24 horas).
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

const estada = (motivo: number, ini: [string, string], fim: [string, string]) => ({
  entrada: ini,
  alta: fim,
  motivo,
  trechos: [{ unidade: 'ENF' as const, de: ini, ate: fim }],
});

describe('motivo de alta e mortalidade', () => {
  const mov = movimento([
    estada(41, ['2026-03-01', '10:00'], ['2026-03-01', '20:00']), // óbito antes de 24 h
    estada(41, ['2026-03-02', '10:00'], ['2026-03-05', '10:00']), // óbito institucional
    estada(66, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']), // óbito da puérpera (grupo óbito)
    estada(31, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
    estada(32, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
    estada(16, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
    estada(14, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
    estada(51, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
    estada(12, ['2026-03-02', '10:00'], ['2026-03-04', '10:00']),
  ]);
  const motor = new MotorInternacao(mov, { horaFechamento: 24, intensivas: [], agora: em('2026-04-02') });
  const [marco] = motor.basesMensais('2026-03', '2026-03');

  it('agrupa pelo grupo do indicador do motivo de alta', () => {
    expect(marco?.altasPorGrupo).toEqual({
      obito: 3,
      'transferencia-externa': 1,
      'internacao-domiciliar': 1,
      'evasao-ou-a-pedido': 2,
      'encerramento-administrativo': 1,
      'alta-domiciliar': 1,
    });
  });

  it('mortalidade geral: todos os óbitos; institucional: só depois de 24 horas da internação', () => {
    expect(marco?.grandezas.obitos).toBe(3);
    expect(marco?.grandezas.obitosInstitucionais).toBe(2);
    expect(marco?.grandezas.saidas).toBe(9);
    expect(marco?.grandezas.saidasVivas).toBe(6);
  });
});
