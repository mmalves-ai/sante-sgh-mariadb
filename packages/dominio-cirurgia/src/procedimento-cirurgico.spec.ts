// Regras do cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91).
import { describe, expect, it } from 'vitest';
import {
  duracaoSugeridaProcedimento,
  normalizarCodigoProcedimento,
  validarProcedimentoCirurgico,
} from './procedimento-cirurgico.js';

const base = {
  codigo: 'cc-001',
  descricao: 'Colecistectomia por vídeo',
  natureza: 'terapeutica',
  grupo: 1,
  porte: 2,
  especialidade: 3,
  carater: null,
  duracaoMediaMinutos: 90,
  tempoPreparoSalaMinutos: 20,
};
const campos = (x: Parameters<typeof validarProcedimentoCirurgico>[0]) =>
  validarProcedimentoCirurgico(x).map((p) => p.campo);

describe('cadastro do procedimento cirúrgico', () => {
  it('aceita o cadastro completo; o código grava sem espaços nas pontas e em maiúsculas', () => {
    expect(validarProcedimentoCirurgico(base)).toEqual([]);
    expect(normalizarCodigoProcedimento('  cc-001 ')).toBe('CC-001');
    expect(validarProcedimentoCirurgico({ ...base, grupo: null, mnemonico: 'COLECVID' })).toEqual([]);
  });

  it('recusa código vazio, longo ou com espaço, descrição curta e abreviação longa', () => {
    expect(campos({ ...base, codigo: '  ' })).toEqual(['codigo']);
    expect(campos({ ...base, codigo: 'A'.repeat(31) })).toEqual(['codigo']);
    expect(campos({ ...base, codigo: 'CC 001' })).toEqual(['codigo']);
    expect(campos({ ...base, descricao: 'ab' })).toEqual(['descricao']);
    expect(campos({ ...base, descricao: 'x'.repeat(151) })).toEqual(['descricao']);
    expect(campos({ ...base, mnemonico: 'x'.repeat(16) })).toEqual(['mnemonico']);
  });

  it('exige natureza válida, porte e especialidade', () => {
    expect(campos({ ...base, natureza: 'paliativa' })).toEqual(['natureza']);
    expect(campos({ ...base, porte: null, especialidade: null })).toEqual(['porte', 'especialidade']);
  });

  it('limita a duração média e o preparo da sala; obstétrico e hemodinâmica não andam juntos', () => {
    expect(campos({ ...base, duracaoMediaMinutos: 0 })).toEqual(['duracaoMediaMinutos']);
    expect(campos({ ...base, duracaoMediaMinutos: 1441 })).toEqual(['duracaoMediaMinutos']);
    expect(campos({ ...base, duracaoMediaMinutos: 12.5 })).toEqual(['duracaoMediaMinutos']);
    expect(campos({ ...base, duracaoMediaMinutos: null, tempoPreparoSalaMinutos: 0 })).toEqual([]);
    expect(campos({ ...base, tempoPreparoSalaMinutos: 241 })).toEqual(['tempoPreparoSalaMinutos']);
    expect(campos({ ...base, obstetrico: true, hemodinamica: true })).toEqual(['hemodinamica']);
    expect(campos({ ...base, obstetrico: true })).toEqual([]);
  });

  it('sugere a duração do procedimento e, sem ela, a de referência do porte', () => {
    expect(duracaoSugeridaProcedimento(90, 120)).toBe(90);
    expect(duracaoSugeridaProcedimento(null, 120)).toBe(120);
    expect(duracaoSugeridaProcedimento(0, null)).toBeNull();
  });
});
