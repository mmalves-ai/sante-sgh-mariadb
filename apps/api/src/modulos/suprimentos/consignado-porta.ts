// Porta do consignado (M46, etapa 4; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL):
//   - `banco` (consignado-porta-propria.ts): as leituras e as gravações no MariaDB do cliente pelo @sgh/nucleo, nas
//     tabelas remessa_consignada(+_item), reposicao_consignada, consumo_opme, saldo_consignado e nota_entrada; cada
//     gravação é UMA operação do executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; os consumos vêm do OPME em memória;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  ConsumoConsignado,
  TipoMovimentoConsignado,
  ItemBusca,
  MovimentoConsignado,
  NotaEntradaConsignado,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CONSIGNADO = Symbol('PORTA_CONSIGNADO');

/** Uma linha de movimento a gravar (a remessa, a reposição ou o faturamento de um consumo, ou a devolução). */
export interface LinhaMovimentoConsignado {
  readonly tipo: TipoMovimentoConsignado;
  readonly quantidade: number;
  readonly consumo: number | null;
  readonly nfNumero: string | null;
  readonly nfSerie: string | null;
  readonly nfEmissao: string | null;
  /** A nota da entrada do estoque: o ano e o mês da entrada e o id da nota (`doc`). */
  readonly nfEntrada: { readonly ano: number; readonly mes: number; readonly doc: number } | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly validade: string | null;
  readonly motivo: string | null;
}

/** O pedido de gravação de um grupo de movimentos do par fornecedor e item. */
export interface MovimentoConsignadoGravacao {
  readonly fornecedor: number;
  readonly item: number;
  readonly linhas: readonly LinhaMovimentoConsignado[];
  readonly usuario: string;
  readonly chave: string;
  /**
   * A entrada do pedido como chegou (o corpo validado): o reenvio com a mesma chave tem de trazer a mesma entrada; outra
   * entrada com a chave já usada é recusada (idempotencia-divergente), nunca devolvida como repetição.
   */
  readonly pedido: unknown;
}

/** O saldo de um fornecedor e item com as parcelas (regra 10), somado no banco (sem o teto das listas). */
export interface SaldoConsignadoAgregado {
  readonly fornecedor: number;
  readonly item: number;
  readonly remessas: number;
  readonly reposicoes: number;
  readonly consumidos: number;
  readonly devolvidos: number;
  readonly saldo: number;
  readonly aRepor: number;
  readonly aFaturar: number;
}

/** As gravações numa transação do executor, com a trilha junto; as leituras aqui são da mesma transação. */
export interface GravadorConsignado {
  /** Os movimentos já gravados com a chave; a mesma chave com outra entrada (`pedido`) é recusada. */
  movimentosPelaChave(chave: string, pedido: unknown): Promise<MovimentoConsignado[] | null>;
  /** Os consumos pedidos, relidos e travados até o fim da transação. */
  consumos(ids: readonly number[]): Promise<ConsumoConsignado[]>;
  /**
   * O saldo do par fornecedor e item relido na transação DEPOIS da trava do par (a devolução simultânea do mesmo par
   * espera e recusa; revisão do M46.4).
   */
  saldoTravado(fornecedor: number, item: number, usuario: string): Promise<number>;
  gravar(m: MovimentoConsignadoGravacao): Promise<{ grupo: number; movimentos: number[]; repetido: boolean }>;
}

export interface PortaConsignado extends PortaGravacaoM18<GravadorConsignado> {
  movimentos(
    c: ContextoPortaM18,
    fornecedor: number | null,
  ): Promise<{ itens: MovimentoConsignado[]; cortada: boolean }>;
  consumos(
    c: ContextoPortaM18,
    fornecedor: number | null,
  ): Promise<{ itens: ConsumoConsignado[]; cortada: boolean }>;
  /** O saldo por fornecedor e item somado no banco (regra 10), sem o teto das listas. */
  saldos(
    c: ContextoPortaM18,
    fornecedor: number | null,
  ): Promise<{ itens: SaldoConsignadoAgregado[]; cortada: boolean }>;
  saldoCadastro(c: ContextoPortaM18): Promise<{ fornecedor: number; item: number; quantidade: number }[]>;
  nomes(
    c: ContextoPortaM18,
    fornecedores: readonly number[],
    itens: readonly number[],
  ): Promise<{ fornecedores: Map<number, string>; itens: Map<number, string> }>;
  notaEntrada(
    c: ContextoPortaM18,
    nf: { ano: number; mes: number; doc: number },
    item: number,
  ): Promise<{ fornecedor: number; temItem: boolean } | null>;
  /** As notas da entrada do estoque do fornecedor com o item (a escolha do faturamento). */
  notasEntrada(c: ContextoPortaM18, fornecedor: number, item: number): Promise<NotaEntradaConsignado[]>;
  fornecedorExiste(c: ContextoPortaM18, fornecedor: number): Promise<boolean>;
  classeDoItem(c: ContextoPortaM18, item: number): Promise<number | null>;
  referenciaConsignada(c: ContextoPortaM18, item: number): Promise<boolean>;
  /** Os itens do cadastro do estoque pelo nome ou código (a busca da remessa). */
  buscarItens(c: ContextoPortaM18, termo: string): Promise<ItemBusca[]>;
}

export const METODOS_PORTA_CONSIGNADO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'movimentos',
  'consumos',
  'saldos',
  'saldoCadastro',
  'nomes',
  'notaEntrada',
  'notasEntrada',
  'fornecedorExiste',
  'classeDoItem',
  'referenciaConsignada',
  'buscarItens',
]);
