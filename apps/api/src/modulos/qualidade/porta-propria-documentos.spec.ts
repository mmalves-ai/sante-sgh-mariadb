// Regra pura da publicação de revisão no banco próprio (porta-propria-documentos.ts): a substituição só da revisão
// vigente do mesmo código na versão lida, nada de segunda vigente e nada de número de revisão repetido.
import { describe, expect, it } from 'vitest';
import { conferirSubstituicao, type RevisaoTravada } from './porta-propria-documentos.js';

const vigente: RevisaoTravada = { id: 7, versao: 2, documento: 3, codigo: 'POP-1', situacao: 'vigente' };
const base = {
  codigo: 'POP-1',
  revisao: 2,
  substitui: { id: 7, versao: 2 },
  substituida: vigente,
  vigenteDoCodigo: 7,
  revisoesDoCodigo: ['1'],
};

describe('conferirSubstituicao', () => {
  it('aceita a revisão nova que substitui a vigente na versão lida', () => {
    expect(conferirSubstituicao(base)).toBeNull();
  });
  it('aceita a primeira publicação de um código sem revisões', () => {
    expect(
      conferirSubstituicao({
        ...base,
        revisao: 1,
        substitui: null,
        substituida: null,
        vigenteDoCodigo: null,
        revisoesDoCodigo: [],
      }),
    ).toBeNull();
  });
  it('recusa a substituição com versão desatualizada, de outro código, não vigente ou inexistente', () => {
    expect(conferirSubstituicao({ ...base, substitui: { id: 7, versao: 1 } })).toBe('substituida-invalida');
    expect(conferirSubstituicao({ ...base, substituida: { ...vigente, codigo: 'POP-2' } })).toBe(
      'substituida-invalida',
    );
    expect(conferirSubstituicao({ ...base, substituida: { ...vigente, situacao: 'obsoleta' } })).toBe(
      'substituida-invalida',
    );
    expect(conferirSubstituicao({ ...base, substituida: null })).toBe('substituida-invalida');
  });
  it('recusa a publicação sem substituição quando o código já tem revisão vigente', () => {
    expect(conferirSubstituicao({ ...base, substitui: null, substituida: null })).toBe('ja-vigente');
  });
  it('recusa o número de revisão repetido no código (rótulo "2" ou "2.0")', () => {
    expect(conferirSubstituicao({ ...base, revisoesDoCodigo: ['1', '2.0'] })).toBe('revisao-repetida');
    expect(
      conferirSubstituicao({
        ...base,
        substitui: null,
        substituida: null,
        vigenteDoCodigo: null,
        revisoesDoCodigo: ['2'],
      }),
    ).toBe('revisao-repetida');
  });
});
