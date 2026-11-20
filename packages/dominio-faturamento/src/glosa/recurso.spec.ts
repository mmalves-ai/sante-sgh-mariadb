// Regra 8 do M31 (recurso): só de item conciliado, com cobrado maior que pago e sem recurso anterior; valor padrão
// VALOR_C − VLR_PG e quantidade padrão QTDE − QTD_PG (nunca 0); motivo sem reapresentação gera alerta, não bloqueio.
import { describe, expect, it } from 'vitest';
import {
  alertaReapresentacao,
  conferirRecurso,
  conferirValorRecurso,
  padraoRecurso,
} from '@sgh/contratos/regras-faturamento';

describe('recurso', () => {
  it('conciliado com glosa e sem recurso: aceita', () => {
    expect(conferirRecurso({ glosado: 'T', valorCobrado: 100, valorPago: 60, valorRecurso: 0 })).toBeNull();
  });
  it.each([
    [{ glosado: 'F', valorCobrado: 100, valorPago: 0, valorRecurso: 0 }, 'nao-conciliado'],
    [{ glosado: 'T', valorCobrado: 100, valorPago: 60, valorRecurso: 40 }, 'ja-recorrido'],
    [{ glosado: 'T', valorCobrado: 100, valorPago: 100, valorRecurso: 0 }, 'sem-glosa'],
  ])('%j → %s', (i, codigo) => {
    expect(conferirRecurso(i)?.codigo).toBe(codigo);
  });
  it('valor e quantidade padrão (fracionária; nunca 0)', () => {
    expect(
      padraoRecurso({ valorCobrado: 100, valorPago: 60.25, quantidade: 2.5, quantidadePaga: 1 }),
    ).toEqual({
      valor: 39.75,
      quantidade: 1.5,
    });
    expect(
      padraoRecurso({ valorCobrado: 100, valorPago: 60, quantidade: 1, quantidadePaga: 1 }).quantidade,
    ).toBe(1);
    expect(
      padraoRecurso({ valorCobrado: 100, valorPago: 60, quantidade: 0, quantidadePaga: 0 }).quantidade,
    ).toBe(1);
  });
  it('valor informado: positivo e até a glosa', () => {
    expect(conferirValorRecurso(10, 40)).toBeNull();
    expect(conferirValorRecurso(0, 40)?.codigo).toBe('valor-invalido');
    expect(conferirValorRecurso(41, 40)?.codigo).toBe('valor-acima-da-glosa');
  });
  it('motivo sem reapresentação: alerta', () => {
    expect(alertaReapresentacao('F')).toMatch(/não admite reapresentação/);
    expect(alertaReapresentacao('T')).toBeNull();
    expect(alertaReapresentacao(null)).toBeNull();
  });
});
