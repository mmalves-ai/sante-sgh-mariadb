// Porta do estoque, do almoxarifado e das compras (M28): o que as telas leem e gravam, independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente (MariaDB) pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura e gravações
//     pelo Executor, com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): itens, saldos, lotes, documentos e pedidos SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: o item do cadastro é um tipo de negócio do módulo (sem o tipo do sistema de origem).
import type {
  DocumentosPorSistema,
  EfeitoDocumentoNovo,
  HorariosUnidade,
  RequisicoesPorLocal,
  UsoEstoquePorLocal,
  ConsumoEstoque,
  DocumentoDetalhe,
  DocumentoEstoque,
  EscopoUsuarioEstoque,
  FichaItem,
  FornecedorLido,
  PrestadorLido,
  TerceiroLido,
  FechamentosEstoque,
  HistoricoCompra,
  InventarioLido,
  ItemBusca,
  KitRastreavel,
  LotesDoPaciente,
  ParametrosEstoque,
  PedidoDetalhe,
  PedidoResumo,
  PosicaoMensal,
  RastreioLote,
  RecalculosEstoque,
  RequisicaoPendente,
  SaldoItem,
  TipoDocumentoEstoque,
  TransferenciaEnviada,
} from '@sgh/contratos';
import type { FaixaAlcada } from '@sgh/dominio-suprimentos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type { KitPadraoCadastro, ProcedimentoKitBusca } from '@sgh/contratos';

export const PORTA_SUPRIMENTOS = Symbol('PORTA_SUPRIMENTOS');

export type ContextoSuprimentos = ContextoPortaM18;

/** O item do cadastro com o saldo e o valor no estabelecimento (custo médio = valor / quantidade). */
export interface ItemCadastroEstoque {
  readonly codigo: number;
  readonly nome: string;
  /** Controla lote e validade. */
  readonly rastreavel: boolean;
  readonly controlado: boolean;
  readonly consignado: boolean;
  /** Quantidade em estoque no estabelecimento. */
  readonly estoque: number;
  /** Valor do estoque no estabelecimento. */
  readonly total: number;
  readonly custoMedio: number;
}

/** Gravações diretas da porta, numa transação com a trilha junto (o estabelecimento vem do contexto). */
export interface GravadorSghSuprimentos {
  aprovarPedido(a: {
    ano: number;
    doc: number;
    decisao: 'aprovado' | 'reprovado';
    justificativa: string;
    usuario: string;
    nivel: number;
    faixas: readonly FaixaAlcada[];
  }): Promise<{ id: number; valor: number; nivel: number }>;
  enviarTransferencia(t: {
    origem: number;
    destino: number;
    observacao: string | null;
    itens: readonly {
      item: number;
      quantidade: number;
      lotes: readonly { lote: string; validade: string; quantidade: number }[];
    }[];
    usuario: string;
  }): Promise<number>;
  cancelarTransferencia(r: { id: number; motivo: string; usuario: string }): Promise<void>;
  registrarDivergencia(r: { id: number; motivo: string }): Promise<void>;
  abrirInventario(i: {
    local: number;
    tipo: 'geral' | 'ciclico';
    /** Cíclico pela curva ABC do saldo no local (sem itens escolhidos). */
    curva?: 'A' | 'B' | 'C';
    limitePct: number;
    /** No banco, vazio no geral (todo o saldo do local); o saldo mandado é ignorado (o do banco vale). */
    itens: readonly { item: number; saldo: number }[];
    usuario: string;
  }): Promise<number>;
  registrarContagem(c: {
    inventario: number;
    item: number;
    quantidade: number;
    usuario: string;
  }): Promise<{ ordem: number }>;
  decidirInventario(d: {
    inventario: number;
    decisao: 'aprovado' | 'cancelado';
    justificativa: string;
    usuario: string;
    podeAprovar: boolean;
  }): Promise<void>;
  conferirCarrinho(c: {
    kit: number;
    lacre: string;
    conferidos: readonly number[];
    pendencias: string | null;
    usuario: string;
  }): Promise<number>;
  definirPontoPedido(p: {
    item: number;
    local: number;
    prazoDias: number;
    estoqueSeguranca: number | null;
    usuario: string;
  }): Promise<void>;
  /** A autorização da requisição pendente (só quem tem a marca "autoriza requisição"); uma vez por requisição. */
  autorizarRequisicao(a: { ano: number; mes: number; doc: number; usuario: string }): Promise<void>;
}

