// Regra 5 (ficha do M26): a faixa vigente no dia do exame, por sexo e idade, pela versão do valor de referência.
import { describe, expect, it } from 'vitest';
import {
  faixaDoPaciente,
  foraDaReferencia,
  limitesDoTexto,
  referenciaDoDia,
  type VersaoReferencia,
  versaoVigente,
} from './versao.js';

const v = (id: number, gravadaEm: string, texto: string): VersaoReferencia => ({
  id,
  gravadaEm,
  texto,
  minimo: null,
  maximo: null,
  unidade: 'mg/dL',
});
const historico = [
  v(1, '2024-01-10T10:00:00.000Z', '70 a 99'),
  v(2, '2025-06-01T08:00:00.000Z', '70 a 100'),
  v(3, '2026-03-15T09:00:00.000Z', '65 a 99'),
];

describe('versão vigente no dia do exame (regra 5)', () => {
  it('a última gravada até o fim do dia do exame', () => {
    expect(versaoVigente(historico, '2025-12-31')?.id).toBe(2);
    expect(versaoVigente(historico, '2026-03-15')?.id).toBe(3);
    expect(versaoVigente(historico, '2023-12-31')).toBeNull();
    expect(
      versaoVigente(
        [v(5, '2025-01-01T00:00:00.000Z', 'a'), v(4, '2025-01-01T00:00:00.000Z', 'b')],
        '2025-02-01',
      )?.id,
    ).toBe(5);
  });

  it('a versão já usada pelo resultado gravado vale sempre', () => {
    const r = referenciaDoDia({
      dataExame: '2026-10-01',
      usadaNoResultado: 1,
      historicoElemento: historico,
      historicoExame: [],
      cadastro: null,
    });
    expect(r).toMatchObject({ fonte: 'historicoElemento', versaoId: 1, texto: '70 a 99' });
  });

  it('sem versão do elemento, a do exame; depois o cadastro; depois nenhuma', () => {
    expect(
      referenciaDoDia({
        dataExame: '2026-10-01',
        usadaNoResultado: 99,
        historicoElemento: [],
        historicoExame: historico,
        cadastro: null,
      }),
    ).toMatchObject({ fonte: 'historicoExame', versaoId: 3 });
    expect(
      referenciaDoDia({
        dataExame: '2020-01-01',
        historicoElemento: historico,
        historicoExame: [],
        cadastro: { texto: '60 a 110', minimo: 60, maximo: 110, unidade: 'mg/dL' },
      }),
    ).toMatchObject({ fonte: 'cadastro', minimo: 60 });
    expect(
      referenciaDoDia({
        dataExame: '2020-01-01',
        historicoElemento: [],
        historicoExame: [],
        cadastro: { texto: null, minimo: null, maximo: null, unidade: null },
      }).fonte,
    ).toBe('nenhuma');
    expect(
      referenciaDoDia({ dataExame: '2020-01-01', historicoElemento: [], historicoExame: [], cadastro: null })
        .fonte,
    ).toBe('nenhuma');
  });

  it('limites do texto livre', () => {
    expect(limitesDoTexto('12,0 a 16,0 g/dL')).toEqual({ minimo: 12, maximo: 16 });
    expect(limitesDoTexto('< 5')).toEqual({ minimo: null, maximo: 5 });
    expect(limitesDoTexto('até 200')).toEqual({ minimo: null, maximo: 200 });
    expect(limitesDoTexto('> 40')).toEqual({ minimo: 40, maximo: null });
    expect(limitesDoTexto('Negativo')).toBeNull();
    expect(limitesDoTexto(null)).toBeNull();
  });

  it('a linha do sexo e da faixa etária do paciente', () => {
    const t = 'Homens: 13,0 a 17,0\nMulheres: 12,0 a 16,0';
    expect(faixaDoPaciente(t, { sexo: 'F', idadeAnos: 30 })).toEqual({
      texto: 'Mulheres: 12,0 a 16,0',
      minimo: 12,
      maximo: 16,
    });
    expect(faixaDoPaciente(t, { sexo: 'M', idadeAnos: 30 }).minimo).toBe(13);
    const idade = '0 a 12 anos: 5 a 10 / 13 a 120 anos: 7 a 12';
    expect(faixaDoPaciente(idade, { sexo: null, idadeAnos: 40 })).toMatchObject({ minimo: 7, maximo: 12 });
    expect(faixaDoPaciente('70 a 99', { sexo: 'M', idadeAnos: null })).toEqual({
      texto: '70 a 99',
      minimo: 70,
      maximo: 99,
    });
    expect(faixaDoPaciente(null, { sexo: 'M', idadeAnos: 1 })).toEqual({
      texto: null,
      minimo: null,
      maximo: null,
    });
  });

  it('fora da referência', () => {
    expect(foraDaReferencia(5, { minimo: 7, maximo: 12 })).toBe('abaixo');
    expect(foraDaReferencia(13, { minimo: 7, maximo: 12 })).toBe('acima');
    expect(foraDaReferencia(8, { minimo: 7, maximo: 12 })).toBeNull();
    expect(foraDaReferencia(null, { minimo: 7, maximo: 12 })).toBeNull();
  });
});
