// Cliente do valor do índice de cobrança e do porte por vigência (06-FAT linha 5), na tela do contrato: as opções do
// formulário (índices ativos, portes de honorário, tabelas de honorários do acordo e as vigências já gravadas) e a
// gravação de uma vigência nova (nada se altera nem se apaga). A gravação manda o CSRF e a Idempotency-Key; erro vira
// ErroApi.
import type { TipoRegistroIndice } from '@sgh/dominio-preco';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

export const esquemaOpcoesIndices = z.object({
  indices: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), tipo: z.string() })),
  portes: z.array(z.object({ codigo: z.string(), descricao: z.string() })),
  tabelas: z.array(
    z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), regime: z.string() }),
  ),
  vigencias: z.array(
    z.object({
      tipo: z.enum(['indice', 'porte', 'porte-anestesico']),
      chave: z.string(),
      tabelaId: z.number().nullable(),
      inicio: z.string(),
      valor: z.number(),
      valorHorarioEspecial: z.number().nullable(),
    }),
  ),
});
export type OpcoesIndices = z.infer<typeof esquemaOpcoesIndices>;

const esquemaGravado = z.object({ id: z.number() }).passthrough();

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const base = (convenio: number) => `/api/cadastros/convenios/${encodeURIComponent(String(convenio))}/indices`;

export const lerOpcoesIndices = (convenio: number) =>
  fetch(`${base(convenio)}/opcoes`, { headers: JSON_ACEITO }).then((r) => lerJson(r, esquemaOpcoesIndices));

export const registrarIndice = (
  convenio: number,
  tipo: TipoRegistroIndice,
  entrada: Record<string, unknown>,
) =>
  fetch(`${base(convenio)}/${tipo}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(entrada),
  }).then((r) => lerJson(r, esquemaGravado));
