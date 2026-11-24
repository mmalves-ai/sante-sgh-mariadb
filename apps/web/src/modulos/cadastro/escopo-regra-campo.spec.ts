import { describe, expect, it } from 'vitest';
import { consultaDoEscopo, escopoDaRota } from './escopo-regra-campo.js';

describe('escopo da regra de campo na ficha do paciente (F3.1, 02-CAD linha 2)', () => {
  it('lê módulo, tipo de atendimento e fonte pagadora da rota e monta a consulta do POST/PUT', () => {
    const e = escopoDaRota({ modulo: '3', tipoAtendimento: 'internacao', fontePagadora: ['77', '8'] });
    expect(e).toEqual({ modulo: 3, tipoAtendimento: 'internacao', fontePagadora: 77 });
    expect(consultaDoEscopo(e)).toBe('?modulo=3&tipoAtendimento=internacao&fontePagadora=77');
  });

  it('valor inválido ou ausente fica de fora: vale a regra geral, como no servidor', () => {
    const e = escopoDaRota({ modulo: '0', tipoAtendimento: 'todos', fontePagadora: 'x1', preCadastro: '9' });
    expect(e).toEqual({ modulo: null, tipoAtendimento: null, fontePagadora: null });
    expect(consultaDoEscopo(e)).toBe('');
    expect(consultaDoEscopo(escopoDaRota({ tipoAtendimento: 'urgencia' }))).toBe('?tipoAtendimento=urgencia');
    expect(consultaDoEscopo(null)).toBe('');
    expect(escopoDaRota({ modulo: '-2', fontePagadora: '1234567890123456' }).fontePagadora).toBeNull();
  });
});
