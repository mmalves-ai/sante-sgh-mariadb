// Cliente do fluxo de aprovação configurável (F8, 07-FIN linha 65): a configuração (fluxos com etapas e aprovadores,
// agrupadores, respostas padrão e os apoios dos combos), as gravações (criar e encerrar fluxo, salvar agrupador e
// resposta), o envio do documento para aprovação (título a pagar, pedido de compra, contrato), a fila do aprovador
// (também a tela do celular), a decisão e o histórico do pedido. A regra é a do domínio: a tela confere na hora com
// `conferirFluxo` e o servidor confere de novo na gravação.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type {
  CriterioAgrupador,
  DocumentoAprovavel,
  EfeitoResposta,
  RegraQuorum,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const P = '/api/financeiro/fluxo-aprovacao';

export type CanalDecisaoTela = 'web' | 'celular';
export interface OpcaoFluxo {
  readonly id: number;
  readonly rotulo: string;
}
export interface AprovadorTela {
  readonly id?: number;
  readonly usuario: number | null;
  readonly papel: number | null;
  readonly substituto: number | null;
  readonly agrupador: number | null;
  readonly valorLimite: number | null;
  readonly aprovaPeloCelular: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export interface EtapaTela {
  readonly id?: number;
  readonly sequencia: number;
  readonly nome: string;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly regraQuorum: RegraQuorum;
  readonly minimo: number | null;
  readonly obrigatoria: boolean;
  readonly aprovadores: readonly AprovadorTela[];
}
export interface FluxoTela {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: DocumentoAprovavel;
  readonly estabelecimento: number | null;
  readonly centroCusto: number | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly etapas: readonly EtapaTela[];
}
export interface AgrupadorTela {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly criterio: CriterioAgrupador;
  readonly aceitaVazio: boolean;
  readonly ativo: boolean;
  readonly fluxo: number | null;
  readonly membros: readonly number[];
}
export interface RespostaTela {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly efeito: EfeitoResposta;
  readonly exigeJustificativa: boolean;
  readonly fluxo: number | null;
  readonly ordem: number;
  readonly ativo: boolean;
}
export interface ConfiguracaoAprovacao {
  readonly fluxos: readonly FluxoTela[];
  readonly agrupadores: readonly AgrupadorTela[];
  readonly respostas: readonly RespostaTela[];
  readonly apoios: {
    readonly usuarios: readonly OpcaoFluxo[];
    readonly papeis: readonly OpcaoFluxo[];
    readonly centrosCusto: readonly OpcaoFluxo[];
  };
}
export interface NovoFluxoTela {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: DocumentoAprovavel;
  readonly todosEstabelecimentos: boolean;
  readonly centroCusto: number | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly etapas: readonly EtapaTela[];
}
export interface NovoAgrupadorTela {
  readonly id: number | null;
  readonly codigo: string;
  readonly descricao: string;
  readonly criterio: CriterioAgrupador;
  readonly fluxo: number | null;
  readonly aceitaVazio: boolean;
  readonly ativo: boolean;
  readonly membros: readonly number[];
}
export interface NovaRespostaTela {
  readonly id: number | null;
  readonly codigo: string;
  readonly descricao: string;
  readonly efeito: EfeitoResposta;
  readonly exigeJustificativa: boolean;
  readonly fluxo: number | null;
  readonly ordem: number;
  readonly ativo: boolean;
}
export interface PendenciaAprovacao {
  readonly pedido: number;
  readonly tipo: DocumentoAprovavel;
  readonly documento: number;
  readonly numero: string;
  readonly descricao: string;
  readonly valor: number;
  readonly fluxo: string;
  readonly etapa: string;
  readonly nivel: number;
  readonly totalEtapas: number;
  readonly solicitante: string;
  readonly solicitadoEm: string;
  /** O aprovador está liberado para decidir pelo celular nesta etapa. */
  readonly celular: boolean;
  readonly respostas: readonly {
    readonly id: number;
    readonly descricao: string;
    readonly efeito: EfeitoResposta;
    readonly exigeJustificativa: boolean;
  }[];
}
export interface HistoricoPedido {
  readonly pedido: number;
  readonly tipo: string;
  readonly documento: number;
  readonly situacao: string;
  readonly numero: string;
  readonly valor: number;
  readonly decisoes: readonly {
    readonly nivel: number;
    readonly etapa: string;
    readonly resposta: string;
    readonly decisao: string;
    readonly justificativa: string;
    readonly canal: string;
    readonly aprovador: string;
    readonly em: string;
  }[];
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerConfiguracaoAprovacao = (): Promise<ConfiguracaoAprovacao> =>
  ler(`${P}/configuracao`, confiar<ConfiguracaoAprovacao>());
export const lerPendenciasAprovacao = (): Promise<PendenciaAprovacao[]> =>
  ler(`${P}/pendencias`, z.array(confiar<PendenciaAprovacao>()));
export const lerHistoricoPedido = (pedido: number): Promise<HistoricoPedido> =>
  ler(`${P}/pedidos/${pedido}`, confiar<HistoricoPedido>());

/** Cria o fluxo inteiro (etapas e aprovadores); mudar um fluxo é encerrá-lo e criar outro. */
export const criarFluxoAprovacao = (f: NovoFluxoTela, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/fluxos`, f, resultado, chave);
export const encerrarFluxoAprovacao = (fluxo: number, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/fluxos/encerrar`, { fluxo }, resultado, chave);
export const salvarAgrupadorAprovacao = (a: NovoAgrupadorTela, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/agrupadores`, a, resultado, chave);
export const salvarRespostaAprovacao = (r: NovaRespostaTela, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/respostas`, r, resultado, chave);
/** Envia o documento para o fluxo que o atende (sem fluxo, o título a pagar segue a alçada simples). */
export const submeterParaAprovacao = (
  tipo: DocumentoAprovavel,
  documento: number,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/submeter`, { tipo, documento }, resultado, chave);
export const decidirAprovacao = (
  pedido: number,
  resposta: number,
  justificativa: string,
  canal: CanalDecisaoTela,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/decidir`, { pedido, resposta, justificativa, canal }, resultado, chave);
