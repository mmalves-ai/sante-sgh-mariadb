// Agenda de exames (M18, ficha seções 4, 5 e 7): entradas das operações de gravação compatível, pedidos das telas e
// respostas da API, validados na tela, na API e no executor (o mesmo Zod). Vocabulário neutro: a agenda de exames, o
// paciente (cadastro único), a marcação e o exame escolhido (catálogo do SADT) são IDs do modelo próprio. Horas do
// dia em "HH:MM" (a tela aceita a hora digitada sem os dois-pontos e converte); datas AAAA-MM-DD; textos restritos ao CP1252 com o tamanho da coluna. Nas respostas, nenhum nome de
// tabela ou coluna; nome e contato do paciente mascarados nas listas.
import { z } from 'zod';
import { esquemaHora } from '../formatacao/hora.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  esquemaCanal,
  esquemaMotivoCancelamento,
  MODOS_REMARCACAO,
  SOLICITANTES_CANCELAMENTO,
  TETO_HORARIOS_POR_GRAVACAO,
} from './entradas.js';
import { esquemaPreviaGrade } from './respostas.js';
import { motivoCancelamento } from './vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const smallint = z.number().int().min(0).max(32767);
const n = z.number().int();
const txt = z.string();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

// A hora do dia das operações de exame é "HH:MM", como na agenda de consultas.
const horaExame = esquemaHora;
const horarioExame = z.object({ data: esquemaDataIso, hora: horaExame }).strict();
const linhaEscalaExame = z
  .object({
    semana: z.number().int().min(1).max(7),
    duracao: horaExame,
    horaInicio: horaExame,
    horaFim: horaExame,
    intervaloInicio: horaExame.nullable(),
    intervaloFim: horaExame.nullable(),
  })
  .strict();

/** O motivo do cancelamento do exame tem 30 posições (o texto livre da base de origem tem de 1 a 24 caracteres em 2026). */
export const TAMANHO_MOTIVO_EXAME = 30;

const MOTIVOS_CURTOS: Readonly<Record<string, string>> = {
  'PAC-DESISTIU': 'Paciente desistiu',
  'PAC-OUTRA-DATA': 'Paciente pediu outra data',
  'PAC-SAUDE': 'Paciente sem condição clínica',
  'PAC-OBITO': 'Óbito do paciente',
  'PROF-AUSENTE': 'Profissional indisponível',
  'HOSP-AGENDA': 'Ajuste da agenda',
  'CONV-NAO-AUTORIZOU': 'Convênio não autorizou',
  'ERRO-MARCACAO': 'Marcação por engano',
  DUPLICADA: 'Marcação em duplicidade',
  'ENCAIXE-DESFEITO': 'Encaixe desfeito',
  OUTRO: 'Outro',
};

/** Texto do motivo para o cancelamento de exame (até 30 caracteres; o código completo vai ao registro do novo). */
export function textoCurtoDoMotivo(codigo: string, complemento?: string | null): string {
  if (!motivoCancelamento(codigo)) throw new Error('Motivo de cancelamento desconhecido.');
  const base = MOTIVOS_CURTOS[codigo] ?? 'Outro';
  const c = (complemento ?? '').replace(/\s+/g, ' ').trim();
  return (codigo === 'OUTRO' && c ? c : base).slice(0, TAMANHO_MOTIVO_EXAME);
}

const observacao = textoCp1252(500)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();
const complemento = textoCp1252(200)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();

/** Solicitante externo do exame (o legado deixa PROC_SOL, CRM_SOL e MED_SOL vazios: vai ao registro do novo). */
export const esquemaSolicitanteExame = z
  .object({
    crm: z.number().int().min(1).max(9_999_999),
    uf: z.string().regex(/^[A-Z]{2}$/, 'UF com duas letras.'),
    nome: textoCp1252(70)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim().toUpperCase())
      .pipe(z.string().min(3, 'Nome do solicitante com ao menos 3 letras.')),
  })
  .strict();
export type SolicitanteExame = z.infer<typeof esquemaSolicitanteExame>;

// ── Entradas das operações ───────────────────────────────────────────────────────────────────────────

