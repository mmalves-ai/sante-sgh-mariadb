// Cliente da conferência das contas médicas recebidas (08-SGO L105, C1-100): as críticas gravadas no recebimento, os
// pareceres da auditoria da conta e os demonstrativos de análise entregues (GET /api/operadora/contas/:id/conferencia),
// o registro do parecer e as regras de crítica cadastráveis por operadora (incluir; tirar de uso ou voltar, nunca
// apagar). As respostas passam pelos esquemas abaixo; Problem Details viram ErroApi.
import {
  RESULTADOS_AUDITORIA_CONTA,
  TIPOS_AUDITORIA_CONTA,
  TIPOS_REGRA_CRITICA,
  type EntradaRegraCritica,
  type ResultadoAuditoriaConta,
  type TipoAuditoriaConta,
} from '@sgh/dominio-operadora';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/operadora/contas';
const R = '/api/operadora/regras-critica-conta';

const ref = z.object({ id: z.number().int(), codigo: z.string(), descricao: z.string() });
const esquemaGravado = z.object({ id: z.number().int(), versao: z.number().int() });
export type Gravado = z.infer<typeof esquemaGravado>;

export const esquemaRegraCritica = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.enum(TIPOS_REGRA_CRITICA),
  principal: ref.nullable(),
  relacionado: ref.nullable(),
  prestador: z.object({ id: z.number().int(), nome: z.string() }).nullable(),
  motivoGlosa: ref.nullable(),
  percentual: z.number().nullable(),
  glosaAutomatica: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
});
export type RegraCritica = z.infer<typeof esquemaRegraCritica>;

export const esquemaApoioRegras = z.object({
  procedimentos: z.array(ref),
  motivos: z.array(ref),
  prestadores: z.array(z.object({ id: z.number().int(), nome: z.string() })),
});
export type ApoioRegras = z.infer<typeof esquemaApoioRegras>;

export const esquemaConferenciaConta = z.object({
  criticas: z.array(
    z.object({
      id: z.number().int(),
      guia: z.number().int(),
      numeroGuia: z.string(),
      item: z.number().int().nullable(),
      itemCodigo: z.string().nullable(),
      regra: z.object({ id: z.number().int(), codigo: z.string() }).nullable(),
      motivoGlosa: z.string().nullable(),
      descricao: z.string(),
      tipo: z.enum(['critica', 'alerta', 'glosa']),
      ocorridaEm: z.string(),
    }),
  ),
  auditorias: z.array(
    z.object({
      id: z.number().int(),
      guia: z.number().int(),
      numeroGuia: z.string(),
      item: z.number().int().nullable(),
      tipo: z.enum(TIPOS_AUDITORIA_CONTA),
      resultado: z.enum(RESULTADOS_AUDITORIA_CONTA),
      parecer: z.string(),
      motivoGlosa: z.string().nullable(),
      auditor: z.string().nullable(),
      registradaEm: z.string(),
    }),
  ),
  demonstrativos: z.array(
    z.object({
      id: z.number().int(),
      versao: z.number().int(),
      numero: z.string(),
      emitidoEm: z.string(),
      informado: z.number(),
      liberado: z.number(),
      glosa: z.number(),
      situacao: z.string(),
      emissoes: z.number().int(),
    }),
  ),
});
export type ConferenciaConta = z.infer<typeof esquemaConferenciaConta>;

export interface EntradaParecer {
  guia: number;
  item: number | null;
  tipo: TipoAuditoriaConta;
  resultado: ResultadoAuditoriaConta;
  parecer: string;
  motivoGlosa: number | null;
}

export const lerConferencia = (conta: number): Promise<ConferenciaConta> =>
  ler(`${C}/${conta}/conferencia`, esquemaConferenciaConta);

export const registrarParecer = (conta: number, e: EntradaParecer): Promise<Gravado> =>
  enviar(`${C}/${conta}/auditorias`, e, esquemaGravado, novaChave('conta-parecer'));

export const lerRegrasCritica = (operadora: number): Promise<RegraCritica[]> =>
  ler(`${R}/${operadora}`, z.array(esquemaRegraCritica));

export const lerApoioRegras = (operadora: number): Promise<ApoioRegras> =>
  ler(`${R}/${operadora}/apoio`, esquemaApoioRegras);

export const incluirRegraCritica = (operadora: number, e: EntradaRegraCritica): Promise<Gravado> =>
  enviar(`${R}/${operadora}`, e, esquemaGravado, novaChave('regra-critica'));

export const situacaoRegraCritica = (regra: number, versao: number, ativo: boolean): Promise<Gravado> =>
  enviar(
    `${R}/regra/${regra}/situacao`,
    { versao, ativo },
    esquemaGravado,
    novaChave('regra-critica-situacao'),
  );
