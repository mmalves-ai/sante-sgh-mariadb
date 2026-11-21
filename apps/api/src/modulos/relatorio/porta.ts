// Porta do catálogo de relatórios e da gestão dos relatórios (M34; ficha, seções 4, 6 e 7): o que as telas do catálogo,
// da triagem, dos pedidos e do envio agendado leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (MariaDB, pelo @sgh/nucleo): as consultas revisadas do
//     catálogo em transação só de leitura com teto de linhas e tempo; a triagem, o agendamento, a execução e o pedido
//     gravados pelo Executor, com a trilha, o outbox e a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): linhas SINTÉTICAS por relatório, a triagem de um inventário
//     sintético e os agendamentos e pedidos em memória, com as mesmas validações;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ContextoNucleo } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type {
  AcessoDeOrigem,
  AgendamentoRelatorio,
  AlvoDependenciaRelatorio,
  AlvoEventoRelatorio,
  DadosAgendamento,
  DadosPedido,
  DecisaoTriagem,
  EventoRelatorio,
  ExecucaoRelatorio,
  FiltroTriagem,
  ItemTriagem,
  LinhaRelatorio,
  NovaExecucao,
  PedidoRelatorio,
  PropostaTriagem,
  RegistroEventoRelatorio,
  RelatorioDeOrigem,
  ResumoTriagem,
  ValoresDoRelatorio,
  VinculoRelatorio,
} from './tipos.js';

export * from './tipos.js';

export const PORTA_RELATORIO = Symbol('PORTA_RELATORIO');

/** O contexto do núcleo (cliente, estabelecimento e usuário por id, correlação) mais a rede e o código do
 * estabelecimento da sessão (a memória separa os dados sintéticos pelo código). */
export interface ContextoRelatorio extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

export interface OpcoesExecucao {
  readonly teto: number;
  readonly tempoMaximoMs: number;
}

/** As gravações da gestão, numa transação com a trilha, o outbox e a idempotência (o estabelecimento vem do contexto). */
export interface GravadorRelatorio {
  gravarPropostas(
    propostas: readonly PropostaTriagem[],
  ): Promise<{ incluidas: number; atualizadas: number; preservadas: number }>;
  /** A área confirma (aceita) o destino; a decisão só passa a ser dela se o destino mudar. */
  decidirTriagem(id: number, d: DecisaoTriagem, usuario: string): Promise<number>;
  criarAgendamento(a: DadosAgendamento, usuario: string, proximoEnvio: Date): Promise<string>;
  alterarAgendamento(
    id: string,
    a: DadosAgendamento & { readonly ativo: boolean },
    usuario: string,
    proximoEnvio: Date | null,
    /** A versão que a tela leu (trava otimista); sem ela, vale a lida na transação. */
    versao?: number,
  ): Promise<number>;
  registrarResultadoEnvio(
    id: string,
    r: { situacao: 'enviado' | 'falhou'; falha: string | null; falhasSeguidas: number; proximoEnvio: Date },
  ): Promise<number>;
  registrarExecucao(x: NovaExecucao): Promise<string>;
  criarPedido(p: DadosPedido, usuario: string): Promise<string>;
  responderPedido(
    id: string,
    r: { situacao: string; relatorio: string | null; resposta: string },
    usuario: string,
    versao?: number,
  ): Promise<number>;
  // W0-09 revisão: a linha anterior lida na transação, com trava (o "antes" do evento é o vigente, não o da tela).
  lerPedidoTravado(id: string): Promise<PedidoRelatorio | null>;
  lerAgendamentoTravado(id: string): Promise<AgendamentoRelatorio | null>;
  // W0-09: o ciclo do pedido e do envio (0 = a condição não vale mais: recusa).
  alterarPedido(id: string, p: DadosPedido, usuario: string, versao?: number): Promise<number>;
  cancelarPedido(id: string, motivo: string, usuario: string, versao?: number): Promise<number>;
  excluirPedido(id: string): Promise<number>;
  excluirAgendamento(id: string): Promise<number>;
  registrarEvento(
    ev: { alvo: AlvoEventoRelatorio; id: string; evento: EventoRelatorio; antes: unknown; motivo: string },
    usuario: string,
  ): Promise<string>;
}

export interface PortaRelatorio {
  readonly destino: 'banco' | 'memoria';
  /** O relógio do banco do estabelecimento (o dia dos parâmetros relativos e do próximo envio). */
  relogio(c: ContextoRelatorio): Promise<{ agora: Date; hoje: string }>;
  executar(
    c: ContextoRelatorio,
    codigo: string,
    valores: ValoresDoRelatorio,
    o: OpcoesExecucao,
  ): Promise<{ linhas: LinhaRelatorio[]; variante: string }>;
  acessoDeOrigem(c: ContextoRelatorio, codigo: string, usuario: string): Promise<AcessoDeOrigem>;
  inventario(c: ContextoRelatorio): Promise<RelatorioDeOrigem[]>;
  triagem(c: ContextoRelatorio, f: FiltroTriagem): Promise<{ itens: ItemTriagem[]; total: number }>;
  umaTriagem(c: ContextoRelatorio, id: number): Promise<ItemTriagem | null>;
  resumoTriagem(c: ContextoRelatorio): Promise<ResumoTriagem>;
  agendamentos(c: ContextoRelatorio): Promise<AgendamentoRelatorio[]>;
  agendamento(c: ContextoRelatorio, id: string): Promise<AgendamentoRelatorio | null>;
  vencidos(c: ContextoRelatorio, lote: number): Promise<AgendamentoRelatorio[]>;
  historicoOrigem(c: ContextoRelatorio): Promise<{
    agendamentos: number;
    porAno: { ano: number; situacao: number; quantidade: number }[];
    ultimoEnviado: Date | null;
  }>;
  execucoes(
    c: ContextoRelatorio,
    f: { readonly relatorio?: string; readonly usuario?: string; readonly limite: number },
  ): Promise<ExecucaoRelatorio[]>;
  pedidos(c: ContextoRelatorio, f: { readonly solicitante?: string }): Promise<PedidoRelatorio[]>;
  pedido(c: ContextoRelatorio, id: string): Promise<PedidoRelatorio | null>;
  eventos(c: ContextoRelatorio, alvo: AlvoEventoRelatorio, id: string): Promise<RegistroEventoRelatorio[]>;
  /** Os vínculos (fora o log) que impedem a exclusão física. */
  dependencias(c: ContextoRelatorio, alvo: AlvoDependenciaRelatorio, id: string): Promise<VinculoRelatorio[]>;
  gravarSgh<T>(
    c: ContextoRelatorio,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRelatorio) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_RELATORIO: ReadonlySet<string> = new Set([
  'relogio',
  'executar',
  'acessoDeOrigem',
  'inventario',
  'triagem',
  'umaTriagem',
  'resumoTriagem',
  'agendamentos',
  'agendamento',
  'vencidos',
  'historicoOrigem',
  'execucoes',
  'pedidos',
  'pedido',
  'eventos',
  'dependencias',
  'gravarSgh',
]);
