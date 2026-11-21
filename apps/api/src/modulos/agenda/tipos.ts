// Tipos de negócio da agenda de consultas (F2.2): o que a porta lê e grava, em vocabulário neutro.
//   - datas em ISO (AAAA-MM-DD), horas em HH:MM (hora local do estabelecimento), durações em minutos;
//   - booleanos para sim/não, ids numéricos do banco do cliente, códigos de negócio (convênio, especialidade) como
//     números de negócio;
//   - situação da marcação pelo SIGNIFICADO (situacao_marcacao.significado), nunca pelo código de um sistema.
// Os tipos de leitura e de gravação são os mesmos na porta própria (MariaDB) e na de memória (dev/ci).

/** Relógio civil do estabelecimento. */
export interface Relogio {
  readonly hoje: string;
  /** HH:MM. */
  readonly hora: string;
}

/** Situação da marcação pelo significado (a "transferida" é a remarcada que manteve o horário antigo). */
export type SituacaoMarcacao =
  | 'marcada'
  | 'confirmada'
  | 'chegou'
  | 'em_atendimento'
  | 'realizada'
  | 'falta'
  | 'transferida';

export interface Agenda {
  readonly id: number;
  readonly nome: string;
  /** Profissional dono da agenda (agenda_servico.profissional_id). */
  readonly profissional: number | null;
  /** Número de inscrição do profissional no conselho (principal), quando numérico. */
  readonly registroProfissional: number | null;
  readonly ativa: boolean;
  readonly duracaoMinutos: number | null;
  readonly teleatendimento: boolean;
  /** Primeiro e último dia com horário futuro na grade. */
  readonly gradeInicio: string | null;
  readonly gradeFim: string | null;
  /** Quantos convênios a agenda aceita (0 = aceita todos) e quantas especialidades tem. */
  readonly convenios: number;
  readonly especialidades: number;
  /** Unidade assistencial e categoria da agenda (escopo da sessão). */
  readonly unidade: number | null;
  readonly categoria: number | null;
  readonly versao: number;
}

export interface ConvenioDaAgenda {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly marcadosFuturos: number;
}

export interface CodigoNome {
  readonly codigo: number;
  readonly nome: string;
}

export interface OpcoesDaAgenda {
  readonly convenios: readonly { codigo: number; nome: string; ativo: boolean }[];
  readonly especialidades: readonly CodigoNome[];
  readonly locais: readonly CodigoNome[];
  readonly unidades: readonly CodigoNome[];
}

/** Faixa da escala semanal. */
export interface FaixaEscala {
  /** 1 = domingo … 7 = sábado. */
  readonly diaSemana: number;
  /** Nulo: a duração da agenda. */
  readonly duracaoMinutos: number | null;
  readonly inicio: string;
  readonly fim: string;
  readonly intervaloInicio: string | null;
  readonly intervaloFim: string | null;
}

/** Escala que passa a valer numa data futura. */
export interface EscalaPlanejada {
  readonly id: number;
  readonly vigenteDesde: string;
  readonly autor: string;
  /** Data e hora (ISO) do planejamento. */
  readonly em: string;
  readonly faixas: readonly FaixaEscala[];
}

/** Geração de grade (geracao_grade). */
export interface GeracaoGrade {
  readonly id: number;
  readonly agenda: number;
  readonly inicio: string;
  readonly fim: string;
  /** Data e hora (ISO, AAAA-MM-DDTHH:MM) da geração. */
  readonly em: string;
  readonly autor: string;
  readonly duracaoMinutos: number | null;
  /** Dias da semana gerados (1 = domingo … 7 = sábado). */
  readonly diasSemana: readonly number[];
  readonly horarios: number;
  readonly revertidaEm: string | null;
}

export interface Feriado {
  readonly data: string;
  readonly nome: string;
}

