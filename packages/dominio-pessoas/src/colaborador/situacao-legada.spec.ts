// Regra 4 do M52 (DP-46.1): a situação do cadastro de profissionais não define vínculo; a atividade vem do registro.
import { describe, expect, it } from 'vitest';
import {
  legendaSituacaoProfissional,
  profissionalAtivo,
  registroAtivo,
  vinculoExibido,
} from './situacao-legada.js';

describe('situação do cadastro de profissionais (regra 4)', () => {
  it('O, F e E saem com a legenda "a confirmar"; o resto não aparece', () => {
    for (const c of ['O', 'F', 'E']) {
      const l = legendaSituacaoProfissional(c);
      expect(l?.codigo).toBe(c);
      expect(l?.aConfirmar).toBe(true);
      expect(l?.rotulo).toMatch(/a confirmar/);
    }
    expect(legendaSituacaoProfissional(' f ')?.codigo).toBe('F');
    expect(legendaSituacaoProfissional('X')).toBeNull();
    expect(legendaSituacaoProfissional(null)).toBeNull();
    expect(legendaSituacaoProfissional('')).toBeNull();
  });

  it('"F" sem vínculo no Sante SGH não vira funcionário: o vínculo é só o registrado', () => {
    expect(vinculoExibido(null)).toBeNull();
    expect(vinculoExibido('cooperado')).toEqual({ tipo: 'cooperado', rotulo: 'Cooperado' });
  });

  it('a atividade vem de TBCBOPRO.ATIVO (T, F ou não informado)', () => {
    expect(registroAtivo('T')).toBe(true);
    expect(registroAtivo('F')).toBe(false);
    expect(registroAtivo(null)).toBeNull();
    expect(registroAtivo('S')).toBeNull();
    expect(profissionalAtivo([{ ativo: false }, { ativo: true }])).toBe(true);
    expect(profissionalAtivo([{ ativo: false }, { ativo: null }])).toBe(false);
    expect(profissionalAtivo([{ ativo: null }])).toBeNull();
    expect(profissionalAtivo([])).toBeNull();
  });
});
