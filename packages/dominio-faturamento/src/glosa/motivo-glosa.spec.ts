// Regra 7 do M31: glosa sem motivo (0) não fecha a conciliação no novo; 3095 é motivo de retorno, não de glosa.
import { describe, expect, it } from 'vitest';
import { conferirBaixa, MOTIVO_ACATADO } from '@sgh/contratos/regras-faturamento';

const b = (x: Partial<Parameters<typeof conferirBaixa>[0]> = {}) =>
  conferirBaixa({
    valorCobrado: 100,
    valorPago: 100,
    quantidadePaga: 1,
    motivo: 0,
    motivoExiste: true,
    jaBaixado: false,
    ...x,
  });

describe('motivo da glosa', () => {
  it('pago integral com motivo 0: aceita', () => {
    expect(b()).toBeNull();
  });
  it('glosa com motivo 0: recusada (motivo-zero)', () => {
    expect(b({ valorPago: 60 })?.codigo).toBe('motivo-zero');
  });
  it('glosa com motivo da tabela 38: aceita', () => {
    expect(b({ valorPago: 60, motivo: 1001 })).toBeNull();
  });
  it('3095 é retorno: recusado na baixa', () => {
    expect(b({ valorPago: 60, motivo: MOTIVO_ACATADO })?.codigo).toBe('motivo-de-retorno');
  });
  it('motivo inexistente, valor negativo e item já baixado', () => {
    expect(b({ valorPago: 60, motivo: 77, motivoExiste: false })?.codigo).toBe('motivo-inexistente');
    expect(b({ valorPago: -1 })?.codigo).toBe('valor-negativo');
    expect(b({ jaBaixado: true })?.codigo).toBe('ja-baixado');
  });
});
