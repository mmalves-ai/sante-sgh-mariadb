// Cliente dos parâmetros e das preferências do faturista (F3.7, 06-FAT linha 38). As regras de validação vêm de
// @sgh/dominio-faturamento (as mesmas da API), para o erro aparecer enquanto se escolhe; o servidor confere de novo.
import { TELAS_INICIAIS_FATURISTA } from '@sgh/dominio-faturamento';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';

const esquemaParametros = z.object({
  parametros: z.object({
    rotinaDiaria: z.boolean(),
    rotinaDiariaHora: z.number(),
    prazoRecursoGlosaDias: z.number(),
    fechamentoDiaLimite: z.number(),
  }),
  preferencias: z.object({
    telaInicial: z.enum(TELAS_INICIAIS_FATURISTA),
    itensPorPagina: z.number(),
    agruparPorPaciente: z.boolean(),
  }),
  catalogo: z.array(
    z.object({
      chave: z.string(),
      tipo: z.enum(['booleano', 'inteiro', 'lista']),
      padrao: z.string(),
      minimo: z.number().optional(),
      maximo: z.number().optional(),
      opcoes: z.array(z.string()).optional(),
      preferencia: z.boolean(),
    }),
  ),
});
export type ParametrosFaturamentoTela = z.infer<typeof esquemaParametros>;

const esquemaGravado = z.object({ usuario: z.string(), gravados: z.string() }).passthrough();

export const lerParametrosFaturamento = () => ler(`${F}/parametros`, esquemaParametros);

/** Grava as preferências da própria conta (chave faturamento.preferencia.* → valor em texto). */
export const gravarPreferenciasFaturista = (preferencias: Record<string, string>, chave: string) =>
  enviar(`${F}/preferencias`, { preferencias }, esquemaGravado, chave);

// ── Alçada do faturamento: pedido e aprovação por outro usuário (quem pede não aprova) ──────────────────────────

export const DOCUMENTOS_ALCADA = [
  'fat_reabertura_competencia',
  'fat_aceite_glosa',
  'fat_cancelamento_conta',
] as const;
export type DocumentoAlcada = (typeof DOCUMENTOS_ALCADA)[number];

const esquemaPedido = z.object({
  id: z.number(),
  documento: z.string(),
  referencia: z.number(),
  valor: z.number(),
  motivo: z.string(),
  situacao: z.enum(['pendente', 'aprovado', 'recusado', 'usado']),
  solicitante: z.number(),
  solicitanteNome: z.string().nullable(),
  solicitadoEm: z.string(),
  decisor: z.number().nullable(),
  decisorNome: z.string().nullable(),
  decididoEm: z.string().nullable(),
  nivel: z.number().nullable(),
  motivoDecisao: z.string().nullable(),
});
export type PedidoAlcada = z.infer<typeof esquemaPedido>;
const esquemaRespostaPedido = z.object({ pedido: z.number(), situacao: z.string() }).passthrough();

export const lerPedidosAlcada = () => ler(`${F}/alcada/pedidos`, z.array(esquemaPedido));

export const pedirAlcada = (
  e: { documento: DocumentoAlcada; referencia: number; valor: number; motivo: string },
  chave: string,
) => enviar(`${F}/alcada/pedidos`, e, esquemaRespostaPedido, chave);

export const decidirAlcada = (pedido: number, e: { aprovar: boolean; motivo?: string }, chave: string) =>
  enviar(`${F}/alcada/pedidos/${pedido}/decisao`, e, esquemaRespostaPedido, chave);
