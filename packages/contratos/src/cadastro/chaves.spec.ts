// Contrato das linhas de SGH_BUSCA_NOME (M11, regra 5): o que o executor grava é o que a busca procura.
import { describe, expect, it } from 'vitest';
import { chavesDeBusca, chaveTelefone, palavrasDoCadastro, palavrasDoTermo } from './chaves.js';

describe('chaves de busca', () => {
  it('uma linha por palavra distinta de cada nome e por telefone distinto (8 últimos dígitos)', () => {
    const c = chavesDeBusca({
      nome: 'José da Silva José',
      social: null,
      mae: 'Ana Silva',
      telefones: ['(31) 98765-4321', '3198765-4321', '123', null],
    });
    expect(c).toEqual([
      { campo: 'nome', palavra: 'JOSE', fonetica: 'JOSE' },
      { campo: 'nome', palavra: 'DA', fonetica: 'DA' },
      { campo: 'nome', palavra: 'SILVA', fonetica: 'SIUVA' },
      { campo: 'mae', palavra: 'ANA', fonetica: 'ANA' },
      { campo: 'mae', palavra: 'SILVA', fonetica: 'SIUVA' },
      { campo: 'telefone', palavra: '87654321', fonetica: null },
    ]);
  });
  it('palavra cortada em 40; termo sem títulos; telefone curto não vira chave', () => {
    const longa = 'A'.repeat(55);
    expect(chavesDeBusca({ nome: longa })[0]?.palavra).toHaveLength(40);
    expect(palavrasDoTermo('Dr(a). Helio N. Novais')).toEqual(['HELIO', 'N', 'NOVAIS']);
    expect(palavrasDoCadastro(null)).toEqual([]);
    expect(chaveTelefone('9876-543')).toBeNull();
    expect(chavesDeBusca({})).toEqual([]);
  });
});
