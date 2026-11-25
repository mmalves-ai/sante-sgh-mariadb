// Agenda de grupos e turmas (02-AGE linha 50): lista, detalhe, opções, presença do encontro, visão por paciente e as
// gravações (turma, escala, geração e cancelamento de encontros, inscrição, saída e presença).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/turmas';

export const SITUACOES_PRESENCA = ['presente', 'falta', 'falta_justificada'] as const;
export const SAIDAS = ['concluido', 'desistente', 'desligado'] as const;
export type SituacaoPresenca = (typeof SITUACOES_PRESENCA)[number];
export type Saida = (typeof SAIDAS)[number];

const esquemaResumo = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.string(),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  vagas: z.number(),
  vagasEncaixe: z.number(),
  ocupadas: z.number(),
  espera: z.number(),
  proximoEncontro: z.string().nullable(),
  ativo: z.boolean(),
});
export type TurmaResumo = z.infer<typeof esquemaResumo>;

const esquemaTurma = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.number(),
  itemAgendavel: z.number(),
  setorFuncional: z.number(),
  localFisico: z.number().nullable(),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  vagas: z.number(),
  vagasEncaixe: z.number(),
  exigeAcompanhante: z.boolean(),
  permiteAcompanhante: z.boolean(),
  exigeIndicacaoMedica: z.boolean(),
  idadeMinimaAnos: z.number().nullable(),
  idadeMaximaAnos: z.number().nullable(),
  sexo: z.number().nullable(),
  ativo: z.boolean(),
  profissionais: z.array(z.object({ profissional: z.number(), principal: z.boolean() })),
  fontes: z.array(
    z.object({ fontePagadora: z.number(), plano: z.number().nullable(), limite: z.number().nullable() }),
  ),
});
export type TurmaLida = z.infer<typeof esquemaTurma>;
export type EntradaTurma = Omit<TurmaLida, 'id' | 'versao'> & { versao?: number };

const esquemaEscala = z.object({
  id: z.number(),
  versao: z.number(),
  turma: z.number(),
  diaSemana: z.number(),
  horaInicio: z.string(),
  horaFim: z.string(),
  inclusiveFeriado: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
});
export type EscalaLida = z.infer<typeof esquemaEscala>;
const esquemaEncontro = z.object({
  id: z.number(),
  versao: z.number(),
  data: z.string(),
  horaInicio: z.string(),
  horaFim: z.string(),
  situacao: z.enum(['previsto', 'realizado', 'cancelado']),
  motivoCancelamento: z.string().nullable(),
  presencas: z.number(),
});
export type EncontroLido = z.infer<typeof esquemaEncontro>;
const esquemaParticipante = z.object({
  id: z.number(),
  versao: z.number(),
  paciente: z.number(),
  nome: z.string(),
  prontuario: z.number().nullable(),
  fontePagadora: z.string(),
  situacao: z.enum(['em_espera', 'inscrito', 'ativo', 'concluido', 'desistente', 'desligado']),
  posicaoEspera: z.number().nullable(),
  inscritoEm: z.string(),
  desligadoEm: z.string().nullable(),
  motivoDesligamento: z.string().nullable(),
  frequencia: z.number().nullable(),
});
export type ParticipanteLido = z.infer<typeof esquemaParticipante>;
const esquemaDetalhe = z.object({
  turma: esquemaTurma,
  escalas: z.array(esquemaEscala),
  encontros: z.array(esquemaEncontro),
  participantes: z.array(esquemaParticipante),
});
export type TurmaDetalhe = z.infer<typeof esquemaDetalhe>;
const esquemaPresencaEncontro = z.object({
  encontro: esquemaEncontro,
  participantes: z.array(
    z.object({
      participante: z.number(),
      nome: z.string(),
      situacao: z.enum(SITUACOES_PRESENCA).nullable(),
      justificativa: z.string().nullable(),
      acompanhante: z.boolean(),
    }),
  ),
});
export type PresencaEncontro = z.infer<typeof esquemaPresencaEncontro>;
const esquemaDoPaciente = z.array(
  z.object({
    participacao: z.number(),
    turma: z.number(),
    codigo: z.string(),
    descricao: z.string(),
    situacao: esquemaParticipante.shape.situacao,
    posicaoEspera: z.number().nullable(),
    inscritoEm: z.string(),
    desligadoEm: z.string().nullable(),
    frequencia: z.number().nullable(),
    proximoEncontro: z.string().nullable(),
  }),
);
export type ParticipacaoPaciente = z.infer<typeof esquemaDoPaciente>[number];
const opcao = z.array(z.object({ id: z.number(), nome: z.string() }));
const esquemaOpcoes = z.object({
  tipo: opcao,
  itemAgendavel: opcao,
  setorFuncional: opcao,
  profissional: opcao,
  fontePagadora: opcao,
  plano: z.array(z.object({ id: z.number(), nome: z.string(), fontePagadora: z.number() })),
  sexo: opcao,
});
export type OpcoesTurma = z.infer<typeof esquemaOpcoes>;

const esquemaGravacao = z
  .object({ ok: z.boolean(), mensagem: z.string().optional(), resultado: z.record(z.string(), z.unknown()) })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = <T>(url: string, e: z.ZodType<T>) =>
  fetch(url, { headers: { accept: 'application/json' } }).then((r) => json(r, e));
const enviar = (url: string, corpo: unknown, chave: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  }).then((r) => json(r, esquemaGravacao));

export const lerTurmas = () => ler(P, z.array(esquemaResumo));
export const lerOpcoesTurma = () => ler(`${P}/opcoes`, esquemaOpcoes);
export const lerTurma = (id: number) => ler(`${P}/${id}`, esquemaDetalhe);
export const lerPresencaEncontro = (id: number) => ler(`${P}/encontros/${id}`, esquemaPresencaEncontro);
export const lerTurmasDoPaciente = (id: number) => ler(`${P}/paciente/${id}`, esquemaDoPaciente);

export const salvarTurma = (id: number | null, e: EntradaTurma, chave: string) =>
  enviar(id ? `${P}/${id}` : P, e, chave);
export type EntradaEscala = Omit<EscalaLida, 'id' | 'versao' | 'turma'> & { id?: number; versao?: number };
export const salvarEscala = (turma: number, e: EntradaEscala, chave: string) =>
  enviar(`${P}/${turma}/escalas`, e, chave);
export const gerarEncontros = (turma: number, de: string, ate: string, chave: string) =>
  enviar(`${P}/${turma}/encontros/gerar`, { de, ate }, chave);
export const cancelarEncontro = (encontro: number, versao: number, motivo: string, chave: string) =>
  enviar(`${P}/encontros/${encontro}/cancelar`, { versao, motivo }, chave);
export interface EntradaInscricao {
  paciente: number;
  fontePagadora: number;
  plano: number | null;
  indicacaoProfissional: number | null;
  acompanhante: boolean;
  encaixe: boolean;
  observacao: string | null;
}
export const inscrever = (turma: number, e: EntradaInscricao, chave: string) =>
  enviar(`${P}/${turma}/participantes`, e, chave);
export const sairDaTurma = (
  participante: number,
  versao: number,
  saida: Saida,
  motivo: string | null,
  chave: string,
) => enviar(`${P}/participantes/${participante}/sair`, { versao, saida, motivo }, chave);
export interface RegistroPresenca {
  participante: number;
  situacao: SituacaoPresenca;
  justificativa: string | null;
  acompanhante: boolean;
}
export const registrarPresenca = (encontro: number, registros: RegistroPresenca[], chave: string) =>
  enviar(`${P}/encontros/${encontro}/presencas`, { registros }, chave);
