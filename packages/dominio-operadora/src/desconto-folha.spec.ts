import { describe, expect, it } from 'vitest';
import {
  arquivoRemessaFolha,
  type CobrancaParaFolha,
  conciliarRetornoFolha,
  lerRetornoFolha,
  montarRemessaFolha,
  podePassarRemessaFolha,
} from './desconto-folha.js';

const c = (x: Partial<CobrancaParaFolha> & { fatura: number }): CobrancaParaFolha => ({
  numero: `F-${x.fatura}`,
  beneficiario: 10,
  matriculaFuncional: 'M1',
  percentualFolha: null,
  competencia: '2026-11-01',
  vencimento: '2026-11-10',
  saldo: 100,
  emOutraRemessa: false,
  ...x,
});

describe('remessa de desconto em folha', () => {
  it('entra a cobrança do titular com matrícula; as outras ficam de fora com a crítica', () => {
    const r = montarRemessaFolha(
      [
        c({ fatura: 1 }),
        c({ fatura: 2, competencia: '2026-10-01', saldo: 40.5 }),
        c({ fatura: 3, beneficiario: null }),
        c({ fatura: 4, matriculaFuncional: ' ' }),
        c({ fatura: 5, emOutraRemessa: true }),
        c({ fatura: 6, saldo: 0 }),
        c({ fatura: 7, competencia: '2026-12-01' }),
      ],
      '2026-11',
    );
    expect(r.itens.map((i) => [i.sequencia, i.fatura])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(r.criticas.map((x) => [x.fatura, x.codigo])).toEqual([
      [3, 'sem-responsavel'],
      [4, 'sem-matricula'],
      [5, 'ja-em-remessa'],
      [6, 'sem-saldo'],
    ]);
    expect(r.valorTotal).toBe(140.5);
    expect(r.valorAtrasado).toBe(40.5);
    expect(() => montarRemessaFolha([], '2026-13')).toThrow(RangeError);
  });

  it('gera o arquivo com uma linha por item', () => {
    const r = montarRemessaFolha([c({ fatura: 1, saldo: 99.9 })], '2026-11');
    expect(arquivoRemessaFolha('2026-11', r.itens)).toBe(
      'matricula;competencia;cobranca;competencia_cobranca;valor;valor_atrasado\nM1;2026-11;F-1;2026-11;99.90;0.00\n',
    );
  });

  it('ciclo: retorno recebido não é cancelado; conferida é final', () => {
    expect(podePassarRemessaFolha('gerada', 'enviada')).toBe(true);
    expect(podePassarRemessaFolha('enviada', 'cancelada')).toBe(true);
    expect(podePassarRemessaFolha('retorno_recebido', 'cancelada')).toBe(false);
    expect(podePassarRemessaFolha('gerada', 'retorno_recebido')).toBe(false);
    expect(podePassarRemessaFolha('conferida', 'cancelada')).toBe(false);
  });
});

describe('retorno do desconto em folha', () => {
  it('lê o arquivo (cabeçalho, vírgula decimal) e aponta a linha ilegível sem o valor', () => {
    const r = lerRetornoFolha('matricula;valor\nM1;120,50\n\nM2;abc\nM3,10.00\n');
    expect(r.linhas).toEqual([
      { linha: 2, matricula: 'M1', valor: 120.5 },
      { linha: 5, matricula: 'M3', valor: 10 },
    ]);
    expect(r.problemas).toEqual([expect.objectContaining({ codigo: 'linha-ilegivel', linha: 4 })]);
    expect(lerRetornoFolha('\n').problemas[0]?.codigo).toBe('retorno-vazio');
  });

  const itens = [
    { sequencia: 1, fatura: 2, matriculaFuncional: 'M1', competencia: '2026-10-01', valorEnviado: 40 },
    { sequencia: 2, fatura: 1, matriculaFuncional: 'M1', competencia: '2026-11-01', valorEnviado: 100 },
    { sequencia: 3, fatura: 9, matriculaFuncional: 'M2', competencia: '2026-11-01', valorEnviado: 80 },
    { sequencia: 4, fatura: 8, matriculaFuncional: 'M3', competencia: '2026-11-01', valorEnviado: 50 },
  ];

  it('aloca o descontado da competência mais antiga para a mais nova; ausente fica não descontado', () => {
    const r = conciliarRetornoFolha(itens, [
      { linha: 1, matricula: 'M1', valor: 90 },
      { linha: 2, matricula: 'M2', valor: 80 },
    ]);
    expect(r.problemas).toEqual([]);
    expect(r.itens.map((i) => [i.fatura, i.valorDescontado, i.situacao])).toEqual([
      [2, 40, 'descontado'],
      [1, 50, 'descontado_parcial'],
      [9, 80, 'descontado'],
      [8, 0, 'nao_descontado'],
    ]);
    expect([r.valorDescontado, r.descontados, r.parciais, r.naoDescontados]).toEqual([170, 2, 1, 1]);
  });

  it('recusa matrícula fora da remessa, repetida e desconto acima do enviado', () => {
    const r = conciliarRetornoFolha(itens, [
      { linha: 1, matricula: 'X9', valor: 1 },
      { linha: 2, matricula: 'M2', valor: 80.01 },
      { linha: 3, matricula: 'M2', valor: 1 },
    ]);
    expect(r.problemas.map((p) => [p.linha, p.codigo])).toEqual([
      [1, 'matricula-fora-da-remessa'],
      [2, 'desconto-acima-do-enviado'],
      [3, 'matricula-repetida'],
    ]);
  });
});