export interface PortaSuprimentos extends PortaGravacaoM18<GravadorSghSuprimentos> {
  relogio(c: ContextoSuprimentos): Promise<{ hoje: string; ano: number; mes: number }>;
  locais(c: ContextoSuprimentos): Promise<{ codigo: number; nome: string }[]>;
  centrosCusto(
    c: ContextoSuprimentos,
  ): Promise<{ codigo: number; nome: string; localConsumo: number; tecnico: boolean }[]>;
  mesesFechados(c: ContextoSuprimentos): Promise<{ ano: number; mes: number; exportado: boolean }[]>;
  buscarItens(c: ContextoSuprimentos, termo: string): Promise<ItemBusca[]>;
  itens(c: ContextoSuprimentos, codigos: readonly number[]): Promise<Map<number, ItemCadastroEstoque>>;
  saldos(
    c: ContextoSuprimentos,
    f: {
      item?: number;
      local?: number;
      termo?: string;
      comSaldo?: boolean;
      hoje: string;
      alertaDias: number;
    },
  ): Promise<{ competencia: { ano: number; mes: number }; itens: SaldoItem[]; cortada: boolean }>;
  lotesDoLocal(
    c: ContextoSuprimentos,
    item: number,
    local: number,
    hoje: string,
    alertaDias: number,
  ): Promise<SaldoItem['lotes']>;
  posicaoMensal(c: ContextoSuprimentos, item: number, hoje: string): Promise<PosicaoMensal>;
  fichaItem(c: ContextoSuprimentos, item: number): Promise<FichaItem | null>;
  documentos(
    c: ContextoSuprimentos,
    f: { tipo: TipoDocumentoEstoque; local?: number; inicio: string; fim: string; pagina?: number },
  ): Promise<{ itens: DocumentoEstoque[]; cortada: boolean }>;
  documento(
    c: ContextoSuprimentos,
    tipo: TipoDocumentoEstoque,
    chave: { ano: number; mes: number; doc: number },
  ): Promise<DocumentoDetalhe | null>;
  requisicoes(
    c: ContextoSuprimentos,
    o: { local?: number; hoje: string },
  ): Promise<{ itens: RequisicaoPendente[]; cortada: boolean }>;
  rastreio(c: ContextoSuprimentos, item: number, lote: string): Promise<RastreioLote>;
  lotesDoPaciente(c: ContextoSuprimentos, atendimento: number): Promise<LotesDoPaciente>;
  consumo(
    c: ContextoSuprimentos,
    competencia: { ano: number; mes: number },
  ): Promise<Omit<ConsumoEstoque, 'fonte'>>;
  consumoMensalPorItem(
    c: ContextoSuprimentos,
    o: { local?: number; meses: readonly { ano: number; mes: number }[] },
  ): Promise<Map<number, { consumos: number[]; valor: number }>>;
  emPedidoPorItem(c: ContextoSuprimentos, desdeAno: number): Promise<Map<number, number>>;
  pedidos(
    c: ContextoSuprimentos,
    o: { ano: number; situacao?: number; termo?: string },
  ): Promise<{ itens: PedidoResumo[]; cortada: boolean }>;
  pedido(c: ContextoSuprimentos, ano: number, doc: number): Promise<PedidoDetalhe | null>;
  historicoCompras(c: ContextoSuprimentos, item: number): Promise<HistoricoCompra>;
  fechamentos(c: ContextoSuprimentos, corrente: { ano: number; mes: number }): Promise<FechamentosEstoque>;
  recalculos(c: ContextoSuprimentos): Promise<RecalculosEstoque>;
  parametros(c: ContextoSuprimentos, login: string): Promise<ParametrosEstoque>;
  escopo(c: ContextoSuprimentos, login: string): Promise<EscopoUsuarioEstoque | null>;
  fornecedores(c: ContextoSuprimentos, termo: string): Promise<{ itens: FornecedorLido[]; cortada: boolean }>;
  terceiros(c: ContextoSuprimentos, termo: string): Promise<{ itens: TerceiroLido[]; cortada: boolean }>;
  prestadores(c: ContextoSuprimentos, termo: string): Promise<{ itens: PrestadorLido[]; cortada: boolean }>;
  usuarios(
    c: ContextoSuprimentos,
    termo: string,
  ): Promise<{ usuario: string; nome: string; locais: number }[]>;
  kits(c: ContextoSuprimentos, hoje: string, alertaDias: number): Promise<KitRastreavel[]>;
  kit(c: ContextoSuprimentos, id: number, hoje: string, alertaDias: number): Promise<KitRastreavel | null>;
  kitsPadraoCadastro(c: ContextoSuprimentos): Promise<KitPadraoCadastro[]>;
  procedimentosKit(c: ContextoSuprimentos, termo: string): Promise<ProcedimentoKitBusca[]>;
  kitsPadrao(
    c: ContextoSuprimentos,
  ): Promise<{ codigo: number; nome: string; itens: { item: number; nome: string; quantidade: number }[] }[]>;
  inventarios(
    c: ContextoSuprimentos,
  ): Promise<{ id: number; local: number; tipo: string; situacao: string; abertoEm: string }[]>;
  inventario(c: ContextoSuprimentos, id: number, cego: boolean): Promise<InventarioLido | null>;
  estoqueInicial(
    c: ContextoSuprimentos,
  ): Promise<{ doc: number; data: string; local: number; itens: number }[]>;
  transferencias(
    c: ContextoSuprimentos,
    o: { local?: number; etapa?: string },
  ): Promise<TransferenciaEnviada[]>;
  envio(
    c: ContextoSuprimentos,
    id: number,
  ): Promise<{
    origem: number;
    destino: number;
    etapa: string;
    itens: { item: number; quantidade: number; lotes: string | null }[];
  } | null>;
  pontosPedido(
    c: ContextoSuprimentos,
    local?: number,
  ): Promise<Map<string, { prazoDias: number; estoqueSeguranca: number | null }>>;
}

