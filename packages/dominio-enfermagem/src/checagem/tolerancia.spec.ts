// Regra 3 do M25: tolerância por unidade e classe (padrão 60 minutos); atrasada fora dela; omitida no fim do turno.
import { describe, expect, it } from 'vitest';
import {
  atrasoAlemDaTolerancia,
  dentroDaTolerancia,
  estadoDoHorario,
  TOLERANCIA_PADRAO_MINUTOS,
  toleranciaDaClasse,
} from './tolerancia.js';

const base = { previsto: '2026-10-22T10:00', toleranciaMinutos: 60, fimDoTurno: '2026-10-22T19:00' };

describe('regra 3: tolerância de 60 minutos (60 dentro, 61 fora)', () => {
  it('o padrão vem do parâmetro de tolerância do estabelecimento (01:00)', () => {
    expect(TOLERANCIA_PADRAO_MINUTOS).toBe(60);
  });
  it('60 minutos depois ainda está dentro; 61, fora', () => {
    expect(dentroDaTolerancia('2026-10-22T10:00', '2026-10-22T11:00', 60)).toBe(true);
    expect(dentroDaTolerancia('2026-10-22T10:00', '2026-10-22T11:01', 60)).toBe(false);
    expect(dentroDaTolerancia('2026-10-22T10:00', '2026-10-22T09:00', 60)).toBe(true);
    expect(dentroDaTolerancia('2026-10-22T10:00', '2026-10-22T08:59', 60)).toBe(false);
  });
  it('a dose não checada fica atrasada aos 61 minutos', () => {
    expect(estadoDoHorario({ ...base, situacao: 'P', agora: '2026-10-22T11:00' })).toBe('pendente');
    expect(estadoDoHorario({ ...base, situacao: 'P', agora: '2026-10-22T11:01' })).toBe('atrasada');
    expect(atrasoAlemDaTolerancia('2026-10-22T10:00', '2026-10-22T11:01', 60)).toBe(1);
    expect(atrasoAlemDaTolerancia('2026-10-22T10:00', '2026-10-22T09:00', 60)).toBe(0);
  });
  it('sem checagem até o fim do turno, omitida', () => {
    expect(estadoDoHorario({ ...base, situacao: 'P', agora: '2026-10-22T18:59' })).toBe('atrasada');
    expect(estadoDoHorario({ ...base, situacao: 'P', agora: '2026-10-22T19:00' })).toBe('omitida');
    // O horário do turno seguinte não é omitido no fim do anterior.
    expect(
      estadoDoHorario({ ...base, previsto: '2026-10-22T20:00', situacao: 'P', agora: '2026-10-22T19:30' }),
    ).toBe('pendente');
  });
  it('as situações checadas e suspensas (sensível a maiúsculas)', () => {
    const agora = '2026-10-22T12:00';
    expect(estadoDoHorario({ ...base, situacao: 'A', agora })).toBe('administrada');
    expect(estadoDoHorario({ ...base, situacao: 'N', agora })).toBe('naoAdministrada');
    expect(estadoDoHorario({ ...base, situacao: 'S', agora })).toBe('suspensa');
    expect(estadoDoHorario({ ...base, situacao: 'C', agora })).toBe('suspensa');
    expect(estadoDoHorario({ ...base, situacao: 'X', agora })).toBe('suspensa');
    expect(estadoDoHorario({ ...base, situacao: 'p', agora })).toBe('outro');
    expect(estadoDoHorario({ ...base, situacao: 'n', agora })).toBe('outro');
    expect(estadoDoHorario({ ...base, situacao: 'O', agora })).toBe('outro');
  });
  it('a classe de tempo crítico tem a tolerância menor', () => {
    expect(toleranciaDaClasse({ geral: 60, tempoCritico: 30, altaVigilancia: true })).toBe(30);
    expect(
      toleranciaDaClasse({ geral: 60, tempoCritico: 30, altaVigilancia: false, antimicrobiano: true }),
    ).toBe(30);
    expect(toleranciaDaClasse({ geral: 60, tempoCritico: 30, altaVigilancia: false })).toBe(60);
    expect(toleranciaDaClasse({ geral: 20, tempoCritico: 30, altaVigilancia: true })).toBe(20);
  });
});
