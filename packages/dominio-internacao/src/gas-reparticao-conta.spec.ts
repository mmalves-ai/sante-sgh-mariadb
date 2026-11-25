import { describe, expect, it } from 'vitest';
import { periodosEfetivosContas, recortarUsosGas, repartirUsosGasPorConta } from './gas-reparticao-conta.js';

const t = (hhmm: string, dia = '10') => new Date(`2026-11-${dia}T${hhmm}:00.000Z`);

describe('repartição do uso de gás entre as contas parciais (C1-074)', () => {
  it('uso que atravessa a virada da conta parcial é dividido no instante da virada', () => {
    const contas = [
      { conta: 1, inicio: t('00:00', '01'), fim: t('12:00') },
      { conta: 2, inicio: t('12:00'), fim: null },
    ];
    const r = repartirUsosGasPorConta([{ id: 7, inicio: t('10:00'), fim: t('15:00') }], contas);
    expect(r.problemas).toEqual([]);
    expect(r.partes.map((p) => [p.conta, p.inicio, p.fim])).toEqual([
      [1, t('10:00'), t('12:00')],
      [2, t('12:00'), t('15:00')],
    ]);
  });

  it('uso dentro de uma conta só fica inteiro nela; atravessando três contas vira três partes', () => {
    const contas = [
      { conta: 1, inicio: t('00:00'), fim: t('08:00') },
      { conta: 2, inicio: t('08:00'), fim: t('16:00') },
      { conta: 3, inicio: t('16:00'), fim: null },
    ];
    const r = repartirUsosGasPorConta(
      [
        { id: 1, inicio: t('09:00'), fim: t('10:00') },
        { id: 2, inicio: t('07:00'), fim: t('17:00') },
      ],
      contas,
    );
    expect(r.problemas).toEqual([]);
    expect(r.partes.filter((p) => p.uso === 1).map((p) => p.conta)).toEqual([2]);
    expect(r.partes.filter((p) => p.uso === 2).map((p) => [p.conta, p.inicio, p.fim])).toEqual([
      [1, t('07:00'), t('08:00')],
      [2, t('08:00'), t('16:00')],
      [3, t('16:00'), t('17:00')],
    ]);
  });

  it('virada com até 1 minuto de intervalo é contínua; intervalo maior recusa com o trecho descoberto', () => {
    const emenda = repartirUsosGasPorConta(
      [{ id: 3, inicio: t('11:00'), fim: t('13:00') }],
      [
        { conta: 1, inicio: t('00:00'), fim: new Date(t('12:00').getTime() - 1000) },
        { conta: 2, inicio: t('12:00'), fim: null },
      ],
    );
    expect(emenda.problemas).toEqual([]);
    expect(emenda.partes.map((p) => p.conta)).toEqual([1, 2]);
    const buraco = repartirUsosGasPorConta(
      [{ id: 4, inicio: t('11:00'), fim: t('15:00') }],
      [
        { conta: 1, inicio: t('00:00'), fim: t('12:00') },
        { conta: 2, inicio: t('14:00'), fim: null },
      ],
    );
    expect(buraco.problemas).toHaveLength(1);
    expect(buraco.problemas[0]!.campo).toBe('conta');
    expect(buraco.problemas[0]!.mensagem).toContain('uso 4');
    expect(buraco.problemas[0]!.mensagem).toContain('12:00 a 2026-11-10 14:00');
  });

  it('uso antes da primeira conta ou depois da última fechada recusa; sem conta nenhuma recusa', () => {
    const contas = [{ conta: 1, inicio: t('08:00'), fim: t('12:00') }];
    const antes = repartirUsosGasPorConta([{ id: 5, inicio: t('07:00'), fim: t('09:00') }], contas);
    expect(antes.problemas.map((p) => p.mensagem)).toEqual([
      expect.stringContaining('07:00 a 2026-11-10 08:00'),
    ]);
    const depois = repartirUsosGasPorConta([{ id: 6, inicio: t('11:00'), fim: t('13:00') }], contas);
    expect(depois.problemas).toHaveLength(1);
    expect(
      repartirUsosGasPorConta([{ id: 8, inicio: t('11:00'), fim: t('12:00') }], []).problemas,
    ).toHaveLength(1);
  });

  it('contas sobrepostas: a de início mais recente prevalece a partir do seu início (nada cobrado duas vezes)', () => {
    const p = periodosEfetivosContas([
      { conta: 2, inicio: t('12:00'), fim: null },
      { conta: 1, inicio: t('00:00'), fim: null },
    ]);
    expect(p.map((x) => [x.conta, x.fim])).toEqual([
      [1, t('12:00')],
      [2, null],
    ]);
    const r = repartirUsosGasPorConta([{ id: 9, inicio: t('11:00'), fim: t('13:00') }], p);
    const soma = r.partes.reduce((s, x) => s + (x.fim.getTime() - x.inicio.getTime()), 0);
    expect(soma).toBe(2 * 3_600_000);
  });

  it('uso de duração zero vai para a conta que contém o início', () => {
    const r = repartirUsosGasPorConta(
      [{ id: 10, inicio: t('12:00'), fim: t('12:00') }],
      [
        { conta: 1, inicio: t('00:00'), fim: t('12:00') },
        { conta: 2, inicio: t('12:00'), fim: null },
      ],
    );
    expect(r.partes.map((p) => p.conta)).toEqual([2]);
  });

  it('recorte ao período: o fora some, o em andamento vai até o fim do período', () => {
    const usos = [
      { gas: 1, inicio: t('06:00'), fim: t('09:00'), fluxoLitrosMinuto: 2 },
      { gas: 1, inicio: t('13:00'), fim: t('14:00'), fluxoLitrosMinuto: null },
      { gas: 1, inicio: t('11:00'), fim: null, fluxoLitrosMinuto: null },
    ];
    const r = recortarUsosGas(usos, { inicio: t('08:00'), fim: t('12:00') });
    expect(r.map((u) => [u.inicio, u.fim, u.fluxoLitrosMinuto])).toEqual([
      [t('08:00'), t('09:00'), 2],
      [t('11:00'), t('12:00'), null],
    ]);
    expect(recortarUsosGas(usos.slice(2), { inicio: t('08:00'), fim: null })[0]!.fim).toBeNull();
  });
});
