// Regra 10 do M31: duas réguas de glosa (líquida e positiva); êxito com denominador zero = "não recorreu"; faixas de
// valor fechadas à esquerda; ciclo de recurso só de 0 a 3.650 dias; a régua padrão é a competência; prazo de recurso
// por operadora sem valor padrão (DP-33.9) e a decisão da glosa.
import { describe, expect, it } from 'vitest';
import {
  cicloValido,
  conferirDecisaoGlosa,
  faixaDoValor,
  indicadoresGlosa,
  percentual,
  prazoRecurso,
  REGUA_PADRAO_GLOSA,
} from '@sgh/contratos/regras-faturamento';

describe('indicadores de glosa', () => {
  it('duas réguas e o êxito', () => {
    const r = indicadoresGlosa({
      emitido: 1000,
      conciliado: 800,
      pago: 700,
      glosaLiquida: 100,
      glosaPositiva: 120,
      contestado: 60,
      recuperado: 30,
    });
    expect(r).toEqual({
      taxaLiquida: 12.5,
      taxaPositiva: 15,
      exito: 50,
      exitoRotulo: '50%',
      nuncaRecorrido: 40,
    });
  });
  it('êxito sem contestado: "não recorreu"', () => {
    const r = indicadoresGlosa({
      emitido: 0,
      conciliado: 0,
      pago: 0,
      glosaLiquida: 0,
      glosaPositiva: 0,
      contestado: 0,
      recuperado: 0,
    });
    expect(r.exito).toBeNull();
    expect(r.exitoRotulo).toBe('não recorreu');
    expect(r.taxaLiquida).toBeNull();
    expect(percentual(1, 0)).toBeNull();
  });
  it('faixas fechadas à esquerda', () => {
    expect(faixaDoValor(0)).toBe('0 até menos de 100');
    expect(faixaDoValor(99.99)).toBe('0 até menos de 100');
    expect(faixaDoValor(100)).toBe('100 até menos de 1000');
    expect(faixaDoValor(1000)).toBe('1000 até menos de 10000');
    expect(faixaDoValor(10_000)).toBe('10000 ou mais');
  });
  it('ciclo só de 0 a 3.650 dias', () => {
    expect(cicloValido(0)).toBe(true);
    expect(cicloValido(3650)).toBe(true);
    expect(cicloValido(3651)).toBe(false);
    expect(cicloValido(-1)).toBe(false);
    expect(cicloValido(null)).toBe(false);
  });
  it('a régua padrão é a competência', () => {
    expect(REGUA_PADRAO_GLOSA).toBe('competencia');
  });
  it('prazo de recurso por operadora; sem valor, "prazo não cadastrado"', () => {
    expect(prazoRecurso('301:30;305:60', 305, '2026-10-01')).toEqual({ prazo: '2026-11-30', alerta: null });
    expect(prazoRecurso('', 305, '2026-10-01')).toEqual({ prazo: null, alerta: 'prazo não cadastrado' });
    expect(prazoRecurso('301:30', 301, null)).toEqual({ prazo: null, alerta: 'sem data de baixa' });
    expect(prazoRecurso('lixo;301:0', 301, '2026-10-01').alerta).toBe('prazo não cadastrado');
  });
  it('decisão da glosa', () => {
    const base = {
      conciliado: true,
      glosa: 10,
      estadoAtual: null,
      decisao: 'aceitar' as const,
      texto: 'motivo válido',
    };
    expect(conferirDecisaoGlosa(base)).toBeNull();
    expect(conferirDecisaoGlosa({ ...base, conciliado: false })?.codigo).toBe('nao-conciliado');
    expect(conferirDecisaoGlosa({ ...base, glosa: 0 })?.codigo).toBe('sem-glosa');
    expect(conferirDecisaoGlosa({ ...base, estadoAtual: 'aceita' })?.codigo).toBe('glosa-decidida');
    expect(conferirDecisaoGlosa({ ...base, estadoAtual: 'recorrida', decisao: 'recorrer' })?.codigo).toBe(
      'glosa-decidida',
    );
    expect(conferirDecisaoGlosa({ ...base, estadoAtual: 'recorrida' })).toBeNull();
    expect(conferirDecisaoGlosa({ ...base, texto: 'x' })?.codigo).toBe('motivo-obrigatorio');
    expect(conferirDecisaoGlosa({ ...base, decisao: 'recorrer', texto: '' })?.codigo).toBe(
      'justificativa-obrigatoria',
    );
  });
});
