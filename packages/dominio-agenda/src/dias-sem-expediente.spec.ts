// 02-AGE linha 41: feriados locais e dias não úteis do estabelecimento na geração da grade.
import { describe, expect, it } from 'vitest';
import {
  type DiaNaoUtilCadastrado,
  diasSemExpediente,
  type FeriadoCadastrado,
  type LocalExpediente,
  valeNoLocal,
} from './dias-sem-expediente.js';

const LOCAL: LocalExpediente = { estabelecimento: 7, municipio: 4314902, uf: 'RS', ufId: 43 };
const fer = (p: Partial<FeriadoCadastrado>): FeriadoCadastrado => ({
  data: '2030-09-20',
  nome: 'Revolução Farroupilha',
  abrangencia: 'estadual',
  uf: 'RS',
  municipio: null,
  estabelecimento: null,
  pontoFacultativo: false,
  ...p,
});
const dnu = (p: Partial<DiaNaoUtilCadastrado>): DiaNaoUtilCadastrado => ({
  descricao: 'Aniversário do hospital',
  abrangencia: 'estabelecimento',
  ufId: null,
  municipio: null,
  estabelecimento: 7,
  recorrencia: 'anual',
  dia: 3,
  mes: 3,
  data: null,
  facultativo: false,
  horaInicio: null,
  ...p,
});

describe('valeNoLocal', () => {
  it('nacional vale sempre; estadual, municipal e do estabelecimento só no próprio alvo', () => {
    expect(valeNoLocal(LOCAL, 'nacional', { municipio: null, estabelecimento: null })).toBe(true);
    expect(valeNoLocal(LOCAL, 'estadual', { uf: 'rs', municipio: null, estabelecimento: null })).toBe(true);
    expect(valeNoLocal(LOCAL, 'estadual', { uf: 'SC', municipio: null, estabelecimento: null })).toBe(false);
    expect(valeNoLocal(LOCAL, 'estadual', { ufId: 43, municipio: null, estabelecimento: null })).toBe(true);
    expect(valeNoLocal(LOCAL, 'municipal', { municipio: 4314902, estabelecimento: null })).toBe(true);
    expect(valeNoLocal(LOCAL, 'municipal', { municipio: 1, estabelecimento: null })).toBe(false);
    expect(valeNoLocal(LOCAL, 'estabelecimento', { municipio: null, estabelecimento: 8 })).toBe(false);
    expect(
      valeNoLocal({ ...LOCAL, uf: null, ufId: null }, 'estadual', {
        uf: 'RS',
        municipio: null,
        estabelecimento: null,
      }),
    ).toBe(false);
  });
});

describe('diasSemExpediente', () => {
  it('sem cadastro: os nacionais fixos e os móveis do período', () => {
    const r = diasSemExpediente(LOCAL, '2030-03-01', '2030-04-30', { feriados: [], diasNaoUteis: [] });
    expect(r.map((f) => f.data)).toEqual(['2030-03-05', '2030-04-19', '2030-04-21']);
  });

  it('estadual da UF e municipal do município entram; de outra UF ou município não', () => {
    const r = diasSemExpediente(LOCAL, '2030-09-01', '2030-09-30', {
      feriados: [
        fer({}),
        fer({ data: '2030-09-10', nome: 'Outro estado', uf: 'SC' }),
        fer({
          data: '2030-09-11',
          nome: 'Padroeira',
          abrangencia: 'municipal',
          uf: null,
          municipio: 4314902,
        }),
        fer({
          data: '2030-09-12',
          nome: 'Outro município',
          abrangencia: 'municipal',
          uf: null,
          municipio: 1,
        }),
      ],
      diasNaoUteis: [],
    });
    expect(r).toEqual([
      { data: '2030-09-07', nome: 'Independência do Brasil' },
      { data: '2030-09-11', nome: 'Padroeira' },
      { data: '2030-09-20', nome: 'Revolução Farroupilha' },
    ]);
  });

  it('ponto facultativo e meio expediente não pulam o dia', () => {
    const r = diasSemExpediente(LOCAL, '2030-03-01', '2030-03-31', {
      feriados: [fer({ data: '2030-03-15', pontoFacultativo: true })],
      diasNaoUteis: [dnu({ horaInicio: '13:00' }), dnu({ dia: 20, facultativo: true })],
    });
    expect(r.map((f) => f.data)).toEqual(['2030-03-05']);
  });

  it('dia não útil anual repete em cada ano; data única e móvel só na data; outro estabelecimento não', () => {
    const r = diasSemExpediente(LOCAL, '2030-03-01', '2031-03-10', {
      feriados: [],
      diasNaoUteis: [
        dnu({}),
        dnu({
          recorrencia: 'data_unica',
          dia: null,
          mes: null,
          data: '2030-06-10',
          descricao: 'Dedetização',
        }),
        dnu({
          recorrencia: 'movel',
          dia: null,
          mes: null,
          data: '2030-06-11',
          descricao: 'Inventário',
          estabelecimento: 9,
        }),
        dnu({
          abrangencia: 'estadual',
          estabelecimento: null,
          ufId: 43,
          dia: 8,
          mes: 7,
          descricao: 'Data estadual',
        }),
      ],
    });
    const datas = r.map((f) => f.data);
    expect(datas).toContain('2030-03-03');
    expect(datas).toContain('2031-03-03');
    expect(datas).toContain('2030-06-10');
    expect(datas).toContain('2030-07-08');
    expect(datas).not.toContain('2030-06-11');
  });

  it('a mesma data sai uma vez, com o nome mais local', () => {
    const r = diasSemExpediente(LOCAL, '2030-11-20', '2030-11-20', {
      feriados: [
        fer({
          data: '2030-11-20',
          nome: 'Consciência Negra (municipal)',
          abrangencia: 'municipal',
          uf: null,
          municipio: 4314902,
        }),
      ],
      diasNaoUteis: [],
    });
    expect(r).toEqual([{ data: '2030-11-20', nome: 'Consciência Negra (municipal)' }]);
  });
});
