// Porta da conta do paciente (M30): o que as telas leem e gravam, independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas
//     faturamento.*, com a trilha na mesma transação); as só do novo (pendências, etapas, fila tardia, regras, pacotes,
//     auditoria e particular) em transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): contas, itens e fichas SINTÉTICAS em memória, com as mesmas
//     validações (Zod dos contratos e regras do domínio) e as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
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
import type { FiltroContas, FiltroPagamentos } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_FATURAMENTO = Symbol('PORTA_FATURAMENTO');

export type ContextoFaturamento = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
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
  /** Simulador: o preço de tabela de um código para um convênio e data (somente leitura). */
  simular(
    c: ContextoFaturamento,
    s: {
      convenio: number;
      tipoConta: 'E' | 'I';
      tipo: 1 | 2 | 3 | 4;
      codigo: number;
      quantidade: number;
      data: string;
    },
  ): Promise<{
    encontrado: boolean;
    nome: string;
    preco: { modelo: string; unitario: number; ch: number; cop: number; filme: number; valor: number } | null;
    vigencia: string | null;
  }>;
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
