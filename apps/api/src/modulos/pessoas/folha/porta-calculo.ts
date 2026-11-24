// Porta do cálculo mensal da folha (M53.3 a M53.8): o que a API do cálculo lê e grava, independente de onde (a API não
// escreve SQL). O ponto fechado, o sobreaviso realizado, os afastamentos, as rubricas e as tabelas legais vêm das portas
// que já os leem; desta, o que é do cálculo:
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-calculo-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  ApuracaoFolha,
  ParametrosObrigacoesLidos,
  TipoObrigacao,
  ParametrosFolha,
  ParametrosFolhaLidos,
  SituacaoFerias,
  SituacaoRescisao,
  TipoProcessoFolha,
} from '@sgh/contratos';
import {
  type CatalogoObrigacoesOficiais,
  type DependentesDoVinculo,
  type FechamentoDaFolha,
  type FeriasDoVinculo,
  type FeriasNaCompetencia,
  type FiltroFechamentosDaFolha,
  type FiltroFeriasDaFolha,
  type FiltroObrigacoesDaFolha,
  type FiltroProcessosDaFolha,
  type FiltroRescisoesDaFolha,
  type HistoricoDaFolha,
  type ItemRubricaDoProcesso,
  type LinhaCalculoDoVinculo,
  type NovaObrigacaoDaFolha,
  type NovaRescisaoDaFolha,
  type NovasFerias,
  type NovoFechamentoDaFolha,
  type NovoProcessoDaFolha,
  type NovoSalarioDoVinculo,
  type NovosParametrosObrigacoes,
  type ObrigacaoDaFolha,
  type OrigemAdiantamentoDecimo,
  type ProcessoDaFolha,
  type RescisaoDaFolha,
  type ResumoVinculoDoProcesso,
  type SalarioDoVinculo,
  type TipoRescisaoDaFolha,
  type VinculoDesligado,
  type VinculoDoCalculo,
} from './tipos-folha.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_CALCULO_FOLHA = Symbol('PORTA_CALCULO_FOLHA');