export const esquemaAgendarExame = z
  .object({
    agenda: id,
    data: esquemaDataIso,
    hora: horaExame,
    paciente: id,
    convenio: smallint,
    /** Exame escolhido no catálogo do SADT; null = ainda não definido (a recepção define na chegada). */
    exame: id.nullable(),
    solicitante: esquemaSolicitanteExame.nullable(),
    /** Retorno (vai ao registro do novo; o legado grava 'N' em 100% das marcações de exame). */
    retorno: z.boolean(),
    observacao: observacao.optional(),
    canal: esquemaCanal,
  })
  .strict();
export type AgendarExameEntrada = z.infer<typeof esquemaAgendarExame>;

export const esquemaCancelarExame = z
  .object({
    marcacao: id,
    motivo: esquemaMotivoCancelamento,
    complemento: complemento.optional(),
    solicitante: z.enum(SOLICITANTES_CANCELAMENTO),
  })
  .strict()
  .refine((e) => e.motivo !== 'OUTRO' || (e.complemento ?? '').length >= 3, {
    message: 'Em "Outro motivo", descreva o motivo.',
    path: ['complemento'],
  });
export type CancelarExameEntrada = z.infer<typeof esquemaCancelarExame>;

export const esquemaRemarcarExame = z
  .object({
    marcacao: id,
    destino: z.object({ agenda: id, data: esquemaDataIso, hora: horaExame }).strict(),
    modo: z.enum(MODOS_REMARCACAO),
    convenio: smallint.optional(),
    observacao: observacao.optional(),
    canal: esquemaCanal,
    motivo: esquemaMotivoCancelamento.default('PAC-OUTRA-DATA'),
    complemento: complemento.optional(),
  })
  .strict();
export type RemarcarExameEntrada = z.infer<typeof esquemaRemarcarExame>;

/** A PRÉVIA aprovada da grade de exames (o motor da agenda a monta; a receita reconfere sob a trava). */
export const esquemaGerarGradeExame = z
  .object({
    agenda: id,
    de: esquemaDataIso,
    ate: esquemaDataIso,
    duracao: horaExame,
    horarios: z.array(horarioExame).min(1).max(TETO_HORARIOS_POR_GRAVACAO),
    escala: z.array(linhaEscalaExame).min(1).max(21),
    semanas: z.array(z.enum(['T', 'F'])).length(7),
    /** A prévia incluiu os feriados (a geração grava o pedido como foi feito). */
    incluirFeriados: z.boolean().optional(),
  })
  .strict()
  .refine((e) => e.ate >= e.de, { message: 'O fim vem antes do início.', path: ['ate'] })
  .refine((e) => e.horarios.every((h) => h.data >= e.de && h.data <= e.ate), {
    message: 'Horário fora do período.',
    path: ['horarios'],
  })
  .refine((e) => new Set(e.horarios.map((h) => `${h.data} ${h.hora}`)).size === e.horarios.length, {
    message: 'Horário repetido na prévia.',
    path: ['horarios'],
  })
  .refine((e) => new Set(e.escala.map((l) => `${l.semana} ${l.duracao}`)).size === e.escala.length, {
    message: 'A escala do exame tem uma linha por dia da semana e duração.',
    path: ['escala'],
  });
export type GerarGradeExameEntrada = z.infer<typeof esquemaGerarGradeExame>;

export const esquemaDefinirCoberturaExame = z
  .object({
    agenda: id,
    convenio: smallint,
    acao: z.enum(['incluir', 'remover']),
    confirmarAceitarTodos: z.boolean().default(false),
  })
  .strict();
export type DefinirCoberturaExameEntrada = z.infer<typeof esquemaDefinirCoberturaExame>;

/** 02-AGE 44: marcação para quem ainda não tem prontuário (pré-cadastro na mesma transação; vira paciente na chegada). */
export const esquemaAgendarExameSemProntuario = z
  .object({
    agenda: id,
    data: esquemaDataIso,
    hora: horaExame,
    nome: textoCp1252(70)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim().toUpperCase())
      .pipe(z.string().min(3)),
    nascimento: esquemaDataIso,
    /** Exame escolhido no catálogo do SADT; null ou ausente = a recepção define na chegada. */
    exame: id.nullable().optional(),
    telefone: z.string().regex(/^\d{8,15}$/, 'Telefone só com dígitos (8 a 15).'),
    /** A central conferiu os pacientes de mesmo nome e nascimento e confirma que é outra pessoa. */
    cadastroConferido: z.boolean().optional(),
    convenio: smallint,
    canal: esquemaCanal,
  })
  .strict();
