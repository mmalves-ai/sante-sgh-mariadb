import { describe, expect, it } from 'vitest';
import {
  classificarData,
  esquemaDataLegada,
  formatarDataCalendario,
  lerDataDigitada,
} from './data-legada.js';
import { falhaDe } from '../validacao/erro.js';

describe('data: anos 0 a 99 e código de validação', () => {
  it('ano 0005 é data real fora da faixa, não malformada (Date.UTC trataria como 1905)', () => {
    expect(classificarData('0005-01-01')).toEqual({ tipo: 'fora-da-faixa', ano: 5, mes: 1, dia: 1 });
    expect(classificarData('0099-12-31')).toEqual({ tipo: 'fora-da-faixa', ano: 99, mes: 12, dia: 31 });
    expect(classificarData('0005-02-30')).toEqual({ tipo: 'malformada', bruto: '0005-02-30' });
  });

  it('o erro de digitação carrega código e parâmetros para a tela traduzir', () => {
    const codigo = (e: string) => {
      try {
        lerDataDigitada(e);
        return null;
      } catch (erro) {
        return falhaDe(erro);
      }
    };
    expect(codigo('x')).toEqual({ codigo: 'data.formato', parametros: { entrada: 'x' } });
    expect(codigo('31/02/2026')?.codigo).toBe('data.inexistente');
    expect(codigo('01/01/5202')).toEqual({
      codigo: 'data.fora-da-faixa',
      parametros: { entrada: '01/01/5202', menorAno: 1900, maiorAno: 2100 },
    });
  });
});

describe('data no contrato', () => {
  it('vazio trafega como null (o adaptador grava 1899-12-30)', () => {
    expect(esquemaDataLegada.parse(null)).toBeNull();
    expect(classificarData(null)).toEqual({ tipo: 'vazia' });
    expect(classificarData('')).toEqual({ tipo: 'vazia' });
    expect(lerDataDigitada('  ')).toBeNull();
  });

  it('ano fora da faixa de sanidade é classificado, nunca corrigido', () => {
    expect(classificarData('5202-03-01')).toEqual({ tipo: 'fora-da-faixa', ano: 5202, mes: 3, dia: 1 });
    expect(classificarData('1899-12-30').tipo).toBe('fora-da-faixa');
    expect(classificarData('2026-10-19').tipo).toBe('valida');
  });

  it('data inexistente é malformada', () => {
    expect(classificarData('2026-02-30').tipo).toBe('malformada');
    expect(classificarData('19/10/2026').tipo).toBe('malformada');
  });

  it('formata dd/mm/aaaa e lê o digitado', () => {
    expect(formatarDataCalendario({ ano: 2026, mes: 1, dia: 5 })).toBe('05/01/2026');
    expect(lerDataDigitada('5/1/2026')).toBe('2026-01-05');
    expect(() => lerDataDigitada('31/02/2026')).toThrow(/inexistente/);
    expect(() => lerDataDigitada('01/01/5202')).toThrow(/fora da faixa/);
    expect(() => lerDataDigitada('2026-01-05')).toThrow(/dd\/mm\/aaaa/);
  });
});
