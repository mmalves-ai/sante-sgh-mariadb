// Porta das rubricas em memória (M53, etapa F1): a sessão sintética de dev/ci e o E2E. Rubricas e tabelas legais
// SINTÉTICAS (valores redondos inventados, nenhuma tabela oficial copiada), com os códigos de incidência do eSocial
// (públicos, do leiaute) e algumas divergências de propósito, para a tela mostrar a conferência. Nada vai à cópia.
import {
  type ApoioRubricas,
  type DiasAfastamentoFolha,
  INCIDENCIAS_RUBRICA_FOLHA,
  type IncidenciaRubricaFolha,
  type RubricaFolha,
  type TabelaLegalFolha,
} from '@sgh/contratos';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoRubricas, PortaRubricas } from './porta-rubricas.js';

const semGravacao = () =>
  Promise.reject(
    new ErroProblema(
      'recusa-de-negocio',
      409,
      'Operação recusada',
      'As rubricas e as tabelas legais são gravadas pelo cadastro de cada uma.',
    ),
  );

function incid(...sim: IncidenciaRubricaFolha[]): RubricaFolha['incidencias'] {
  return Object.fromEntries(
    INCIDENCIAS_RUBRICA_FOLHA.map((i) => [i, sim.includes(i)]),
  ) as RubricaFolha['incidencias'];
}

function rubrica(
  id: number,
  descricao: string,
  tipo: RubricaFolha['tipo'],
  incidencias: RubricaFolha['incidencias'],
  esocial: Partial<RubricaFolha['esocial']>,
  extra: Partial<RubricaFolha> = {},
): RubricaFolha {
  return {
    id,
    empresa: 1,
    codigo: id,
    descricao,
    tipo,
    referencia: 'valor',
    percentual: 0,
    prioridade: null,
    ativa: true,
    vigencia: { inicio: null, fim: null },
    usos: ['mensal', 'ferias', 'rescisao'],
    incidencias,
    esocial: { inss: null, irrf: null, fgts: null, sindical: null, ...esocial },
    natureza: 1000,
    ...extra,
  };
}

export const RUBRICAS_SINTETICAS: readonly RubricaFolha[] = [
  rubrica(1, 'Salário base', 'provento', incid('inss', 'irrf', 'fgts', 'dsr', 'media13', 'mediaFerias'), {
    inss: '11',
    irrf: '11',
    fgts: '11',
  }),
  rubrica(
    2,
    'Adicional noturno',
    'provento',
    incid('inss', 'irrf', 'fgts'),
    { inss: '11', irrf: '11', fgts: '11' },
    {
      referencia: 'percentual',
      percentual: 2_000,
    },
  ),
  rubrica(
    3,
    'Horas extras 50%',
    'provento',
    incid('inss', 'irrf'),
    { inss: '11', irrf: '11', fgts: '11' },
    {
      referencia: 'hora',
      percentual: 5_000,
    },
  ),
  rubrica(4, 'Desconto de INSS', 'desconto', incid('inss'), { inss: '31', irrf: '41' }, { natureza: 9201 }),
  rubrica(5, 'Base de cálculo do FGTS', 'base', incid(), {}, { natureza: null }),
  rubrica(
    6,
    'Gratificação natalina antiga',
    'provento',
    incid('inss13', 'irrf13'),
    { inss: '12', irrf: '12' },
    {
      vigencia: { inicio: '2020-01-01', fim: '2024-12-31' },
      natureza: null,
    },
  ),
];

const reducaoZero = { isencaoAte: 0, reducaoDe: 0, reducaoAte: 0, valor: 0, semReducaoAcimaDe: 0 };

