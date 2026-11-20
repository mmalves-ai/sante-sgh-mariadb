// Cobertura por contrato de manutenção (F1 do M55): vigência, o que cobre e o acionamento. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  cobre,
  coberturasVigentes,
  conferirAcionamento,
  diasParaVencer,
  vigenteEm,
  type CoberturaVigencia,
} from './cobertura.js';

const c: CoberturaVigencia = {
  id: 1,
  cobertura: 'integral',
  inicio: '2026-01-01',
  fim: '2026-12-31',
  equipamentos: [10, 11],
};

describe('cobertura por contrato de manutenção', () => {
  it('vigência com as duas pontas inclusas', () => {
    expect(vigenteEm(c, '2026-01-01')).toBe(true);
    expect(vigenteEm(c, '2026-12-31')).toBe(true);
    expect(vigenteEm(c, '2027-01-01')).toBe(false);
    expect(vigenteEm(c, '2025-12-31')).toBe(false);
  });

  it('a cobertura "preventiva" não cobre corretiva nem predial', () => {
    expect(cobre('preventiva', 'calibracao')).toBe(true);
    expect(cobre('preventiva', 'segurancaEletrica')).toBe(true);
    expect(cobre('preventiva', 'inspecao')).toBe(true);
    expect(cobre('preventiva', 'preventiva')).toBe(true);
    expect(cobre('preventiva', 'corretiva')).toBe(false);
    expect(cobre('sobDemanda', 'predial')).toBe(true);
  });

  it('acionamento confere equipamento, vigência e natureza', () => {
    expect(conferirAcionamento(c, 10, 'corretiva', '2026-10-24')).toEqual({ ok: true });
    expect(conferirAcionamento(c, 12, 'corretiva', '2026-10-24')).toMatchObject({
      recusa: 'fora-do-contrato',
    });
    expect(conferirAcionamento(c, 10, 'corretiva', '2027-02-01')).toMatchObject({
      recusa: 'contrato-fora-da-vigencia',
    });
    expect(
      conferirAcionamento({ ...c, cobertura: 'preventiva' }, 10, 'corretiva', '2026-10-24'),
    ).toMatchObject({
      recusa: 'nao-cobre',
    });
  });

  it('vigentes do equipamento, da que vence por último; dias para vencer', () => {
    const d = { ...c, id: 2, fim: '2027-06-30' };
    const e = { ...c, id: 3, equipamentos: [99] };
    const f = { ...c, id: 4, fim: '2026-06-30' };
    expect(coberturasVigentes([c, d, e, f], 10, '2026-10-24').map((x) => x.id)).toEqual([2, 1]);
    expect(coberturasVigentes([c, { ...c, id: 0 }], 10, '2026-10-24').map((x) => x.id)).toEqual([0, 1]);
    expect(diasParaVencer(c, '2026-12-01')).toBe(30);
    expect(diasParaVencer(c, '2027-01-02')).toBe(-2);
  });
});
