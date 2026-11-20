import { describe, expect, it } from 'vitest';
import {
  chamadasEntreRetratos,
  falaChamada,
  iniciais,
  juntarChamadas,
  mostraNome,
  textoSenha,
} from './painel.js';

describe('senha e painel (regras 6 e 7)', () => {
  it('texto da senha: letra + 3 dígitos', () => {
    expect(textoSenha('mc', 12)).toBe('MC 012');
    expect(textoSenha('HGP', 1234)).toBe('HGP 1234');
    expect(textoSenha('', 7)).toBe('007');
    expect(textoSenha(null, -3)).toBe('000');
  });

  it('iniciais sem partículas, no máximo 4, nunca uma palavra inteira', () => {
    expect(iniciais('Maria da Silva Souza')).toBe('M. S. S.');
    expect(iniciais('JOSÉ')).toBe('J.');
    expect(iniciais('Ana Beatriz Carla Dias Elias')).toBe('A. B. C. D.');
    expect(iniciais('  ')).toBeNull();
    expect(iniciais(null)).toBeNull();
  });

  it('o painel não mostra palavra do nome', () => {
    expect(mostraNome('MC 012 · CONSULTORIO 01 · M. S.', 'Maria da Silva')).toBe(false);
    expect(mostraNome('MC 012 · MARIA', 'Maria da Silva')).toBe(true);
    expect(mostraNome('Senha · Silva', 'Maria da Silva')).toBe(true);
  });

  it('fala: a letra soletrada, o número e o guichê ou o local', () => {
    expect(falaChamada({ texto: 'MC 012', destino: 'AMBULATORIO', guiche: 3 })).toBe(
      'Senha M C 12, guichê 3',
    );
    expect(falaChamada({ texto: 'EX 101', destino: 'Consultório 01', guiche: 0 })).toBe(
      'Senha E X 101, Consultório 01',
    );
    expect(falaChamada({ texto: '007', destino: 'Sala', guiche: 0 })).toBe('Senha 7, Sala');
  });

  it('juntar chamadas: sem repetir, a mais recente primeiro, no teto', () => {
    const a = [{ chave: '1:1', em: '2026-10-21T08:00:00' }];
    const n = [
      { chave: '2:1', em: '2026-10-21T08:05:00' },
      { chave: '1:1', em: '2026-10-21T08:00:00' },
      { chave: '3:1', em: '2026-10-21T08:03:00' },
    ];
    expect(juntarChamadas(a, n, 2).map((c) => c.chave)).toEqual(['2:1', '3:1']);
    expect(juntarChamadas(a, [], 0)).toEqual([]);
  });

  it('chamadas entre retratos: guichê que passou a um número e C novo no fluxo', () => {
    const antes = new Map([
      [1, { id: 1, guiche: 0, situacao: 'G', chamadasNoFluxo: 0 }],
      [2, { id: 2, guiche: 3, situacao: 'G', chamadasNoFluxo: 0 }],
      [3, { id: 3, guiche: 4, situacao: 'G', chamadasNoFluxo: 1 }],
    ]);
    const depois = [
      { id: 1, guiche: 2, situacao: 'G', chamadasNoFluxo: 0 },
      { id: 2, guiche: 3, situacao: 'G', chamadasNoFluxo: 0 },
      { id: 3, guiche: 4, situacao: 'G', chamadasNoFluxo: 2 },
      { id: 4, guiche: 5, situacao: 'G', chamadasNoFluxo: 0 },
      { id: 2, guiche: 0, situacao: 'S', chamadasNoFluxo: 0 },
    ];
    expect(chamadasEntreRetratos(antes, depois)).toEqual([
      { id: 1, contagem: 1 },
      { id: 3, contagem: 3 },
    ]);
  });
});
