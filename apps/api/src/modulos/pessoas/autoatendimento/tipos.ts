// Tipos de negócio das solicitações do autoatendimento (F2.2, lote 03-02): o pedido, a decisão, os ajustes do ponto
// ligados e o atestado, sem forma de banco. Os campos que a tela já conhece vêm do contrato (@sgh/contratos).
import type { IncluirSolicitacaoEntrada, SolicitacaoPessoaResposta } from '@sgh/contratos';

export type TipoSolicitacao = SolicitacaoPessoaResposta['tipo'];
export type SituacaoSolicitacao = SolicitacaoPessoaResposta['situacao'];

/** Os dados do pedido conforme o tipo (o que não se aplica fica nulo). */
export type DadosSolicitacao = Pick<
  SolicitacaoPessoaResposta,
  | 'tipo'
  | 'inicio'
  | 'fim'
  | 'diasGozo'
  | 'diasAbono'
  | 'adiantaDecimo'
  | 'movimento'
  | 'justificativa'
  | 'campo'
  | 'valorAnterior'
  | 'valorNovo'
  | 'observacao'
>;

export type SolicitacaoRegistrada = DadosSolicitacao &
  Pick<
    SolicitacaoPessoaResposta,
    | 'id'
    | 'vinculo'
    | 'situacao'
    | 'pedidoPor'
    | 'pedidoEm'
    | 'decididoPor'
    | 'decididoEm'
    | 'motivoDecisao'
    | 'ferias'
    | 'temAtestado'
    | 'versao'
  >;

export interface AjusteDaSolicitacao {
  readonly id: number;
  readonly dia: string;
  readonly situacao: SolicitacaoPessoaResposta['ajustes'][number]['situacao'];
  readonly versao: number;
}

/** O atestado informado no pedido (emissão, dias, CID, emitente e o anexo). */
export type DadosAtestado = Extract<IncluirSolicitacaoEntrada, { tipo: 'atestado' }>['atestado'];

export interface AtestadoRegistrado {
  readonly id: number;
  readonly solicitacao: number;
  readonly emitidoEm: DadosAtestado['emitidoEm'];
  readonly dias: number;
  readonly cid: string | null;
  readonly temCid: boolean;
  readonly emitente: DadosAtestado['emitente'];
  readonly registroConselho: DadosAtestado['registroConselho'];
  readonly arquivo: DadosAtestado['arquivo'];
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface AcessoAtestado {
  readonly id: number;
  readonly acessadoPor: string;
  readonly acessadoEm: string;
  readonly viuCid: boolean;
  readonly finalidade: string;
}

/** A chave do estado em memória pelo contexto (o estabelecimento da sessão, ou o código dele nos testes). */
export function chaveDoContexto(c: object): string {
  const x = c as { hospital?: unknown; estabelecimento?: unknown };
  return String(x.hospital ?? x.estabelecimento ?? '');
}
