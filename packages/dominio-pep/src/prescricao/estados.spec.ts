// Regra 13 do M24: conjunto completo da suspensão; os horários ainda prescritos ficam suspensos; checados não mudam.
import { describe, expect, it } from 'vitest';
import {
  conjuntoSuspensaoValido,
  horariosASuspender,
  justificativaValida,
  rotuloChecagem,
  situacaoDoItem,
} from './estados.js';

const completo = {
  profissional: 1,
  dataHora: '2026-06-20T10:00',
  fuso: -3,
  horarioVerao: 'F',
  justificativa: 'Troca de antibiótico',
};

describe('estados', () => {
  it('conjunto completo ou vazio; pela metade, recusado (como o gatilho)', () => {
    expect(conjuntoSuspensaoValido(completo)).toBe(true);
    expect(
      conjuntoSuspensaoValido({
        profissional: null,
        dataHora: null,
        fuso: null,
        horarioVerao: null,
        justificativa: null,
      }),
    ).toBe(true);
    for (const k of Object.keys(completo))
      expect(conjuntoSuspensaoValido({ ...completo, [k]: null })).toBe(false);
    expect(conjuntoSuspensaoValido({ ...completo, justificativa: '   ' })).toBe(false);
  });
  it('justificativa com 10 letras ou mais', () => {
    expect(justificativaValida('123456789')).toBe(false);
    expect(justificativaValida('1234567890')).toBe(true);
    expect(justificativaValida(null)).toBe(false);
  });
  it('suspende os prescritos (passados contados à parte); checados viram pendência; suspensos ficam', () => {
    const r = horariosASuspender(
      [
        { id: 1, dataHora: '2026-06-20T06:00', situacao: 'P' },
        { id: 2, dataHora: '2026-06-20T14:00', situacao: 'P' },
        { id: 3, dataHora: '2026-06-20T08:00', situacao: 'O' },
        { id: 4, dataHora: '2026-06-20T09:00', situacao: 'S' },
        { id: 5, dataHora: '2026-06-20T22:00', situacao: 'p' },
      ],
      '2026-06-20T10:00',
    );
    expect(r.suspender.map((h) => h.id)).toEqual([1, 2]);
    expect(r.passados).toBe(1);
    expect(r.pendentes.map((h) => h.id)).toEqual([3, 5]);
  });
  it('situação do item', () => {
    const P = { id: 1, dataHora: 'x', situacao: 'P' };
    const S = { id: 2, dataHora: 'x', situacao: 'S' };
    const O = { id: 3, dataHora: 'x', situacao: 'O' };
    expect(situacaoDoItem([P], true, false)).toBe('suspenso-correcao');
    expect(situacaoDoItem([S, S], false, false)).toBe('suspenso');
    expect(situacaoDoItem([S, O], false, false)).toBe('suspenso');
    expect(situacaoDoItem([P, S], false, true)).toBe('vencido');
    expect(situacaoDoItem([P], false, false)).toBe('ativo');
    expect(situacaoDoItem([], false, false)).toBe('ativo');
  });
  it('rótulos sensíveis a maiúsculas', () => {
    expect(rotuloChecagem('P')).toBe('Prescrito');
    expect(rotuloChecagem('p')).toBe('Parcial');
    expect(rotuloChecagem('Z')).toContain('a confirmar');
  });
});
