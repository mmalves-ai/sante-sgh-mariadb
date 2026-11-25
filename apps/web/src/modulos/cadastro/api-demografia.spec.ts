import { describe, expect, it } from 'vitest';
import { exigeEtnia, type GravacaoDemografia, pendenciasDemografia } from './api-demografia.js';

const op = (id: number, marca = false) => ({ id, descricao: `OPCAO ${id}`, marca });
const d = {
  nome: 'MARIA SINTETICA',
  temRepresentanteVigente: false,
  capacidadeCivil: null as number | null,
  opcoes: {
    identidadeGenero: [op(1)],
    racaCor: [op(4), op(5, true)],
    povoIndigena: [op(90)],
    escolaridade: [],
    religiao: [],
    nacionalidade: [],
    paisNascimento: [],
    capacidadeCivil: [op(10), op(11, true)],
    condicoesVulnerabilidade: [],
    informantes: ['paciente'],
  },
};
const f: GravacaoDemografia = {
  usaNomeSocial: false,
  nomeSocial: null,
  identidadeGenero: null,
  racaCor: null,
  povoIndigena: null,
  escolaridade: null,
  religiao: null,
  nacionalidade: null,
  paisNascimento: null,
  capacidadeCivil: null,
  ocupacao: null,
};

describe('pendências dos dados demográficos na tela', () => {
  it('sem nada informado, nada pende', () => {
    expect(pendenciasDemografia(f, d)).toEqual([]);
  });
  it('nome social exigido quando usado e diferente do nome civil', () => {
    expect(pendenciasDemografia({ ...f, usaNomeSocial: true }, d)).toEqual(['nomeSocial']);
    expect(pendenciasDemografia({ ...f, nomeSocial: ' maria  sintética ' }, d)).toEqual(['nomeSocialIgual']);
    expect(pendenciasDemografia({ ...f, usaNomeSocial: true, nomeSocial: 'JOANA' }, d)).toEqual([]);
  });
  it('povo indígena exigido pela raça/cor que pede etnia', () => {
    expect(exigeEtnia(5, d)).toBe(true);
    expect(exigeEtnia(4, d)).toBe(false);
    expect(pendenciasDemografia({ ...f, racaCor: 5 }, d)).toEqual(['povoIndigena']);
    expect(pendenciasDemografia({ ...f, racaCor: 5, povoIndigena: 90 }, d)).toEqual([]);
  });
  it('capacidade que exige responsável: pende sem representante; a já gravada não pende', () => {
    expect(pendenciasDemografia({ ...f, capacidadeCivil: 11 }, d)).toEqual(['capacidadeCivil']);
    expect(
      pendenciasDemografia({ ...f, capacidadeCivil: 11 }, { ...d, temRepresentanteVigente: true }),
    ).toEqual([]);
    expect(pendenciasDemografia({ ...f, capacidadeCivil: 11 }, { ...d, capacidadeCivil: 11 })).toEqual([]);
    expect(pendenciasDemografia({ ...f, capacidadeCivil: 10 }, d)).toEqual([]);
  });
});
