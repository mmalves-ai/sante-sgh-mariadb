// Porta da agenda de consultas: o que as telas da agenda leem e gravam, independente de onde (a API não escreve SQL
// fora das portas próprias):
//   - `propria`: o banco do cliente (MariaDB) pelo @sgh/nucleo — leituras pelo Leitor; cada gravação é uma operação
//     do Executor, com a trilha, o outbox e a idempotência na mesma transação (porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E): agendas, horários e marcações SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas; nada vai a banco.
// Vocabulário neutro (tipos.ts): ids, datas ISO, HH:MM, minutos e booleanos.
import type {
  Agenda,
  BloqueioAgenda,
  Cancelamento,
  ComplementoMarcacao,
  ConfirmacaoRegistrada,
  ContagensIndicadores,
  ContatoMarcacao,
  ConvenioDaAgenda,
  EscalaPlanejada,
  FaixaEscala,
  Feriado,
  GeracaoGrade,
  Horario,
  ItemListaEspera,
  LiberacaoGravacao,
  Marcacao,
  OpcoesDaAgenda,
  PacienteDaAgenda,
  PreCadastroMarcado,
  Relogio,
  ResultadoGravacao,
  Vaga,
  VinculoAgenda,
} from './tipos.js';
import type { EscopoAgenda } from './escopo.js';

export type { PacienteDaAgenda } from './tipos.js';

export const PORTA_AGENDA = Symbol('PORTA_AGENDA');

export interface ContextoAgenda {
  readonly rede: string;
  /** Código do estabelecimento da sessão. */
  readonly hospital: string;
  /** Escopo da sessão (unidade e tipo de agenda); ausente = sem restrição. As portas não o usam. */
  readonly escopo?: EscopoAgenda;
}

/** Contexto de uma gravação: quem grava, a correlação e a chave de idempotência do pedido. */
export interface ContextoGravacao extends ContextoAgenda {
  readonly login: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
}

export interface GravacaoAgendaFeita {
  readonly resultado: ResultadoGravacao;
  readonly repetida: boolean;
  readonly trilha: string | null;
}

/** Gravações de apoio da agenda (escala planejada, confirmação, bloqueio de período, fila, vínculos). */
export interface GravadorAgenda {
  planejarEscala(r: {
    agenda: number;
    vigenteDesde: string;
    faixas: readonly FaixaEscala[];
  }): Promise<number>;
  cancelarEscalaPlanejada(r: { agenda: number; id: number }): Promise<void>;
  gravarConfirmacao(r: {
    marcacao: number;
    /** Código do resultado (RESULTADOS_CONFIRMACAO). */
    resultado: string;
    canal: string;
    observacao: string | null;
  }): Promise<number>;
  gravarBloqueioPeriodo(r: {
    agenda: number;
    inicio: string;
    fim: string;
    horaInicio: string | null;
    horaFim: string | null;
    motivo: string;
    complemento: string | null;
    previsaoRetorno: string | null;
  }): Promise<number>;
  encerrarBloqueio(r: { agenda: number; id: number }): Promise<void>;
  incluirEspera(r: {
    paciente: number;
    agenda: number | null;
    especialidade: number | null;
    prioridade: string;
    observacao: string | null;
  }): Promise<number>;
  ofertarEspera(r: { id: number; agenda: number; data: string; hora: string }): Promise<void>;
  encerrarEspera(r: {
    id: number;
    situacao: 'atendido' | 'cancelado' | 'aguardando';
    marcacao: number | null;
  }): Promise<void>;
  gravarVinculo(r: {
    agenda: number;
    profissional: number | null;
    especialidade: number | null;
    local: number | null;
    unidade: number | null;
  }): Promise<void>;
}

export interface PortaAgenda {
  readonly destino: 'propria' | 'memoria';
  /** A operação grava agora para este login? (liberação, sem gravar). */
  podeGravar(c: ContextoAgenda, operacao: string, login: string): Promise<LiberacaoGravacao>;
  /** Operação da agenda (OPERACOES_AGENDA) com a entrada do contrato. */
  executar(c: ContextoGravacao, operacao: string, entrada: unknown): Promise<GravacaoAgendaFeita>;
  /** Gravações de apoio; cada chamada do gravador é uma transação com a trilha. */
  gravar<T>(c: ContextoGravacao, fn: (g: GravadorAgenda) => Promise<T>): Promise<T>;