export const TABELAS_LEGAIS_SINTETICAS: readonly TabelaLegalFolha[] = [
  {
    inicio: '2026-01-01',
    irrf: {
      faixas: [
        { de: 0, ate: 250_000, aliquota: 0, deducao: 0 },
        { de: 250_001, ate: 350_000, aliquota: 750, deducao: 18_750 },
        { de: 350_001, ate: 450_000, aliquota: 1_500, deducao: 45_000 },
        { de: 450_001, ate: null, aliquota: 2_750, deducao: 100_000 },
      ],
      deducaoDependente: 20_000,
      descontoSimplificado: 60_000,
      reducao: {
        isencaoAte: 500_000,
        reducaoDe: 500_001,
        reducaoAte: 700_000,
        valor: 30_000,
        semReducaoAcimaDe: 700_000,
      },
    },
    inss: {
      faixas: [
        { de: 0, ate: 150_000, aliquota: 750, deducao: 0 },
        { de: 150_001, ate: 300_000, aliquota: 900, deducao: 0 },
        { de: 300_001, ate: 450_000, aliquota: 1_200, deducao: 0 },
        { de: 450_001, ate: 800_000, aliquota: 1_400, deducao: 0 },
      ],
      teto: 800_000,
    },
    salarioFamilia: [{ de: 0, ate: 180_000, cota: 6_000 }],
    salarioMinimo: 150_000,
    contribuinteIndividual: { aliquota: 2_000, teto: 800_000 },
  },
  {
    inicio: '2025-01-01',
    irrf: {
      faixas: [
        { de: 0, ate: 230_000, aliquota: 0, deducao: 0 },
        { de: 230_001, ate: 330_000, aliquota: 750, deducao: 17_250 },
        { de: 330_001, ate: null, aliquota: 1_500, deducao: 42_000 },
      ],
      deducaoDependente: 19_000,
      descontoSimplificado: 56_000,
      reducao: reducaoZero,
    },
    inss: {
      faixas: [
        { de: 0, ate: 140_000, aliquota: 750, deducao: 0 },
        { de: 140_001, ate: 280_000, aliquota: 900, deducao: 0 },
        // Buraco de propósito (a tela mostra a conferência).
        { de: 290_000, ate: 760_000, aliquota: 1_200, deducao: 0 },
      ],
      teto: 760_000,
    },
    salarioFamilia: [{ de: 0, ate: 170_000, cota: 5_500 }],
    salarioMinimo: 140_000,
    contribuinteIndividual: { aliquota: 2_000, teto: 760_000 },
  },
];

/** Dias de afastamento a cargo da empresa por vigência (sintéticos: duas vigências, a mais nova primeiro). */
export const DIAS_AFASTAMENTO_SINTETICOS: readonly DiasAfastamentoFolha[] = [
  { inicio: '2026-01-01', dias: 15 },
  { inicio: '2015-03-01', dias: 30 },
];

export const DOMINIOS_RUBRICAS_SINTETICOS: Pick<ApoioRubricas, 'incidenciasEsocial' | 'naturezas'> = {
  incidenciasEsocial: {
    inss: [
      { codigo: '00', rotulo: 'Não é base de cálculo' },
      { codigo: '11', rotulo: 'Base de cálculo - mensal' },
      { codigo: '12', rotulo: 'Base de cálculo - 13º salário' },
      { codigo: '31', rotulo: 'Contribuição descontada do segurado - mensal' },
    ],
    irrf: [
      { codigo: '00', rotulo: 'Não é base de cálculo' },
      { codigo: '11', rotulo: 'Remuneração mensal' },
      { codigo: '12', rotulo: '13º salário' },
      { codigo: '41', rotulo: 'Dedução: previdência social oficial' },
    ],
    fgts: [
      { codigo: '00', rotulo: 'Não é base de cálculo' },
      { codigo: '11', rotulo: 'Base de cálculo - mensal' },
    ],
    sindical: [
      { codigo: '00', rotulo: 'Não é base de cálculo' },
      { codigo: '11', rotulo: 'Base de cálculo' },
    ],
  },
  naturezas: [
    { id: 1000, codigo: '1000', rotulo: 'Salário, vencimento, soldo' },
    { id: 9201, codigo: '9201', rotulo: 'Contribuição previdenciária' },
  ],
};

export class PortaRubricasMemoria implements PortaRubricas {
  readonly destino = 'memoria' as const;
  podeGravar: PortaRubricas['podeGravar'] = async () => ({ pode: true, codigo: null, motivo: null });
  executar: PortaRubricas['executar'] = semGravacao;
  gravarSgh: PortaRubricas['gravarSgh'] = semGravacao;

  async rubricas(_c: ContextoRubricas, empresa: number | null): Promise<RubricaFolha[]> {
    return RUBRICAS_SINTETICAS.filter((r) => empresa === null || r.empresa === empresa).map((r) => ({
      ...r,
    }));
  }
  async tabelasLegais(): Promise<TabelaLegalFolha[]> {
    return TABELAS_LEGAIS_SINTETICAS.map((t) => structuredClone(t));
  }
  async diasAfastamento(): Promise<DiasAfastamentoFolha[]> {
    return DIAS_AFASTAMENTO_SINTETICOS.map((d) => ({ ...d }));
  }
  async dominios(): Promise<Pick<ApoioRubricas, 'incidenciasEsocial' | 'naturezas'>> {
    return structuredClone(DOMINIOS_RUBRICAS_SINTETICOS);
  }
}
