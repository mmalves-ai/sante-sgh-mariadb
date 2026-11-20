// Porta da agenda de consultas (M17): o que as telas da agenda leem e gravam, independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do
//     M04, com a trilha na mesma transação; as gravações só do novo, por transação SGH_ com a SGH_TRILHA junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E): agendas, horários e marcações SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AgendaLida,
  BloqueioLido,
  CancelamentoLido,
  ConfirmacaoLida,
  ContagensIndicadores,
  ContatoMarcacao,
  ContextoOperacao,
  ConvenioDaAgenda,
  EscalaPlanejadaLida,
  EsperaLida,
  FeriadoLido,
  GeracaoLida,
  GeracaoNovaLida,
  HorarioLido,
  LiberacaoConsultada,
  LigacaoLida,
  LinhaEscalaLida,
  LinhaEscalaSgh,
  LinhaTrilha,
  MarcacaoExtLida,
  MarcacaoLida,
  OpcoesAgendaLidas,
  PreCadastroLido,
  RelogioLido,
  ResultadoOperacao,
  VagaLida,
} from '@sgh/legado';

import type { EscopoAgenda } from './escopo.js';

export const PORTA_AGENDA = Symbol('PORTA_AGENDA');

export interface ContextoAgenda {
  readonly rede: string;
  readonly hospital: string;
  /** Escopo da sessão (unidade e tipo de agenda, M06); ausente = sem restrição. As portas não o usam. */
  readonly escopo?: EscopoAgenda;
}

export interface GravacaoAgendaFeita {
  readonly resultado: ResultadoOperacao;
  readonly repetida: boolean;
  readonly trilha: string | null;
}

