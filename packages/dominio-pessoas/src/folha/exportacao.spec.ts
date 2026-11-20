// Montagem do lote para a folha externa (M53-F0, regras 4 a 6), com dados sintéticos (CPF gerado pelos dígitos).
import { esquemaLoteExportacaoFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  contaDaExportacao,
  type EntradaLoteFolha,
  jsonCanonico,
  montarLoteFolha,
  periodoDaCompetencia,
  type VinculoParaFolha,
  vinculoNaFolha,
} from './exportacao.js';
import { conferirRetorno, exportadoConferivel } from './lote.js';

/** CPF sintético válido: nove dígitos e os dois verificadores calculados. */
function cpfSintetico(base: string): string {
  const d = base.split('').map(Number);
  for (const n of [9, 10]) {
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

const vinc = (id: number, extra: Partial<VinculoParaFolha> = {}): VinculoParaFolha => ({
  id,
  cpf: cpfSintetico(String(100000000 + id)),
  matricula: `M${id}`,
  tipo: 'clt',
  admissao: '2020-01-01',
  desligamento: null,
  centroCusto: 10 + id,
  unidade: 5,
  cbo: '223505',
  conselho: null,
  ...extra,
});

const base = (extra: Partial<EntradaLoteFolha> = {}): EntradaLoteFolha => ({
  lote: 77,
  empresa: 1,
  estabelecimento: 'pc',
  competencia: '2026-09',
  geradoEm: '2026-10-05T10:00:00-03:00',
  hoje: '2026-10-05',
  vinculos: [vinc(2), vinc(1)],
  afastamentos: [],
  fechamentos: new Map([
    [1, { '1': 9600, '5': 60 }],
    [2, { '1': 8800 }],
  ]),
  plantoes: [],
  eventosDisponiveis: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  competenciaLancada: false,
  ...extra,
});

describe('vinculoNaFolha', () => {
  it('só os tipos da folha (o prestador é do repasse) que existiam na competência', () => {
    expect(vinculoNaFolha(vinc(1), '2026-09')).toBe(true);
    for (const tipo of ['cooperado', 'pj', 'terceiro', 'outro'])
      expect(vinculoNaFolha(vinc(1, { tipo }), '2026-09')).toBe(false);
    expect(vinculoNaFolha(vinc(1, { admissao: '2026-10-01' }), '2026-09')).toBe(false);
    expect(vinculoNaFolha(vinc(1, { desligamento: '2026-08-31' }), '2026-09')).toBe(false);
    expect(vinculoNaFolha(vinc(1, { admissao: '2026-09-30' }), '2026-09')).toBe(true);
    expect(vinculoNaFolha(vinc(1, { desligamento: '2026-09-01' }), '2026-09')).toBe(true);
  });

  it('o período é o mês civil', () => {
    expect(periodoDaCompetencia('2026-02')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
  });
});

describe('montarLoteFolha', () => {
  it('monta o lote válido pelo contrato, com os totais do conteúdo e sem salário', () => {
    const r = montarLoteFolha(base());
    expect(r.pendencias).toEqual([]);
    const lote = esquemaLoteExportacaoFolha.parse(r.lote);
    expect(lote.colaboradores.map((c) => c.vinculo)).toEqual([1, 2]);
    expect(lote.totais).toEqual({
      colaboradores: 2,
      afastamentos: 0,
      eventosPonto: 3,
      minutosPonto: 18460,
      plantoes: 0,
      minutosPlantao: 0,
    });
    expect(r.conta).toBe('2 colaboradores; 0 afastamentos; ponto 3 eventos = 18.460 min; plantões 0 = 0 min');
    expect(JSON.stringify(lote)).not.toMatch(/salario|rubrica/);
  });

  it('leva o afastamento em vigor que toca a competência e o plantão do mês, com o fuso', () => {
    const r = montarLoteFolha(
      base({
        afastamentos: [
          { vinculo: 1, motivo: 3, inicio: '2026-08-20', fim: '2026-09-02', situacao: 'ativo' },
          { vinculo: 1, motivo: 3, inicio: '2026-09-10', fim: null, situacao: 'cancelado' },
          { vinculo: 2, motivo: 4, inicio: '2026-10-01', fim: null, situacao: 'ativo' },
          { vinculo: 99, motivo: 4, inicio: '2026-09-01', fim: null, situacao: 'ativo' },
        ],
        plantoes: [
          {
            vinculo: 2,
            plantao: 5,
            modalidade: 'presencial',
            inicio: '2026-09-30T19:00',
            fim: '2026-10-01T07:00',
            minutos: 720,
          },
          {
            vinculo: 2,
            plantao: 6,
            modalidade: 'presencial',
            inicio: '2026-10-01T07:00',
            fim: '2026-10-01T19:00',
            minutos: 720,
          },
          {
            vinculo: 1,
            plantao: 7,
            modalidade: 'x',
            inicio: '2026-09-02T07:00',
            fim: '2026-09-02T19:00',
            minutos: 1,
          },
        ],
      }),
    );
    const lote = esquemaLoteExportacaoFolha.parse(r.lote);
    expect(lote.afastamentos).toEqual([{ vinculo: 1, motivo: 3, inicio: '2026-08-20', fim: '2026-09-02' }]);
    expect(lote.plantoes).toEqual([
      {
        vinculo: 2,
        plantao: 5,
        modalidade: 'presencial',
        inicio: '2026-09-30T19:00-03:00',
        fim: '2026-10-01T07:00-03:00',
        minutos: 720,
        centroCusto: 12,
      },
    ]);
  });

  it('pendências barram o lote e levam só os IDs dos vínculos', () => {
    const r = montarLoteFolha(
      base({
        vinculos: [vinc(1, { cpf: null }), vinc(2), vinc(3, { cpf: '11111111111' }), vinc(4, { tipo: 'pj' })],
        fechamentos: new Map([
          [1, { '1': 60 }],
          [3, { '1': 60, '12': 10 }],
        ]),
        eventosDisponiveis: new Set([1]),
      }),
    );
    expect(r.lote).toBeNull();
    expect(r.pendencias).toEqual([
      { codigo: 'cpf-ilegivel', vinculos: [1, 3], valor: 0 },
      { codigo: 'ponto-nao-fechado', vinculos: [2], valor: 0 },
      { codigo: 'evento-indisponivel', vinculos: [3], valor: 12 },
    ]);
  });

  it('competência lançada, futura ou sem colaborador também barram', () => {
    const r = montarLoteFolha(base({ competenciaLancada: true, competencia: '2026-11', vinculos: [] }));
    expect(r.pendencias.map((p) => p.codigo)).toEqual([
      'competencia-lancada',
      'competencia-futura',
      'sem-colaboradores',
    ]);
  });

  it('o CBO fora do formato vai como nulo', () => {
    const r = montarLoteFolha(
      base({ vinculos: [vinc(1, { cbo: '2235' })], fechamentos: new Map([[1, {}]]) }),
    );
    expect(r.lote?.colaboradores[0]?.cbo).toBeNull();
  });

  it('o resumo conferível guardado confere o retorno como o lote inteiro', () => {
    const lote = esquemaLoteExportacaoFolha.parse(montarLoteFolha(base()).lote);
    const resumo = exportadoConferivel(lote);
    expect(resumo.vinculos).toEqual([1, 2]);
    const retorno = {
      leiaute: '1.0' as const,
      loteExportado: 77,
      empresa: 1,
      competencia: '2026-09',
      recebido: lote.totais,
      colaboradores: [
        {
          vinculo: 1,
          matriculaExterna: 'X1',
          rubricas: [{ codigo: '001', natureza: 'provento' as const, valor: 100 }],
          liquido: 100,
        },
      ],
      encargos: [],
      vencimentoLiquido: '2026-10-05',
      totais: { colaboradores: 1, proventos: 100, descontos: 0, liquido: 100, encargos: 0 },
    };
    expect(conferirRetorno(retorno, resumo)).toEqual(conferirRetorno(retorno, lote));
    expect(conferirRetorno(retorno, resumo)).toEqual([]);
  });
});

describe('contaDaExportacao e jsonCanonico', () => {
  it('singular e plural', () => {
    expect(
      contaDaExportacao({
        colaboradores: 1,
        afastamentos: 1,
        eventosPonto: 1,
        minutosPonto: 1000,
        plantoes: 1,
        minutosPlantao: 60,
      }),
    ).toBe('1 colaborador; 1 afastamento; ponto 1 evento = 1.000 min; plantões 1 = 60 min');
  });

  it('a mesma estrutura em outra ordem dá o mesmo texto', () => {
    expect(jsonCanonico({ b: [1, { d: null, c: 'x' }], a: 2, z: undefined })).toBe(
      '{"a":2,"b":[1,{"c":"x","d":null}]}',
    );
    expect(jsonCanonico({ a: 1, b: 2 })).toBe(jsonCanonico({ b: 2, a: 1 }));
  });
});
