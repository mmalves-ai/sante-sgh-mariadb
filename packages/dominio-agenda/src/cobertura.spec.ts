// Regra 7: cobertura de convênio por agenda (porta dos casos de regra de test/cobertura-convenio.test.js).
import { describe, expect, it } from 'vitest';
import { alternativas, avaliarCobertura, CONVENIO_PARTICULAR, impactoDaRemocao } from './cobertura.js';

describe('cobertura por agenda', () => {
  it('convênio na lista da agenda passa', () => {
    expect(avaliarCobertura([306, 10], 306)).toEqual({ configurada: true, aceito: true });
  });
  it('convênio fora da lista é recusado', () => {
    expect(avaliarCobertura([306, 10], 308)).toEqual({ configurada: true, aceito: false });
  });
  it('agenda SEM lista aceita todos — ausência não é recusa', () => {
    expect(avaliarCobertura([], 999)).toEqual({ configurada: false, aceito: true });
  });
  it('alternativas: mesmo procedimento (antes do hífen, espaçamento irregular), outro profissional, que aceita', () => {
    const agendas = [
      { nome: 'CARDIOLOGIA - DR A', aceitos: [306], vigente: true },
      { nome: 'CARDIOLOGIA- DR B', aceitos: [308], vigente: true },
      { nome: 'CARDIOLOGIA -DR C', aceitos: [], vigente: true },
      { nome: 'CARDIOLOGIA - DR D', aceitos: [308], vigente: false },
      { nome: 'ORTOPEDIA - DR E', aceitos: [308], vigente: true },
    ];
    expect(alternativas(agendas, 'CARDIOLOGIA - DR A', 308)).toEqual([
      'CARDIOLOGIA -DR C',
      'CARDIOLOGIA- DR B',
    ]);
  });
  it('sem alternativa: lista vazia de propósito', () => {
    expect(
      alternativas([{ nome: 'ORTOPEDIA - X', aceitos: [10], vigente: true }], 'ORTOPEDIA - Y', 356),
    ).toEqual([]);
    expect(alternativas([], '', 1)).toEqual([]);
  });
  it('remover a última linha inverte o efeito (passa a aceitar todos); remover o particular avisa', () => {
    expect(impactoDaRemocao([306], 306)).toEqual({ passaAAceitarTodos: true, removeParticular: false });
    expect(impactoDaRemocao([306, 10], CONVENIO_PARTICULAR)).toEqual({
      passaAAceitarTodos: false,
      removeParticular: true,
    });
    expect(impactoDaRemocao([306], 999).passaAAceitarTodos).toBe(false);
  });
});
