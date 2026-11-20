// Fechamento do dia, painel e próxima vaga.
import { describe, expect, it } from 'vitest';
import { candidatosAFalta, type MarcacaoDoDia, proximaVaga, resumoDoDia, turnoDaHora } from './dia.js';

const relogio = { hoje: '2026-10-21', hhmm: '1100' };
const m = (id: number, x: Partial<MarcacaoDoDia> = {}): MarcacaoDoDia => ({
  id,
  data: '2026-10-21',
  hora: '0800',
  atendido: 'N',
  situacaoHorario: '',
  temSenha: false,
  dataMarcacao: '2026-10-01',
  ...x,
});

describe('fechamento do dia', () => {
  it('candidatos a falta: horário passado com a tolerância, sem chegada, marcada ou confirmada', () => {
    const lista = [
      m(1),
      m(2, { hora: '1045' }),
      m(3, { temSenha: true }),
      m(4, { atendido: 'S' }),
      m(5, { situacaoHorario: 'C' }),
      m(6, { data: '2026-10-20' }),
      m(7, { data: '2026-10-22' }),
      m(8, { situacaoHorario: 'F' }),
    ];
    expect(candidatosAFalta(lista, relogio).map((x) => x.id)).toEqual([1, 5, 6]);
    expect(candidatosAFalta(lista, relogio, 0).map((x) => x.id)).toEqual([1, 2, 5, 6]);
  });
  it('resumo do painel por estado e risco alto pela antecedência', () => {
    const r = resumoDoDia([
      m(1, { dataMarcacao: '2026-08-01' }),
      m(2, { situacaoHorario: 'C', dataMarcacao: '2026-10-21' }),
      m(3, { atendido: 'S', dataMarcacao: '2026-08-01' }),
    ]);
    expect(r).toEqual({ total: 3, porEstado: { marcada: 1, confirmada: 1, atendida: 1 }, riscoAlto: 1 });
  });
  it('próxima vaga que ainda não começou', () => {
    const v = (data: string, hora: string, paciente = '') => ({
      data,
      hora,
      paciente,
      livre: 'S',
      situacao: '',
      tipo: 'N',
    });
    expect(
      proximaVaga(
        [
          v('2026-10-22', '0900'),
          v('2026-10-21', '1000'),
          v('2026-10-21', '1200'),
          v('2026-10-21', '1130', 'X'),
          v('2026-10-22', '0800'),
        ],
        relogio,
      ),
    ).toMatchObject({ data: '2026-10-21', hora: '1200' });
    expect(proximaVaga([v('2026-10-20', '0800')], relogio)).toBeNull();
    expect(
      proximaVaga([v('2026-10-23', '0900'), v('2026-10-22', '0900'), v('2026-10-22', '0800')], relogio),
    ).toMatchObject({
      data: '2026-10-22',
      hora: '0800',
    });
  });
  it('turnos', () => {
    expect(turnoDaHora('1159')).toBe('manha');
    expect(turnoDaHora('1200')).toBe('tarde');
    expect(turnoDaHora('1800')).toBe('noite');
  });
});
