// Agenda de sessões e recursos (M50, etapa 6; ficha, seções 4, 5, 7 e 8; regra 11; cap-05a §5.1): a série de sessões
// de um plano terapêutico (quimioterapia, infusão, fisioterapia, hemodiálise…) em cadeira ou sala, sem sobreposição do
// recurso nem do paciente, com a complexidade e a duração dos domínios do agendamento (AGCOMPLEXIDADE, AGDURACAO) e a
// faixa etária do recurso. Os recursos são as cadeiras e salas do cadastro de agendas do agendamento (AGCADAGENDA e
// AGCADEIRA, pelo CRUD genérico); as sessões ficam só no novo (SGH_AGE_SESSAO). Desligada até o serviço existir (chave
// `sessoes`, DP-32; POL-1, POL-3).
import { z } from 'zod';
import { FORMATO_HHMM } from '../formatacao/hora-legada.js';
import { textoCp1252 } from '../texto-cp1252.js';

export const CHAVE_LIBERACAO_SESSOES = 'sessoes';

/** O plano terapêutico a que a série pertence (o tipo; a descrição e a referência vão em texto). */
export const TIPOS_PLANO_SESSAO = [
  'quimioterapia',
  'infusao',
  'fisioterapia',
  'hemodialise',
  'radioterapia',
  'outra',
] as const;
export type TipoPlanoSessao = (typeof TIPOS_PLANO_SESSAO)[number];

export const SITUACOES_SESSAO = ['agendada', 'realizada', 'falta', 'cancelada'] as const;
export type SituacaoSessao = (typeof SITUACOES_SESSAO)[number];

/** O que se faz com uma sessão já agendada (a última, `cancelar-restantes`, cancela as futuras da série). */
export const ACOES_SESSAO = ['realizar', 'falta', 'cancelar', 'cancelar-restantes'] as const;
export type AcaoSessao = (typeof ACOES_SESSAO)[number];

/** Sessões numa série (um ciclo longo de fisioterapia cabe; acima disso, outra série). */
export const TETO_SESSOES_SERIE = 60;
/** Dias da grade numa leitura (uma ou duas semanas). */
export const DIAS_GRADE_SESSOES = 14;
/** Teto de sessões devolvidas na grade (ficha, seção 4: consulta simples; corte avisado). */
export const TETO_GRADE_SESSOES = 500;
/** Sessões futuras de um paciente devolvidas na ficha do paciente. */
export const TETO_SESSOES_PACIENTE = 100;
/** A duração da sessão em minutos (a categoria curta, média ou longa vem do domínio AGDURACAO). */
export const DURACAO_SESSAO_MIN = { minimo: 10, maximo: 720 } as const;

const id = z.number().int().positive().max(2_147_483_647);
const idLongo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const hhmm = z.string().regex(FORMATO_HHMM, 'Hora no formato HHMM.');

// ── Agendar a série (`agenda.agendarSessao`) ─────────────────────────────────────────────────────────────────────

export const esquemaAgendarSessao = z
  .object({
    /** RICADPAC.ID do paciente (escolhido pela busca do cadastro). */
    paciente: id,
    /** O recurso (AGCADEIRA.ID_CADEIRA): a cadeira ou a sala; a agenda vem dele. */
    recurso: id,
    /** AGCOMPLEXIDADE.ID_COMPLEXIDADE da sessão (1 a 3; 0 = "todas" não é complexidade de sessão). */
    complexidade: z.number().int().min(1).max(32767),
    /** AGDURACAO.ID_DURACAO da sessão (1 a 3). */
    duracao: z.number().int().min(1).max(32767),
    duracaoMin: z.number().int().min(DURACAO_SESSAO_MIN.minimo).max(DURACAO_SESSAO_MIN.maximo),
    planoTipo: z.enum(TIPOS_PLANO_SESSAO),
    /** O plano terapêutico (protocolo, ciclo, prescrição de referência), sem dado clínico além do necessário. */
    plano: textoCp1252(200).pipe(z.string().trim().min(3)),
    /** Primeira sessão. */
    inicio: data,
    hora: hhmm,
    sessoes: z.number().int().min(1).max(TETO_SESSOES_SERIE),
    /** Dias entre uma sessão e a seguinte (1 = diária; 7 = semanal; 21 = ciclo de 21 dias). */
    intervaloDias: z.number().int().min(1).max(60),
    /** Pular sábado e domingo ao calcular as datas (a sessão vai para a segunda). */
    pularFimDeSemana: z.boolean(),
    observacao: textoCp1252(200).pipe(z.string().trim()).optional(),
    /** O item agendado em cada sessão (o procedimento do tratamento), que o plano de sessões exige para faturar. */
    itemAgendavel: idLongo.optional(),
    /** O profissional que indicou o tratamento. */
    solicitante: idLongo.optional(),
    /** A fonte pagadora do tratamento. */
    fontePagadora: idLongo.optional(),
  })
  .strict();
export type AgendarSessaoEntrada = z.infer<typeof esquemaAgendarSessao>;

// ── Atualizar uma sessão (`agenda.atualizarSessao`) ──────────────────────────────────────────────────────────────

export const esquemaAtualizarSessao = z
  .object({
    sessao: idLongo,
    acao: z.enum(ACOES_SESSAO),
    motivo: textoCp1252(200).pipe(z.string().trim()).optional(),
    /** Versão lida (a outra pessoa que mexeu antes faz esta recusar). */
    versao: z.number().int().positive(),
  })
  .strict()
  .refine(
    (x) => !['falta', 'cancelar', 'cancelar-restantes'].includes(x.acao) || (x.motivo?.length ?? 0) >= 3,
    {
      message: 'Diga o motivo (3 caracteres ou mais).',
      path: ['motivo'],
    },
  );
