// Regra 14 do M52: banco de horas por regra (destino pelo domínio do ramo, início do ciclo pelo outro domínio); o saldo é
// a soma dos movimentos, nunca um campo editável. Parcelas escritas.
import { describe, expect, it } from 'vitest';
import { zeroEventos } from './apuracao.js';
import {
  comecaCiclo,
  conferirAcerto,
  fecharNoBanco,
  horasMinutos,
  type RegraBanco,
  saldoBanco,
  viradaDoCiclo,
} from './banco-horas.js';

const REGRA: RegraBanco = { destino: 2, inicio: 4, desde: '2026-01', cicloMeses: 6, faltaDebita: false };
const ev = (x: Partial<Record<number, number>>) => ({ ...zeroEventos(), ...x });

describe('banco de horas (regra 14)', () => {
  it('saldo = soma dos movimentos', () => {
    expect(saldoBanco([{ minutos: 120 }, { minutos: -30 }, { minutos: 45 }])).toBe(135);
    expect(saldoBanco([])).toBe(0);
  });

  it('com o destino banco: extras (60 + 30 + 15) creditam e atrasos (20) debitam: +85; a folha não recebe esses eventos', () => {
    const r = fecharNoBanco(ev({ 1: 7000, 4: 20, 6: 60, 10: 30, 11: 15 }), REGRA, '2026-03', 100);
    expect(r.credito).toBe(105);
    expect(r.debito).toBe(20);
    expect(r.movimentos).toEqual([{ origem: 'apuracao', destino: 2, minutos: 85 }]);
    expect(r.saldoFinal).toBe(185);
    expect(r.eventosFolha).toMatchObject({ 1: 7000, 4: 0, 6: 0, 10: 0, 11: 0 });
  });

  it('a falta também debita quando a regra manda', () => {
    const r = fecharNoBanco(ev({ 3: 720, 4: 0 }), { ...REGRA, faltaDebita: true }, '2026-03', 0);
    expect(r.debito).toBe(720);
    expect(r.eventosFolha[3]).toBe(0);
    expect(r.saldoFinal).toBe(-720);
  });

  it('sem banco (1) ou para a folha (3): os eventos vão inteiros e nada se move', () => {
    for (const regra of [null, { ...REGRA, destino: 3 as const }, { ...REGRA, destino: 1 as const }]) {
      const r = fecharNoBanco(ev({ 10: 60 }), regra, '2026-03', 50);
      expect(r.movimentos).toEqual([]);
      expect(r.eventosFolha[10]).toBe(60);
      expect(r.saldoFinal).toBe(50);
    }
  });

  it('virada do ciclo (a cada 6 meses desde 2026-01): 2026-07 começa; 2026-01 e 2026-04 não', () => {
    expect(comecaCiclo('2026-07', REGRA)).toBe(true);
    expect(comecaCiclo('2027-01', REGRA)).toBe(true);
    expect(comecaCiclo('2026-01', REGRA)).toBe(false);
    expect(comecaCiclo('2026-04', REGRA)).toBe(false);
    expect(() => comecaCiclo('2026-13', REGRA)).toThrow();
  });

  it('início do ciclo: zerado paga o positivo e expira o negativo; residual positivo expira o negativo; residual negativo paga o positivo; os dois carregam', () => {
    expect(viradaDoCiclo(90, 1)).toEqual([{ origem: 'pago-folha', destino: 3, minutos: -90 }]);
    expect(viradaDoCiclo(-90, 1)).toEqual([{ origem: 'expiracao', destino: 4, minutos: 90 }]);
    expect(viradaDoCiclo(-90, 2)).toEqual([{ origem: 'expiracao', destino: 4, minutos: 90 }]);
    expect(viradaDoCiclo(90, 2)).toEqual([]);
    expect(viradaDoCiclo(90, 3)).toEqual([{ origem: 'pago-folha', destino: 3, minutos: -90 }]);
    expect(viradaDoCiclo(-90, 3)).toEqual([]);
    expect(viradaDoCiclo(90, 4)).toEqual([]);
    expect(viradaDoCiclo(0, 1)).toEqual([]);
  });

  it('no fechamento da virada, o positivo pago entra na 1ª faixa de hora extra da folha: saldo 300 − 300 + 40 = 40', () => {
    const r = fecharNoBanco(ev({ 10: 40 }), { ...REGRA, inicio: 1 }, '2026-07', 300);
    expect(r.movimentos).toEqual([
      { origem: 'pago-folha', destino: 3, minutos: -300 },
      { origem: 'apuracao', destino: 2, minutos: 40 },
    ]);
    expect(r.eventosFolha[10]).toBe(300);
    expect(r.saldoFinal).toBe(40);
  });

  it('acerto manual: nunca zero, até 200 h, em período aberto', () => {
    expect(conferirAcerto(30, false)).toBeNull();
    expect(conferirAcerto(0, false)?.codigo).toBe('minutos');
    expect(conferirAcerto(200 * 60 + 1, false)?.codigo).toBe('minutos');
    expect(conferirAcerto(1.5, false)?.codigo).toBe('minutos');
    expect(conferirAcerto(-30, true)?.codigo).toBe('periodo-fechado');
  });

  it('horas e minutos', () => {
    expect(horasMinutos(125)).toBe('2 h 05');
    expect(horasMinutos(-61)).toBe('−1 h 01');
  });
});
