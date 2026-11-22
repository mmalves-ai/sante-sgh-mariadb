// Porta da agência transfusional, etapa 1 (M47; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `legado`: leituras READ ONLY (os itens de hemoterapia da prescrição vigente, a indicação, os horários do item, a
//     tipagem do cadastro, os termos de consentimento, as requisições, os atos com os sinais, as reações) e as gravações
//     só do novo numa transação SGH_ com a SGH_TRILHA junto. O início com o horário pendente vai pela checagem do M25
//     (porta da enfermagem, executor), com o ato transfusional no registro próprio da mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a enfermagem em memória, com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AdendoAtoLido,
  AtoTransfusionalLido,
  ItemHemoterapiaAAtender,
  ReacaoTransfusionalLida,
  RequisicaoTransfusionalLida,
  SinaisTransfusao,
  TipagemSanguinea,
  VersaoRequisicaoLida,
} from '@sgh/contratos';
import type {
  AdendoAtoNovo,
  AlteracaoRequisicaoNova,
  AmostraTransfusionalNova,
  ConclusaoTransfusaoNova,
  HorarioHemoterapia,
  InicioTransfusaoNovo,
  ReacaoTransfusionalNova,
  RequisicaoTransfusaoNova,
  TermoConsentimentoLido,
} from './transfusao-tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_TRANSFUSAO = Symbol('PORTA_TRANSFUSAO');

export type ContextoTransfusao = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorTransfusao {
  requisitar(r: RequisicaoTransfusaoNova): Promise<{ id: number; repetida: boolean }>;
  cancelar(c: {
    readonly requisicao: number;
    readonly motivo: string;
    readonly usuario: string;
    readonly chave?: string | null | undefined;
  }): Promise<{
    id: number;
  }>;
  amostra(a: AmostraTransfusionalNova): Promise<{ id: number; codigo: string; repetida: boolean }>;
  iniciar(t: InicioTransfusaoNovo): Promise<{ id: number; repetida: boolean }>;
  sinais(s: {
    readonly ato: number;
    readonly momento: 'durante' | 'depois';
    readonly sinais: SinaisTransfusao;
    readonly medidoEm: string;
    readonly foraJanela: boolean;
    readonly usuario: string;
    readonly chave: string | null;
  }): Promise<{ id: number; repetida: boolean }>;
  concluir(
    c: ConclusaoTransfusaoNova,
  ): Promise<{ id: number; estadoRequisicao: string; ganho: number | null }>;
  reacao(r: ReacaoTransfusionalNova): Promise<{ id: number; repetida: boolean; interrompeu: boolean }>;
  notificada(m: {
    readonly reacao: number;
    readonly enviadaEm: string;
    readonly chave?: string | null | undefined;
  }): Promise<{ id: number }>;
  /** W0-03: a requisição alterada antes do atendimento (a versão anterior guardada); 409 depois. */
  alterar(a: AlteracaoRequisicaoNova): Promise<{ id: number; versao: number }>;
  /** W0-03: o adendo do ato (sinais digitados errado); o ato e a medida original não mudam. */
  adendo(a: AdendoAtoNovo): Promise<{ id: number }>;
}

export interface FiltroRequisicoesPorta {
  readonly agora: string;
  readonly estado?: string;
  readonly urgencia?: number;
  readonly de?: string;
  readonly ate?: string;
  readonly atendimento?: number;
  /** Nome ou prontuário, aplicado na leitura antes do teto. */
  readonly termo?: string;
}

export interface PortaTransfusao extends PortaGravacaoM18<GravadorTransfusao> {
  /** Itens de hemoterapia da prescrição vigente ainda sem requisição (os já requisitados saem). */
  itensAAtender(
    c: ContextoTransfusao,
    o: { readonly agora: string; readonly atendimento?: number },
  ): Promise<{ itens: ItemHemoterapiaAAtender[]; cortada: boolean }>;
  /** O item de hemoterapia pelo ID (vigente ou não), com a indicação escrita. */
  item(c: ContextoTransfusao, item: number, agora: string): Promise<ItemHemoterapiaAAtender | null>;
  horarios(c: ContextoTransfusao, item: number): Promise<HorarioHemoterapia[]>;
  tipagem(c: ContextoTransfusao, paciente: number): Promise<TipagemSanguinea>;
  termos(c: ContextoTransfusao, paciente: number): Promise<TermoConsentimentoLido[]>;
  requisicoes(
    c: ContextoTransfusao,
    f: FiltroRequisicoesPorta,
  ): Promise<{ itens: RequisicaoTransfusionalLida[]; cortada: boolean }>;
  requisicao(c: ContextoTransfusao, id: number, agora: string): Promise<RequisicaoTransfusionalLida | null>;
  atos(
    c: ContextoTransfusao,
    f: {
      readonly requisicao?: number;
      readonly ato?: number;
      readonly paciente?: number;
      readonly de?: string;
      readonly ate?: string;
    },
  ): Promise<AtoTransfusionalLido[]>;
  reacoes(
    c: ContextoTransfusao,
    f: { readonly de?: string; readonly ate?: string; readonly reacao?: number },
  ): Promise<ReacaoTransfusionalLida[]>;
  bolsaUsada(c: ContextoTransfusao, numero: string): Promise<boolean>;
  /** W0-03: as versões anteriores da requisição (a original primeiro). */
  versoesRequisicao(c: ContextoTransfusao, requisicao: number): Promise<VersaoRequisicaoLida[]>;
  /** W0-03: os adendos dos atos (mais antigos primeiro). */
  adendos(c: ContextoTransfusao, atos: readonly number[]): Promise<AdendoAtoLido[]>;
  /** A requisição ou o ato já gravado com a chave do pedido (do mesmo usuário), para o reenvio; null: nenhum. */
  gravadoPorChave(
    c: ContextoTransfusao,
    o: { readonly tipo: 'requisicao' | 'ato'; readonly chave: string; readonly usuario: string },
  ): Promise<number | null>;
  /** Sexo, nascimento e nome do paciente (a notificação leva só as iniciais, o sexo e a idade). */
  pessoa(
    c: ContextoTransfusao,
    paciente: number,
  ): Promise<{ sexo: 'F' | 'M' | 'I'; nascimento: string | null; nome: string }>;
}

export const METODOS_PORTA_TRANSFUSAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'itensAAtender',
  'item',
  'horarios',
  'tipagem',
  'termos',
  'requisicoes',
  'requisicao',
  'atos',
  'reacoes',
  'bolsaUsada',
  'versoesRequisicao',
  'adendos',
  'gravadoPorChave',
  'pessoa',
]);
