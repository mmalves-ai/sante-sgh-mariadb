// Regra 2 do M46: sem a pausa cirúrgica concluída, a incisão não é registrada no novo; a exceção só em urgência, pelo
// supervisor, com motivo; a trava só vale ligada (por bloco inteiro).
import { describe, expect, it } from 'vitest';
import type { ChecklistLido } from './checklist.js';
import { conferirExcecao, decidirTrava, instanteDaIncisao } from './trava.js';

const C: ChecklistLido = {
  lista: 1,
  versao: 3,
  inducaoEm: '2026-10-25T08:00',
  inducaoPor: 'A',
  timeoutEm: '2026-10-25T08:10',
  timeoutPor: 'A',
  saidaEm: null,
  saidaPor: null,
  excecaoEm: null,
  excecaoPor: null,
  excecaoMotivo: null,
};
const base = {
  travaLigada: true,
  agendamento: 10,
  incisao: '2026-10-25T08:15',
  checklist: C,
  supervisor: false,
};

describe('trava da incisão', () => {
  it('desligada, nada é conferido; sem incisão no pedido, também não', () => {
    expect(decidirTrava({ ...base, travaLigada: false, checklist: null })).toEqual({
      ok: true,
      por: 'desligada',
    });
    expect(decidirTrava({ ...base, incisao: null, checklist: null })).toEqual({
      ok: true,
      por: 'sem-incisao',
    });
  });
  it('com a pausa concluída antes da incisão, passa; antes da pausa, recusa', () => {
    expect(decidirTrava(base)).toEqual({ ok: true, por: 'pausa' });
    expect(decidirTrava({ ...base, incisao: '2026-10-25T08:10' })).toEqual({ ok: true, por: 'pausa' });
    expect(decidirTrava({ ...base, incisao: '2026-10-25T08:05' })).toEqual({
      ok: false,
      codigo: 'incisao-antes-do-timeout',
    });
  });
  it('sem a pausa: recusa; com a exceção registrada: passa (mesmo antes da pausa)', () => {
    expect(decidirTrava({ ...base, checklist: null })).toEqual({ ok: false, codigo: 'incisao-sem-timeout' });
    expect(decidirTrava({ ...base, checklist: { ...C, timeoutEm: null } })).toEqual({
      ok: false,
      codigo: 'incisao-sem-timeout',
    });
    const exc = {
      ...C,
      timeoutEm: null,
      excecaoEm: '2026-10-25T08:01',
      excecaoPor: 'SUP',
      excecaoMotivo: 'Urgência hemorrágica',
    };
    expect(decidirTrava({ ...base, checklist: exc })).toEqual({ ok: true, por: 'excecao' });
    expect(
      decidirTrava({
        ...base,
        incisao: '2026-10-25T08:05',
        checklist: { ...exc, timeoutEm: '2026-10-25T08:10' },
      }),
    ).toEqual({
      ok: true,
      por: 'excecao',
    });
  });
  it('o ato sem agendamento passa só com o supervisor, em urgência e com o motivo', () => {
    const semAg = { ...base, agendamento: null, checklist: null };
    const motivo = 'Urgência: sangramento ativo';
    expect(decidirTrava({ ...semAg, carater: 1, motivo })).toEqual({
      ok: false,
      codigo: 'incisao-sem-timeout',
    });
    expect(decidirTrava({ ...semAg, supervisor: true, carater: 1, motivo })).toEqual({
      ok: true,
      por: 'supervisor',
    });
    expect(decidirTrava({ ...semAg, supervisor: true, carater: 3, motivo })).toEqual({
      ok: true,
      por: 'supervisor',
    });
    // A eletiva sem agendamento não tem exceção, mesmo com o supervisor e o motivo.
    expect(decidirTrava({ ...semAg, supervisor: true, carater: 2, motivo })).toEqual({
      ok: false,
      codigo: 'excecao-so-urgencia',
    });
    // Sem o motivo (ou com menos de 10 caracteres), recusa.
    for (const m of [null, '', '   urgente  '])
      expect(decidirTrava({ ...semAg, supervisor: true, carater: 1, motivo: m })).toEqual({
        ok: false,
        codigo: 'excecao-sem-motivo',
      });
    expect(decidirTrava({ ...semAg, supervisor: true, carater: 1 })).toEqual({
      ok: false,
      codigo: 'excecao-sem-motivo',
    });
  });
  it('a exceção: só em urgência (a eletiva não tem), uma vez, antes de a pausa ser concluída', () => {
    expect(conferirExcecao(null, 2)).toBe('excecao-so-urgencia');
    expect(conferirExcecao(null, 1)).toBeNull();
    expect(conferirExcecao(null, 3)).toBeNull();
    expect(conferirExcecao(null, null)).toBeNull();
    expect(conferirExcecao({ ...C, timeoutEm: null, excecaoEm: '2026-10-25T08:00' }, 1)).toBe(
      'excecao-ja-registrada',
    );
    expect(conferirExcecao(C, 1)).toBe('excecao-timeout-concluido');
  });
  it('o instante da incisão do registro do ato (HHMM no dia)', () => {
    expect(instanteDaIncisao('2026-10-25', '0805')).toBe('2026-10-25T08:05');
    expect(instanteDaIncisao('2026-10-25', null)).toBeNull();
    expect(instanteDaIncisao('2026-10-25', '8:05')).toBeNull();
  });
});