export type ContextoCalculoFolha = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações do cálculo numa transação, com as releituras dentro dela. */
export interface GravadorCalculoFolha {
  /** As vigências do salário dos vínculos, lidas na própria transação (conferência do cálculo depois da trava). */
  salarios(vinculos: readonly number[]): Promise<SalarioDoVinculo[]>;
  incluirSalario(x: SemHospital<NovoSalarioDoVinculo>): Promise<number>;
  parametros(empresa: number): Promise<ParametrosFolhaLidos[]>;
  incluirParametros(x: ParametrosFolha & { readonly por: string }): Promise<number>;
  /**
   * O processamento `calculada` da empresa na competência e no tipo (padrão `mensal`) relido com trava, e o número
   * seguinte; `intervalo` alarga a busca do vigente (a 1ª parcela do 13º vale para o ano).
   */
  emVigorComTrava(
    empresa: number,
    competencia: string,
    tipo?: TipoProcessoFolha,
    intervalo?: { readonly de: string; readonly ate: string } | null,
  ): Promise<{ vigente: ProcessoDaFolha | null; proximoNumero: number }>;
  incluirProcesso(x: SemHospital<NovoProcessoDaFolha>): Promise<number>;
  incluirLinhas(processo: number, linhas: readonly LinhaCalculoDoVinculo[]): Promise<number>;
  situacaoProcesso(x: {
    id: number;
    versao: number;
    de: ProcessoDaFolha['situacao'];
    para: ProcessoDaFolha['situacao'];
    motivo: string | null;
    por: string;
  }): Promise<void>;
  processo(id: number): Promise<ProcessoDaFolha | null>;
  resumoVinculos(processo: number): Promise<ResumoVinculoDoProcesso[]>;
  // M53.4 (F3): as frações de férias do vínculo relidas com trava, a inclusão e a troca de situação.
  feriasDoVinculoComTrava(vinculo: number): Promise<FeriasDoVinculo[]>;
  incluirFerias(x: SemHospital<NovasFerias>): Promise<number>;
  situacaoFerias(x: {
    id: number;
    versao: number;
    de: SituacaoFerias;
    para: SituacaoFerias;
    processo?: number | null;
    motivo: string | null;
    por: string;
  }): Promise<void>;
  // M53.5 (F4): o vínculo (desligamento relido) e as rescisões dele com trava, a inclusão e a troca de situação.
  rescisoesDoVinculoComTrava(
    vinculo: number,
  ): Promise<{ desligamento: string | null; tipoRescisao: number | null; rescisoes: RescisaoDaFolha[] }>;
  incluirRescisao(x: SemHospital<NovaRescisaoDaFolha>): Promise<number>;
  situacaoRescisao(x: {
    id: number;
    versao: number;
    de: SituacaoRescisao;
    para: SituacaoRescisao;
    motivo: string | null;
    por: string;
  }): Promise<void>;
  // M53.7 (F6): o fechamento do período (o vigente com trava, os processamentos calculados do intervalo com trava, a
  // inclusão e a reabertura). Incluir ou trocar a situação de processamento de período fechado é recusado.
  fechamentoEmVigorComTrava(
    empresa: number,
    apuracao: ApuracaoFolha,
    periodo: string,
  ): Promise<{ vigente: FechamentoDaFolha | null; proximoNumero: number }>;
  processosCalculadosComTrava(empresa: number, de: string, ate: string): Promise<ProcessoDaFolha[]>;
  incluirFechamento(x: SemHospital<NovoFechamentoDaFolha>): Promise<number>;
  reabrirFechamento(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  // M53.8 (F7): os parâmetros das obrigações (nova vigência) e a obrigação gerada (as em vigor com trava, a inclusão
  // com o arquivo cifrado, a substituição, a entrega e o cancelamento pela versão).
  incluirParametrosObrigacoes(x: SemHospital<NovosParametrosObrigacoes>): Promise<number>;
  obrigacoesEmVigorComTrava(
    empresa: number,
    tipo: TipoObrigacao,
    periodo: string,
  ): Promise<{ vigentes: ObrigacaoDaFolha[]; proximoNumero: number }>;
  obrigacaoComTrava(id: number): Promise<ObrigacaoDaFolha | null>;
  incluirObrigacao(x: SemHospital<NovaObrigacaoDaFolha>): Promise<number>;
  substituirObrigacao(x: { id: number; versao: number; por: string }): Promise<void>;
  registrarEntregaObrigacao(x: {
    id: number;
    versao: number;
    protocolo: string;
    data: string;
    valorGuia: number | null;
    acrescimos: number | null;
    por: string;
  }): Promise<void>;
  cancelarObrigacao(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
}

export interface PortaCalculoFolha extends PortaGravacaoM18<GravadorCalculoFolha> {
  vinculos(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<VinculoDoCalculo[]>;
  dependentes(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    data: string,
  ): Promise<Map<number, DependentesDoVinculo>>;
  salarios(c: ContextoCalculoFolha, vinculos: readonly number[]): Promise<SalarioDoVinculo[]>;
  parametros(c: ContextoCalculoFolha, empresa: number): Promise<ParametrosFolhaLidos[]>;
  processos(c: ContextoCalculoFolha, f: FiltroProcessosDaFolha): Promise<ProcessoDaFolha[]>;
  processo(c: ContextoCalculoFolha, id: number): Promise<ProcessoDaFolha | null>;
  resumoVinculos(c: ContextoCalculoFolha, processo: number): Promise<ResumoVinculoDoProcesso[]>;
  linhasDoVinculo(
    c: ContextoCalculoFolha,
    processo: number,
    vinculo: number,
  ): Promise<LinhaCalculoDoVinculo[]>;
  // M53.4 (F3): férias, histórico das folhas mensais, adiantamentos do 13º e férias com recibo na competência.
  ferias(c: ContextoCalculoFolha, f: FiltroFeriasDaFolha): Promise<FeriasDoVinculo[]>;
  feriasPorId(c: ContextoCalculoFolha, id: number): Promise<FeriasDoVinculo | null>;
  historico(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    de: string,
    ate: string,
  ): Promise<HistoricoDaFolha[]>;
  adiantamentosDecimo(
    c: ContextoCalculoFolha,
    empresa: number,
    ano: number,
    origens?: readonly OrigemAdiantamentoDecimo[],
  ): Promise<Map<number, number>>;
  feriasNaCompetencia(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<FeriasNaCompetencia[]>;
  // M53.5 (F4): rescisões, desligados, processamentos que já pagaram o vínculo, FGTS depositado e tipos de rescisão.
  rescisoes(c: ContextoCalculoFolha, f: FiltroRescisoesDaFolha): Promise<RescisaoDaFolha[]>;
  rescisaoPorId(c: ContextoCalculoFolha, id: number): Promise<RescisaoDaFolha | null>;
  desligados(c: ContextoCalculoFolha, de: string, ate: string): Promise<VinculoDesligado[]>;
  processosDoVinculo(
    c: ContextoCalculoFolha,
    vinculo: number,
    tipo: TipoProcessoFolha,
    de: string,
    ate: string,
  ): Promise<{ processo: number; competencia: string }[]>;
  fgtsDepositado(c: ContextoCalculoFolha, vinculo: number): Promise<number>;
  tiposRescisao(c: ContextoCalculoFolha): Promise<TipoRescisaoDaFolha[]>;
  // M53.7 (F6).
  fechamentos(c: ContextoCalculoFolha, f: FiltroFechamentosDaFolha): Promise<FechamentoDaFolha[]>;
  fechamento(c: ContextoCalculoFolha, id: number): Promise<FechamentoDaFolha | null>;
  itensRubricaDoProcesso(c: ContextoCalculoFolha, processo: number): Promise<ItemRubricaDoProcesso[]>;
  // M53.8 (F7): parâmetros das obrigações, obrigações geradas (sem o conteúdo), o conteúdo cifrado de uma (a rota de
  // baixar) e o catálogo oficial das obrigações acessórias (edição versionada vigente na data; hoje, por omissão).
  parametrosObrigacoes(c: ContextoCalculoFolha, empresa: number | null): Promise<ParametrosObrigacoesLidos[]>;
  obrigacoes(c: ContextoCalculoFolha, f: FiltroObrigacoesDaFolha): Promise<ObrigacaoDaFolha[]>;
  obrigacao(c: ContextoCalculoFolha, id: number): Promise<ObrigacaoDaFolha | null>;
  conteudoObrigacao(c: ContextoCalculoFolha, id: number): Promise<string | null>;
  catalogosObrigacoes(c: ContextoCalculoFolha, data?: string): Promise<CatalogoObrigacoesOficiais>;
}

export const METODOS_PORTA_CALCULO_FOLHA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'vinculos',
  'dependentes',
  'salarios',
  'parametros',
  'processos',
  'processo',
  'resumoVinculos',
  'linhasDoVinculo',
  'ferias',
  'feriasPorId',
  'historico',
  'adiantamentosDecimo',
  'feriasNaCompetencia',
  'rescisoes',
  'rescisaoPorId',
  'desligados',
  'processosDoVinculo',
  'fgtsDepositado',
  'tiposRescisao',
  'fechamentos',
  'fechamento',
  'itensRubricaDoProcesso',
  'parametrosObrigacoes',
  'obrigacoes',
  'obrigacao',
  'conteudoObrigacao',
  'catalogosObrigacoes',
]);
