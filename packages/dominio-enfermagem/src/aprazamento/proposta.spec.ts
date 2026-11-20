// Regras 1 e 2 do M25: quem apraza e a proposta pela grade da unidade (dados sintéticos).
import { describe, expect, it } from 'vitest';
import {
  categoriaPorCbo,
  conferirAcaoAprazamento,
  podeAprazar,
  podeChecar,
  proporAprazamento,
} from './proposta.js';

describe('regra 1: aprazar é ato do enfermeiro; o técnico checa', () => {
  it('a categoria vem do CBO', () => {
    expect(categoriaPorCbo('223505')).toBe('enfermeiro');
    expect(categoriaPorCbo('322205')).toBe('tecnico');
    expect(categoriaPorCbo('322230')).toBe('tecnico');
    expect(categoriaPorCbo('225125')).toBe('outro');
    expect(categoriaPorCbo(null)).toBe('outro');
  });
  it('só o enfermeiro apraza; enfermeiro e técnico checam', () => {
    expect(podeAprazar('enfermeiro')).toBe(true);
    expect(podeAprazar('tecnico')).toBe(false);
    expect(podeAprazar('outro')).toBe(false);
    expect(podeChecar('tecnico')).toBe(true);
    expect(podeChecar('enfermeiro')).toBe(true);
    expect(podeChecar('outro')).toBe(false);
  });
});

describe('regra 2: proposta pela grade da unidade e pela âncora', () => {
  const grade = ['06:00', '14:00', '22:00'];
  it('cada dose vai ao horário-padrão mais perto (empate: o anterior)', () => {
    const p = proporAprazamento({
      horarios: [
        { id: 1, previsto: '2026-10-22T08:00', ordem: 1 },
        { id: 2, previsto: '2026-10-22T16:00', ordem: 2 },
        { id: 3, previsto: '2026-10-23T00:00', ordem: 3 },
        { id: 4, previsto: '2026-10-22T10:00', ordem: 4 },
      ],
      grade,
      agora: '2026-10-22T07:00',
      primeiraAgora: false,
    });
    expect(p.map((x) => [x.horario, x.proposto, x.motivo])).toEqual([
      [1, '2026-10-22T06:00', 'grade'],
      [2, '2026-10-22T14:00', 'grade'],
      [3, '2026-10-22T22:00', 'grade'],
      [4, '2026-10-22T06:00', 'grade'],
    ]);
  });
  it('a primeira dose "agora" ou no próximo horário-padrão', () => {
    const agora = proporAprazamento({
      horarios: [{ id: 1, previsto: '2026-10-22T06:00', ordem: 0 }],
      grade,
      agora: '2026-10-22T09:12',
      primeiraAgora: true,
    });
    expect(agora[0]).toMatchObject({ proposto: '2026-10-22T09:12', motivo: 'agora' });
    const proxima = proporAprazamento({
      horarios: [{ id: 1, previsto: '2026-10-22T06:00', ordem: 0 }],
      grade,
      agora: '2026-10-22T09:12',
      primeiraAgora: false,
    });
    expect(proxima[0]).toMatchObject({ proposto: '2026-10-22T14:00', motivo: 'proximoPadrao' });
    // Depois do último horário do dia: o primeiro do dia seguinte.
    const noite = proporAprazamento({
      horarios: [{ id: 1, previsto: '2026-10-22T06:00', ordem: 0 }],
      grade,
      agora: '2026-10-22T23:00',
      primeiraAgora: false,
    });
    expect(noite[0]?.proposto).toBe('2026-10-23T06:00');
  });
  it('a âncora da frequência relativa e o horário já na grade', () => {
    const p = proporAprazamento({
      horarios: [
        { id: 7, previsto: '2026-10-22T07:40', ordem: 1, ancora: '07:30' },
        { id: 8, previsto: '2026-10-22T14:00', ordem: 2 },
      ],
      grade,
      agora: '2026-10-22T07:00',
      primeiraAgora: false,
    });
    expect(p[0]).toMatchObject({ proposto: '2026-10-22T07:30', motivo: 'ancora' });
    expect(p[1]).toMatchObject({ proposto: '2026-10-22T14:00', motivo: 'mantido' });
  });
  it('sem grade, o previsto é mantido', () => {
    const p = proporAprazamento({
      horarios: [{ id: 1, previsto: '2026-10-22T09:00', ordem: 0 }],
      grade: [],
      agora: '2026-10-22T10:00',
      primeiraAgora: false,
    });
    expect(p[0]).toMatchObject({ proposto: '2026-10-22T09:00', motivo: 'mantido' });
  });
  it('reaprazar e suprimir exigem motivo; o ajuste da proposta também', () => {
    const base = { proposto: '2026-10-22T14:00', confirmado: '2026-10-22T14:00', motivo: null };
    expect(conferirAcaoAprazamento({ ...base, acao: 'aprazar' })).toBeNull();
    expect(conferirAcaoAprazamento({ ...base, acao: 'reaprazar' })).toMatch(/motivo de reaprazar/);
    expect(conferirAcaoAprazamento({ ...base, acao: 'reaprazar', motivo: 'paciente no exame' })).toBeNull();
    expect(conferirAcaoAprazamento({ ...base, acao: 'suprimir', confirmado: null })).toMatch(
      /motivo de suprimir/,
    );
    expect(
      conferirAcaoAprazamento({ ...base, acao: 'suprimir', confirmado: null, motivo: 'dose duplicada' }),
    ).toBeNull();
    expect(conferirAcaoAprazamento({ ...base, acao: 'suprimir', motivo: 'dose duplicada' })).toMatch(
      /não tem hora/,
    );
    expect(conferirAcaoAprazamento({ ...base, acao: 'aprazar', confirmado: null })).toMatch(
      /hora confirmada/,
    );
    expect(conferirAcaoAprazamento({ ...base, acao: 'aprazar', confirmado: '2026-10-22T15:00' })).toMatch(
      /motivo do ajuste/,
    );
    expect(
      conferirAcaoAprazamento({
        ...base,
        acao: 'aprazar',
        confirmado: '2026-10-22T15:00',
        motivo: 'fisioterapia',
      }),
    ).toBeNull();
  });
});
