// Regra 9 (ficha do M28): lançamento em mês fechado é recusado; o próximo a fechar; reabertura só do último, com motivo.
import { describe, expect, it } from 'vitest';
import {
  conferirCompetencia,
  conferirReabertura,
  mesFechado,
  proximoAFechar,
  rotuloCompetencia,
} from '@sgh/contratos/regras-suprimentos';

const fechados = [
  { ano: 2026, mes: 5 },
  { ano: 2026, mes: 6 },
  { ano: 2025, mes: 12 },
];

describe('competência do estoque (regra 9)', () => {
  it('recusa o mês fechado', () => {
    expect(mesFechado({ ano: 2026, mes: 6 }, fechados)).toBe(true);
    expect(conferirCompetencia({ ano: 2026, mes: 6 }, fechados)?.codigo).toBe('mes-fechado');
    expect(conferirCompetencia({ ano: 2026, mes: 7 }, fechados)).toBeNull();
    expect(rotuloCompetencia({ ano: 2026, mes: 7 })).toBe('07/2026');
  });
  it('o próximo a fechar', () => {
    expect(proximoAFechar(fechados, { ano: 2026, mes: 10 })).toEqual({ ano: 2026, mes: 7 });
    expect(proximoAFechar([{ ano: 2025, mes: 12 }], { ano: 2026, mes: 10 })).toEqual({ ano: 2026, mes: 1 });
    expect(proximoAFechar([], { ano: 2026, mes: 10 })).toEqual({ ano: 2026, mes: 10 });
  });
  it('reabrir: permissão, motivo, mês fechado e só o último', () => {
    const m = 'conferência do inventário';
    expect(
      conferirReabertura({ ano: 2026, mes: 6 }, fechados, { podeReabrir: false, motivo: m })?.codigo,
    ).toBe('sem-permissao-reabrir');
    expect(
      conferirReabertura({ ano: 2026, mes: 6 }, fechados, { podeReabrir: true, motivo: 'x' })?.codigo,
    ).toBe('sem-motivo');
    expect(
      conferirReabertura({ ano: 2026, mes: 7 }, fechados, { podeReabrir: true, motivo: m })?.codigo,
    ).toBe('mes-aberto');
    expect(
      conferirReabertura({ ano: 2026, mes: 5 }, fechados, { podeReabrir: true, motivo: m })?.codigo,
    ).toBe('nao-e-o-ultimo');
    expect(conferirReabertura({ ano: 2026, mes: 6 }, fechados, { podeReabrir: true, motivo: m })).toBeNull();
  });
});