export type AgendarExameSemProntuarioEntrada = z.infer<typeof esquemaAgendarExameSemProntuario>;

// ── Pedidos das telas (gravações só do novo) ─────────────────────────────────────────────────────────

/** Cobertura por exame do novo: a agenda faz o exame (convênio nulo) ou o convênio cobre o exame nesta agenda. */
export const esquemaPedidoCoberturaExame = z
  .object({
    exame: id,
    convenio: smallint.nullable(),
    acao: z.enum(['incluir', 'remover']),
  })
  .strict();
export type PedidoCoberturaExame = z.infer<typeof esquemaPedidoCoberturaExame>;

/** Prévia e gravação da grade de exames: o mesmo pedido da agenda de consultas (faixas, período e duração). */
export { esquemaPedidoGerarGrade as esquemaPedidoGerarGradeExame } from './pedidos.js';
export { esquemaPedidoGrade as esquemaPedidoGradeExame } from './pedidos.js';

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaCategoriaExameResposta = z.object({ codigo: n, rotulo: txt });

export const esquemaAgendaExameResumo = z.object({
  id: n,
  nome: txt,
  crm: n,
  /** Tipo de horário da agenda (E, U, O) e o rótulo. */
  exame: txt,
  exameRotulo: txt,
  categoria: esquemaCategoriaExameResposta,
  duracao: txt,
  ativa: z.boolean(),
  unidade: n,
  gradeInicio: nul(txt),
  gradeFim: nul(txt),
  /** Convênios aceitos; 0 = aceita todos. */
  convenios: n,
  /** Exames que a agenda faz (cobertura do novo); 0 = não informado (vale a lista de convênios). */
  exames: n,
});
export type AgendaExameResumo = z.infer<typeof esquemaAgendaExameResumo>;

export const esquemaListaAgendasExame = z.object({
  itens: z.array(esquemaAgendaExameResumo),
  total: n,
  destino: z.enum(['legado', 'memoria']),
});
export type ListaAgendasExame = z.infer<typeof esquemaListaAgendasExame>;

export const esquemaCoberturaExameResposta = z.object({
  id: n,
  exame: n,
  exameNome: txt,
  convenio: nul(n),
  convenioNome: nul(txt),
});

export const esquemaDetalheAgendaExame = z.object({
  agenda: esquemaAgendaExameResumo,
  convenios: z.array(z.object({ codigo: n, nome: txt })),
  cobertura: z.array(esquemaCoberturaExameResposta),
  escala: z.array(z.object({ semana: n, dia: txt, duracao: txt, inicio: txt, fim: txt, exame: txt })),
  geracoes: z.array(
    z.object({ inicio: txt, fim: txt, criadaEm: txt, hora: txt, situacao: txt, dias: z.array(n) }),
  ),
  observacao: nul(txt),
});
export type DetalheAgendaExame = z.infer<typeof esquemaDetalheAgendaExame>;

/** Prévia da geração da grade de exames (a mesma da agenda de consultas, com o resumo da agenda de exames). */
export const esquemaPreviaGradeExame = esquemaPreviaGrade.omit({ agenda: true }).extend({
  agenda: esquemaAgendaExameResumo,
});
export type PreviaGradeExame = z.infer<typeof esquemaPreviaGradeExame>;

export const ESTADOS_HORARIO_EXAME = [
  'vago',
  'bloqueado',
  'marcado',
  'confirmado',
  'realizado',
  'transferido',
  'marcacao-incompleta',
  'residuo-confirmado-sem-paciente',
  'outro',
] as const;

export const esquemaHorarioExame = z.object({
  agenda: n,
  agendaNome: txt,
  data: txt,
  hora: txt,
  exame: txt,
  estado: z.enum(ESTADOS_HORARIO_EXAME),
  estadoRotulo: txt,
  paciente: nul(txt),
  marcacao: nul(n),
  convenio: nul(n),
});
export type HorarioExame = z.infer<typeof esquemaHorarioExame>;

export const esquemaGradeExame = z.object({
  agenda: esquemaAgendaExameResumo,
  de: txt,
  ate: txt,
  horarios: z.array(esquemaHorarioExame),
  truncado: z.boolean(),
  /** "Marcação incompleta" e "confirmado sem paciente" no período (aviso da tela). */
  residuo: z.object({ confirmadosSemPaciente: n, ocupadosSemMarcacao: n, total: n }),
});
export type GradeExame = z.infer<typeof esquemaGradeExame>;

