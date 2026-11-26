// Cliente da auditoria da prescrição de antimicrobiano pela comissão de controle de infecção (F7, 03-PEP linha 110),
// validado na chegada. A fila traz as fichas de antimicrobiano (as pendentes primeiro) com a versão vista; o histórico,
// as auditorias da ficha ou do paciente (as encerradas também); a gravação vai com o CSRF e a Idempotency-Key.
import {
  ADEQUACOES_AUDITORIA,
  INDICACOES_AUDITORIA,
  PARECERES_AUDITORIA_ANTIMICROBIANO,
} from '@sgh/dominio-qualidade';
import { z } from 'zod';
import { enviar, ler, qs } from '../../exames/api-exames.js';

const A = '/api/qualidade/ccih/auditoria-antimicrobiano';

const esquemaFicha = z.object({
  id: z.number(),
  versao: z.number(),
  paciente: z.number(),
  nome: z.string(),
  atendimento: z.number().nullable(),
  /** Nulo só na ficha migrada sem item de prescrição ligado na origem. */
  item: z.number().nullable(),
  antimicrobiano: z.string(),
  finalidade: z.string(),
  finalidadeCodigo: z.string(),
  sitio: z.string().nullable(),
  indicacaoClinica: z.string(),
  culturaColetada: z.boolean(),
  inicio: z.string().nullable(),
  fimPrevisto: z.string().nullable(),
  diasPrevistos: z.number(),
  prescritor: z.string(),
  avaliacao: z.string(),
  avaliadaEm: z.string().nullable(),
  ultimoParecer: z.string().nullable(),
});
export type FichaDaAuditoria = z.infer<typeof esquemaFicha>;

const esquemaAuditoria = z.object({
  id: z.number(),
  ficha: z.number().nullable(),
  item: z.number().nullable(),
  paciente: z.number(),
  auditadaEm: z.string(),
  auditor: z.string(),
  avaliavel: z.boolean(),
  droga: z.string().nullable(),
  dose: z.string().nullable(),
  tempo: z.string().nullable(),
  via: z.string().nullable(),
  indicacao: z.string().nullable(),
  parecer: z.string(),
  permiteProrrogacao: z.boolean(),
  recomendacao: z.string().nullable(),
  situacao: z.string(),
  tipo: z.string().nullable(),
  parecerPadrao: z.string().nullable(),
  versao: z.number(),
});
export type AuditoriaDaFicha = z.infer<typeof esquemaAuditoria>;

const esquemaCadastro = z.object({
  tipos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      acao: z.string(),
      padrao: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  pareceres: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      permiteProrrogacao: z.boolean(),
      antimicrobiano: z.number().nullable(),
      ativo: z.boolean(),
    }),
  ),
});
export type CadastroDaAuditoria = z.infer<typeof esquemaCadastro>;

export interface EntradaAuditoria {
  readonly versaoFicha: number;
  readonly avaliavel: boolean;
  readonly droga: (typeof ADEQUACOES_AUDITORIA)[number];
  readonly dose: (typeof ADEQUACOES_AUDITORIA)[number];
  readonly tempo: (typeof ADEQUACOES_AUDITORIA)[number];
  readonly via: (typeof ADEQUACOES_AUDITORIA)[number];
  readonly indicacao: (typeof INDICACOES_AUDITORIA)[number] | null;
  readonly parecer: (typeof PARECERES_AUDITORIA_ANTIMICROBIANO)[number];
  readonly permiteProrrogacao: boolean | null;
  readonly recomendacao: string | null;
  readonly tipo: number | null;
  readonly parecerPadrao: number | null;
}

export const lerFichasParaAuditoria = (todas: boolean) =>
  ler(`${A}${qs({ todas: todas ? '1' : undefined })}`, z.array(esquemaFicha));
export const lerAuditoriasDoPaciente = (paciente: number) =>
  ler(`${A}/historico${qs({ paciente })}`, z.array(esquemaAuditoria));
export const lerCadastroDaAuditoria = () => ler(`${A}/cadastro`, esquemaCadastro);
export const gravarAuditoria = (ficha: number, e: EntradaAuditoria, chave: string) =>
  enviar(
    `${A}/fichas/${String(ficha)}`,
    e,
    z.object({ id: z.number(), ficha: z.number(), avaliacao: z.string(), encerradas: z.number() }),
    chave,
  );
