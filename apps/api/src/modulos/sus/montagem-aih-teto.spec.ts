// O teto das diárias de UTI na crítica da competência AIH (Leitos do sistema público, 04-INT linha 79): as diárias das
// AIHs a apresentar somadas por tipo e competência da diária, contra a capacidade contratada vigente (massa SINTÉTICA).
import { cnsValido } from '@sgh/contratos';
import type { LinhaCapacidadeSus } from '@sgh/dominio-internacao';
import { describe, expect, it } from 'vitest';
import {
  type AihMontada,
  chaveDaCriticaAih,
  criticaAihDaCompetencia,
  criticasTetoDiariasUti,
} from './montagem-aih.js';
import { cnsSintetico } from './porta-memoria.js';
import type { ParametrosSus } from './montagem.js';

const DIRETOR = (() => {
  for (let k = 0; k < 50; k++) {
    const c = cnsSintetico(880 + k);
    if (cnsValido(c)) return c;
  }
  throw new Error('sem CNS');
})();

const montada = (id: number, diarias: { tipo: number; competencia: string; diarias: number }[]): AihMontada =>
  ({
    aih: { id, registro: 9000 + id, situacao: 'fechada' },
    internacao: null,
    resultado: {
      competencia: null,
      linhas: [],
      permanencia: { dias: null, media: null },
      diariasUti: { total: 0, mesAnterior: 0 },
      itensForaDaAih: 0,
      itensSemSigtap: 0,
      criticas: [],
    },
    especialidade: 1,
    diariasCompetencia: diarias.map((d) => ({
      ...d,
      procedimento: '0802010083',
      dataEntrada: '2026-02-01',
      dataSaida: '2026-02-02',
      unidade: null,
    })),
  }) as unknown as AihMontada;

const cap = (o: Partial<LinhaCapacidadeSus>): LinhaCapacidadeSus => ({
  id: 1,
  especialidade: 75,
  competencia: '2026-02-01',
  quantidadeLeitos: 1,
  criticaLiberada: false,
  operacao: 'inclusao',
  ocorridoEm: '2026-02-01T10:00:00.000Z',
  ...o,
});

