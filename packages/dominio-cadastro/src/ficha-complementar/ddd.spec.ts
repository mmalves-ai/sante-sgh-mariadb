import { describe, expect, it } from 'vitest';
import { classeDoNumero, errosTelefoneNaArea, mensagemTelefoneRecusado, type AreaDdd } from './ddd.js';

const AREA: AreaDdd = { ativa: true, digitosFixo: 8, digitosMovel: 9 };

describe('telefone pela área de DDD (02-CAD linha 14)', () => {
  it('classifica fixo (8 dígitos, começa de 2 a 5) e móvel (9 dígitos, começa por 9)', () => {
    expect(classeDoNumero('32104567', AREA)).toBe('fixo');
    expect(classeDoNumero('991234567', AREA)).toBe('movel');
    expect(classeDoNumero('91234567', AREA)).toBeNull();
    expect(classeDoNumero('12345678', AREA)).toBeNull();
    expect(classeDoNumero('3210456', AREA)).toBeNull();
    expect(classeDoNumero('9912345678', AREA)).toBeNull();
  });

  it('recusa DDD sem área ativa no Brasil', () => {
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '20', numero: '991234567' }, null)).toEqual(['ddd']);
    expect(
      errosTelefoneNaArea({ ddi: '55', ddd: '11', numero: '991234567' }, { ...AREA, ativa: false }),
    ).toEqual(['ddd']);
  });

  it('recusa número fora da forma da área e aceita fixo e móvel válidos', () => {
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '11', numero: '81234567' }, AREA)).toEqual(['numero']);
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '11', numero: '991234567' }, AREA)).toEqual([]);
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '61', numero: '33214567' }, AREA)).toEqual([]);
  });

  it('fora do Brasil não confere a área', () => {
    expect(errosTelefoneNaArea({ ddi: '351', ddd: null, numero: '912345678' }, null)).toEqual([]);
  });

  it('campo que exige móvel recusa o fixo válido; sem exigência, o fixo e o móvel passam', () => {
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '31', numero: '33334444' }, AREA, 'movel')).toEqual([
      'numero',
    ]);
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '31', numero: '999990102' }, AREA, 'movel')).toEqual([]);
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '31', numero: '999990102' }, AREA)).toEqual([]);
    expect(errosTelefoneNaArea({ ddi: '55', ddd: '20', numero: '999990102' }, null, 'movel')).toEqual([
      'ddd',
    ]);
  });

  it('a frase da recusa diz o que corrigir, pelo campo recusado', () => {
    expect(mensagemTelefoneRecusado('ddd')).toContain('DDD');
    expect(mensagemTelefoneRecusado('numero', 'movel')).toContain('começando por 9');
    expect(mensagemTelefoneRecusado('numero')).toContain('fixo');
  });
});
