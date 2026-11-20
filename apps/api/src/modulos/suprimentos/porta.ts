// Porta do estoque, do almoxarifado e das compras (M28): o que as telas leem e gravam, independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas
//     suprimentos.*, com a trilha na mesma transação); as só do novo (aprovação por alçada, envio da transferência,
//     inventário, carrinho, ponto de pedido) em transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): itens, saldos, lotes, documentos e pedidos SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  DocumentosPorSistema,
  EfeitoDocumentoNovo,
  HorariosUnidade,
  LeituraNumericaOnda3,
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
import type { ItemEstoqueTx } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_SUPRIMENTOS = Symbol('PORTA_SUPRIMENTOS');

export type ContextoSuprimentos = ContextoPortaM18;

export type ItemCadastroEstoque = ItemEstoqueTx;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
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
    limitePct: number;
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
  /**
   * M41 (campo 4): as leituras do painel "Efeito no estoque dos documentos do novo" num dia (READ ONLY, só agregados ou
   * chaves de documento): os documentos do dia por sistema, o efeito dos gatilhos nos documentos do novo, os horários
   * prescritos × dispensados por unidade, as requisições pendentes e quem ainda usa o estoque pelo outro sistema.
   */
  onda3(c: ContextoSuprimentos, dia: string, hoje: string): Promise<LeituraOnda3>;
  /** M41 (campo 10): saldo do local e preço médio, lidos agora, dos itens movimentados pelo novo no dia. */
  onda3Numerica(c: ContextoSuprimentos, dia: string): Promise<LeituraNumericaOnda3[]>;
  /**
   * M41 (campo 10): saldo do local e preço médio, lidos agora na competência do dia, dos pares item × local pedidos
   * (os que o chave-usuário informou; teto de 500), movimentados ou não pelo novo no dia.
   */
  onda3LerPares(
    c: ContextoSuprimentos,
    dia: string,
    pares: readonly { item: number; local: number | null }[],
  ): Promise<LeituraNumericaOnda3[]>;
  /** M41 (regra 1): as unidades atendidas por local (competência corrente e anterior) e as prescrições do novo. */
  onda3Regra1(c: ContextoSuprimentos, hoje: string): Promise<LeituraRegra1Onda3>;
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
  'onda3',
  'onda3Numerica',
  'onda3LerPares',
  'onda3Regra1',
]);
