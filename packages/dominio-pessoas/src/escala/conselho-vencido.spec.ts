// Regra 3 do M52: conselho vencido não entra na escala; o alerta antecede o bloqueio. Conferido no dia do plantão.
import { describe, expect, it } from 'vitest';
import { conferirConselhoParaPlantao, type RegistroDoProfissional } from './conselho-vencido.js';

const coren = (
  validade: string | null,
  extra: Partial<RegistroDoProfissional> = {},
): RegistroDoProfissional => ({
  registro: 1,
  conselho: 'COREN',
  ativo: true,
  validade,
  ...extra,
});

describe('conselho no dia do plantão (regra 3)', () => {
  it('válido entra sem alerta; a vencer entra com alerta', () => {
    expect(conferirConselhoParaPlantao([coren('2027-12-31')], '2026-11-02T19:00')).toEqual({
      permitido: true,
      alerta: null,
      registro: 1,
    });
    expect(conferirConselhoParaPlantao([coren('2026-12-01')], '2026-11-02T19:00')).toEqual({
      permitido: true,
      alerta: 'aVencer',
      registro: 1,
    });
  });

  it('vencido no dia do plantão é recusado, ainda que hoje esteja válido', () => {
    expect(conferirConselhoParaPlantao([coren('2026-11-01')], '2026-11-02T07:00')).toMatchObject({
      permitido: false,
      motivo: 'vencido',
    });
    expect(conferirConselhoParaPlantao([coren('2026-11-02')], '2026-11-02T19:00').permitido).toBe(true);
  });

  it('sem validade conferida: entra com alerta (D-CONS-52)', () => {
    expect(conferirConselhoParaPlantao([coren(null)], '2026-11-02')).toEqual({
      permitido: true,
      alerta: 'semValidade',
      registro: 1,
    });
  });

  it('o conselho exigido pela escala filtra os registros; o inativo não conta', () => {
    const regs = [
      coren('2026-01-01'),
      { registro: 2, conselho: 'CRM', ativo: true, validade: '2028-01-01' },
      { registro: 3, conselho: 'COREN', ativo: false, validade: '2030-01-01' },
    ];
    expect(conferirConselhoParaPlantao(regs, '2026-11-02', { conselhoExigido: 'coren' })).toMatchObject({
      permitido: false,
      motivo: 'vencido',
    });
    expect(conferirConselhoParaPlantao(regs, '2026-11-02')).toMatchObject({ permitido: true, registro: 2 });
    expect(conferirConselhoParaPlantao(regs, '2026-11-02', { conselhoExigido: 'CRF' })).toMatchObject({
      permitido: false,
      motivo: 'sem-registro',
      mensagem: 'O profissional não tem registro ativo no CRF.',
    });
    expect(conferirConselhoParaPlantao([], '2026-11-02')).toMatchObject({
      permitido: false,
      motivo: 'sem-registro',
      mensagem: 'O profissional não tem registro ativo no conselho.',
    });
  });

  it('o melhor registro vale: válido antes de a vencer, a vencer antes de sem validade', () => {
    const regs = [
      { registro: 5, conselho: 'COREN', ativo: true, validade: null },
      { registro: 6, conselho: 'COREN', ativo: true, validade: '2026-11-20' },
    ];
    expect(conferirConselhoParaPlantao(regs, '2026-11-02')).toMatchObject({ alerta: 'aVencer', registro: 6 });
    expect(conferirConselhoParaPlantao(regs, '2026-11-02', { janelaDias: 10 })).toMatchObject({
      alerta: null,
      registro: 6,
    });
  });
});
