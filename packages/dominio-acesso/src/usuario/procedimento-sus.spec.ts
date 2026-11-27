import { describe, expect, it } from 'vitest';
import {
  codigoHierarquiaSusValido,
  procedimentoSusLiberado,
  procedimentosSusForaDoEscopo,
} from './procedimento-sus.js';

describe('permissão por procedimento do SUS (C2-051)', () => {
  it('sem concessão a conta não tem restrição própria', () => {
    expect(procedimentoSusLiberado('0301010072', [])).toBe(true);
  });
  it('libera pelo grupo, subgrupo ou forma de organização concedidos', () => {
    expect(procedimentoSusLiberado('0301010072', ['03'])).toBe(true);
    expect(procedimentoSusLiberado('0301010072', ['0301'])).toBe(true);
    expect(procedimentoSusLiberado('0301010072', ['030101'])).toBe(true);
    expect(procedimentoSusLiberado('0407010012', ['03', '0202'])).toBe(false);
  });
  it('código de procedimento inválido não passa quando há restrição', () => {
    expect(procedimentoSusLiberado('03010', ['03'])).toBe(false);
  });
  it('confere o código da concessão e lista o que fica fora', () => {
    expect([
      codigoHierarquiaSusValido('03'),
      codigoHierarquiaSusValido('030'),
      codigoHierarquiaSusValido('0301010072'),
    ]).toEqual([true, false, false]);
    expect(procedimentosSusForaDoEscopo(['0301010072', '0407010012', '0407010012'], ['03'])).toEqual([
      '0407010012',
    ]);
  });
});
