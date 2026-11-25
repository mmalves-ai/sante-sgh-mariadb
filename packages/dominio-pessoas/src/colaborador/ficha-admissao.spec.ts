import { describe, expect, it } from 'vitest';
import { conferirFichaAdmissao, idadeEm, sugerirTipoDependente } from './ficha-admissao.js';

const base = { nascimento: '1990-05-10', admissao: '2026-11-02', grauInstrucao: '07', salario: 3500.5 };

describe('ficha da admissão', () => {
  it('idade em anos completos, contando o aniversário', () => {
    expect(idadeEm('2000-11-02', '2026-11-01')).toBe(25);
    expect(idadeEm('2000-11-02', '2026-11-02')).toBe(26);
  });

  it('aceita a ficha completa', () => {
    expect(conferirFichaAdmissao(base)).toEqual({ ok: true });
  });

  it('recusa nascimento ausente, depois da admissão ou abaixo da idade mínima, com o campo', () => {
    expect(conferirFichaAdmissao({ ...base, nascimento: null })).toMatchObject({
      recusa: 'nascimento-obrigatorio',
      campo: 'nascimento',
    });
    expect(conferirFichaAdmissao({ ...base, nascimento: '2026-11-03' })).toMatchObject({
      recusa: 'nascimento-invalido',
    });
    expect(conferirFichaAdmissao({ ...base, nascimento: '2012-11-03' })).toMatchObject({
      recusa: 'idade-minima',
    });
    expect(conferirFichaAdmissao({ ...base, nascimento: '2012-11-02' })).toEqual({ ok: true });
  });

  it('recusa grau de instrução fora do código oficial e salário zerado, negativo ou com centavos a mais', () => {
    expect(conferirFichaAdmissao({ ...base, grauInstrucao: '13' })).toMatchObject({
      recusa: 'grau-instrucao-invalido',
      campo: 'grauInstrucao',
    });
    expect(conferirFichaAdmissao({ ...base, grauInstrucao: undefined })).toMatchObject({
      recusa: 'grau-instrucao-invalido',
    });
    for (const salario of [0, -1, null, 10.123])
      expect(conferirFichaAdmissao({ ...base, salario })).toMatchObject({
        recusa: 'salario-invalido',
        campo: 'salario',
      });
  });
});

describe('sugestão do tipo de dependente do eSocial pela idade', () => {
  const dia = '2026-11-25';
  it('filho acima de 21 anos: sugere o universitário (04); até 21 com 04, volta ao 03', () => {
    expect(sugerirTipoDependente('03', '2004-01-01', dia)).toMatchObject({ sugerido: '04' });
    expect(sugerirTipoDependente('03', '2006-01-01', dia)).toBeNull();
    expect(sugerirTipoDependente('04', '2010-01-01', dia)).toMatchObject({ sugerido: '03' });
  });
  it('universitário acima de 24: só incapaz (11); guarda do menor acaba aos 18', () => {
    expect(sugerirTipoDependente('04', '2000-01-01', dia)).toMatchObject({ sugerido: '11' });
    expect(sugerirTipoDependente('04', '2003-01-01', dia)).toBeNull();
    expect(sugerirTipoDependente('10', '2008-01-01', dia)).toMatchObject({ sugerido: '99' });
    expect(sugerirTipoDependente('01', '1950-01-01', dia)).toBeNull();
  });
});
