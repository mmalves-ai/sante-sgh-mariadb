// W0-04 (M4): o canal da Hal-AI só com o parâmetro ligado; os indicadores da ouvidoria por competência com as parcelas
// (no prazo sobre respondidas e vencidas; por tipo, área e canal), sem as canceladas; o prazo parametrizável.
import { describe, expect, it } from 'vitest';
import {
  chaveDeArea,
  indicadoresOuvidoria,
  parcelaOuvidoria,
  recusaCanalOuvidoria,
} from './ouvidoria-indicadores.js';
import { prazoRespostaOuvidoria } from './ouvidoria.js';

const m = (o: Partial<Parameters<typeof indicadoresOuvidoria>[1][number]>) => ({
  tipo: 'reclamacao',
  area: 'Recepção',
  canal: 'telefone',
  situacao: 'aberta',
  recebidaEm: '2026-10-05T09:00:00',
  prazoEm: '2026-10-19T23:59:59',
  respondidaEm: null,
  canceladaEm: null,
  ...o,
});

describe('canal da ouvidoria', () => {
  it('a Hal-AI só com o parâmetro ligado; o portal sempre', () => {
    expect(recusaCanalOuvidoria('halai', false)).toBe('canal-halai-desligado');
    expect(recusaCanalOuvidoria('halai', true)).toBeNull();
    expect(recusaCanalOuvidoria('portal', false)).toBeNull();
  });
});

describe('prazo parametrizável', () => {
  it('5 dias úteis em vez de 10 (o dia do recebimento não conta)', () => {
    expect(prazoRespostaOuvidoria('2026-10-05T09:00', new Set(), 5)).toBe('2026-10-12T23:59:59');
    expect(prazoRespostaOuvidoria('2026-10-05T09:00', new Set())).toBe('2026-10-19T23:59:59');
  });
});

describe('indicadores da ouvidoria', () => {
  const xs = [
    m({ situacao: 'respondida', respondidaEm: '2026-10-10T10:00:00' }),
    m({ situacao: 'respondida', respondidaEm: '2026-10-25T10:00:00', area: 'Faturamento', tipo: 'denuncia' }),
    m({ situacao: 'encaminhada', canal: 'portal' }),
    m({ situacao: 'aberta', prazoEm: '2026-11-30T23:59:59', tipo: 'elogio' }),
    m({ canceladaEm: '2026-10-06T10:00:00' }),
    m({ recebidaEm: '2026-09-30T10:00:00' }),
  ];
  const r = indicadoresOuvidoria('2026-10', xs, '2026-10-28T12:00:00', 10);

  it('no prazo: respondidas no prazo sobre respondidas e vencidas, sem as canceladas nem outro mês', () => {
    expect(r).toMatchObject({ total: 4, canceladas: 1, respondidas: 2, vencidas: 1, prazoDiasUteis: 10 });
    expect(r.noPrazo).toEqual({ numerador: 1, denominador: 3, valor: 33.3, conta: '1 ÷ 3 × 100 = 33,3%' });
  });

  it('por tipo, por área e por canal, com as parcelas', () => {
    expect(r.porTipo.map((g) => [g.chave, g.total, g.noPrazo.numerador, g.noPrazo.denominador])).toEqual([
      ['reclamacao', 2, 1, 2],
      ['denuncia', 1, 0, 1],
      ['elogio', 1, 0, 0],
    ]);
    expect(r.porArea.map((g) => [g.chave, g.total])).toEqual([
      ['Recepção', 3],
      ['Faturamento', 1],
    ]);
    expect(r.porCanal.find((g) => g.chave === 'portal')).toMatchObject({ total: 1, vencidas: 1 });
  });

  it('sem denominador, a taxa é nula (nada inventado)', () => {
    expect(parcelaOuvidoria(0, 0)).toEqual({ numerador: 0, denominador: 0, valor: null, conta: null });
  });
});

describe('revisão do W0-04: a área do indicador é texto livre normalizado', () => {
  it('"UTI", "uti", "U.T.I." e "Uti " são a mesma área; o rótulo é a grafia mais usada', () => {
    for (const a of ['UTI', 'uti', 'U.T.I.', 'Uti ', 'U T I']) expect(chaveDeArea(a)).toBe('UTI');
    expect(chaveDeArea('Clínica Médica')).toBe(chaveDeArea('CLINICA MEDICA'));
    expect(chaveDeArea('Pronto-Socorro')).toBe('PRONTO SOCORRO');
    const r = indicadoresOuvidoria(
      '2026-10',
      [
        m({ area: 'UTI' }),
        m({ area: 'uti' }),
        m({ area: 'U.T.I.' }),
        m({ area: 'UTI' }),
        m({ area: 'Recepção' }),
      ],
      '2026-10-10T10:00:00',
      10,
    );
    expect(r.porArea.map((g) => [g.chave, g.total])).toEqual([
      ['UTI', 4],
      ['Recepção', 1],
    ]);
  });
});
