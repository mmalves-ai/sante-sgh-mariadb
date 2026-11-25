// Cliente do complemento da conta da AIH (F7, 06-SUS linha 58): GET e PUT em /api/sus/aih/:aih/complemento. A resposta
// é conferida pelo esquema de @sgh/contratos mais as opções da tela; a gravação leva o CSRF e a chave de idempotência.
import { esquemaComplementoContaAih } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from '../exames/api-exames.js';

const codigoDescricao = z.object({ codigo: z.string(), descricao: z.string() });
export const esquemaComplementoAihTela = esquemaComplementoContaAih.extend({
  opcoes: z.object({
    procedimentos: z.array(
      z.object({ sequencia: z.number().int(), codigo: z.string(), nome: z.string(), tipo: z.string() }),
    ),
    atividades: z.array(codigoDescricao),
    credores: z.array(codigoDescricao),
    habilitacoes: z.array(codigoDescricao),
  }),
});
export type ComplementoAihTela = z.infer<typeof esquemaComplementoAihTela>;
/** O que o PUT devolve: o complemento gravado (sem as opções). */
export type ComplementoAihGravado = z.infer<typeof esquemaComplementoContaAih>;

export interface GravarComplementoAih {
  /** A versão da conta lida. */
  readonly versao: number;
  readonly diagnosticos: readonly {
    cid: string;
    tipo: 'secundario' | 'causa_associada' | 'causa_morte';
    classificacao: 'preexistente' | 'adquirido' | null;
  }[];
  readonly equipe: readonly {
    procedimento: number;
    cns: string;
    cbo: string;
    atividade: string;
    credor: string | null;
    documentoCredor: string | null;
  }[];
  readonly incrementos: readonly { habilitacao: string; procedimento: number | null; percentual: number }[];
}

const url = (aih: number) => `/api/sus/aih/${aih}/complemento`;

export async function lerComplementoAih(aih: number): Promise<ComplementoAihTela> {
  const r = await fetch(url(aih), { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaComplementoAihTela.parse(await r.json());
}

export async function gravarComplementoAih(
  aih: number,
  corpo: GravarComplementoAih,
): Promise<ComplementoAihGravado> {
  const r = await fetch(url(aih), {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('sus-aih-complemento'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaComplementoContaAih.parse(await r.json());
}
