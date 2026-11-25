// Cliente do laudo de internação SUS (F7, 06-SUS linha 57): laudos da AIH, devolução pelo gestor, reenvio corrigido,
// laudo especial, impressão e lote de laudos. Toda escrita leva o CSRF e a chave de idempotência.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const BASE = '/api/sus/laudos-internacao';
const JSON_ACEITO = { accept: 'application/json' };

export const TIPOS_ITEM_LAUDO_ESPECIAL = [
  'opm',
  'sangue',
  'diaria_acompanhante',
  'diaria_uti',
  'outro',
] as const;
export type TipoItemLaudoEspecial = (typeof TIPOS_ITEM_LAUDO_ESPECIAL)[number];

const esquemaLaudo = z.object({
  id: z.number().int(),
  numero: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  autorizacao: z.number().int().nullable(),
  numeroAih: z.string().nullable(),
  prontuario: z.number().nullable(),
  dataLaudo: z.string(),
  procedimentoSolicitado: z.string(),
  cidPrincipal: z.string(),
  justificativa: z.string(),
  emitidoEm: z.string().nullable(),
  impressoEm: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  devolvidoEm: z.string().nullable(),
  motivoDevolucao: z.string().nullable(),
  lote: z.object({ id: z.number().int(), numero: z.string() }).nullable(),
  especiais: z.array(
    z.object({
      sequencia: z.number().int(),
      tipo: z.string(),
      procedimento: z.string(),
      quantidade: z.number(),
      justificativa: z.string().nullable(),
    }),
  ),
  versao: z.number().int(),
});
export type LaudoInternacaoSus = z.infer<typeof esquemaLaudo>;

const esquemaLote = z.object({
  id: z.number().int(),
  numero: z.string(),
  situacao: z.string(),
  quantidadeLaudos: z.number().int(),
  // O que o lote continha, inclusive os laudos retirados depois (reenvio corrigido ou lote cancelado).
  laudos: z
    .array(
      z.object({
        laudo: z.number().int(),
        numero: z.string(),
        situacaoNaInclusao: z.string(),
        incluidoEm: z.string(),
        enviadoEm: z.string().nullable(),
        retiradoEm: z.string().nullable(),
        motivoRetirada: z.enum(['reenvio_corrigido', 'lote_cancelado']).nullable(),
      }),
    )
    .default([]),
  geradoEm: z.string(),
  enviadoEm: z.string().nullable(),
  retornadoEm: z.string().nullable(),
  observacao: z.string().nullable(),
  versao: z.number().int(),
});
export type LoteLaudoSus = z.infer<typeof esquemaLote>;

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function postar(caminho: string, corpo: unknown): Promise<void> {
  const r = await fetch(`${BASE}${caminho}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
}

async function ler<T>(caminho: string, esquema: z.ZodType<T>): Promise<T> {
  const r = await fetch(`${BASE}${caminho}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

export async function lerLaudosDaAih(aih: number): Promise<LaudoInternacaoSus[]> {
  return (await ler(`?autorizacao=${aih}`, z.object({ itens: z.array(esquemaLaudo) }))).itens;
}

export async function lerLaudosSemLote(): Promise<LaudoInternacaoSus[]> {
  return (await ler('?semLote=true', z.object({ itens: z.array(esquemaLaudo) }))).itens;
}

export async function lerLotesLaudo(): Promise<LoteLaudoSus[]> {
  return (await ler('/lotes', z.object({ itens: z.array(esquemaLote) }))).itens;
}

export const devolverLaudo = (aih: number, versao: number, motivo: string) =>
  postar(`/aih/${aih}/devolver`, { versao, motivo });

export const reenviarLaudo = (
  aih: number,
  corpo: {
    versao: number;
    justificativa: string;
    procedimentoSolicitado: string | null;
    cidPrincipal: string | null;
  },
) => postar(`/aih/${aih}/reenviar`, corpo);

export const emitirLaudoEspecial = (
  aih: number,
  corpo: {
    versao: number;
    justificativa: string;
    itens: { tipo: TipoItemLaudoEspecial; procedimento: string; quantidade: number }[];
  },
) => postar(`/aih/${aih}/especial`, corpo);

export const marcarLaudoImpresso = (laudo: number) => postar(`/${laudo}/impressao`, {});

export const gerarLoteLaudos = (laudos: number[]) => postar('/lotes', { laudos });

export const acaoLoteLaudos = (
  lote: number,
  acao: 'enviar' | 'retornar' | 'cancelar',
  versao: number,
  observacao: string | null,
) => postar(`/lotes/${lote}/${acao}`, { versao, observacao });
