// Regra 5 do M33: beneficiário é o executante do item; sem executante, pendência.
import { describe, expect, it } from 'vitest';
import { beneficiarioDoItem } from './beneficiario.js';

describe('beneficiarioDoItem', () => {
  it('o lançamento do item tem precedência; depois equipe, laudo e consulta', () => {
    expect(beneficiarioDoItem({ lancamento: 5, equipe: 6 })).toEqual({
      ok: true,
      profissional: 5,
      origem: 'lancamento',
    });
    expect(beneficiarioDoItem({ lancamento: null, equipe: 6, laudo: 7 })).toEqual({
      ok: true,
      profissional: 6,
      origem: 'equipe',
    });
    expect(beneficiarioDoItem({ laudo: 7, consulta: 8 })).toEqual({
      ok: true,
      profissional: 7,
      origem: 'laudo',
    });
    expect(beneficiarioDoItem({ consulta: 8 })).toEqual({ ok: true, profissional: 8, origem: 'consulta' });
  });

  it('zero (o "vazio" do outro sistema) e ausência viram pendência', () => {
    expect(beneficiarioDoItem({ lancamento: 0, equipe: null })).toEqual({
      ok: false,
      pendencia: 'sem-executante',
    });
    expect(beneficiarioDoItem({})).toEqual({ ok: false, pendencia: 'sem-executante' });
  });
});
