import { describe, expect, it } from 'vitest';
import { conveniosDaTabela, tabelaCompartilhada } from './impacto.js';

const conv = [
  {
    codigo: 1,
    nome: 'SUS SINTÉTICO',
    ativo: true,
    honorariosInternacao: 1,
    honorariosExterna: 10,
    diarias: 5,
    matmed: 7,
  },
  {
    codigo: 10,
    nome: 'PARTICULAR SINTÉTICO',
    ativo: true,
    honorariosInternacao: 10,
    honorariosExterna: 10,
    diarias: 5,
    matmed: 8,
  },
  { codigo: 50, nome: 'INATIVO SINTÉTICO', ativo: false, honorariosInternacao: 305, honorariosExterna: 305 },
  { codigo: 51, nome: 'OPERADORA SINTÉTICA', ativo: true, honorariosInternacao: 305, honorariosExterna: 306 },
];

describe('impacto em mais de um convênio (regra 5)', () => {
  it('lista os convênios que usam a tabela e em qual conta', () => {
    const u = conveniosDaTabela(10, conv);
    expect(u.map((x) => [x.codigo, x.usos])).toEqual([
      [1, ['externa']],
      [10, ['internacao', 'externa']],
    ]);
    expect(conveniosDaTabela(5, conv, 'diarias').map((x) => x.codigo)).toEqual([1, 10]);
    expect(conveniosDaTabela(8, conv, 'matmed').map((x) => x.codigo)).toEqual([10]);
  });
  it('tabela 10 ou com mais de um convênio ativo é compartilhada', () => {
    expect(tabelaCompartilhada(10, conveniosDaTabela(10, conv))).toBe(true);
    // 305: um ativo e um inativo → não compartilhada
    expect(tabelaCompartilhada(305, conveniosDaTabela(305, conv))).toBe(false);
    expect(tabelaCompartilhada(306, conveniosDaTabela(306, conv))).toBe(false);
  });
});
