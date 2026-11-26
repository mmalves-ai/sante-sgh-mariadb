// Porta da conta do paciente (M30): o que as telas leem e gravam, independente de onde (a API não escreve SQL fora da
// porta; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente, pelo @sgh/nucleo: leituras somente leitura nas tabelas da
//     conta (conta_hospitalar, conta_hospitalar_item, pendencia_conta, conta_hospitalar_etapa, auditoria_conta...) e
//     gravações pelo Executor (operações faturamento.*: trilha, outbox e idempotência na mesma transação); as
//     gravações diretas (pendências, etapas, auditoria, orçamento e caixa) numa transação com a trilha junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): contas, itens e fichas SINTÉTICAS em memória, com as mesmas
//     validações (Zod dos contratos e regras do domínio) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: o contexto é o do núcleo (cliente, estabelecimento e usuário por id) mais a rede e o código do
// estabelecimento da sessão; os filtros são tipos do próprio módulo.
import type {
  AuditoriaConta,
  CaixaLido,
  ContaDetalhe,
  DecidirLancamentoTardioEntrada,
  EditarPacoteEntrada,
  EditarRegraFaturabilidadeEntrada,
  EtapaContaEntrada,
  ExplicacaoLida,
  ItemSigtap,
  LancamentoTardio,
  ListaContas,
  ListaItens,
  NotaSala,
  OrcamentoParticular,
  PacoteLido,
  PagamentoLido,
  PainelLancamentos,
  ReceberParticularEntrada,
  ReciboLido,
  RegistrarOrcamentoEntrada,
  RegistrarPendenciaEntrada,
  RegistrarVersaoAuditoriaEntrada,
  RegraLida,
  WorklistFaturamento,
} from '@sgh/contratos';
import type { SituacaoDerivada } from '@sgh/dominio-faturamento';
import type { ReajusteSimulado } from '@sgh/dominio-preco';
import type { ContextoPorta } from '../cadastro/porta.js';
import { type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';

export const PORTA_FATURAMENTO = Symbol('PORTA_FATURAMENTO');

/** Contexto da porta: o do núcleo (cliente, estabelecimento, usuário, correlação), a rede e o código do estabelecimento. */
export type ContextoFaturamento = ContextoPorta;

/** Filtro da lista de contas. */
export interface FiltroContas {
  readonly situacao: SituacaoDerivada | null;
  /** Convênios do escopo do usuário; null: todos. */
  readonly convenios: readonly number[] | null;
  readonly ano: number | null;
  readonly mes: number | null;
  /** E: externa (ambulatório, pronto atendimento); I: internação. */
  readonly tipoConta: 'E' | 'I' | null;
  readonly termo: string;
  readonly sus: boolean;
  /** Só as contas com alta até esta data (AAAA-MM-DD). */
  readonly altaAte: string | null;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Filtro dos pagamentos do particular. */
export interface FiltroPagamentos {
  readonly caixa: number | null;
  readonly forma: string | null;
  readonly situacao: string | null;
  readonly desde: string | null;
  readonly ate: string | null;
  readonly pagina?: number;
  readonly porPagina?: number;
}

/** Gravações diretas da porta, numa transação com a linha da trilha junto (o estabelecimento vem do contexto). */
export interface GravadorSghFaturamento {
  registrarPendencia(p: RegistrarPendenciaEntrada & { usuario: string }): Promise<number>;
  resolverPendencia(r: { id: number; resolucao: string; usuario: string }): Promise<{ conta: number }>;
  registrarEtapa(x: EtapaContaEntrada & { usuario: string }): Promise<number>;
  decidirLancamentoTardio(
    d: DecidirLancamentoTardioEntrada & { usuario: string; conta: number | null },
  ): Promise<number>;
  editarRegra(r: EditarRegraFaturabilidadeEntrada & { usuario: string }): Promise<number>;
  editarPacote(p: EditarPacoteEntrada & { usuario: string }): Promise<number>;
  registrarVersaoAuditoria(v: RegistrarVersaoAuditoriaEntrada & { usuario: string }): Promise<number>;
  registrarOrcamento(
    o: RegistrarOrcamentoEntrada & { usuario: string },
  ): Promise<{ id: number; total: number }>;
  abrirCaixa(c: { usuario: string; saldoInicial: number }): Promise<number>;
  fecharCaixa(c: { usuario: string; id: number; contado: number }): Promise<{ esperado: number }>;
  receberParticular(
    r: ReceberParticularEntrada & { usuario: string; simulado: boolean },
  ): Promise<{ pagamentos: number[]; troco: number }>;
  emitirRecibo(r: {
    usuario: string;
    pagamento: number;
    pagador: string;
    referente: string;
  }): Promise<{ id: number; numero: number }>;
}

export type FiltroContasPorta = FiltroContas;

export interface PortaFaturamento extends PortaGravacaoM18<GravadorSghFaturamento> {
  hoje(c: ContextoFaturamento): Promise<string>;
  /** Os convênios do estabelecimento (código e nome), para o filtro da lista de contas. */
  convenios(c: ContextoFaturamento): Promise<{ codigo: number; nome: string }[]>;
  /** Os setores ativos do estabelecimento (id e nome), para a escolha do setor no simulador (06-FAT linha 11). */
  setoresDoSimulador(c: ContextoFaturamento): Promise<{ id: number; nome: string }[]>;
  contas(c: ContextoFaturamento, f: FiltroContasPorta, hoje: string): Promise<ListaContas>;
  conta(c: ContextoFaturamento, id: number, hoje: string): Promise<ContaDetalhe | null>;
  itens(
    c: ContextoFaturamento,
    conta: number,
    o: {
      pagina: number;
      porPagina: number;
      tipo?: number | null;
      naoConferidos?: boolean;
      regua?: 'competencia' | 'data-item';
      mes?: string | null;
    },
  ): Promise<ListaItens>;
  explicar(c: ContextoFaturamento, item: number): Promise<ExplicacaoLida | null>;
  /** A conta da pendência (para o escopo antes de resolver; null: a pendência não existe). */
  contaDaPendencia(c: ContextoFaturamento, id: number): Promise<number | null>;
  /** O convênio da conta (null: a conta não existe), sem ler o resto da conta. */
  convenioDaConta(c: ContextoFaturamento, conta: number): Promise<number | null>;
  /** A conta é particular (fonte pagadora de tipo particular)? Nulo: conta inexistente no estabelecimento. */
  contaParticular(c: ContextoFaturamento, conta: number): Promise<boolean | null>;
  /** O convênio da conta do item (para o escopo). */
  convenioDoItem(c: ContextoFaturamento, item: number): Promise<number | null>;
  sigtap(c: ContextoFaturamento, conta: number): Promise<ItemSigtap[]>;
  painelLancamentos(
    c: ContextoFaturamento,
    o: { ano: number; mes: number; desde: string; convenios: readonly number[] | null },
  ): Promise<PainelLancamentos>;
  tardios(
    c: ContextoFaturamento,
    o: { desde: string; convenios: readonly number[] | null; pagina: number; porPagina: number },
  ): Promise<{ itens: LancamentoTardio[]; total: number }>;
  auditoria(c: ContextoFaturamento, conta: number): Promise<AuditoriaConta>;
  tiposPendencia(c: ContextoFaturamento): Promise<{ id: number; nome: string; modulos: number[] }[]>;
  apoioPacotes(c: ContextoFaturamento): Promise<{
    controles: { id: number; nome: string }[];
    orcamentosPadrao: {
      convenio: number;
      procedimento: number;
      tipo: number;
      nome: string;
      valor: number;
      quantidade: number;
    }[];
    orcamentoAntigo: number;
  }>;
  regras(c: ContextoFaturamento): Promise<RegraLida[]>;
  pacotes(c: ContextoFaturamento): Promise<PacoteLido[]>;
  notaSala(c: ContextoFaturamento, cirurgia: number): Promise<NotaSala | null>;
  cirurgias(
    c: ContextoFaturamento,
    desde: string,
  ): Promise<{ id: number; data: string | null; sala: number; conta: number | null }[]>;
  orcamentos(c: ContextoFaturamento, hoje: string): Promise<OrcamentoParticular[]>;
  caixas(c: ContextoFaturamento, operador: string | null): Promise<CaixaLido[]>;
  pagamentos(c: ContextoFaturamento, f: FiltroPagamentos): Promise<PagamentoLido[]>;
  recibos(c: ContextoFaturamento, antigos: boolean): Promise<ReciboLido[]>;
  worklist(
    c: ContextoFaturamento,
    o: { convenios: readonly number[] | null; hoje: string; prazoDias: number; desde: string },
  ): Promise<WorklistFaturamento>;
  /** Simulador: o preço de um código para um convênio e data, explicado, e o impacto de um reajuste (somente leitura). */
  simular(c: ContextoFaturamento, s: PedidoSimulacao): Promise<ResultadoSimulacao>;
}

/** Pedido do simulador (06-FAT linha 11): o item, onde seria lançado e, opcional, o reajuste a medir (em %). */
export interface PedidoSimulacao {
  convenio: number;
  tipoConta: 'E' | 'I';
  tipo: 1 | 2 | 3 | 4;
  codigo: number;
  quantidade: number;
  data: string;
  /** Setor do lançamento: o índice do setor no acordo. */
  setor?: number | null;
  horarioEspecial?: boolean;
  reajuste?: ReajusteSimulado | null;
}

export interface ResultadoSimulacao {
  encontrado: boolean;
  nome: string;
  preco: { modelo: string; unitario: number; ch: number; cop: number; filme: number; valor: number } | null;
  vigencia: string | null;
  /** De onde saiu o unitário: do índice do acordo (CH ou PORTE) ou da vigência do valor da tabela. */
  origem?: 'indice' | 'vigencia' | null;
  /** A explicação do valor, passo a passo (a mesma memória gravada no item quando lançado). */
  passos?: readonly string[];
  /** O item é cobrado pelo índice e falta valor no acordo: o que falta. */
  falta?: string | null;
  /** O impacto do reajuste pedido, na quantidade simulada. */
  impacto?: {
    atual: number | null;
    novo: number | null;
    diferenca: number | null;
    percentual: number | null;
    afetadoPor: readonly string[];
    passos: readonly string[];
  } | null;
}

export const METODOS_PORTA_FATURAMENTO: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'hoje',
  'convenios',
  'contas',
  'conta',
  'itens',
  'explicar',
  'contaDaPendencia',
  'convenioDaConta',
  'contaParticular',
  'convenioDoItem',
  'sigtap',
  'painelLancamentos',
  'tardios',
  'auditoria',
  'tiposPendencia',
  'apoioPacotes',
  'regras',
  'pacotes',
  'notaSala',
  'cirurgias',
  'orcamentos',
  'caixas',
  'pagamentos',
  'recibos',
  'worklist',
  'simular',
]);

export function portaFaturamentoIndisponivel(): PortaFaturamento {
  return portaIndisponivel<PortaFaturamento>(METODOS_PORTA_FATURAMENTO);
}
