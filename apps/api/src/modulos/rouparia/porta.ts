// Porta da rouparia e lavanderia (M55; ficha, seções 4 a 7), independente de onde (a API não escreve SQL):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo: leituras somente leitura e
//     as gravações numa operação do Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O "centro de custo" do contrato da tela é o setor do estabelecimento (setor_funcional); o "fornecedor" é a lavanderia
// terceirizada do cadastro (lavanderia_externa).
// Melhoria: tipos de negócio do módulo (sem os tipos do sistema de origem); o usuário vem do contexto (id), não do login;
// a repetição do pedido (Idempotency-Key) é a do Executor, presa à impressão do movimento (tipo, data e setor).
import type {
  CotaRoupa,
  ItemMovimentoRoupa,
  KgSetorDia,
  MovimentoRoupa,
  PecaRoupa,
  PecaRoupaEntrada,
  RegistrarMovimentoRoupaEntrada,
  TipoMovimentoRoupa,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ROUPARIA = Symbol('PORTA_ROUPARIA');

/** O pedido de gravação que se repete pela Idempotency-Key: a chave e a impressão do que foi pedido. */
export interface PedidoRouparia {
  readonly chave: string;
  /** Tipo, data e setor: a mesma chave com outra impressão é recusada (chave-de-outro-movimento). */
  readonly impressao: string;
}

/** O contexto da porta, com o pedido quando a gravação se repete pela chave (registrar movimento). */
export type ContextoRouparia = ContextoPortaM18 & { readonly pedido?: PedidoRouparia };

/** A peça ou o kit como a tela grava (sem a versão vista, que vai à parte). */
export type PecaRoupaGravada = Omit<PecaRoupaEntrada, 'versaoVista'>;

/** O movimento conferido pelo domínio, com a conferência do retorno com o envio. */
export interface MovimentoRoupaNovo extends Omit<RegistrarMovimentoRoupaEntrada, 'itens'> {
  readonly itens: readonly ItemMovimentoRoupa[];
  readonly diferencaKg: number | null;
  readonly diferencaPct: number | null;
  readonly ocorrencia: boolean;
}

/** Totais do período para os indicadores (kg por etapa, peças perdidas, retornos e ocorrências). */
export interface TotaisRouparia {
  readonly kgColetados: number;
  readonly kgEnviados: number;
  readonly kgRetornados: number;
  readonly pecasPerdidas: number;
  readonly retornos: number;
  readonly ocorrencias: number;
}

/** Gravações da rouparia numa transação (as leituras aqui são da mesma transação, com a trava quando dito). */
export interface GravadorRouparia {
  relogio(): Promise<{ hoje: string; agora: string }>;
  pecas(): Promise<PecaRoupa[]>;
  /** O movimento relido na transação (travado até o fim), ou null. */
  movimento(id: number): Promise<MovimentoRoupa | null>;
  incluirPeca(p: PecaRoupaGravada): Promise<{ id: number; versao: number }>;
  alterarPeca(
    p: PecaRoupaGravada & { id: number; versaoVista: number },
  ): Promise<{ id: number; versao: number }>;
  gravarCotas(c: {
    centroCusto: number;
    cotas: readonly { peca: number; quantidade: number }[];
  }): Promise<{ alteradas: number }>;
  registrarMovimento(m: MovimentoRoupaNovo): Promise<{ id: number; versao: number }>;
  cancelarMovimento(c: {
    id: number;
    versaoVista: number;
    motivo: string;
    /** Retorno: o envio que volta a "registrado". */
    remessa: number | null;
  }): Promise<{ id: number; versao: number }>;
}

export interface FiltroMovimentosPorta {
  readonly de: string;
  readonly ate: string;
  readonly tipo?: TipoMovimentoRoupa | null;
  readonly centroCusto?: number | null;
  readonly antesDe?: number | null;
  readonly teto?: number;
}

export interface SetorRouparia {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface PortaRouparia extends PortaGravacaoM18<GravadorRouparia> {
  gravarSgh<T>(
    c: ContextoRouparia,
    trilha: Parameters<PortaGravacaoM18<GravadorRouparia>['gravarSgh']>[1],
    fn: (g: GravadorRouparia) => Promise<T>,
  ): Promise<T>;
  relogio(c: ContextoPortaM18): Promise<{ hoje: string; agora: string }>;
  pecas(c: ContextoPortaM18): Promise<PecaRoupa[]>;
  cotas(c: ContextoPortaM18, centroCusto?: number | null): Promise<CotaRoupa[]>;
  movimentos(
    c: ContextoPortaM18,
    f: FiltroMovimentosPorta,
  ): Promise<{ itens: MovimentoRoupa[]; cortada: boolean }>;
  movimento(c: ContextoPortaM18, id: number): Promise<MovimentoRoupa | null>;
  enviosAbertos(c: ContextoPortaM18): Promise<MovimentoRoupa[]>;
  kgPorSetorDia(c: ContextoPortaM18, de: string, ate: string): Promise<KgSetorDia[]>;
  totais(c: ContextoPortaM18, de: string, ate: string): Promise<TotaisRouparia>;
  inventarios(c: ContextoPortaM18, ate: string): Promise<MovimentoRoupa[]>;
  /** Os setores do estabelecimento, com os inativos marcados. */
  setores(c: ContextoPortaM18): Promise<SetorRouparia[]>;
  /** As lavanderias terceirizadas pelo nome ou código, sem documento nem dado bancário. */
  fornecedores(c: ContextoPortaM18, termo: string): Promise<{ codigo: number; nome: string }[]>;
  fornecedorExiste(c: ContextoPortaM18, codigo: number): Promise<boolean>;
  /** Pacientes-dia do período (o censo diário fechado). */
  pacientesDia(c: ContextoPortaM18, de: string, ate: string): Promise<number>;
}

export const METODOS_PORTA_ROUPARIA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'pecas',
  'cotas',
  'movimentos',
  'movimento',
  'enviosAbertos',
  'kgPorSetorDia',
  'totais',
  'inventarios',
  'setores',
  'fornecedores',
  'fornecedorExiste',
  'pacientesDia',
]);

/** Chave do estado da memória: o estabelecimento da sessão (na sintética sem id numérico, o código dele). */
export function chaveDoEstabelecimento(c: ContextoPortaM18): string {
  const codigo = (c as Partial<{ hospital: string }>).hospital;
  return `${c.cliente}:${c.estabelecimento ?? codigo ?? '-'}`;
}
