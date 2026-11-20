import { describe, expect, it } from 'vitest';
import {
  chavesDoNome,
  entraNaFila,
  escoreDuplicidade,
  LIMIAR_FILA,
  ordemDaFila,
  parOrdenado,
  type CadastroComparavel,
} from './escore.js';

const base: CadastroComparavel = {
  id: 1,
  nome: 'MARIA APARECIDA DOS SANTOS',
  nascimento: '1970-05-10',
  mae: 'JOANA DOS SANTOS',
  cpf: '90000000175',
  telefones: ['31987654321'],
};

describe('escore de duplicidade (regra 6)', () => {
  it('mesmo CPF válido, nome fonético, nascimento, mãe e telefone: 100 (teto)', () => {
    const e = escoreDuplicidade(base, { ...base, id: 2, nome: 'MARIA APARECIDA DOS SANTTOS' });
    expect(e.escore).toBe(100);
    expect(e.criterios).toEqual(['cpf', 'fonetica', 'nascimento', 'mae', 'telefone']);
    expect(entraNaFila(e)).toBe(true);
  });
  it('CPF igual sempre entra; CPF inválido não conta', () => {
    const outro = { ...base, id: 2, nome: 'OUTRO NOME QUALQUER', nascimento: null, mae: null, telefones: [] };
    expect(entraNaFila(escoreDuplicidade(base, outro))).toBe(true);
    const invalido = escoreDuplicidade({ ...base, cpf: '11111111111' }, { ...outro, cpf: '11111111111' });
    expect(invalido.criterios).not.toContain('cpf');
  });
  it('homônimo com nascimento e mãe iguais entra; só o nome não basta', () => {
    const a = { ...base, cpf: null, telefones: [] };
    const b = { ...a, id: 2 };
    expect(escoreDuplicidade(a, b).escore).toBe(65);
    const soNome = escoreDuplicidade(a, { ...b, nascimento: '1980-01-01', mae: 'OUTRA MAE' });
    expect(soNome.escore).toBe(30);
    expect(entraNaFila(soNome)).toBe(false);
    expect(LIMIAR_FILA).toBe(50);
  });
  it('primeiro e último nome iguais valem metade; nomes vazios não contam', () => {
    const a = { ...base, cpf: null, telefones: [], nascimento: null, mae: null };
    const e = escoreDuplicidade(a, { ...a, id: 2, nome: 'MARIA DE FATIMA SANTOS' });
    expect(e.escore).toBe(15);
    expect(escoreDuplicidade({ ...a, nome: null }, a).criterios).toEqual([]);
    expect(chavesDoNome('ANA DA SILVA')).toEqual(['ANA', 'SIUVA']);
  });
  it('ordem da fila: CPF primeiro, depois escore; par sempre com o menor ID primeiro', () => {
    const fila = ordemDaFila([
      { a: 5, b: 9, escore: 80, criterios: ['fonetica', 'nascimento', 'mae'] as const },
      { a: 3, b: 4, escore: 60, criterios: ['cpf'] as const },
      { a: 1, b: 2, escore: 80, criterios: ['fonetica', 'nascimento', 'mae'] as const },
    ]);
    expect(fila.map((p) => p.a)).toEqual([3, 1, 5]);
    expect(parOrdenado(9, 4)).toEqual([4, 9]);
    expect(parOrdenado(4, 9)).toEqual([4, 9]);
  });
});
