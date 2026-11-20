import { describe, expect, it } from 'vitest';
import {
  caminhoDaOpcao,
  descendentes,
  type OpcaoMenu,
  reconstruirArvoreOpcoes,
} from './reconstrucao-arvore.js';

const o = (
  id: number,
  modulo: number,
  indice: number,
  nivel: number,
  titulo: string,
  ativo = true,
): OpcaoMenu => ({
  id,
  modulo,
  indice,
  nivel,
  titulo,
  ativo,
});

describe('árvore de TBOPCOES sem chave de pai (regra 5)', () => {
  it('o pai é a última anterior do mesmo módulo com nível − 1, na ordem de INDICE', () => {
    const a = reconstruirArvoreOpcoes([
      o(10, 1, 0, 0, 'Raiz'),
      o(12, 1, 2, 2, 'Incluir'),
      o(11, 1, 1, 1, 'Tabelas'),
      o(13, 1, 3, 2, 'Alterar'),
      o(14, 1, 4, 1, 'Relatórios'),
      o(15, 1, 5, 2, 'Mensal', false),
      o(20, 2, 0, 0, 'Outro módulo'),
      o(21, 2, 1, 1, 'Item'),
    ]);
    expect(a.nos.get(11)?.pai).toBe(10);
    expect(a.nos.get(12)?.pai).toBe(11);
    expect(a.nos.get(13)?.pai).toBe(11);
    expect(a.nos.get(14)?.pai).toBe(10);
    expect(a.nos.get(15)?.pai).toBe(14);
    expect(a.nos.get(15)?.ativo).toBe(false);
    expect(a.nos.get(21)?.pai).toBe(20);
    expect(a.nos.get(11)?.filhos).toEqual([12, 13]);
    expect(a.raizes.get(1)).toEqual([10]);
    expect(a.avisos).toEqual([]);
    expect(caminhoDaOpcao(a, 13)).toEqual(['Raiz', 'Tabelas', 'Alterar']);
    expect(descendentes(a, 10).sort()).toEqual([11, 12, 13, 14, 15]);
    expect(descendentes(a, 999)).toEqual([]);
    expect(caminhoDaOpcao(a, 999)).toEqual([]);
  });

  it('salto de nível vira aviso e a opção fica sem pai (nunca adivinhado)', () => {
    const a = reconstruirArvoreOpcoes([
      o(1, 5, 0, 0, 'Raiz'),
      o(2, 5, 1, 1, 'Grupo'),
      o(3, 5, 2, 3, 'Neto pulado'),
      o(4, 5, 3, 2, 'Filho de Grupo'),
      o(5, 5, 4, 2, 'Outro filho'),
    ]);
    expect(a.nos.get(3)?.pai).toBeNull();
    expect(a.nos.get(3)?.salto).toBe(true);
    expect(a.avisos).toEqual([{ opcao: 3, modulo: 5, nivel: 3, nivelAnterior: 1 }]);
    expect(a.raizes.get(5)).toEqual([1, 3]);
    // Depois do salto, o nível 2 volta a ter o pai certo (o nível 1 da pilha continua "Grupo").
    expect(a.nos.get(4)?.pai).toBe(2);
    expect(a.nos.get(5)?.pai).toBe(2);
  });

  it('primeira opção do módulo em nível > 0 também é aviso', () => {
    const a = reconstruirArvoreOpcoes([o(7, 9, 0, 1, 'Solta')]);
    expect(a.nos.get(7)?.pai).toBeNull();
    expect(a.avisos).toEqual([{ opcao: 7, modulo: 9, nivel: 1, nivelAnterior: null }]);
  });
});
