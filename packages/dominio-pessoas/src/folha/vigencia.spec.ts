// Regra 7 do M53 (ficha, seção 8): tabelas legais com vigência, nunca constante no código; a competência usa a vigência
// da data de competência. Valores sintéticos (nenhuma tabela oficial copiada).
import type { TabelaLegalFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirTabelaLegal,
  dataDaCompetencia,
  fimDaCompetencia,
  ordenarVigencias,
  rubricaVigenteNaCompetencia,
  rubricaVigenteNaData,
  vigenteNaCompetencia,
  vigenteNaData,
} from './vigencia.js';

const vigencias = [
  { inicio: '2024-01-01', nome: 'a' },
  { inicio: '2025-05-01', nome: 'b' },
  { inicio: '2025-02-11', nome: 'c' },
];

function tabela(extra: Partial<TabelaLegalFolha> = {}): TabelaLegalFolha {
  return {
    inicio: '2025-01-01',
    irrf: {
      faixas: [
        { de: 0, ate: 100_000, aliquota: 0, deducao: 0 },
        { de: 100_001, ate: 200_000, aliquota: 750, deducao: 7_500 },
        { de: 200_001, ate: null, aliquota: 1_500, deducao: 22_500 },
      ],
      deducaoDependente: 10_000,
      descontoSimplificado: 20_000,
      reducao: { isencaoAte: 0, reducaoDe: 0, reducaoAte: 0, valor: 0, semReducaoAcimaDe: 0 },
    },
    inss: {
      faixas: [
        { de: 0, ate: 100_000, aliquota: 750, deducao: 0 },
        { de: 100_001, ate: 300_000, aliquota: 900, deducao: 0 },
      ],
      teto: 300_000,
    },
    salarioFamilia: [{ de: 0, ate: 150_000, cota: 5_000 }],
    salarioMinimo: 100_000,
    contribuinteIndividual: { aliquota: 2_000, teto: 300_000 },
    ...extra,
  };
}

describe('data da competência (D-VIG-532)', () => {
  it('é o primeiro dia do mês; o fim é o último dia (com ano bissexto)', () => {
    expect(dataDaCompetencia('2025-03')).toBe('2025-03-01');
    expect(fimDaCompetencia('2024-02')).toBe('2024-02-29');
    expect(fimDaCompetencia('2025-02')).toBe('2025-02-28');
    expect(fimDaCompetencia('2025-12')).toBe('2025-12-31');
  });
  it('recusa competência mal formada', () => {
    expect(() => dataDaCompetencia('2025-13')).toThrow();
    expect(() => dataDaCompetencia('25-01')).toThrow();
  });
});

describe('vigência em vigor (regra 7)', () => {
  it('pega a de maior início que não passe da data; o início igual vale', () => {
    expect(vigenteNaData(vigencias, '2025-05-01')?.nome).toBe('b');
    expect(vigenteNaData(vigencias, '2025-04-30')?.nome).toBe('c');
    expect(vigenteNaData(vigencias, '2023-12-31')).toBeNull();
  });
  it('a competência usa o primeiro dia: vigência que começa no meio do mês vale a partir da competência seguinte', () => {
    expect(vigenteNaCompetencia(vigencias, '2025-02')?.nome).toBe('a');
    expect(vigenteNaCompetencia(vigencias, '2025-03')?.nome).toBe('c');
    expect(vigenteNaCompetencia(vigencias, '2025-05')?.nome).toBe('b');
  });
  it('dois inícios iguais são ambíguos: nenhuma vale', () => {
    expect(vigenteNaData([...vigencias, { inicio: '2025-05-01', nome: 'd' }], '2025-06-01')).toBeNull();
  });
  it('ordena da mais nova para a mais antiga', () => {
    expect(ordenarVigencias(vigencias).map((v) => v.nome)).toEqual(['b', 'c', 'a']);
  });
});