/** Paciente do cadastro único como a agenda o mostra (nome e prontuário; o contato vem da marcação). */
export interface PacienteDaAgenda {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number;
}

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorSghAgenda {
  planejarEscala(r: {
    agenda: number;
    nome: string;
    crm: number;
    vigenteDesde: string;
    linhas: readonly LinhaEscalaSgh[];
    usuario: string;
  }): Promise<number>;
  cancelarEscalaPlanejada(r: { agenda: number; versao: number; usuario: string }): Promise<void>;
  gravarConfirmacao(r: {
    marcacao: number;
    nome: string;
    crm: number;
    data: string;
    hora: string;
    resultado: number;
    canal: string;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  gravarBloqueioPeriodo(r: {
    agenda: number;
    nome: string;
    crm: number;
    inicio: string;
    fim: string;
    horaInicio: string | null;
    horaFim: string | null;
    motivo: string;
    complemento: string | null;
    previsaoRetorno: string | null;
    usuario: string;
  }): Promise<number>;
  encerrarBloqueio(r: { agenda: number; id: number; usuario: string }): Promise<void>;
  incluirEspera(r: {
    paciente: number;
    prontuario: number;
    agenda: number | null;
    especialidade: number | null;
    prioridade: string;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  ofertarEspera(r: {
    id: number;
    agenda: number;
    data: string;
    hora: string;
    usuario: string;
  }): Promise<void>;
  encerrarEspera(r: {
    id: number;
    situacao: 'atendido' | 'cancelado' | 'aguardando';
    marcacao: number | null;
    usuario: string;
  }): Promise<void>;
  gravarLigacao(r: {
    agenda: number;
    nome: string;
    crm: number;
    profissional: number | null;
    especialidade: number | null;
    local: number | null;
    unidade: number | null;
    usuario: string;
  }): Promise<void>;
}

export interface PortaAgenda {
  readonly destino: 'legado' | 'memoria';
  /** A operação grava agora para este login? (passo 0 do executor, sem gravar). */
  podeGravar(c: ContextoAgenda, operacao: string, usuarioLegado: string): Promise<LiberacaoConsultada>;
  executar(
    c: ContextoAgenda,
    operacao: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoAgendaFeita>;
  /** Grava só do novo; a trilha pode depender do resultado (ex.: o ID do registro criado). */
  gravarSgh<T>(
    c: ContextoAgenda,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSghAgenda) => Promise<T>,
  ): Promise<T>;

  relogio(c: ContextoAgenda): Promise<RelogioLido>;
  agendas(c: ContextoAgenda): Promise<AgendaLida[]>;
  agenda(c: ContextoAgenda, id: number): Promise<AgendaLida | null>;
  conveniosDaAgenda(c: ContextoAgenda, id: number): Promise<ConvenioDaAgenda[]>;
  cobertura(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, number[]>>;
  especialidadesDaAgenda(c: ContextoAgenda, id: number): Promise<{ codigo: number; nome: string }[]>;
  opcoes(c: ContextoAgenda): Promise<OpcoesAgendaLidas>;
  escala(c: ContextoAgenda, nome: string, crm: number): Promise<LinhaEscalaLida[]>;
  geracoes(
    c: ContextoAgenda,
    nome: string,
    crm: number,
  ): Promise<{ itens: GeracaoLida[]; truncado: boolean }>;
  feriados(c: ContextoAgenda, de: string, ate: string): Promise<FeriadoLido[]>;
  horarios(
    c: ContextoAgenda,
    nome: string,
    crm: number,
    de: string,
    ate: string,
  ): Promise<{ itens: HorarioLido[]; truncado: boolean }>;
  horasMarcadas(c: ContextoAgenda, nome: string, crm: number, data: string): Promise<string[]>;
  marcacoesDaJanela(
    c: ContextoAgenda,
    nome: string,
    crm: number,
    de: string,
    ate: string,
  ): Promise<{ itens: MarcacaoLida[]; truncado: boolean }>;
  marcacoesDoDia(c: ContextoAgenda, data: string): Promise<{ itens: MarcacaoLida[]; truncado: boolean }>;
  marcacao(
    c: ContextoAgenda,
    id: number,
  ): Promise<{ marcacao: MarcacaoLida; contato: ContatoMarcacao } | null>;
  /** As do cadastro e, à parte, as possíveis a confirmar (sem vínculo, mesmo nome) e os pré-cadastros. */
  marcacoesDoPaciente(
    c: ContextoAgenda,
    id: number,
  ): Promise<{
    itens: MarcacaoLida[];
    truncado: boolean;
    possiveis: MarcacaoLida[];
    preCadastros: PreCadastroLido[];
  }>;
  vagas(
    c: ContextoAgenda,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ): Promise<{ itens: VagaLida[]; truncado: boolean }>;
  proximasVagas(
    c: ContextoAgenda,
    agendas: readonly number[],
    depoisDe: string,
    ate: string,
  ): Promise<VagaLida[]>;
  cancelamentos(
    c: ContextoAgenda,
    f: {
      de: string;
      ate: string;
      agendas: readonly string[] | null;
      motivo?: { codigo: string; texto: string } | null;
      pagina: number;
      porPagina: number;
    },
  ): Promise<{ itens: CancelamentoLido[]; total: number }>;
  indicadores(c: ContextoAgenda, de: string, ate: string): Promise<ContagensIndicadores>;
  pacientes(c: ContextoAgenda, ids: readonly number[]): Promise<PacienteDaAgenda[]>;

  marcacoesExt(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, MarcacaoExtLida>>;
  geracoesDoNovo(c: ContextoAgenda, agenda: number): Promise<GeracaoNovaLida[]>;
  /** A agenda (REAGENDA.ID) de uma geração do novo; null se não existe. */
  agendaDaGeracao(c: ContextoAgenda, id: number): Promise<number | null>;
  bloqueios(
    c: ContextoAgenda,
    f: { agenda?: number | null; ativos?: boolean; de?: string | null; ate?: string | null },
  ): Promise<BloqueioLido[]>;
  horariosDoBloqueio(c: ContextoAgenda, id: number): Promise<{ data: string; hora: string }[]>;
  confirmacoes(c: ContextoAgenda, marcacao: number): Promise<ConfirmacaoLida[]>;
  escalasPlanejadas(c: ContextoAgenda, agenda: number): Promise<EscalaPlanejadaLida[]>;
  espera(
    c: ContextoAgenda,
    f: { situacoes: readonly string[]; agenda?: number | null; especialidade?: number | null },
  ): Promise<EsperaLida[]>;
  ligacoes(c: ContextoAgenda): Promise<Map<number, LigacaoLida>>;
  profissionais(c: ContextoAgenda): Promise<{ id: number; nome: string }[]>;
  cancelamentosPorMotivo(
    c: ContextoAgenda,
    de: string,
    ate: string,
  ): Promise<{ motivo: string; total: number }[]>;
}
