// Porta do OPME (M46, etapa 3), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (opme-porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala e o estado vêm da porta do centro cirúrgico; os locais e os centros de custo, da do estoque.
// Melhoria: a solicitação, a etapa e o consumo lido são tipos de negócio do módulo (sem o tipo do sistema de origem).
import type {
  ConsumoOpme,
  EtapaOpme,
  ExpostoOpme,
  ItemOpme,
  SaidaLoteOpme,
  SituacaoOpme,
  SolicitacaoOpme,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_OPME = Symbol('PORTA_OPME');

/** O consumo lido, com o paciente, o cirurgião e o fornecedor (o rastreio e a conciliação). */
export interface ConsumoOpmeLeitura extends ConsumoOpme {
  readonly paciente: number | null;
  readonly cirurgiao: number | null;
  readonly fornecedor: number | null;
}

/** A solicitação de OPME a gravar. */
export interface NovaSolicitacaoOpme {
  readonly agendamento: number;
  readonly sala: number;
  /** AAAA-MM-DDTHH:mm (o início previsto do agendamento). */
  readonly dataHora: string;
  /** O atendimento do paciente. */
  readonly reg: number;
  readonly paciente: number | null;
  readonly item: number;
  readonly tuss: string;
  readonly quantidade: number;
  readonly fornecedor: number | null;
  readonly justificativa: string;
  readonly consignado: boolean;
  /** AAAA-MM-DDTHH:mm (a hora do pedido). */
  readonly em: string;
  readonly usuario: string;
  readonly chave: string | null;
}

/** Uma etapa da solicitação (cotação, autorização, recebimento, consumo, devolução). */
export interface NovaEtapaOpme {
  readonly solicitacao: number;
  readonly seq?: number;
  readonly etapa: EtapaOpme;
  readonly em: string;
  readonly quantidade?: number | null;
  readonly fornecedor?: number | null;
  readonly senha?: string | null;
  readonly guia?: string | null;
  readonly validade?: string | null;
  readonly pedido?: { ano: number; doc: number } | null;
  readonly nf?: { ano: number; mes: number; doc: number } | null;
  readonly saida?: { ano: number; mes: number; doc: number } | null;
  readonly lancamento?: number | null;
  readonly consumo?: number | null;
  readonly observacao?: string | null;
  readonly usuario: string;
  readonly chave: string | null;
}

/** O que a etapa muda na solicitação. */
export interface MudancaSolicitacaoOpme {
  readonly situacao: SituacaoOpme;
  readonly autorizada?: number;
  readonly consumida?: number;
  readonly devolvida?: number;
  readonly senha?: string | null;
  readonly guia?: string | null;
  readonly validade?: string | null;
  readonly fornecedor?: number | null;
  readonly consignado?: boolean;
}

/** Gravações diretas, numa transação com a trilha junto; as leituras aqui são da mesma transação. */
export interface GravadorOpme {
  /** A solicitação relida na transação (travada até o fim), ou null. */
  solicitacao(id: number): Promise<SolicitacaoOpme | null>;
  /** A etapa já gravada pela chave do pedido (o reenvio da tela), ou null. */
  etapaPelaChave(chave: string): Promise<{ id: number; solicitacao: number } | null>;
  solicitar(s: NovaSolicitacaoOpme): Promise<{ id: number; versao: number; repetida: boolean }>;
  avancar(
    x: NovaEtapaOpme & { readonly versaoVista: number; readonly mudanca: MudancaSolicitacaoOpme },
  ): Promise<{ etapa: number; versao: number }>;
}

export interface PortaOpme extends PortaGravacaoM18<GravadorOpme> {
  solicitacoesDosAgendamentos(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<SolicitacaoOpme[]>;
  solicitacoesDoPeriodo(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: SolicitacaoOpme[]; cortada: boolean }>;
  solicitacao(c: ContextoPortaM18, id: number): Promise<SolicitacaoOpme | null>;
  consumosDosAgendamentos(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<ConsumoOpmeLeitura[]>;
  consumosDoPeriodo(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: ConsumoOpmeLeitura[]; cortada: boolean }>;
  consumo(c: ContextoPortaM18, id: number): Promise<ConsumoOpmeLeitura | null>;
  consumoPelaChave(c: ContextoPortaM18, chave: string): Promise<ConsumoOpmeLeitura | null>;
  /** O local de estoque de onde a saída do consumo partiu (a devolução volta a ele), ou null. */
  localDaSaida(c: ContextoPortaM18, saida: { ano: number; mes: number; doc: number }): Promise<number | null>;
  /** O fornecedor, o pedido e a nota fiscal citados nas etapas, relidos no cadastro (null: inexistente). */
  documentosCompra(
    c: ContextoPortaM18,
    d: {
      fornecedor: number | null;
      pedido: { ano: number; doc: number } | null;
      nf: { ano: number; mes: number; doc: number } | null;
    },
  ): Promise<{
    fornecedor: string | null;
    pedido: { fornecedores: number[] } | null;
    nf: { fornecedor: number } | null;
  }>;
  /** O primeiro dos locais (na ordem dada) com saldo de OPME, ou null (o contrato do local sugerido). */
  localComSaldo(c: ContextoPortaM18, locais: readonly number[]): Promise<number | null>;
  /** Os fornecedores pelo nome ou código, para a busca da tela (só o código e o nome). */
  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ itens: { codigo: number; nome: string }[]; cortada: boolean }>;
  itens(
    c: ContextoPortaM18,
    f: { termo: string; local: number; hoje: string },
  ): Promise<{ itens: ItemOpme[]; cortada: boolean }>;
  classeDoItem(c: ContextoPortaM18, item: number): Promise<number | null>;
  itemConsignado(c: ContextoPortaM18, item: number): Promise<boolean>;
  rastreioReverso(
    c: ContextoPortaM18,
    f: { item: number | null; lote: string | null; serie: string | null; registroAnvisa: string | null },
  ): Promise<{
    itemNome: string | null;
    expostos: ExpostoOpme[];
    saidasDoLote: number;
    saidasEstoque: SaidaLoteOpme[];
    cortada: boolean;
  }>;
  itensDaConta(
    c: ContextoPortaM18,
    contas: readonly number[],
    itens: readonly number[],
  ): Promise<{ conta: number; item: number; quantidade: number }[]>;
}

export const METODOS_PORTA_OPME: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'solicitacoesDosAgendamentos',
  'solicitacoesDoPeriodo',
  'solicitacao',
  'consumosDosAgendamentos',
  'consumosDoPeriodo',
  'consumo',
  'consumoPelaChave',
  'localDaSaida',
  'documentosCompra',
  'localComSaldo',
  'fornecedores',
  'itens',
  'classeDoItem',
  'itemConsignado',
  'rastreioReverso',
  'itensDaConta',
]);
