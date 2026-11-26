// A regra da limpeza pedida pela alta: terminal sempre; a precaução do leito vence a do isolamento; o isolamento com
// tipo fora da lista de precauções da tela vale como contato; com precaução, a prioridade sobe.
import { describe, expect, it } from 'vitest';
import { limpezaDaAlta } from './limpeza-da-alta.js';
import { altaMedicaDaLinha, MEDICO_ALTA_NAO_REGISTRADO, medicoDaAlta } from './porta-propria.js';

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
    expect(limpezaDaAlta({ precaucaoAberta: null, isolamento: { codigo: 'goticulas' } }).precaucao).toBe(
      'goticulas',
    );
    expect(limpezaDaAlta({ precaucaoAberta: 'qualquer', isolamento: { codigo: 'CCIH-X' } }).precaucao).toBe(
      'contato',
    );
  });
});

// A alta médica migrada sem médico informado na origem (alta_medica.profissional_id nulo só com origem='migracao'):
// a porta a devolve com o vínculo nulo (nunca o médico 0) e a tela da internação mostra o rótulo, nunca o vazio.
describe('alta médica migrada sem médico', () => {
  it('o vínculo do médico fica nulo; a alta nova traz o vínculo', () => {
    const linha = {
      id: 9,
      profissional_id: null,
      motivo_saida_hospitalar_id: 3,
      destino: null,
      alta_medica_em: null,
    };
    expect(altaMedicaDaLinha(linha)).toMatchObject({ id: 9, vinculo: null, motivo: 3, decididaEm: '' });
    expect(altaMedicaDaLinha({ ...linha, profissional_id: 41 }).vinculo).toBe(41);
  });

  it('o médico da alta na tela: o nome, ou o rótulo da alta migrada sem médico', () => {
    expect(medicoDaAlta(null)).toBe(MEDICO_ALTA_NAO_REGISTRADO);
    expect(medicoDaAlta(undefined)).toBe('médico da alta não registrado na origem');
    expect(medicoDaAlta('')).toBe(MEDICO_ALTA_NAO_REGISTRADO);
    expect(medicoDaAlta('Dra. Sintética')).toBe('Dra. Sintética');
  });
});
