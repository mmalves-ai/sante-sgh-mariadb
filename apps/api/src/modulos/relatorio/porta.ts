// Porta do catálogo de relatórios e da gestão dos relatórios (M34; ficha, seções 4, 6 e 7): o que as telas do catálogo,
// da triagem, dos pedidos e do envio agendado leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as consultas revisadas do catálogo em transação READ ONLY com teto de linhas e tempo (o driver cancela
//     a consulta acima do tempo), o inventário dos relatórios de origem (metadado; o texto da consulta nunca é lido) e
//     as gravações SGH_ (triagem, agendamento, execução, pedido) com a SGH_TRILHA na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): linhas SINTÉTICAS por relatório, a triagem de um inventário
//     sintético e os agendamentos e pedidos em memória, com as mesmas validações; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AcessoDeOrigem,
  AgendamentoGravado,
  AlvoDependenciaRelatorio,
  AlvoEventoRelatorio,
  EventoRelatorio,
  EventoRelatorioLido,
  AgendamentoLidoBanco,
  DecisaoGravada,
  ExecucaoGravada,
  ExecucaoLidaBanco,
  FiltroTriagem,
  LinhaRelatorio,
  LinhaTrilha,
  PedidoGravado,
  PedidoLidoBanco,
  PropostaGravada,
  RelatorioOrigemLido,
  ResumoTriagemLido,
  TriagemLinha,
  ValoresDoRelatorio,
  VinculoRelatorio,
} from '@sgh/legado';

export const PORTA_RELATORIO = Symbol('PORTA_RELATORIO');

export interface ContextoRelatorio {
  readonly rede: string;
  readonly hospital: string;
}

export interface OpcoesExecucao {
  readonly teto: number;
  readonly tempoMaximoMs: number;
}

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
export interface GravadorSghRelatorio {
  gravarPropostas(
    propostas: readonly PropostaGravada[],
  ): Promise<{ incluidas: number; atualizadas: number; preservadas: number }>;
  decidirTriagem(id: number, d: DecisaoGravada, usuario: string): Promise<number>;
  criarAgendamento(a: AgendamentoGravado, usuario: string, proximoEnvio: Date): Promise<string>;
  alterarAgendamento(
    id: string,
    a: AgendamentoGravado & { readonly ativo: boolean },
    usuario: string,
    proximoEnvio: Date | null,
  ): Promise<number>;
  registrarResultadoEnvio(
    id: string,
    r: { situacao: 'enviado' | 'falhou'; falha: string | null; falhasSeguidas: number; proximoEnvio: Date },
  ): Promise<number>;
  registrarExecucao(x: ExecucaoGravada): Promise<string>;
  criarPedido(p: PedidoGravado, usuario: string): Promise<string>;
  responderPedido(
    id: string,
    r: { situacao: string; relatorio: string | null; resposta: string },
    usuario: string,
  ): Promise<number>;
  // W0-09 revisão: a linha anterior lida na transação, com trava (o "antes" do evento é o vigente, não o da tela).
  lerPedidoTravado(id: string): Promise<PedidoLidoBanco | null>;
  lerAgendamentoTravado(id: string): Promise<AgendamentoLidoBanco | null>;
  // W0-09: o ciclo do pedido e do envio (0 = a condição não vale mais: recusa).
  alterarPedido(id: string, p: PedidoGravado, usuario: string): Promise<number>;
  cancelarPedido(id: string, motivo: string, usuario: string): Promise<number>;
  excluirPedido(id: string): Promise<number>;
  excluirAgendamento(id: string): Promise<number>;
  registrarEvento(
    ev: { alvo: AlvoEventoRelatorio; id: string; evento: EventoRelatorio; antes: unknown; motivo: string },
    usuario: string,
  ): Promise<string>;
}

export interface PortaRelatorio {
  readonly destino: 'legado' | 'memoria';
  /** O relógio do banco do estabelecimento (o dia dos parâmetros relativos e do próximo envio). */
  relogio(c: ContextoRelatorio): Promise<{ agora: Date; hoje: string }>;
  executar(
    c: ContextoRelatorio,
    codigo: string,
    valores: ValoresDoRelatorio,
    o: OpcoesExecucao,
  ): Promise<{ linhas: LinhaRelatorio[]; variante: string }>;
  acessoDeOrigem(c: ContextoRelatorio, codigo: string, usuario: string): Promise<AcessoDeOrigem>;
  inventario(c: ContextoRelatorio): Promise<RelatorioOrigemLido[]>;
  triagem(c: ContextoRelatorio, f: FiltroTriagem): Promise<{ itens: TriagemLinha[]; total: number }>;
  umaTriagem(c: ContextoRelatorio, id: number): Promise<TriagemLinha | null>;
  resumoTriagem(c: ContextoRelatorio): Promise<ResumoTriagemLido>;
  agendamentos(c: ContextoRelatorio): Promise<AgendamentoLidoBanco[]>;
  agendamento(c: ContextoRelatorio, id: string): Promise<AgendamentoLidoBanco | null>;
  vencidos(c: ContextoRelatorio, lote: number): Promise<AgendamentoLidoBanco[]>;
  historicoOrigem(c: ContextoRelatorio): Promise<{
    agendamentos: number;
    porAno: { ano: number; situacao: number; quantidade: number }[];
    ultimoEnviado: Date | null;
  }>;
  execucoes(
    c: ContextoRelatorio,
    f: { readonly relatorio?: string; readonly usuario?: string; readonly limite: number },
  ): Promise<ExecucaoLidaBanco[]>;
  pedidos(c: ContextoRelatorio, f: { readonly solicitante?: string }): Promise<PedidoLidoBanco[]>;
  pedido(c: ContextoRelatorio, id: string): Promise<PedidoLidoBanco | null>;
  eventos(c: ContextoRelatorio, alvo: AlvoEventoRelatorio, id: string): Promise<EventoRelatorioLido[]>;
  /** Os vínculos (fora o log) que impedem a exclusão física (packages/legado: dependencias-relatorio.ts). */
  dependencias(c: ContextoRelatorio, alvo: AlvoDependenciaRelatorio, id: string): Promise<VinculoRelatorio[]>;
  gravarSgh<T>(
    c: ContextoRelatorio,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSghRelatorio) => Promise<T>,
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
