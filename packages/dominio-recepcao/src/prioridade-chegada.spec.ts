import { describe, expect, it } from 'vitest';
import { grupoDaSenhaAoDesfazer, grupoDaSenhaNaChegada } from './prioridade-chegada.js';

const gestante = { id: 4, peso: 2, ativo: true };
const idoso80 = { id: 7, peso: 1, ativo: true };
const demais = { id: 9, peso: 3, ativo: true };

describe('02-AGE 49: prioridade legal da marcação na chegada', () => {
  it('a senha normal passa ao grupo da marcação', () => {
    expect(grupoDaSenhaNaChegada({ senha: null, marcacao: gestante })).toEqual({ grupo: 4, mudou: true });
  });
  it('a marcação mais forte que a senha vence; a senha mais forte ou igual fica', () => {
    expect(grupoDaSenhaNaChegada({ senha: demais, marcacao: gestante })).toEqual({ grupo: 4, mudou: true });
    expect(grupoDaSenhaNaChegada({ senha: idoso80, marcacao: gestante })).toEqual({ grupo: 7, mudou: false });
    expect(grupoDaSenhaNaChegada({ senha: { ...demais, peso: 2 }, marcacao: gestante })).toEqual({
      grupo: 9,
      mudou: false,
    });
  });
  it('sem grupo na marcação, ou grupo desativado, a senha fica como está', () => {
    expect(grupoDaSenhaNaChegada({ senha: null, marcacao: null })).toEqual({ grupo: null, mudou: false });
    expect(grupoDaSenhaNaChegada({ senha: demais, marcacao: { ...gestante, ativo: false } })).toEqual({
      grupo: 9,
      mudou: false,
    });
  });
  it('grupo da senha desativado no cadastro dá lugar ao da marcação; o mesmo grupo não muda nada', () => {
    expect(grupoDaSenhaNaChegada({ senha: { ...idoso80, ativo: false }, marcacao: gestante })).toEqual({
      grupo: 4,
      mudou: true,
    });
    expect(grupoDaSenhaNaChegada({ senha: gestante, marcacao: gestante })).toEqual({
      grupo: 4,
      mudou: false,
    });
  });
  it('desfazer devolve o grupo anterior só quando a chegada o trocou e ninguém o mudou depois', () => {
    expect(grupoDaSenhaAoDesfazer({ atual: 4, aplicadoNaChegada: 4, anteriorNaChegada: null })).toEqual({
      grupo: null,
    });
    expect(grupoDaSenhaAoDesfazer({ atual: 4, aplicadoNaChegada: 4, anteriorNaChegada: 9 })).toEqual({
      grupo: 9,
    });
    expect(grupoDaSenhaAoDesfazer({ atual: 7, aplicadoNaChegada: 4, anteriorNaChegada: null })).toBeNull();
    expect(
      grupoDaSenhaAoDesfazer({ atual: 4, aplicadoNaChegada: undefined, anteriorNaChegada: null }),
    ).toBeNull();
  });
});
