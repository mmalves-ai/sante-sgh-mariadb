// Tipos de negócio do registro de serviços compartilhados da Rede (M57, etapa 3): a forma do contrato da tela
// (`ServicoCompartilhado`), o filtro e as mudanças que a porta grava. Instantes em ISO 8601.
import type { AreaServicoCompartilhado, SituacaoServicoCompartilhado } from '@sgh/contratos';
import { TETO_LISTA_SERVICOS_REDE } from '@sgh/contratos';

export interface ServicoCompartilhadoLido {
  /** Estabelecimento de quem registrou. */
  readonly estabelecimento: string;
  readonly id: number;
  readonly area: AreaServicoCompartilhado;
  readonly titulo: string;
  readonly descricao: string | null;
  /** Os estabelecimentos envolvidos na oportunidade. */
  readonly estabelecimentos: readonly string[];
  readonly situacao: SituacaoServicoCompartilhado;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly atualizadoPor: string | null;
  readonly atualizadoEm: string | null;
}

export interface FiltroServicosRede {
  readonly area?: AreaServicoCompartilhado;
  readonly situacao?: SituacaoServicoCompartilhado;
  /** Parte do título ou da descrição (sem diferença de maiúsculas). */
  readonly busca?: string;
  /** Quantos dos mais recentes ler (a junção pagina em memória). */
  readonly ate: number;
}

export interface NovoServicoParaGravar {
  readonly area: AreaServicoCompartilhado;
  readonly titulo: string;
  readonly descricao: string | null;
  readonly estabelecimentos: readonly string[];
}

export type MudancaServicoParaGravar = Partial<NovoServicoParaGravar> & {
  readonly situacao?: SituacaoServicoCompartilhado;
};

/** Teto de leitura de cada estabelecimento (o mesmo teto da lista da tela). */
export const TETO_SERVICOS_POR_BANCO = TETO_LISTA_SERVICOS_REDE;