describe('vigência da rubrica', () => {
  it('sem início nem fim vale sempre; os extremos valem', () => {
    expect(rubricaVigenteNaData({ inicio: null, fim: null }, '2000-01-01')).toBe(true);
    expect(rubricaVigenteNaData({ inicio: '2025-01-01', fim: '2025-06-30' }, '2025-01-01')).toBe(true);
    expect(rubricaVigenteNaData({ inicio: '2025-01-01', fim: '2025-06-30' }, '2025-06-30')).toBe(true);
    expect(rubricaVigenteNaData({ inicio: '2025-01-01', fim: '2025-06-30' }, '2025-07-01')).toBe(false);
    expect(rubricaVigenteNaData({ inicio: '2025-01-02', fim: null }, '2025-01-01')).toBe(false);
  });
  it('invertida nunca vale', () => {
    expect(rubricaVigenteNaData({ inicio: '2025-06-01', fim: '2025-01-01' }, '2025-03-01')).toBe(false);
    expect(rubricaVigenteNaCompetencia({ inicio: '2025-06-01', fim: '2025-01-01' }, '2025-03')).toBe(false);
  });
  it('na competência, vale se algum dia do mês estiver na vigência', () => {
    expect(rubricaVigenteNaCompetencia({ inicio: '2025-03-20', fim: null }, '2025-03')).toBe(true);
    expect(rubricaVigenteNaCompetencia({ inicio: null, fim: '2025-03-01' }, '2025-03')).toBe(true);
    expect(rubricaVigenteNaCompetencia({ inicio: null, fim: '2025-02-28' }, '2025-03')).toBe(false);
    expect(rubricaVigenteNaCompetencia({ inicio: '2025-04-01', fim: null }, '2025-03')).toBe(false);
  });
  it('D-VIG-532 (exceção registrada): início no dia 15 — a rubrica entra na competência, a tabela legal só na seguinte', () => {
    // A rubrica é o que se pode lançar na folha do mês (criada no meio do mês, já se lança nele); a tabela legal é o
    // parâmetro do cálculo e é lida num dia só, o primeiro da competência.
    expect(rubricaVigenteNaCompetencia({ inicio: '2025-03-15', fim: null }, '2025-03')).toBe(true);
    expect(vigenteNaCompetencia([{ inicio: '2025-03-15' }], '2025-03')).toBeNull();
    expect(vigenteNaCompetencia([{ inicio: '2025-03-15' }], '2025-04')).toEqual({ inicio: '2025-03-15' });
    // A rubrica que termina no dia 15 ainda entra na competência (vale em parte dela).
    expect(rubricaVigenteNaCompetencia({ inicio: null, fim: '2025-03-15' }, '2025-03')).toBe(true);
  });
});

describe('conferência da tabela legal', () => {
  it('tabela coerente: nada a acusar', () => {
    expect(conferirTabelaLegal(tabela())).toEqual([]);
  });
  it('acusa faixa sobreposta, buraco e alíquota regressiva', () => {
    const t = tabela();
    const r = conferirTabelaLegal({
      ...t,
      irrf: {
        ...t.irrf,
        faixas: [
          { de: 0, ate: 100_000, aliquota: 750, deducao: 0 },
          { de: 90_000, ate: 200_000, aliquota: 1_500, deducao: 0 },
          { de: 250_000, ate: null, aliquota: 1_000, deducao: 0 },
        ],
      },
    });
    expect(r).toEqual([
      { codigo: 'faixas-fora-de-ordem', tabela: 'irrf', faixa: 2 },
      { codigo: 'faixas-com-buraco', tabela: 'irrf', faixa: 3 },
      { codigo: 'aliquota-regressiva', tabela: 'irrf', faixa: 3 },
    ]);
  });
  it('faixa com fim antes do começo, faixa depois da sem-limite, tabela vazia', () => {
    const t = tabela();
    expect(
      conferirTabelaLegal({
        ...t,
        inss: {
          faixas: [
            { de: 100, ate: 50, aliquota: 750, deducao: 0 },
            { de: 51, ate: null, aliquota: 900, deducao: 0 },
            { de: 400_000, ate: 500_000, aliquota: 900, deducao: 0 },
          ],
          teto: 0,
        },
      }).map((x) => [x.codigo, x.faixa]),
    ).toEqual([
      ['faixas-fora-de-ordem', 1],
      ['faixas-fora-de-ordem', 3],
    ]);
    expect(conferirTabelaLegal({ ...t, irrf: { ...t.irrf, faixas: [] } })).toEqual([
      { codigo: 'sem-faixas', tabela: 'irrf', faixa: null },
    ]);
  });
  it('acusa teto do INSS diferente da última faixa e salário mínimo zerado; salário-família vazio é aceito', () => {
    const t = tabela();
    expect(
      conferirTabelaLegal({ ...t, inss: { ...t.inss, teto: 310_000 }, salarioMinimo: 0, salarioFamilia: [] }),
    ).toEqual([
      { codigo: 'teto-diferente-da-ultima-faixa', tabela: 'inss', faixa: 2 },
      { codigo: 'sem-salario-minimo', tabela: 'geral', faixa: null },
    ]);
  });
  it('salário-família não é progressivo (a cota diminui com a faixa)', () => {
    expect(
      conferirTabelaLegal(
        tabela({
          salarioFamilia: [
            { de: 0, ate: 100_000, cota: 6_000 },
            { de: 100_001, ate: 150_000, cota: 4_000 },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
