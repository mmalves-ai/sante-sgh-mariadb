// Regras 2, 3 e 8: vaga é PACIENTE vazio (não LIVRE); a legenda de SITUACAO (C é Confirmado); estados da
// marcação e as ações permitidas.
import { describe, expect, it } from 'vitest';
import {
  acoesDaMarcacao,
  ehVaga,
  estadoDaMarcacao,
  estadoDoHorario,
  type LinhaGrade,
  podeBloquear,
  podeDesbloquear,
  rotuloSituacao,
  situacao,
  SITUACOES_AGENDA,
  vagaOferecida,
} from './estado-horario.js';

const relogio = { hoje: '2026-10-21', hhmm: '10:00' };
const h = (x: Partial<LinhaGrade> = {}): LinhaGrade => ({
  data: '2026-10-22',
  hora: '0800',
  paciente: '',
  livre: 'S',
  situacao: '',
  tipo: 'N',
  ...x,
});

describe('estado do horário', () => {
  it('vaga = paciente vazio, normal, livre e sem situação', () => {
    expect(ehVaga(h())).toBe(true);
    expect(ehVaga(h({ paciente: 'FULANO' }))).toBe(false);
    expect(ehVaga(h({ livre: 'N' }))).toBe(false);
    expect(ehVaga(h({ situacao: 'Q' }))).toBe(false);
    expect(ehVaga(h({ tipo: 'E' }))).toBe(false);
  });
  it('LIVRE continua S com paciente: ocupado é o PACIENTE preenchido', () => {
    expect(estadoDoHorario(h({ paciente: 'X', livre: 'S' }), relogio)).toBe('ocupado');
    expect(estadoDoHorario(h({ paciente: 'X', tipo: 'E' }), relogio)).toBe('encaixe');
  });
  it('bloqueado, situação especial, encaixe livre e passado', () => {
    expect(estadoDoHorario(h({ livre: 'N' }), relogio)).toBe('bloqueado');
    expect(estadoDoHorario(h({ situacao: 'P' }), relogio)).toBe('situacao-especial');
    expect(estadoDoHorario(h({ tipo: 'E' }), relogio)).toBe('situacao-especial');
    expect(estadoDoHorario(h({ data: '2026-10-20' }), relogio)).toBe('passado');
    expect(estadoDoHorario(h(), null)).toBe('vago');
    expect(estadoDoHorario(h(), relogio)).toBe('vago');
  });
  it('vaga oferecida só se não começou', () => {
    expect(vagaOferecida(h(), relogio)).toBe(true);
    expect(vagaOferecida(h({ data: '2026-10-21', hora: '1000' }), relogio)).toBe(false);
  });
  it('bloquear só sem paciente; desbloquear só bloqueado e sem paciente', () => {
    expect(podeBloquear(h())).toBe(true);
    expect(podeBloquear(h({ paciente: 'X' }))).toBe(false);
    expect(podeBloquear(h({ livre: 'N' }))).toBe(false);
    expect(podeDesbloquear(h({ livre: 'N' }))).toBe(true);
    expect(podeDesbloquear(h())).toBe(false);
  });
});

describe('legenda da situação (TBSITAGE)', () => {
  it('C é Confirmado, não Cancelado; X é Cancelado; T é Transferido', () => {
    expect(rotuloSituacao('C')).toBe('Confirmado');
    expect(rotuloSituacao('X')).toBe('Cancelado');
    expect(rotuloSituacao('T')).toMatch(/Transferido/);
    expect(rotuloSituacao(' ')).toBe('Marcado');
    expect(rotuloSituacao('??')).toBe('Código ??');
  });
  it('tabela completa: 16 códigos, e o novo grava só "", C, F e T', () => {
    expect(SITUACOES_AGENDA).toHaveLength(16);
    expect(SITUACOES_AGENDA.filter((s) => s.gravadaPeloNovo).map((s) => s.codigo)).toEqual([
      '',
      'C',
      'F',
      'T',
    ]);
    expect(situacao('HR')?.rotulo).toBe('Horário reservado');
    expect(situacao(null)?.codigo).toBe('');
    expect(rotuloSituacao(undefined)).toBe('Marcado');
  });
});

describe('estado da marcação e ações', () => {
  const m = (x: Partial<{ atendido: string; situacaoHorario: string; temSenha: boolean }> = {}) => ({
    atendido: 'N',
    situacaoHorario: '',
    temSenha: false,
    ...x,
  });
  it('estados', () => {
    expect(estadoDaMarcacao(m())).toBe('marcada');
    expect(estadoDaMarcacao(m({ situacaoHorario: 'C' }))).toBe('confirmada');
    expect(estadoDaMarcacao(m({ situacaoHorario: 'A' }))).toBe('chegou');
    expect(estadoDaMarcacao(m({ temSenha: true }))).toBe('chegou');
    expect(estadoDaMarcacao(m({ atendido: 'S' }))).toBe('atendida');
    expect(estadoDaMarcacao(m({ situacaoHorario: 'F' }))).toBe('faltou');
    expect(estadoDaMarcacao(m({ situacaoHorario: 'T' }))).toBe('transferida');
    expect(estadoDaMarcacao(m({ situacaoHorario: 'Z' }))).toBe('outra');
  });
  it('ações: cancelar e remarcar até o check-in; confirmar só futura; falta só passada', () => {
    const futuro = { data: '2026-10-22', hora: '0800' };
    const passado = { data: '2026-10-20', hora: '0800' };
    expect(acoesDaMarcacao(m(), futuro, relogio)).toEqual({
      cancelar: true,
      remarcar: true,
      confirmar: true,
      registrarFalta: false,
    });
    expect(acoesDaMarcacao(m(), passado, relogio)).toEqual({
      cancelar: true,
      remarcar: true,
      confirmar: false,
      registrarFalta: true,
    });
    expect(acoesDaMarcacao(m({ temSenha: true }), futuro, relogio).cancelar).toBe(false);
    expect(acoesDaMarcacao(m({ situacaoHorario: 'F' }), passado, relogio)).toEqual({
      cancelar: true,
      remarcar: true,
      confirmar: false,
      registrarFalta: false,
    });
    expect(acoesDaMarcacao(m({ situacaoHorario: 'C' }), futuro, relogio).confirmar).toBe(false);
  });
});
