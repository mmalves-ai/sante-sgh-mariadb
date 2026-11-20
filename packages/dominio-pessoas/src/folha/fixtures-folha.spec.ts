// Dados sintéticos dos testes de férias e 13º (M53-F3): a tabela legal de 2026 (números públicos, só para a conta à
// mão), os parâmetros, uma rubrica por papel e o vínculo e o salário de teste. Arquivo de teste (fora da biblioteca e da
// cobertura); o teste abaixo só confere que a tabela passa na conferência.
import type { ParametrosFolha, RubricaFolha, TabelaLegalFolha } from '@sgh/contratos';
import { PAPEIS_CALCULO_FOLHA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { VinculoParaCalculo } from './calculo.js';
import { conferirTabelaLegal } from './vigencia.js';

export const TABELA_2026: TabelaLegalFolha = {
  inicio: '2026-01-01',
  irrf: {
    faixas: [
      { de: 0, ate: 242_880, aliquota: 0, deducao: 0 },
      { de: 242_881, ate: 282_665, aliquota: 750, deducao: 18_216 },
      { de: 282_666, ate: 375_105, aliquota: 1500, deducao: 39_416 },
      { de: 375_106, ate: 466_468, aliquota: 2250, deducao: 67_549 },
      { de: 466_469, ate: null, aliquota: 2750, deducao: 90_873 },
    ],
    deducaoDependente: 18_959,
    descontoSimplificado: 60_720,
    reducao: {
      isencaoAte: 500_000,
      reducaoDe: 500_001,
      reducaoAte: 735_000,
      valor: 31_289,
      semReducaoAcimaDe: 735_000,
    },
  },
  inss: {
    faixas: [
      { de: 0, ate: 151_800, aliquota: 750, deducao: 0 },
      { de: 151_801, ate: 279_388, aliquota: 900, deducao: 0 },
      { de: 279_389, ate: 419_083, aliquota: 1200, deducao: 0 },
      { de: 419_084, ate: 815_741, aliquota: 1400, deducao: 0 },
    ],
    teto: 815_741,
  },
  salarioFamilia: [{ de: 0, ate: 190_604, cota: 6_504 }],
  salarioMinimo: 151_800,
  contribuinteIndividual: { aliquota: 2000, teto: 815_741 },
};

const TODAS = { inss: true, irrf: true, fgts: true };
const NENHUMA = { inss: false, irrf: false, fgts: false };
/** Incidência de cada papel nos testes: as férias e o terço incidem; o abono e a dobra, não; o adiantamento, só FGTS. */
const INCIDENCIA: Partial<Record<(typeof PAPEIS_CALCULO_FOLHA)[number], typeof TODAS>> = {
  feriasGozo: TODAS,
  feriasMedias: TODAS,
  feriasTerco: TODAS,
  abonoPecuniario: NENHUMA,
  abonoTerco: NENHUMA,
  feriasDobra: NENHUMA,
  decimoAdiantamento: { inss: true, irrf: true, fgts: true },
  decimoPrimeira: { inss: false, irrf: false, fgts: true },
  decimoTerceiro: TODAS,
  decimoMedias: TODAS,
  decimoDesconto: TODAS,
  // M53-F4: o aviso indenizado só tem FGTS; as férias indenizadas e a indenização do art. 479, nada; o 13º, tudo.
  avisoIndenizado: { inss: false, irrf: false, fgts: true },
  avisoDescontado: TODAS,
  indenizacao479: NENHUMA,
  feriasVencidas: NENHUMA,
  feriasVencidasDobra: NENHUMA,
  feriasProporcionais: NENHUMA,
  feriasAviso: NENHUMA,
  feriasRescisaoTerco: NENHUMA,
  decimoProporcional: TODAS,
  decimoAviso: TODAS,
};

/** Uma rubrica por papel (ID = posição + 1), do tipo do papel, com a incidência acima. */
export function rubricasDeTeste(): RubricaFolha[] {
  return PAPEIS_CALCULO_FOLHA.map((papel, i) => {
    const desconto =
      /^(inss|irrf|faltas|atrasos|inssFerias|irrfFerias|decimoDesconto|inssDecimo|irrfDecimo|avisoDescontado)$/.test(
        papel,
      );
    const informativa = papel === 'fgts';
    return {
      id: i + 1,
      empresa: 1,
      codigo: 100 + i,
      descricao: `Rubrica ${papel}`,
      tipo: informativa ? 'informativa' : desconto ? 'desconto' : 'provento',
      referencia: 'valor',
      percentual: 0,
      prioridade: null,
      ativa: true,
      vigencia: { inicio: null, fim: null },
      usos: ['mensal'],
      incidencias: (INCIDENCIA[papel] ?? (desconto ? NENHUMA : TODAS)) as RubricaFolha['incidencias'],
      esocial: { inss: null, irrf: null, fgts: null, sindical: null },
      natureza: null,
    } as RubricaFolha;
  });
}

export const PARAM_2026: ParametrosFolha = {
  empresa: 1,
  inicio: '2026-01-01',
  percentuais: {
    horaExtra50: 5000,
    horaExtra100: 10_000,
    adicionalNoturno: 2000,
    sobreaviso: 3333,
    periculosidade: 3000,
  },
  encargos: { inssPatronal: 2000, ratAjustado: 300, terceiros: 580, fgts: 800 },
  divisorHoras: null,
  rubricas: Object.fromEntries(PAPEIS_CALCULO_FOLHA.map((p, i) => [p, i + 1])) as ParametrosFolha['rubricas'],
};

export const VINC = (id: number, extra: Partial<VinculoParaCalculo> = {}): VinculoParaCalculo => ({
  id,
  matricula: `M${id}`,
  tipo: 'clt',
  admissao: '2024-01-10',
  desligamento: null,
  centroCusto: 10,
  cargaSemanal: 44,
  ...extra,
});

export const SALARIO = (vinculo: number, salario = 300_000, extra = {}) => ({
  vinculo,
  inicio: '2024-01-10',
  salario,
  dependentesIrrf: 0,
  dependentesSalarioFamilia: 0,
  insalubridade: 0,
  periculosidade: false,
  ...extra,
});

describe('dados de teste da folha (M53-F3)', () => {
  it('a tabela de 2026 passa na conferência e há uma rubrica por papel', () => {
    expect(conferirTabelaLegal(TABELA_2026)).toEqual([]);
    expect(rubricasDeTeste()).toHaveLength(PAPEIS_CALCULO_FOLHA.length);
  });
});
