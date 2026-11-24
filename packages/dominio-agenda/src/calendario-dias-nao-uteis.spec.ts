import { describe, expect, it } from 'vitest';
import {
  dataMovel,
  datasMoveis,
  type DiaNaoUtilExistente,
  duplicadoDe,
  type EntradaDiaNaoUtil,
  errosDiaNaoUtil,
  ocorrencias,
} from './calendario-dias-nao-uteis.js';

const base: EntradaDiaNaoUtil = {
  descricao: 'Aniversário da cidade',
  abrangencia: 'municipal',
  ufId: null,
  municipio: 10,
  estabelecimento: null,
  recorrencia: 'anual',
  dia: 12,
  mes: 12,
  data: null,
  facultativo: false,
  horaInicio: null,
  horaFim: null,
};
const e = (p: Partial<EntradaDiaNaoUtil>): EntradaDiaNaoUtil => ({ ...base, ...p });
const x = (id: number, p: Partial<EntradaDiaNaoUtil>): DiaNaoUtilExistente => ({ ...base, ...p, id });

describe('errosDiaNaoUtil', () => {
  it('aceita a entrada completa', () => {
    expect(errosDiaNaoUtil(base)).toEqual([]);
  });
  it('confere o alvo pela abrangência', () => {
    expect(errosDiaNaoUtil(e({ abrangencia: 'estadual', municipio: null }))).toEqual(['uf-ausente']);
    expect(errosDiaNaoUtil(e({ municipio: null }))).toEqual(['municipio-ausente']);
    expect(errosDiaNaoUtil(e({ abrangencia: 'estabelecimento', municipio: null }))).toEqual([
      'estabelecimento-ausente',
    ]);
    expect(errosDiaNaoUtil(e({ abrangencia: 'nacional' }))).toEqual(['alvo-a-mais']);
    expect(errosDiaNaoUtil(e({ abrangencia: 'municipal', ufId: 3 }))).toEqual(['alvo-a-mais']);
  });
  it('confere a recorrência, o dia do mês e a data', () => {
    expect(errosDiaNaoUtil(e({ dia: 31, mes: 4 }))).toEqual(['dia-mes-invalido']);
    expect(errosDiaNaoUtil(e({ dia: 29, mes: 2 }))).toEqual([]);
    expect(
      errosDiaNaoUtil(e({ recorrencia: 'data_unica', dia: null, mes: null, data: '2027-02-30' })),
    ).toEqual(['data-invalida']);
    expect(errosDiaNaoUtil(e({ recorrencia: 'movel', data: '2027-03-26' }))).toEqual(['data-com-dia-mes']);
  });
  it('confere o período do dia e a descrição, tudo de uma vez', () => {
    expect(errosDiaNaoUtil(e({ descricao: ' a ', horaInicio: '12:00', horaFim: null }))).toEqual([
      'descricao-curta',
      'hora-incompleta',
    ]);
    expect(errosDiaNaoUtil(e({ horaInicio: '13:00', horaFim: '12:00' }))).toEqual(['hora-invertida']);
    expect(errosDiaNaoUtil(e({ horaInicio: '25:00', horaFim: '26:00' }))).toEqual(['hora-invalida']);
  });
});

describe('duplicadoDe', () => {
  it('acha o mesmo dia no mesmo alvo (anual e data)', () => {
    const lista = [x(1, {}), x(2, { municipio: 11 })];
    expect(duplicadoDe(lista, base)?.id).toBe(1);
    expect(
      duplicadoDe(lista, e({ recorrencia: 'data_unica', dia: null, mes: null, data: '2030-12-12' }))?.id,
    ).toBe(1);
    expect(duplicadoDe(lista, base, 1)).toBeNull();
    expect(duplicadoDe(lista, e({ municipio: 12 }))).toBeNull();
  });
  it('faixas de horas que não se cruzam convivem no mesmo dia', () => {
    const lista = [x(1, { horaInicio: '08:00', horaFim: '12:00' })];
    expect(duplicadoDe(lista, e({ horaInicio: '12:00', horaFim: '18:00' }))).toBeNull();
    expect(duplicadoDe(lista, e({ horaInicio: '11:00', horaFim: '18:00' }))?.id).toBe(1);
    expect(duplicadoDe(lista, base)?.id).toBe(1);
  });
});

describe('móveis e ocorrências', () => {
  it('calcula pela Páscoa', () => {
    expect(dataMovel('pascoa', 2027)).toBe('2027-03-28');
    expect(dataMovel('sexta_santa', 2027)).toBe('2027-03-26');
    expect(dataMovel('carnaval', 2027)).toBe('2027-02-09');
    expect(dataMovel('corpus_christi', 2027)).toBe('2027-05-27');
    expect(datasMoveis('pascoa', 2027, 2028)).toEqual(['2027-03-28', '2028-04-16']);
    expect(datasMoveis('pascoa', 2027, 2050)).toEqual([]);
  });
  it('lista as ocorrências do período; 29/02 só em ano bissexto', () => {
    expect(ocorrencias(e({ dia: 29, mes: 2 }), '2027-01-01', '2028-12-31')).toEqual(['2028-02-29']);
    expect(ocorrencias(base, '2027-12-13', '2028-12-12')).toEqual(['2028-12-12']);
    expect(
      ocorrencias(
        e({ recorrencia: 'data_unica', dia: null, mes: null, data: '2027-05-01' }),
        '2027-01-01',
        '2027-12-31',
      ),
    ).toEqual(['2027-05-01']);
  });
});
