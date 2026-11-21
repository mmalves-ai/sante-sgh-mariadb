// A regra da limpeza pedida pela alta: terminal sempre; a precaução do leito vence a do isolamento; o isolamento com
// tipo fora da lista de precauções da tela vale como contato; com precaução, a prioridade sobe.
import { describe, expect, it } from 'vitest';
import { limpezaDaAlta } from './limpeza-da-alta.js';

describe('limpeza pedida pela alta', () => {
  it('sem precaução: terminal, prioridade normal', () => {
    expect(limpezaDaAlta({ precaucaoAberta: null, isolamento: null })).toEqual({
      tipo: 'terminal',
      motivoGeracao: 'alta',
      prioridade: 'normal',
      precaucao: null,
    });
  });
  it('a precaução aberta no leito passa ao período de higienização e sobe a prioridade', () => {
    expect(limpezaDaAlta({ precaucaoAberta: 'aerossois', isolamento: { codigo: 'contato' } })).toMatchObject({
      prioridade: 'alta',
      precaucao: 'aerossois',
    });
  });
  it('o isolamento ativo da internação vale quando o leito não tem precaução; tipo desconhecido vira contato', () => {
    expect(limpezaDaAlta({ precaucaoAberta: null, isolamento: { codigo: 'goticulas' } }).precaucao).toBe('goticulas');
    expect(limpezaDaAlta({ precaucaoAberta: 'qualquer', isolamento: { codigo: 'CCIH-X' } }).precaucao).toBe('contato');
  });
});