export const esquemaVagaExame = z.object({
  agenda: n,
  agendaNome: txt,
  categoria: txt,
  data: txt,
  hora: txt,
  exame: txt,
});
export const esquemaBuscaVagasExame = z.object({
  itens: z.array(esquemaVagaExame),
  truncado: z.boolean(),
  /** Próximas vagas (até 90 dias) quando a janela não tem nenhuma. */
  proximas: z.array(esquemaVagaExame),
  de: txt,
  ate: txt,
});
export type BuscaVagasExame = z.infer<typeof esquemaBuscaVagasExame>;

export const esquemaMarcacaoExameResumo = z.object({
  id: n,
  agenda: nul(n),
  agendaNome: txt,
  data: txt,
  hora: txt,
  /** Nome mascarado nas listas. */
  paciente: txt,
  prontuario: n,
  idPaciente: nul(n),
  convenio: n,
  situacao: txt,
  estado: z.enum(ESTADOS_HORARIO_EXAME),
  estadoRotulo: txt,
  categoria: txt,
  exameEscolhido: nul(z.object({ id: n, nome: txt })),
  canal: nul(txt),
  atendido: z.boolean(),
  /** Vínculo pelo prontuário; sem prontuário, a sugestão por nome fica a confirmar. */
  vinculo: z.enum(['prontuario', 'sugestao-por-nome', 'sem-vinculo']),
});
export type MarcacaoExameResumo = z.infer<typeof esquemaMarcacaoExameResumo>;

export const esquemaMarcacaoExameDetalhe = esquemaMarcacaoExameResumo.extend({
  pacienteNome: txt,
  telefone: txt,
  celular: txt,
  email: txt,
  observacao: nul(txt),
  solicitante: nul(z.object({ crm: n, uf: txt, nome: txt })),
  retorno: z.boolean(),
  marcadaPor: txt,
  marcadaEm: txt,
  temSenha: z.boolean(),
});
export type MarcacaoExameDetalhe = z.infer<typeof esquemaMarcacaoExameDetalhe>;

export const esquemaListaMarcacoesExame = z.object({
  itens: z.array(esquemaMarcacaoExameResumo),
  truncado: z.boolean(),
});
export type ListaMarcacoesExame = z.infer<typeof esquemaListaMarcacoesExame>;

export const esquemaCancelamentoExame = z.object({
  agendaNome: txt,
  data: txt,
  hora: txt,
  paciente: txt,
  motivo: txt,
  codigoMotivo: nul(txt),
  canceladoEm: txt,
  canceladoPor: txt,
  marcadoPor: txt,
  convenio: n,
});
export const esquemaListaCancelamentosExame = z.object({
  itens: z.array(esquemaCancelamentoExame),
  total: n,
  pagina: n,
  porPagina: n,
});
export type ListaCancelamentosExame = z.infer<typeof esquemaListaCancelamentosExame>;

/** Relatório de resíduo da sante-api: só contagens e a lista por horário (sem nome de paciente). */
export const esquemaResiduoExame = z.object({
  de: txt,
  ate: txt,
  confirmadosSemPaciente: n,
  ocupadosSemMarcacao: n,
  total: n,
  porAgenda: z.array(
    z.object({ agenda: n, agendaNome: txt, confirmadosSemPaciente: n, ocupadosSemMarcacao: n }),
  ),
  horarios: z.array(z.object({ agendaNome: txt, data: txt, hora: txt, tipo: txt })),
  truncado: z.boolean(),
});
export type ResiduoExameResposta = z.infer<typeof esquemaResiduoExame>;

export const esquemaOpcoesExame = z.object({
  convenios: z.array(z.object({ codigo: n, nome: txt, ativo: z.boolean() })),
  exames: z.array(z.object({ id: n, nome: txt, categoria: n })),
  categorias: z.array(esquemaCategoriaExameResposta),
  tipos: z.array(z.object({ codigo: txt, rotulo: txt })),
  motivosCancelamento: z.array(z.object({ codigo: txt, texto: txt, solicitante: txt })),
  canais: z.array(z.object({ codigo: txt, rotulo: txt, aConfirmar: z.boolean() })),
  hoje: txt,
  agora: txt,
});
export type OpcoesExame = z.infer<typeof esquemaOpcoesExame>;
