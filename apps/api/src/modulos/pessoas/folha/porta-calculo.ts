// Porta do cálculo mensal da folha, fatia F2 (M53.3; ficha do M53, seções 4 a 6, regras 7 e 8): o que a API do cálculo
// lê e grava, independente de onde (a API não escreve SQL; fronteira Nx). O ponto fechado, o sobreaviso realizado, os
// afastamentos, as rubricas e as tabelas legais vêm das portas que já os leem (ponto, realizado, interface, rubricas);
// desta, o que é do cálculo:
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto
//     (nenhuma tabela do outro sistema: o cálculo não tem receita de gravação no legado);
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
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
import type {
  CodigosCatalogosObrigacoes,
  FiltroObrigacoesSgh,
  NovaObrigacaoSgh,
  NovosParametrosObrigacoesSgh,
  ObrigacaoPesLida,
  FechamentoFolhaLido,
  FiltroFechamentosFolhaSgh,
  ItemRubricaProcessoLido,
  NovoFechamentoFolhaSgh,
  DependentesDoVinculo,
  DesligadoLido,
  FeriasNaCompetenciaLida,
  FiltroRescisoesSgh,
  NovaRescisaoSgh,
  RescisaoPesLida,
  TipoRescisaoLido,
  FeriasPesLida,
  FiltroFeriasSgh,
  HistoricoFolhaLido,
  NovaFeriasSgh,
  OrigemAdiantamentoDecimo,
  FiltroProcessosFolhaSgh,
  LinhaCalculoSgh,
  NovoProcessoFolhaSgh,
  NovoSalarioSgh,
  ProcessoFolhaLido,
  ResumoVinculoProcessoLido,
  SalarioPesLido,
  VinculoCalculoLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_CALCULO_FOLHA = Symbol('PORTA_CALCULO_FOLHA');

export type ContextoCalculoFolha = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ do cálculo numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorCalculoFolha {
  /** As vigências do salário dos vínculos, lidas na própria transação (conferência do cálculo depois da trava). */
  salarios(vinculos: readonly number[]): Promise<SalarioPesLido[]>;
  incluirSalario(x: SemHospital<NovoSalarioSgh>): Promise<number>;
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
  ): Promise<{ vigente: ProcessoFolhaLido | null; proximoNumero: number }>;
  incluirProcesso(x: SemHospital<NovoProcessoFolhaSgh>): Promise<number>;
  incluirLinhas(processo: number, linhas: readonly LinhaCalculoSgh[]): Promise<number>;
  situacaoProcesso(x: {
    id: number;
    versao: number;
    de: ProcessoFolhaLido['situacao'];
    para: ProcessoFolhaLido['situacao'];
    motivo: string | null;
    por: string;
  }): Promise<void>;
  processo(id: number): Promise<ProcessoFolhaLido | null>;
  resumoVinculos(processo: number): Promise<ResumoVinculoProcessoLido[]>;
  // M53.4 (F3): as frações de férias do vínculo relidas com trava, a inclusão e a troca de situação.
  feriasDoVinculoComTrava(vinculo: number): Promise<FeriasPesLida[]>;
  incluirFerias(x: SemHospital<NovaFeriasSgh>): Promise<number>;
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
  ): Promise<{ desligamento: string | null; tipoRescisao: number | null; rescisoes: RescisaoPesLida[] }>;
  incluirRescisao(x: SemHospital<NovaRescisaoSgh>): Promise<number>;
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
  ): Promise<{ vigente: FechamentoFolhaLido | null; proximoNumero: number }>;
  processosCalculadosComTrava(empresa: number, de: string, ate: string): Promise<ProcessoFolhaLido[]>;
  incluirFechamento(x: SemHospital<NovoFechamentoFolhaSgh>): Promise<number>;
  reabrirFechamento(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  // M53.8 (F7): os parâmetros das obrigações (nova vigência) e a obrigação gerada (as em vigor com trava, a inclusão
  // com o arquivo cifrado, a substituição, a entrega e o cancelamento pela versão).
  incluirParametrosObrigacoes(x: SemHospital<NovosParametrosObrigacoesSgh>): Promise<number>;
  obrigacoesEmVigorComTrava(
    empresa: number,
    tipo: TipoObrigacao,
    periodo: string,
  ): Promise<{ vigentes: ObrigacaoPesLida[]; proximoNumero: number }>;
  obrigacaoComTrava(id: number): Promise<ObrigacaoPesLida | null>;
  incluirObrigacao(x: SemHospital<NovaObrigacaoSgh>): Promise<number>;
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
  vinculos(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<VinculoCalculoLido[]>;
  dependentes(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    data: string,
  ): Promise<Map<number, DependentesDoVinculo>>;
  salarios(c: ContextoCalculoFolha, vinculos: readonly number[]): Promise<SalarioPesLido[]>;
  parametros(c: ContextoCalculoFolha, empresa: number): Promise<ParametrosFolhaLidos[]>;
  processos(c: ContextoCalculoFolha, f: FiltroProcessosFolhaSgh): Promise<ProcessoFolhaLido[]>;
  processo(c: ContextoCalculoFolha, id: number): Promise<ProcessoFolhaLido | null>;
  resumoVinculos(c: ContextoCalculoFolha, processo: number): Promise<ResumoVinculoProcessoLido[]>;
  linhasDoVinculo(c: ContextoCalculoFolha, processo: number, vinculo: number): Promise<LinhaCalculoSgh[]>;
  // M53.4 (F3): férias, histórico das folhas mensais, adiantamentos do 13º e férias com recibo na competência.
  ferias(c: ContextoCalculoFolha, f: FiltroFeriasSgh): Promise<FeriasPesLida[]>;
  feriasPorId(c: ContextoCalculoFolha, id: number): Promise<FeriasPesLida | null>;
  historico(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    de: string,
    ate: string,
  ): Promise<HistoricoFolhaLido[]>;
  adiantamentosDecimo(
    c: ContextoCalculoFolha,
    empresa: number,
    ano: number,
    origens?: readonly OrigemAdiantamentoDecimo[],
  ): Promise<Map<number, number>>;
  feriasNaCompetencia(
    c: ContextoCalculoFolha,
    inicio: string,
    fim: string,
  ): Promise<FeriasNaCompetenciaLida[]>;
  // M53.5 (F4): rescisões, desligados, processamentos que já pagaram o vínculo, FGTS depositado e tipos de rescisão.
  rescisoes(c: ContextoCalculoFolha, f: FiltroRescisoesSgh): Promise<RescisaoPesLida[]>;
  rescisaoPorId(c: ContextoCalculoFolha, id: number): Promise<RescisaoPesLida | null>;
  desligados(c: ContextoCalculoFolha, de: string, ate: string): Promise<DesligadoLido[]>;
  processosDoVinculo(
    c: ContextoCalculoFolha,
    vinculo: number,
    tipo: TipoProcessoFolha,
    de: string,
    ate: string,
  ): Promise<{ processo: number; competencia: string }[]>;
  fgtsDepositado(c: ContextoCalculoFolha, vinculo: number): Promise<number>;
  tiposRescisao(c: ContextoCalculoFolha): Promise<TipoRescisaoLido[]>;
  // M53.7 (F6).
  fechamentos(c: ContextoCalculoFolha, f: FiltroFechamentosFolhaSgh): Promise<FechamentoFolhaLido[]>;
  fechamento(c: ContextoCalculoFolha, id: number): Promise<FechamentoFolhaLido | null>;
  itensRubricaDoProcesso(c: ContextoCalculoFolha, processo: number): Promise<ItemRubricaProcessoLido[]>;
  // M53.8 (F7): parâmetros das obrigações, obrigações geradas (sem o conteúdo), o conteúdo cifrado de uma (a rota de
  // baixar) e os códigos dos catálogos oficiais da SEFIP, do CAGED e da RAIS.
  parametrosObrigacoes(c: ContextoCalculoFolha, empresa: number | null): Promise<ParametrosObrigacoesLidos[]>;
  obrigacoes(c: ContextoCalculoFolha, f: FiltroObrigacoesSgh): Promise<ObrigacaoPesLida[]>;
  obrigacao(c: ContextoCalculoFolha, id: number): Promise<ObrigacaoPesLida | null>;
  conteudoObrigacao(c: ContextoCalculoFolha, id: number): Promise<string | null>;
  catalogosObrigacoes(c: ContextoCalculoFolha): Promise<CodigosCatalogosObrigacoes>;
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
