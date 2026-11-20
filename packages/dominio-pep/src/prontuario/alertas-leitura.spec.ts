// Regra 12 da ficha do M15: muitos prontuários em pouco tempo e acesso fora do horário habitual geram alerta.
import { describe, expect, it } from 'vitest';
import { avaliarLeitura, horaLocal, LIMITES_PADRAO } from './alertas.js';

const T0 = Date.parse('2026-10-20T13:00:00Z');
const MIN = 60_000;

describe('alertas de leitura', () => {
  it('passa do limite de prontuários diferentes na janela: um alerta só', () => {
    const l = { ...LIMITES_PADRAO, maxPacientes: 3 };
    const recentes = [1, 2, 3].map((p, i) => ({ paciente: p, em: T0 + i * MIN }));
    const a = avaliarLeitura(recentes, { paciente: 4, em: T0 + 5 * MIN }, 10, l);
    expect(a).toEqual([expect.objectContaining({ tipo: 'muitos-prontuarios', criticidade: 2 })]);
    // A seguinte, já acima do limite, não repete o alerta.
    expect(
      avaliarLeitura(
        [...recentes, { paciente: 4, em: T0 + 5 * MIN }],
        { paciente: 5, em: T0 + 6 * MIN },
        10,
        l,
      ),
    ).toEqual([]);
    // O mesmo paciente de novo não conta.
    expect(avaliarLeitura(recentes, { paciente: 3, em: T0 + 5 * MIN }, 10, l)).toEqual([]);
  });

  it('fora da janela não conta', () => {
    const l = { ...LIMITES_PADRAO, maxPacientes: 1, janelaMinutos: 10 };
    expect(avaliarLeitura([{ paciente: 1, em: T0 }], { paciente: 2, em: T0 + 30 * MIN }, 10, l)).toEqual([]);
  });

  it('fora do horário habitual: alerta na primeira abertura do paciente', () => {
    const a = avaliarLeitura([], { paciente: 9, em: T0 }, 23);
    expect(a).toEqual([expect.objectContaining({ tipo: 'fora-do-horario', criticidade: 4 })]);
    expect(avaliarLeitura([{ paciente: 9, em: T0 - MIN }], { paciente: 9, em: T0 }, 23)).toEqual([]);
    expect(avaliarLeitura([], { paciente: 9, em: T0 }, 10)).toEqual([]);
  });

  it('horário habitual que cruza a meia-noite', () => {
    const l = { ...LIMITES_PADRAO, inicioHabitual: 20, fimHabitual: 8 };
    expect(avaliarLeitura([], { paciente: 1, em: T0 }, 23, l)).toEqual([]);
    expect(avaliarLeitura([], { paciente: 1, em: T0 }, 12, l)).toHaveLength(1);
  });

  it('hora local do estabelecimento independe do fuso do processo', () => {
    expect(horaLocal(Date.parse('2026-10-20T13:00:00Z'))).toBe(10);
    expect(horaLocal(Date.parse('2026-10-20T02:30:00Z'))).toBe(23);
  });
});
