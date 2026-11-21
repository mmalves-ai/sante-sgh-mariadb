// Dados sintéticos da contabilidade (nenhum dado real: códigos, IDs e valores inventados).
import type { ContaPlano, FatoContabil, LinhaFonte, RegraContabil } from '@sgh/contratos';

export const conta = (codigo: string, extra: Partial<ContaPlano> = {}): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta ${codigo}`,
  grupo: 'ativo',
  tipo: 'analitica',
  natureza: 'devedora',
  referencialTipo: 4,
  referencialConta: '1.01',
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
  ...extra,
});

export const PLANO: ContaPlano[] = [
  conta('1', { tipo: 'sintetica' }),
  conta('1.1', { tipo: 'sintetica' }),
  conta('1.1.2', { tipo: 'sintetica' }),
  conta('1.1.2.01', { tipo: 'sintetica' }),
  conta('1.1.2.01.0001', { nome: 'Convênios a receber', contaExportacao: 1101 }),
  conta('1.1.2.01.0002', { nome: 'Convênio B a receber', contaExportacao: 1102 }),
  conta('3', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01.0001', { grupo: 'receita', natureza: 'credora', nome: 'Receita de convênios' }),
  conta('3.1.1.01.0002', { grupo: 'receita', natureza: 'credora', nome: 'Receita de internação' }),
  conta('3.1.1.01.0009', { grupo: 'receita', natureza: 'credora', nome: 'Glosas', ativa: false }),
];

export const regra = (extra: Partial<RegraContabil> = {}): RegraContabil => ({
  empresa: 1,
  origem: 3,
  tipoFato: 'receitaConta',
  versao: 1,
  nome: 'Receita da conta',
  vigenciaInicio: '2027-01-01',
  vigenciaFim: null,
  prioridade: 100,
  condicoes: [],
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'dePara', campoChave: 'convenio', contaPadrao: null },
      valor: { base: 'valorFato' },
      historico: 'Receita {documento} {competencia}',
      centroCusto: 'nenhum',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: '3.1.1.01.0001' },
      valor: { base: 'valorFato' },
      historico: 'Receita {documento}',
      centroCusto: 'doFato',
    },
  ],
  ...extra,
});

export const linha = (
  tabela: string,
  id: number,
  valores: LinhaFonte['valores'],
  carimbo: string | null = null,
): LinhaFonte => ({
  tabela,
  id,
  carimbo,
  valores,
});

export const fato = (extra: Partial<FatoContabil> = {}): FatoContabil => ({
  tabela: 'conta_hospitalar',
  id: 10,
  tipo: 'receitaConta',
  origem: 3,
  empresa: 1,
  data: '2027-01-15',
  competencia: '2027-01',
  valorCentavos: 150_000,
  centroCusto: 7,
  documento: 'conta 10',
  campos: { convenio: 5 },
  impressao: 'abc',
  carimbo: null,
  estorno: false,
  referencia: null,
  ...extra,
});
