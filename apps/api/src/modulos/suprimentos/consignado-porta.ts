// Porta do consignado (M46, etapa 4; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `legado`: as leituras READ ONLY (SGH_SUP_CONSIGNADO, os consumos em sala do consignado, o saldo do cadastro, a nota
//     da entrada e o fornecedor); os movimentos numa transação SGH_ com a SGH_TRILHA junto (os consumos relidos e
//     travados na MESMA transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; os consumos vêm do OPME em memória;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Nenhuma operação do consignado passa pelo executor: a nota de faturamento é a entrada por nota do M28 (sem mudança).
import type {
  ConsumoConsignado,
  ItemBusca,
  MovimentoConsignado,
  NotaEntradaConsignado,
} from '@sgh/contratos';
import type { MovimentoConsignadoSgh, SaldoConsignadoAgregado } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CONSIGNADO = Symbol('PORTA_CONSIGNADO');

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorConsignado {
  movimentosPelaChave(chave: string): Promise<MovimentoConsignado[] | null>;
  /** Os consumos pedidos, relidos e travados até o fim da transação. */
  consumos(ids: readonly number[]): Promise<ConsumoConsignado[]>;
  /**
   * O saldo do par fornecedor e item relido na transação DEPOIS da trava do par (a devolução simultânea do mesmo par
   * espera e recusa; revisão do M46.4).
   */
  saldoTravado(fornecedor: number, item: number, usuario: string): Promise<number>;
  gravar(
    m: Omit<MovimentoConsignadoSgh, 'hospital'>,
  ): Promise<{ grupo: number; movimentos: number[]; repetido: boolean }>;
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
