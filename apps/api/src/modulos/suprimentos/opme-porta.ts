// Porta do OPME (M46, etapa 3; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (as SGH_SUP_OPME_*, os itens de OPME com o saldo, o rastreio reverso e os itens
//     da conta); a solicitação e as etapas numa transação SGH_ com a SGH_TRILHA junto (a solicitação relida e travada
//     na MESMA transação); o consumo em sala e a devolução pelo EXECUTOR do M04 (suprimentos.registrarSaida e
//     suprimentos.registrarDevolucao com o bloco `opme`, o rastreio no registro próprio da mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala e o estado vêm da porta do centro cirúrgico; os locais e os centros de custo, da do estoque.
import type { ExpostoOpme, ItemOpme, SaidaLoteOpme, SolicitacaoOpme } from '@sgh/contratos';
import type { ConsumoOpmeLido, EtapaOpmeSgh, MudancaSolicitacaoOpme, SolicitacaoOpmeSgh } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_OPME = Symbol('PORTA_OPME');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorOpme {
  /** A solicitação relida na transação (travada até o fim), ou null. */
  solicitacao(id: number): Promise<SolicitacaoOpme | null>;
  /** A etapa já gravada pela chave do pedido (o reenvio da tela), ou null. */
  etapaPelaChave(chave: string): Promise<{ id: number; solicitacao: number } | null>;
  solicitar(s: SemHospital<SolicitacaoOpmeSgh>): Promise<{ id: number; versao: number; repetida: boolean }>;
  avancar(
    x: SemHospital<EtapaOpmeSgh> & { readonly versaoVista: number; readonly mudanca: MudancaSolicitacaoOpme },
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
  consumosDosAgendamentos(c: ContextoPortaM18, agendamentos: readonly number[]): Promise<ConsumoOpmeLido[]>;
  consumosDoPeriodo(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: ConsumoOpmeLido[]; cortada: boolean }>;
  consumo(c: ContextoPortaM18, id: number): Promise<ConsumoOpmeLido | null>;
  consumoPelaChave(c: ContextoPortaM18, chave: string): Promise<ConsumoOpmeLido | null>;
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
