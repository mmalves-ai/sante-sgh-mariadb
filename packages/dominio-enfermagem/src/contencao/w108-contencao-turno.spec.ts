// W1-08, mercado (contenção mecânica): a ordem gera no aprazamento as checagens de perfusão e pele por turno; a ordem
// vencida sem renovação aparece no alerta e no indicador.
import { describe, expect, it } from 'vitest';
import {
  checagensPorTurno,
  horariosDeChecagem,
  indicadorContencao,
  venceuSemRenovacao,
} from './contencao.js';

const ORDEM = {
  id: 1,
  inicio: '2026-11-18T15:00',
  prazoHoras: 8,
  intervaloMinutos: 120,
  encerradaEm: null,
  encerramento: null,
  renovadaPor: null,
} as const;

describe('W1-08: checagem da contenção por turno', () => {
  it('a ordem que atravessa a troca de turno gera checagens de perfusão e pele nos dois turnos', () => {
    const horarios = horariosDeChecagem(ORDEM).map((previsto) => ({ previsto, estado: 'pendente' as const }));
    const t = checagensPorTurno(horarios, '0700');
    expect(t.map((x) => [x.turno, x.inicio, x.horarios])).toEqual([
      ['diurno', '2026-11-18T07:00', ['2026-11-18T17:00']],
      ['noturno', '2026-11-18T19:00', ['2026-11-18T19:00', '2026-11-18T21:00', '2026-11-18T23:00']],
    ]);
    for (const x of t) expect(x.achados).toEqual(['perfusao', 'pele']);
  });

  it('o turno conta feitas, atrasadas, pendentes e canceladas (as canceladas não são previstas)', () => {
    const t = checagensPorTurno(
      [
        { previsto: '2026-11-18T08:00', estado: 'feita' },
        { previsto: '2026-11-18T09:00', estado: 'atrasada' },
        { previsto: '2026-11-18T10:00', estado: 'pendente' },
        { previsto: '2026-11-18T11:00', estado: 'cancelada' },
      ],
      '0700',
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ previstas: 3, feitas: 1, atrasadas: 1, pendentes: 1, canceladas: 1 });
  });

  it('o turno respeita o início do diurno da unidade', () => {
    const t = checagensPorTurno([{ previsto: '2026-11-18T06:30', estado: 'pendente' }], '0600');
    expect(t[0]).toMatchObject({ turno: 'diurno', inicio: '2026-11-18T06:00', fim: '2026-11-18T18:00' });
  });
});

describe('W1-08: ordem vencida sem renovação', () => {
  it('vencida e aberta conta; retirada ou renovada no prazo não conta; inativada não conta', () => {
    const ate = '2026-11-19T00:00';
    expect(venceuSemRenovacao(ORDEM, ate, 15)).toBe(true);
    expect(
      venceuSemRenovacao({ ...ORDEM, encerradaEm: '2026-11-18T23:10', encerramento: 'retirada' }, ate, 15),
    ).toBe(false);
    expect(venceuSemRenovacao({ ...ORDEM, renovadaPor: 2, renovadaEm: '2026-11-18T22:50' }, ate, 15)).toBe(
      false,
    );
    // Retirada depois do prazo mais a tolerância: venceu sem renovação (fica no indicador, não no alerta aberto).
    expect(
      venceuSemRenovacao({ ...ORDEM, encerradaEm: '2026-11-18T23:40', encerramento: 'retirada' }, ate, 15),
    ).toBe(true);
    expect(
      venceuSemRenovacao({ ...ORDEM, encerradaEm: '2026-11-18T16:00', encerramento: 'inativacao' }, ate, 15),
    ).toBe(false);
    // O prazo ainda não fechou (fim + tolerância depois do corte).
    expect(venceuSemRenovacao(ORDEM, '2026-11-18T23:10', 15)).toBe(false);
  });

  it('o indicador traz as vencidas sem renovação com numerador, denominador e as que seguem abertas', () => {
    const i = indicadorContencao(
      [
        { ...ORDEM, renovaAnterior: false },
        { ...ORDEM, id: 2, encerradaEm: '2026-11-18T23:50', encerramento: 'retirada', renovaAnterior: false },
        { ...ORDEM, id: 3, renovadaPor: 4, renovadaEm: '2026-11-18T22:00', renovaAnterior: false },
        { ...ORDEM, id: 4, inicio: '2026-11-18T22:00', renovaAnterior: true },
        {
          ...ORDEM,
          id: 5,
          encerradaEm: '2026-11-18T15:10',
          encerramento: 'inativacao',
          renovaAnterior: false,
        },
      ],
      [],
      0,
      10,
      '2026-11-19T02:00',
      15,
    );
    // Prazo fechado até 02:00: 1, 2 e 3 (a 4 vence às 06:00; a 5 é inativada). Vencidas: 1 (aberta) e 2 (retirada tarde).
    expect(i.vencidasSemRenovacao).toEqual({ numerador: 2, denominador: 3, percentual: 66.7, emAberto: 1 });
  });

  it('sem ordem com prazo fechado, o percentual fica sem denominador', () => {
    expect(indicadorContencao([], [], 0, 0, '2026-11-18T14:00', 15).vencidasSemRenovacao).toEqual({
      numerador: 0,
      denominador: 0,
      percentual: null,
      emAberto: 0,
    });
  });
});
