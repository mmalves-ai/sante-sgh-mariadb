import { describe, expect, it } from 'vitest';
import { conferirResponsavelSetor, responsaveisQueValem } from './responsavel-setor.js';

describe('responsável pelo laudo do setor (05-SADT linha 25)', () => {
  it('sem nomeação, o setor não restringe e vale a habilitação', () => {
    expect(responsaveisQueValem([], 10)).toEqual([]);
    expect(conferirResponsavelSetor({ nomeacoes: [], exame: 10, profissional: 7 })).toBeNull();
  });

  it('nomeação do setor vale para todos os exames dele', () => {
    const n = [{ profissional: 7, exame: null }];
    expect(conferirResponsavelSetor({ nomeacoes: n, exame: 10, profissional: 7 })).toBeNull();
    expect(conferirResponsavelSetor({ nomeacoes: n, exame: 11, profissional: 8 })).toBe(
      'fora-dos-responsaveis-setor',
    );
  });

  it('a nomeação do exame prevalece sobre a do setor', () => {
    const n = [
      { profissional: 7, exame: null },
      { profissional: 9, exame: 10 },
    ];
    expect(responsaveisQueValem(n, 10)).toEqual([9]);
    expect(conferirResponsavelSetor({ nomeacoes: n, exame: 10, profissional: 7 })).toBe(
      'fora-dos-responsaveis-setor',
    );
    expect(conferirResponsavelSetor({ nomeacoes: n, exame: 10, profissional: 9 })).toBeNull();
    // Outro exame do setor segue a nomeação do setor.
    expect(conferirResponsavelSetor({ nomeacoes: n, exame: 11, profissional: 7 })).toBeNull();
  });

  it('sem profissional habilitado na sessão, com nomeação, recusa', () => {
    expect(
      conferirResponsavelSetor({
        nomeacoes: [{ profissional: 7, exame: null }],
        exame: 10,
        profissional: null,
      }),
    ).toBe('fora-dos-responsaveis-setor');
  });

  it('nomeações repetidas não duplicam a lista', () => {
    expect(
      responsaveisQueValem(
        [
          { profissional: 7, exame: null },
          { profissional: 7, exame: null },
        ],
        3,
      ),
    ).toEqual([7]);
  });
});