export type AtualizarSessaoEntrada = z.infer<typeof esquemaAtualizarSessao>;

// ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DominioSessao {
  readonly codigo: number;
  readonly nome: string;
}

/** Uma cadeira ou sala (AGCADEIRA) com a agenda (AGCADAGENDA) a que pertence. */
export interface RecursoSessao {
  readonly recurso: number;
  readonly identificacao: string;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly unidade: number;
  readonly tipo: number;
  readonly prioridade: number;
  /** Complexidade aceita (0 = todas). */
  readonly complexidade: number;
  /** Duração aceita (0 = todas). */
  readonly duracao: number;
  /** Faixa etária aceita, em anos (null = sem limite). */
  readonly faixa: { readonly de: number; readonly ate: number } | null;
  readonly ativo: boolean;
}

export interface SessaoLida {
  readonly id: number;
  readonly serie: number;
  readonly ordem: number;
  readonly total: number;
  readonly recurso: number;
  readonly agenda: number;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly nome: string;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: SituacaoSessao;
  readonly planoTipo: TipoPlanoSessao;
  readonly plano: string;
  readonly complexidade: number;
  readonly duracao: number;
  readonly observacao: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
  readonly alteradoPor: string | null;
  readonly alteradoEm: string | null;
  readonly versao: number;
}

export interface GradeSessoes {
  readonly de: string;
  readonly ate: string;
  readonly recursos: readonly RecursoSessao[];
  readonly sessoes: readonly SessaoLida[];
  readonly complexidades: readonly DominioSessao[];
  readonly duracoes: readonly DominioSessao[];
  readonly cortada: boolean;
  readonly lidoEm: string;
}

export interface SessoesDoPaciente {
  readonly paciente: number;
  readonly nome: string;
  readonly sessoes: readonly SessaoLida[];
  readonly cortada: boolean;
}

/** A prévia de uma série: as datas e, por sessão, o que impede (recurso ou paciente ocupado). */
export interface PreviaSerieSessoes {
  readonly ok: boolean;
  readonly datas: readonly {
    readonly ordem: number;
    readonly inicio: string;
    readonly fim: string;
    readonly conflito: 'recurso' | 'paciente' | null;
  }[];
  /** A recusa que vale para a série toda (recurso inativo, fora da faixa etária, complexidade não aceita…). */
  readonly recusa: { readonly codigo: string; readonly motivo: string } | null;
}

export interface ResultadoSessao {
  readonly ok: true;
  readonly serie: number;
  readonly sessoes: readonly number[];
  readonly mensagem: string;
}

export interface GravacaoSessoes {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
}

const esquemaDominio = z.object({ codigo: z.number().int(), nome: z.string() });
const esquemaRecurso = z.object({
  recurso: z.number().int(),
  identificacao: z.string(),
  agenda: z.number().int(),
  nomeAgenda: z.string(),
  unidade: z.number().int(),
  tipo: z.number().int(),
  prioridade: z.number().int(),
  complexidade: z.number().int(),
  duracao: z.number().int(),
  faixa: z.object({ de: z.number().int(), ate: z.number().int() }).nullable(),
  ativo: z.boolean(),
});
export const esquemaSessaoLida = z.object({
  id: z.number().int(),
  serie: z.number().int(),
  ordem: z.number().int(),
  total: z.number().int(),
  recurso: z.number().int(),
  agenda: z.number().int(),
  paciente: z.number().int(),
  prontuario: z.number().int().nullable(),
  nome: z.string(),
  inicio: z.string(),
  fim: z.string(),
  situacao: z.enum(SITUACOES_SESSAO),
  planoTipo: z.enum(TIPOS_PLANO_SESSAO),
  plano: z.string(),
  complexidade: z.number().int(),
  duracao: z.number().int(),
  observacao: z.string().nullable(),
  motivo: z.string().nullable(),
  por: z.string(),
  em: z.string(),
  alteradoPor: z.string().nullable(),
  alteradoEm: z.string().nullable(),
  versao: z.number().int(),
});
export const esquemaGradeSessoes = z.object({
  de: z.string(),
  ate: z.string(),
  recursos: z.array(esquemaRecurso),
  sessoes: z.array(esquemaSessaoLida),
  complexidades: z.array(esquemaDominio),
  duracoes: z.array(esquemaDominio),
  cortada: z.boolean(),
  lidoEm: z.string(),
});
export const esquemaSessoesDoPaciente = z.object({
  paciente: z.number().int(),
  nome: z.string(),
  sessoes: z.array(esquemaSessaoLida),
  cortada: z.boolean(),
});
export const esquemaPreviaSerieSessoes = z.object({
  ok: z.boolean(),
  datas: z.array(
    z.object({
      ordem: z.number().int(),
      inicio: z.string(),
      fim: z.string(),
      conflito: z.enum(['recurso', 'paciente']).nullable(),
    }),
  ),
  recusa: z.object({ codigo: z.string(), motivo: z.string() }).nullable(),
});
export const esquemaResultadoSessao = z.object({
  ok: z.literal(true),
  serie: z.number().int(),
  sessoes: z.array(z.number().int()),
  mensagem: z.string(),
});
export const esquemaGravacaoSessoes = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
});
