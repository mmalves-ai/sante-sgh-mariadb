// Regra 4 do M25: nove certos — bloqueia paciente errado, item suspenso, vencido, dose maior e medicamento diferente;
// a divergência menor avisa (dados sintéticos).
import { describe, expect, it } from 'vitest';
import { avaliarNoveCertos, type EntradaNoveCertos, liberadoPelosNoveCertos } from './nove-certos.js';

const base: EntradaNoveCertos = {
  desfecho: 'administrado',
  suspenso: false,
  pacienteErrado: false,
  previsto: '2026-10-22T10:00',
  agora: '2026-10-22T10:20',
  toleranciaMinutos: 60,
  dosePrescrita: 500,
  quantidade: 500,
  unidade: 'mg',
  gtin: '07891234567895',
  barrasDoItem: '7891234567895',
  validade: '2027-01-31',
  lote: 'L123',
  hoje: '2026-10-22',
  doseObrigatoria: false,
  loteValidadeObrigatorio: false,
  temDose: true,
};

describe('regra 4: nove certos', () => {
  it('tudo certo: nem bloqueio nem aviso', () => {
    const a = avaliarNoveCertos(base);
    expect(a).toEqual({ bloqueios: [], avisos: [] });
    expect(liberadoPelosNoveCertos(a, false)).toBe(true);
  });
  it('bloqueia paciente errado, item suspenso, vencido, dose maior e medicamento diferente', () => {
    expect(avaliarNoveCertos({ ...base, pacienteErrado: true }).bloqueios[0]).toMatch(/paciente certo/);
    expect(avaliarNoveCertos({ ...base, suspenso: true }).bloqueios[0]).toMatch(/suspenso/);
    expect(avaliarNoveCertos({ ...base, validade: '2026-10-21' }).bloqueios[0]).toMatch(/vencido/);
    expect(avaliarNoveCertos({ ...base, quantidade: 500.5 }).bloqueios[0]).toMatch(/maior que a dose/);
    expect(avaliarNoveCertos({ ...base, gtin: '07890000000001' }).bloqueios[0]).toMatch(/não é o prescrito/);
    const a = avaliarNoveCertos({ ...base, quantidade: 1000 });
    expect(liberadoPelosNoveCertos(a, true)).toBe(false);
  });
  it('a leitura obrigatória da dose e o lote e a validade obrigatórios', () => {
    expect(avaliarNoveCertos({ ...base, gtin: null, doseObrigatoria: true }).bloqueios).toContain(
      'Nesta unidade a leitura da dose é obrigatória.',
    );
    expect(avaliarNoveCertos({ ...base, lote: null, loteValidadeObrigatorio: true }).bloqueios[0]).toMatch(
      /lote e a validade/,
    );
  });
  it('divergência menor avisa: dose menor, fora da tolerância, dose não lida, item sem código', () => {
    expect(avaliarNoveCertos({ ...base, quantidade: 250 }).avisos[0]).toMatch(/menor que a dose/);
    expect(avaliarNoveCertos({ ...base, agora: '2026-10-22T11:30' }).avisos[0]).toMatch(/tolerância/);
    expect(avaliarNoveCertos({ ...base, gtin: null }).avisos[0]).toMatch(/não foi lida/);
    expect(avaliarNoveCertos({ ...base, barrasDoItem: null }).avisos[0]).toMatch(/sem|não tem código/);
    const a = avaliarNoveCertos({ ...base, quantidade: 250 });
    expect(liberadoPelosNoveCertos(a, false)).toBe(false);
    expect(liberadoPelosNoveCertos(a, true)).toBe(true);
  });
  it('o não administrado só confere a suspensão; o cuidado não tem dose a ler', () => {
    expect(avaliarNoveCertos({ ...base, desfecho: 'naoAdministrado', pacienteErrado: true })).toEqual({
      bloqueios: [],
      avisos: [],
    });
    expect(
      avaliarNoveCertos({ ...base, desfecho: 'naoAdministrado', suspenso: true }).bloqueios,
    ).toHaveLength(1);
    expect(
      avaliarNoveCertos({ ...base, temDose: false, gtin: null, dosePrescrita: null, quantidade: null }),
    ).toEqual({ bloqueios: [], avisos: [] });
  });
});
