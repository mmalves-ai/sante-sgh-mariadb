// Regra 4 do M08 (parte pura): inativar preserva referências; em uso pede confirmação, sem uso inativa.
import { describe, expect, it } from 'vitest';
import { avisoDeUso, decidirInativacao } from './inativar.js';

describe('inativação (regra 4)', () => {
  it('já inativo, sem uso, em uso sem e com confirmação', () => {
    expect(decidirInativacao({ ativo: false, referencias: [], confirmado: false })).toEqual({
      tipo: 'ja-inativo',
    });
    expect(
      decidirInativacao({
        ativo: true,
        referencias: [{ regra: 'RESTRICT', usos: false }],
        confirmado: false,
      }),
    ).toEqual({ tipo: 'pode' });
    const d = decidirInativacao({
      ativo: true,
      referencias: [{ regra: 'RESTRICT', usos: true }],
      confirmado: false,
    });
    expect(d.tipo).toBe('confirmar');
    expect(
      decidirInativacao({ ativo: true, referencias: [{ regra: 'RESTRICT', usos: true }], confirmado: true }),
    ).toEqual({ tipo: 'pode' });
  });
  it('aviso de uso no singular e no plural', () => {
    expect(avisoDeUso([])).toBeNull();
    expect(avisoDeUso([{ regra: 'RESTRICT', usos: true }])).toMatch(/1 cadastro do/);
    expect(
      avisoDeUso([
        { regra: 'RESTRICT', usos: true },
        { regra: 'CASCADE', usos: true },
      ]),
    ).toMatch(/2 cadastros/);
  });
});
