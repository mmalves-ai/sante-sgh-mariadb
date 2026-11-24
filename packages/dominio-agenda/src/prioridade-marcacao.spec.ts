// 02-AGE linha 49: prioridade legal na marcação.
import { describe, expect, it } from 'vitest';
import {
  type GrupoPrioridadeCadastro,
  ordenarEncaixes,
  prioridadeNaMarcacao,
} from './prioridade-marcacao.js';

const G: GrupoPrioridadeCadastro[] = [
  { id: 10, descricao: 'Acima de 80 anos', ativo: true, peso: 1, idadeMinima: 80 },
  { id: 11, descricao: '60 anos ou mais', ativo: true, peso: 2, idadeMinima: 60 },
  { id: 12, descricao: 'Gestante', ativo: true, peso: 2, idadeMinima: null },
  { id: 13, descricao: 'Pessoa com deficiência', ativo: true, peso: 2, idadeMinima: null },
  { id: 14, descricao: 'Grupo desativado', ativo: false, peso: 1, idadeMinima: null },
];
const DATA = '2030-03-12';

describe('prioridadeNaMarcacao', () => {
  it('sem grupo informado, sem cadastro e adulto jovem: sem prioridade', () => {
    expect(prioridadeNaMarcacao(G, { data: DATA, nascimento: '1990-01-01' })).toEqual({
      ok: true,
      grupo: null,
      origem: null,
    });
  });

  it('a idade sugere o grupo mais específico (acima de 80 vence 60 ou mais)', () => {
    expect(prioridadeNaMarcacao(G, { data: DATA, nascimento: '1965-03-12' })).toMatchObject({
      grupo: 11,
      origem: 'idade',
    });
    expect(prioridadeNaMarcacao(G, { data: DATA, nascimento: '1950-03-12' })).toMatchObject({
      grupo: 10,
      origem: 'idade',
    });
    // Véspera do aniversário de 60: ainda sem prioridade.
    expect(prioridadeNaMarcacao(G, { data: DATA, nascimento: '1970-03-13' })).toMatchObject({ grupo: null });
  });

  it('o cadastro do paciente sugere o grupo vigente na data da marcação', () => {
    const doPaciente = [{ grupo: 12, vigenciaInicio: '2030-01-01', vigenciaFim: '2030-09-30' }];
    expect(prioridadeNaMarcacao(G, { data: DATA, doPaciente })).toMatchObject({
      grupo: 12,
      origem: 'cadastro',
    });
    expect(prioridadeNaMarcacao(G, { data: '2030-10-01', doPaciente })).toMatchObject({ grupo: null });
  });

  it('o informado vale no empate; a idade acima de 80 não é tirada pela recepção', () => {
    expect(prioridadeNaMarcacao(G, { data: DATA, informada: 13, nascimento: '1965-01-01' })).toMatchObject({
      grupo: 13,
      origem: 'informada',
    });
    expect(prioridadeNaMarcacao(G, { data: DATA, informada: 13, nascimento: '1940-01-01' })).toMatchObject({
      grupo: 10,
      origem: 'idade',
    });
    expect(prioridadeNaMarcacao(G, { data: DATA, informada: null, nascimento: '1940-01-01' })).toMatchObject({
      grupo: 10,
    });
  });

  it('grupo informado inexistente ou inativo é recusado', () => {
    expect(prioridadeNaMarcacao(G, { data: DATA, informada: 14 })).toMatchObject({
      ok: false,
      codigo: 'prioridade-invalida',
    });
    expect(prioridadeNaMarcacao(G, { data: DATA, informada: 99 })).toMatchObject({ ok: false });
  });
});

describe('ordenarEncaixes', () => {
  it('prioritário antes; entre iguais, a ordem do encaixe', () => {
    const r = ordenarEncaixes([
      { id: 'a', pesoPrioridade: null, ordem: 1 },
      { id: 'b', pesoPrioridade: 2, ordem: 3 },
      { id: 'c', pesoPrioridade: 1, ordem: 4 },
      { id: 'd', pesoPrioridade: 2, ordem: 2 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
