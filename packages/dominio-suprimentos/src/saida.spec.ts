// Regras 3, 4 e 5 (ficha do M28): local e centro de custo; saldo, valor, negativo, unitário; troca de paciente.
import { describe, expect, it } from 'vitest';
import {
  centroTecnico,
  conferirCabecalhoSaida,
  conferirItemSaida,
  conferirTrocaPaciente,
  valorPrevisto,
} from '@sgh/contratos/regras-suprimentos';

const base = { item: 7, quantidade: 2, saldoLocal: 10, estoque: 20, total: 200 };

describe('saída (regras 3 a 5)', () => {
  it('sem centro de custo ou sem local é recusada', () => {
    expect(conferirCabecalhoSaida({ centroCusto: 0, local: null }).map((r) => r.codigo)).toEqual([
      'sem-centro-custo',
      'sem-local',
    ]);
    expect(conferirCabecalhoSaida({ centroCusto: 300100, local: 10 })).toEqual([]);
  });
  it('saldo insuficiente no local ou na empresa', () => {
    expect(conferirItemSaida({ ...base, quantidade: 11 })[0]?.codigo).toBe('saldo-insuficiente');
    expect(conferirItemSaida({ ...base, saldoLocal: 30, quantidade: 21 })[0]?.codigo).toBe(
      'saldo-insuficiente',
    );
    expect(conferirItemSaida({ ...base, quantidade: 0 })[0]?.codigo).toBe('quantidade-invalida');
    expect(conferirItemSaida(base)).toEqual([]);
  });
  it('sem valor em estoque, valor negativo e unitário acima de 100.000', () => {
    expect(conferirItemSaida({ ...base, total: 0 })[0]?.codigo).toBe('sem-valor-estoque');
    expect(conferirItemSaida({ ...base, total: 0, custoMedio: 0 })).toEqual([]);
    expect(conferirItemSaida({ ...base, total: -1 })[0]?.codigo).toBe('valor-negativo');
    expect(conferirItemSaida({ ...base, total: 20 * 100_001 })[0]?.codigo).toBe('unitario-acima-limite');
  });
  it('consignado não confere saldo nem valor', () => {
    expect(conferirItemSaida({ ...base, quantidade: 50, total: 0, consignado: true })).toEqual([]);
  });
  it('o valor previsto: custo médio; a saída de todo o saldo leva todo o valor (regra 5)', () => {
    expect(valorPrevisto({ quantidade: 2, estoque: 3, total: 10 })).toBe(6.67);
    expect(valorPrevisto({ quantidade: 3, estoque: 3, total: 10 })).toBe(10);
    expect(valorPrevisto({ quantidade: 1, estoque: 0, total: 0 })).toBe(0);
  });
  it('troca de paciente que muda o prontuário é recusada', () => {
    expect(conferirTrocaPaciente({ prontuario: 1 }, { prontuario: 1 })).toBeNull();
    expect(conferirTrocaPaciente({ prontuario: 1 }, { prontuario: 2 })?.codigo).toBe('troca-de-prontuario');
  });
  it('centros técnicos 9901 a 9999 (regra 10)', () => {
    expect(centroTecnico(9901)).toBe(true);
    expect(centroTecnico(9999)).toBe(true);
    expect(centroTecnico(300100)).toBe(false);
  });
});
