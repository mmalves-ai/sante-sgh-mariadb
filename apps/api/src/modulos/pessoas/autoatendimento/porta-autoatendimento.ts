// Porta das solicitações do autoatendimento (W0-06, parte 6b-2; M3 de mercado; F2.2 lote 03-02): o que as telas leem e
// gravam, independente de onde (a API não escreve SQL; fronteira Nx). A aprovação grava o efeito NA MESMA transação da
// decisão: por isso o gravador traz, além das gravações da solicitação, os gravadores do ponto, das férias e do
// colaborador sobre a mesma transação.
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts), gravações numa operação do Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória do ponto, da folha e do colaborador;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import type { GravadorCalculoFolha } from '../folha/porta-calculo.js';
import type { GravadorPessoas } from '../porta.js';
import type { GravadorPonto } from '../ponto/porta-ponto.js';
import type {
  AcessoAtestado,
  AjusteDaSolicitacao,
  AtestadoRegistrado,
  DadosAtestado,
  DadosSolicitacao,
  SituacaoSolicitacao,
  SolicitacaoRegistrada,
} from './tipos.js';

export const PORTA_AUTOATENDIMENTO = Symbol('PORTA_AUTOATENDIMENTO');

export type ContextoAutoatendimento = ContextoPortaM18;

/** As gravações da solicitação, com as releituras na transação. */
export interface GravadorSolicitacoes {
  solicitacao(id: number): Promise<SolicitacaoRegistrada | null>;
  incluirSolicitacao(x: DadosSolicitacao & { vinculo: number; por: string }): Promise<number>;
  incluirAtestado(x: DadosAtestado & { solicitacao: number; por: string }): Promise<number>;
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
  ajustesDaSolicitacao(solicitacao: number): Promise<AjusteDaSolicitacao[]>;
  /** Leitura com escrita: grava o acesso (quem, finalidade, se viu o CID). */
  atestado(x: {
    solicitacao: number;
    verCid: boolean;
    finalidade: string;
    por: string;
  }): Promise<AtestadoRegistrado | null>;
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
  readonly situacao?: SituacaoSolicitacao | null;
}

export interface PortaAutoatendimento extends PortaGravacaoM18<GravadorAutoatendimento> {
  hoje(c: ContextoAutoatendimento): Promise<string>;
  solicitacoes(c: ContextoAutoatendimento, filtro: FiltroSolicitacoesPorta): Promise<SolicitacaoRegistrada[]>;
  solicitacao(c: ContextoAutoatendimento, id: number): Promise<SolicitacaoRegistrada | null>;
  ajustesDaSolicitacao(c: ContextoAutoatendimento, solicitacao: number): Promise<AjusteDaSolicitacao[]>;
  acessosAtestado(c: ContextoAutoatendimento, solicitacao: number): Promise<AcessoAtestado[]>;
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
