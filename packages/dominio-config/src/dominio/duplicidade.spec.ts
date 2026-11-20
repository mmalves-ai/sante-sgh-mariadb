// Regra 3 do M08: código e descrição únicos entre ATIVOS depois de normalizar; 409 apontando o existente.
import { describe, expect, it } from 'vitest';
import { mensagemDuplicidade, normalizarDescricao, procurarDuplicidade } from './duplicidade.js';

const itens = [
  { codigo: '1', ativo: true, valores: { nome: 'Situação Única', sexo: 'F', cod: 1 } },
  { codigo: '2', ativo: false, valores: { nome: 'Antigo Inativo', sexo: 'F', cod: 2 } },
  { codigo: '3', ativo: true, valores: { nome: 'Outro', sexo: 'M', cod: 1 } },
];

describe('duplicidade (regra 3)', () => {
  it('normaliza acento, caixa e espaços', () => {
    expect(normalizarDescricao('  Situação   Única ')).toBe('SITUACAO UNICA');
    expect(normalizarDescricao(null)).toBe('');
    expect(normalizarDescricao(12)).toBe('12');
  });
  it('acusa a descrição repetida entre ativos, depois de normalizar', () => {
    expect(procurarDuplicidade(itens, { nome: 'situacao unica' }, [['nome']])).toEqual({
      campos: ['nome'],
      existente: '1',
    });
  });
  it('item inativo não colide; o próprio item (alteração) não colide', () => {
    expect(procurarDuplicidade(itens, { nome: 'antigo inativo' }, [['nome']])).toBeNull();
    expect(procurarDuplicidade(itens, { nome: 'Situacao Unica' }, [['nome']], '1')).toBeNull();
  });
  it('conjunto composto (código e sexo) e conjunto vazio ou com campo vazio', () => {
    expect(procurarDuplicidade(itens, { cod: 1, sexo: 'M' }, [['cod', 'sexo']])).toEqual({
      campos: ['cod', 'sexo'],
      existente: '3',
    });
    expect(procurarDuplicidade(itens, { cod: 1, sexo: 'X' }, [['cod', 'sexo']])).toBeNull();
    expect(procurarDuplicidade(itens, { nome: '' }, [['nome'], []])).toBeNull();
  });
  it('mensagem em português com o código existente', () => {
    expect(mensagemDuplicidade({ campos: ['nome'], existente: '1' }, { nome: 'Descrição' })).toMatch(
      /descrição iguais \(código 1\)/,
    );
    expect(mensagemDuplicidade({ campos: ['cod', 'sexo'], existente: '3' }, {})).toMatch(/cod e sexo/);
  });
});