export interface LeituraOnda3 {
  readonly documentos: DocumentosPorSistema[];
  readonly efeitos: EfeitoDocumentoNovo[];
  readonly horarios: HorariosUnidade[];
  readonly requisicoes: RequisicoesPorLocal[];
  readonly uso: UsoEstoquePorLocal[];
  readonly cortada: boolean;
}

export interface LeituraRegra1Onda3 {
  readonly atendidas: { local: number; unidade: string; dispensacoes: number }[];
  readonly prescricoes: { unidade: string; n: number }[];
}

export const METODOS_PORTA_SUPRIMENTOS: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'locais',
  'centrosCusto',
  'mesesFechados',
  'buscarItens',
  'itens',
  'saldos',
  'lotesDoLocal',
  'posicaoMensal',
  'documentos',
  'documento',
  'requisicoes',
  'rastreio',
  'lotesDoPaciente',
  'consumo',
  'consumoMensalPorItem',
  'emPedidoPorItem',
  'pedidos',
  'pedido',
  'historicoCompras',
  'fechamentos',
  'recalculos',
  'parametros',
  'escopo',
  'usuarios',
  'fornecedores',
  'fichaItem',
  'terceiros',
  'prestadores',
  'kits',
  'kit',
  'kitsPadrao',
  'inventarios',
  'inventario',
  'estoqueInicial',
  'transferencias',
  'envio',
  'pontosPedido',
]);
