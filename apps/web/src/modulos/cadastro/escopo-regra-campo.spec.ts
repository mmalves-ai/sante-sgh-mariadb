import { describe, expect, it } from 'vitest';
import {
  consultaDeRotaDoEscopo,
  consultaDoEscopo,
  escopoDaAbertura,
  escopoDaRota,
} from './escopo-regra-campo.js';

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

  it('a tela que abre o atendimento monta o escopo pelo tipo, convênio e módulo; a ficha lê o mesmo da rota', () => {
    const e = escopoDaAbertura({ tipo: 'pa', convenio: '12', modulo: 4 });
    expect(e).toEqual({ modulo: 4, tipoAtendimento: 'urgencia', fontePagadora: 12 });
    expect(consultaDeRotaDoEscopo(e)).toEqual({
      modulo: '4',
      tipoAtendimento: 'urgencia',
      fontePagadora: '12',
    });
    expect(escopoDaRota(consultaDeRotaDoEscopo(e))).toEqual(e);
    expect(escopoDaAbertura({ tipo: 'consulta' }).tipoAtendimento).toBe('ambulatorial');
    expect(escopoDaAbertura({ tipo: 'exame' }).tipoAtendimento).toBe('externo');
    expect(escopoDaAbertura({ tipo: 'requisicaoLab' }).tipoAtendimento).toBe('externo');
    expect(escopoDaAbertura({ tipo: 'internacao', convenio: 9 })).toEqual({
      modulo: null,
      tipoAtendimento: 'internacao',
      fontePagadora: 9,
    });
  });

  it('sem tipo, sem convênio ou com valor inválido, a consulta sai vazia (vale a regra geral)', () => {
    expect(consultaDeRotaDoEscopo(escopoDaAbertura({ tipo: '', convenio: '' }))).toEqual({});
    expect(
      consultaDeRotaDoEscopo(escopoDaAbertura({ tipo: 'toString', convenio: '0', modulo: 'x' })),
    ).toEqual({});
    expect(consultaDeRotaDoEscopo(null)).toEqual({});
  });
});