describe('teto das diárias de UTI na crítica da AIH', () => {
  // Fevereiro de 2026 tem 28 dias: 1 leito do tipo 75 dá teto de 28 diárias.
  const aihs = [
    montada(1, [{ tipo: 75, competencia: '202602', diarias: 20 }]),
    montada(2, [
      { tipo: 75, competencia: '202602', diarias: 10 },
      { tipo: 76, competencia: '202602', diarias: 2 },
    ]),
  ];

  it('acima do teto sem liberação é bloqueante; o tipo sem capacidade é aviso', () => {
    expect(criticasTetoDiariasUti(aihs, [cap({})])).toEqual([
      expect.objectContaining({
        regra: 'diarias-uti-acima-do-teto',
        gravidade: 'bloqueante',
        conta: null,
        detalhe: {
          tipoUti: 75,
          competenciaDiarias: '202602',
          diarias: 30,
          diariasOutrasAihs: 0,
          teto: 28,
          excedente: 2,
        },
      }),
      expect.objectContaining({
        regra: 'diarias-uti-sem-capacidade',
        gravidade: 'aviso',
        detalhe: {
          tipoUti: 76,
          competenciaDiarias: '202602',
          diarias: 2,
          diariasOutrasAihs: 0,
          teto: null,
          excedente: 0,
        },
      }),
    ]);
  });

  it('a liberação nominal, a capacidade maior e o cadastro não usado não criticam', () => {
    const liberada = [cap({}), cap({ id: 2, especialidade: 76, quantidadeLeitos: 1 })];
    expect(
      criticasTetoDiariasUti(aihs, [
        ...liberada,
        cap({ id: 3, criticaLiberada: true, operacao: 'alteracao', ocorridoEm: '2026-02-03T10:00:00.000Z' }),
      ]),
    ).toEqual([]);
    expect(
      criticasTetoDiariasUti(aihs, [
        cap({ quantidadeLeitos: 2 }),
        cap({ id: 2, especialidade: 76, quantidadeLeitos: 1 }),
      ]),
    ).toEqual([]);
    expect(criticasTetoDiariasUti(aihs, [])).toEqual([]);
  });

  it('a crítica da competência leva o teto e trava o arquivo (bloqueante na lista da competência)', () => {
    const p = { cnes: '9999991', habilitacoes: new Set<string>() } as unknown as ParametrosSus;
    const pAih = { utiPorAcomodacao: '', diretorClinicoCns: DIRETOR };
    const sem = criticaAihDaCompetencia('202602', [], [], aihs, p, pAih, [9_999_991]);
    expect(sem.todas.filter((c) => c.regra.startsWith('diarias-uti'))).toEqual([]);
    const com = criticaAihDaCompetencia('202602', [], [], aihs, p, pAih, [9_999_991], [cap({})]);
    expect(com.criticas.map((c) => [c.regra, c.gravidade])).toEqual([
      ['diarias-uti-acima-do-teto', 'bloqueante'],
      ['diarias-uti-sem-capacidade', 'aviso'],
    ]);
  });

  it('as diárias de um mês repartidas em dois arquivos somam no teto do mês das diárias', () => {
    // A AIH de março traz 20 diárias de fevereiro; outra AIH, apresentada em fevereiro, já gravou 10 de fevereiro.
    // Sozinhas, as 20 cabem no teto de 28; com as 10 já gravadas passam dele em 2.
    const marco = [montada(3, [{ tipo: 75, competencia: '202602', diarias: 20 }])];
    expect(criticasTetoDiariasUti(marco, [cap({})])).toEqual([]);
    const outras = [
      { tipo: 75, competencia: '202602', diarias: 10 },
      // De outro mês e de outro tipo: não são deste arquivo criticar.
      { tipo: 75, competencia: '202601', diarias: 40 },
      { tipo: 76, competencia: '202602', diarias: 9 },
    ];
    expect(criticasTetoDiariasUti(marco, [cap({})], outras)).toEqual([
      expect.objectContaining({
        regra: 'diarias-uti-acima-do-teto',
        gravidade: 'bloqueante',
        detalhe: {
          tipoUti: 75,
          competenciaDiarias: '202602',
          diarias: 30,
          diariasOutrasAihs: 10,
          teto: 28,
          excedente: 2,
        },
      }),
    ]);
    const p = { cnes: '9999991', habilitacoes: new Set<string>() } as unknown as ParametrosSus;
    const pAih = { utiPorAcomodacao: '', diretorClinicoCns: DIRETOR };
    const m = criticaAihDaCompetencia('202603', [], [], marco, p, pAih, [9_999_991], [cap({})], outras);
    expect(m.criticas.map((c) => [c.regra, c.gravidade])).toEqual([
      ['diarias-uti-acima-do-teto', 'bloqueante'],
    ]);
  });

  it('a chave da crítica do teto é só o tipo e a competência das diárias: outra quantidade mantém a linha', () => {
    const [a] = criticasTetoDiariasUti(aihs, [cap({})]);
    const [b] = criticasTetoDiariasUti(
      [montada(4, [{ tipo: 75, competencia: '202602', diarias: 45 }])],
      [cap({})],
      [{ tipo: 75, competencia: '202602', diarias: 3 }],
    );
    expect(a?.detalhe['diarias']).toBe(30);
    expect(b?.detalhe['diarias']).toBe(48);
    expect(chaveDaCriticaAih(a!)).toBe(chaveDaCriticaAih(b!));
    expect(chaveDaCriticaAih(a!)).toBe('diarias-uti-acima-do-teto||||competenciaDiarias=202602;tipoUti=75');
    // Outro tipo ou outro mês é outra crítica; as demais regras seguem a chave com o detalhe inteiro.
    const [, semCap] = criticasTetoDiariasUti(aihs, [cap({})]);
    expect(chaveDaCriticaAih(semCap!)).not.toBe(chaveDaCriticaAih(a!));
    const outra = { ...a!, regra: 'aih-sem-laudo' as const, detalhe: { registro: 1, competencia: '202602' } };
    expect(chaveDaCriticaAih(outra)).toBe('aih-sem-laudo||||competencia=202602;registro=1');
  });
});
