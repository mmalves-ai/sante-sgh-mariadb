import { describe, expect, it } from 'vitest';
import {
  iniciaisDaChamada,
  NOME_SIGILOSO,
  nomeDeTratamento,
  nomeNaLista,
  nomesDaPulseira,
  usaNomeSocial,
} from './identificacao.js';
import { mostraNome } from './painel.js';

const civil = 'Joao Carlos da Silva';
const social = 'Joana Silva';

describe('nome social e sigiloso na recepção (W1-04)', () => {
  it('o nome social vence o civil no tratamento, nas iniciais e na lista', () => {
    const i = { nome: civil, nomeSocial: social };
    expect(nomeDeTratamento(i)).toBe(social);
    expect(usaNomeSocial(i)).toBe(true);
    expect(iniciaisDaChamada(i)).toBe('J. S.');
    expect(nomeNaLista(i)).toBe('J*** S***');
  });

  it('sem nome social (ou em branco) segue o civil', () => {
    const i = { nome: civil, nomeSocial: '   ' };
    expect(nomeDeTratamento(i)).toBe(civil);
    expect(usaNomeSocial(i)).toBe(false);
    expect(iniciaisDaChamada(i)).toBe('J. C. S.');
    expect(nomeNaLista({ nome: '' })).toBe('—');
  });

  it('o sigiloso sai mascarado: sem iniciais, sem nome, nem o social', () => {
    const i = { nome: civil, nomeSocial: social, sigiloso: true };
    expect(nomeDeTratamento(i)).toBeNull();
    expect(usaNomeSocial(i)).toBe(false);
    expect(iniciaisDaChamada(i)).toBeNull();
    expect(nomeNaLista(i)).toBe(NOME_SIGILOSO);
    expect(mostraNome(nomeNaLista(i), civil)).toBe(false);
    expect(mostraNome(nomeNaLista(i), social)).toBe(false);
  });

  it('pulseira: social em destaque e civil abaixo; sem social, só o civil (o sigilo não a esconde)', () => {
    expect(nomesDaPulseira({ nome: civil, nomeSocial: social, sigiloso: true })).toEqual({
      principal: social,
      civil,
    });
    expect(nomesDaPulseira({ nome: civil, nomeSocial: null })).toEqual({ principal: civil, civil: null });
    expect(nomesDaPulseira({ nome: civil, nomeSocial: civil.toUpperCase() })).toEqual({
      principal: civil,
      civil: null,
    });
  });
});