/** Horário da grade, com a marcação que o ocupa (quando houver). */
export interface Horario {
  readonly data: string;
  readonly hora: string;
  readonly encaixe: boolean;
  readonly bloqueado: boolean;
  readonly duracaoMinutos: number | null;
  readonly marcacao: number | null;
  /** Nome de quem ocupa (null: horário vago). */
  readonly paciente: string | null;
  readonly situacao: SituacaoMarcacao | null;
  readonly convenio: number | null;
}

export interface Marcacao {
  readonly id: number;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly idPaciente: number | null;
  readonly prontuario: number | null;
  readonly convenio: number;
  readonly nomeConvenio: string | null;
  readonly retorno: boolean;
  readonly encaixe: boolean;
  readonly situacao: SituacaoMarcacao;
  /** Código do canal (vocabulário CANAIS_MARCACAO). */
  readonly canal: string;
  readonly marcadaEm: string | null;
  readonly marcadaPor: string | null;
}

/** O que a marcação tem além da grade (canal, encaixe, remarcação). */
export interface ComplementoMarcacao {
  readonly marcacao: number;
  readonly canal: string;
  readonly encaixe: boolean;
  readonly motivoEncaixe: string | null;
  readonly remarcadaDe: number | null;
  readonly modoRemarcacao: string | null;
  readonly criadoPor: string;
}

export interface ContatoMarcacao {
  readonly telefone: string | null;
  readonly celular: string | null;
  readonly observacao: string | null;
}

export interface PreCadastroMarcado {
  readonly nomeAgenda: string;
  readonly data: string | null;
}

export interface Vaga {
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
}

export interface Cancelamento {
  readonly protocolo: number;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly canceladoEm: string;
  /** HH:MM. */
  readonly horaCancelamento: string;
  readonly canceladoPor: string | null;
  readonly motivo: string;
  readonly motivoCodigo: string | null;
  readonly solicitante: string | null;
}

export interface ContagensIndicadores {
  readonly ocupacao: readonly { agenda: string; horarios: number; ocupados: number }[];
  readonly porAntecedencia: readonly { chave: string; marcados: number; compareceu: number }[];
  readonly porAgenda: readonly { chave: string; marcados: number; compareceu: number }[];
  readonly funil: {
    readonly horarios: number;
    readonly livres: number;
    readonly marcados: number;
    readonly compareceu: number;
    readonly cancelados: number;
    readonly encaixes: number;
  };
  /** Marcações por código de canal. */
  readonly porCanal: readonly { canal: string; marcados: number }[];
}

export interface BloqueioAgenda {
  readonly id: number;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly inicio: string;
  readonly fim: string;
  /** Recorte diário (HH:MM), quando o bloqueio não é do dia inteiro. */
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  /** Código do motivo (vocabulário MOTIVOS_BLOQUEIO). */
  readonly motivo: string;
  readonly complemento: string | null;
  readonly previsaoRetorno: string | null;
  readonly horarios: number;
  readonly autor: string;
  readonly criadoEm: string;
  readonly ativo: boolean;
}

export interface ConfirmacaoRegistrada {
  /** Código do resultado (vocabulário RESULTADOS_CONFIRMACAO). */
  readonly resultado: string;
  readonly canal: string;
  readonly em: string;
  readonly por: string;
}

export interface ItemListaEspera {
  readonly id: number;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly agenda: number | null;
  readonly especialidade: number | null;
  readonly prioridade: string;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly desde: string;
  readonly oferta: { readonly agenda: number; readonly data: string; readonly hora: string } | null;
  readonly marcacao: number | null;
}

/** Vínculos da agenda (profissional, especialidade principal, local e unidade). */
export interface VinculoAgenda {
  readonly agenda: number;
  readonly profissional: number | null;
  readonly especialidade: number | null;
  readonly local: number | null;
  readonly unidade: number | null;
  readonly situacao: 'proposta' | 'revisada';
}

export interface PacienteDaAgenda {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number | null;
}

export interface LiberacaoGravacao {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

export type ResultadoGravacao = Readonly<Record<string, number | string | boolean | null>>;
