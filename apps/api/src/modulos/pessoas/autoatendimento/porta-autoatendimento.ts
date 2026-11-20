// Porta das solicitações do autoatendimento (W0-06, parte 6b-2; M3 de mercado): o que as telas leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx). Só tabelas SGH_ (script 1067 e as do ponto, das férias e
// do colaborador). A aprovação grava o efeito NA MESMA transação da decisão (D-W006-SOLIC-EFEITO): por isso o gravador
// traz, além das gravações da solicitação, os gravadores do ponto, das férias e do colaborador sobre o mesmo escritor.
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória do ponto, da folha e do colaborador;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AcessoAtestadoLido,
  AjusteDaSolicitacaoLido,
  AtestadoPesLido,
  DadosAtestadoSgh,
  DadosSolicitacaoSgh,
  SituacaoSolicitacaoPes,
  SolicitacaoPesLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import type { GravadorCalculoFolha } from '../folha/porta-calculo.js';
import type { GravadorPessoas } from '../porta.js';
import type { GravadorPonto } from '../ponto/porta-ponto.js';

export const PORTA_AUTOATENDIMENTO = Symbol('PORTA_AUTOATENDIMENTO');

export type ContextoAutoatendimento = ContextoPortaM18;

/** As gravações da solicitação (1067), com as releituras na transação. */
export interface GravadorSolicitacoes {
  solicitacao(id: number): Promise<SolicitacaoPesLida | null>;
  incluirSolicitacao(x: DadosSolicitacaoSgh & { vinculo: number; por: string }): Promise<number>;
  incluirAtestado(x: DadosAtestadoSgh & { solicitacao: number; por: string }): Promise<number>;
  decidirSolicitacao(x: {
    id: number;
    versao: number;
    situacao: 'aprovada' | 'recusada';
    motivo: string | null;
    ferias: number | null;
    por: string;
  }): Promise<void>;
  desistirSolicitacao(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  ligarAjuste(x: { ajuste: number; solicitacao: number }): Promise<void>;
  ajustesDaSolicitacao(solicitacao: number): Promise<AjusteDaSolicitacaoLido[]>;
  /** Leitura com escrita: grava o acesso (quem, finalidade, se viu o CID). */
  atestado(x: {
    solicitacao: number;
    verCid: boolean;
    finalidade: string;
    por: string;
  }): Promise<AtestadoPesLido | null>;
}

/** O gravador da solicitação mais os efeitos, todos sobre a mesma transação. */
export interface GravadorAutoatendimento extends GravadorSolicitacoes {
  readonly ponto: Pick<
    GravadorPonto,
    | 'travarPessoa'
    | 'eventosPeriodo'
    | 'marcacoes'
    | 'ajuste'
    | 'ajustes'
    | 'incluirAjuste'
    | 'decidirAjuste'
    | 'desistirAjuste'
  >;
  readonly folha: Pick<GravadorCalculoFolha, 'feriasDoVinculoComTrava' | 'incluirFerias'>;
  readonly pessoas: Pick<
    GravadorPessoas,
    'vinculo' | 'corrigirVinculo' | 'incluirHistorico' | 'registrarCorrecao'
  >;
}

export interface FiltroSolicitacoesPorta {
  readonly vinculos?: readonly number[] | null;
  readonly situacao?: SituacaoSolicitacaoPes | null;
}

export interface PortaAutoatendimento extends PortaGravacaoM18<GravadorAutoatendimento> {
  hoje(c: ContextoAutoatendimento): Promise<string>;
  solicitacoes(c: ContextoAutoatendimento, filtro: FiltroSolicitacoesPorta): Promise<SolicitacaoPesLida[]>;
  solicitacao(c: ContextoAutoatendimento, id: number): Promise<SolicitacaoPesLida | null>;
  ajustesDaSolicitacao(c: ContextoAutoatendimento, solicitacao: number): Promise<AjusteDaSolicitacaoLido[]>;
  acessosAtestado(c: ContextoAutoatendimento, solicitacao: number): Promise<AcessoAtestadoLido[]>;
}

export const METODOS_PORTA_AUTOATENDIMENTO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'solicitacoes',
  'solicitacao',
  'ajustesDaSolicitacao',
  'acessosAtestado',
]);
