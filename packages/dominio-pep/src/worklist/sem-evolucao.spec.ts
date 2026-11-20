// Regra 3 do M27: internado sem evolução médica nas últimas 24 h (os dois sistemas; suspensa não conta; limite exato).
import { describe, expect, it } from 'vitest';
import { horasSemEvolucao, semEvolucaoMedica24h } from './sem-evolucao.js';

const agora = new Date('2026-10-22T12:00:00.000Z');
const ev = (em: string, cbo: string | null = '225125', suspensa = false) => ({ em, cbo, suspensa });

describe('internado sem evolução médica em 24 h', () => {
  it('limite exato: 24 h em ponto ainda vale; 1 ms depois, alerta', () => {
    expect(
      semEvolucaoMedica24h({
        internado: true,
        evolucoes: [ev('2026-10-21T12:00:00.000Z')],
        entrada: null,
        agora,
      }),
    ).toBe(false);
    expect(
      semEvolucaoMedica24h({
        internado: true,
        evolucoes: [ev('2026-10-21T11:59:59.999Z')],
        entrada: null,
        agora,
      }),
    ).toBe(true);
  });
  it('a evolução suspensa não conta; a de quem não é médico também não', () => {
    expect(
      semEvolucaoMedica24h({
        internado: true,
        evolucoes: [ev('2026-10-22T08:00:00.000Z', '225125', true), ev('2026-10-22T09:00:00.000Z', '223505')],
        entrada: '2026-10-19T10:00:00.000Z',
        agora,
      }),
    ).toBe(true);
  });
  it('conta a evolução de qualquer dos dois sistemas: a mais recente vale', () => {
    // A do outro sistema (lida do mesmo banco) é a mais recente: sem alerta.
    expect(
      semEvolucaoMedica24h({
        internado: true,
        evolucoes: [ev('2026-10-20T08:00:00.000Z'), ev('2026-10-22T07:00:00.000Z', '2251-25')],
        entrada: '2026-10-19T10:00:00.000Z',
        agora,
      }),
    ).toBe(false);
  });
  it('sem evolução, conta a entrada: recém-internado não alerta; quem não está internado nunca alerta', () => {
    expect(
      semEvolucaoMedica24h({ internado: true, evolucoes: [], entrada: '2026-10-22T01:00:00.000Z', agora }),
    ).toBe(false);
    expect(
      semEvolucaoMedica24h({ internado: true, evolucoes: [], entrada: '2026-10-20T01:00:00.000Z', agora }),
    ).toBe(true);
    expect(semEvolucaoMedica24h({ internado: true, evolucoes: [], entrada: null, agora })).toBe(false);
    expect(
      semEvolucaoMedica24h({ internado: false, evolucoes: [], entrada: '2026-10-01T01:00:00.000Z', agora }),
    ).toBe(false);
  });
  it('horas desde a última evolução válida', () => {
    expect(horasSemEvolucao([ev('2026-10-21T10:30:00.000Z')], null, agora)).toBe(25);
    expect(horasSemEvolucao([], null, agora)).toBeNull();
    expect(horasSemEvolucao([ev('data ruim')], '2026-10-22T11:00:00.000Z', agora)).toBe(1);
  });
});