  relogio(c: ContextoAgenda): Promise<Relogio>;
  agendas(c: ContextoAgenda): Promise<Agenda[]>;
  agenda(c: ContextoAgenda, id: number): Promise<Agenda | null>;
  conveniosDaAgenda(c: ContextoAgenda, id: number): Promise<ConvenioDaAgenda[]>;
  /** Convênios aceitos por agenda (agenda sem linha aceita todos e fica fora do mapa). */
  cobertura(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, number[]>>;
  especialidadesDaAgenda(c: ContextoAgenda, id: number): Promise<{ codigo: number; nome: string }[]>;
  opcoes(c: ContextoAgenda): Promise<OpcoesDaAgenda>;
  /** Escala vigente hoje. */
  escala(c: ContextoAgenda, agenda: number): Promise<FaixaEscala[]>;
  geracoes(c: ContextoAgenda, agenda: number): Promise<GeracaoGrade[]>;
  /** A agenda de uma geração; null se não existe. */
  agendaDaGeracao(c: ContextoAgenda, id: number): Promise<number | null>;
  feriados(c: ContextoAgenda, de: string, ate: string): Promise<Feriado[]>;
  horarios(
    c: ContextoAgenda,
    agenda: number,
    de: string,
    ate: string,
  ): Promise<{ itens: Horario[]; truncado: boolean }>;
  horasMarcadas(c: ContextoAgenda, agenda: number, data: string): Promise<string[]>;
  marcacoesDaJanela(
    c: ContextoAgenda,
    agenda: number,
    de: string,
    ate: string,
  ): Promise<{ itens: Marcacao[]; truncado: boolean }>;
  marcacoesDoDia(c: ContextoAgenda, data: string): Promise<{ itens: Marcacao[]; truncado: boolean }>;
  marcacao(c: ContextoAgenda, id: number): Promise<{ marcacao: Marcacao; contato: ContatoMarcacao } | null>;
  /** As do paciente e os pré-cadastros dele que têm marcação. */
  marcacoesDoPaciente(
    c: ContextoAgenda,
    id: number,
  ): Promise<{ itens: Marcacao[]; truncado: boolean; preCadastros: PreCadastroMarcado[] }>;
  vagas(
    c: ContextoAgenda,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ): Promise<{ itens: Vaga[]; truncado: boolean }>;
  /** A primeira vaga de cada agenda depois da data. */
  proximasVagas(c: ContextoAgenda, agendas: readonly number[], depoisDe: string, ate: string): Promise<Vaga[]>;
  cancelamentos(
    c: ContextoAgenda,
    f: {
      de: string;
      ate: string;
      agendas: readonly number[] | null;
      motivo?: string | null;
      pagina: number;
      porPagina: number;
    },
  ): Promise<{ itens: Cancelamento[]; total: number }>;
  indicadores(c: ContextoAgenda, de: string, ate: string): Promise<ContagensIndicadores>;
  pacientes(c: ContextoAgenda, ids: readonly number[]): Promise<PacienteDaAgenda[]>;
  complementos(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, ComplementoMarcacao>>;
  bloqueios(
    c: ContextoAgenda,
    f: { agenda?: number | null; ativos?: boolean; de?: string | null; ate?: string | null },
  ): Promise<BloqueioAgenda[]>;
  horariosDoBloqueio(c: ContextoAgenda, id: number): Promise<{ data: string; hora: string }[]>;
  confirmacoes(c: ContextoAgenda, marcacao: number): Promise<ConfirmacaoRegistrada[]>;
  escalasPlanejadas(c: ContextoAgenda, agenda: number): Promise<EscalaPlanejada[]>;
  espera(
    c: ContextoAgenda,
    f: { situacoes: readonly string[]; agenda?: number | null; especialidade?: number | null },
  ): Promise<ItemListaEspera[]>;
  vinculos(c: ContextoAgenda): Promise<Map<number, VinculoAgenda>>;
  profissionais(c: ContextoAgenda): Promise<{ id: number; nome: string }[]>;
  cancelamentosPorMotivo(c: ContextoAgenda, de: string, ate: string): Promise<{ motivo: string; total: number }[]>;
}
