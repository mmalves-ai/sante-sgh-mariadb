// Cliente da rouparia e lavanderia (M55, fatia F2), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar; no movimento ela é também a `chave` do corpo); Problem Details viram
// ErroApi e o código da recusa fica em `problema.codigo`.
import {
  type DetalheMovimentoRoupa,
  esquemaDetalheMovimentoRoupa,
  esquemaEstatisticaRouparia,
  esquemaFornecedoresRouparia,
  esquemaIndicadoresRouparia,
  esquemaListaMovimentosRoupa,
  esquemaPainelRouparia,
  esquemaResultadoCotasRoupa,
  esquemaResultadoRouparia,
  esquemaSituacaoCotaSetor,
  type EstatisticaRouparia,
  type IndicadoresRouparia,
  type ListaMovimentosRoupa,
  type PainelRouparia,
  type ResultadoRoupariaResposta,
  type SituacaoCotaSetor,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, lerJson, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const B = '/api/hotelaria/rouparia';

let sequencia = 0;
export function novaChaveRouparia(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m55r.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function colocar<T>(url: string, corpo: unknown, esquema: z.ZodType<T>, chave: string): Promise<T> {
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return lerJson(r, esquema);
}

export const lerPainelRouparia = (): Promise<PainelRouparia> => ler(B, esquemaPainelRouparia);

export const listarMovimentosRoupa = (f: {
  de: string;
  ate: string;
  tipo?: string | null;
  centroCusto?: number | null;
  antesDe?: number | null;
}): Promise<ListaMovimentosRoupa> =>
  ler(
    `${B}/movimentos${qs({ de: f.de, ate: f.ate, tipo: f.tipo ?? null, centroCusto: f.centroCusto ?? null, antesDe: f.antesDe ?? null })}`,
    esquemaListaMovimentosRoupa,
  );

export const lerMovimentoRoupa = (id: number): Promise<DetalheMovimentoRoupa> =>
  ler(`${B}/movimentos/${id}`, esquemaDetalheMovimentoRoupa);

/** O movimento: a Idempotency-Key é a chave do corpo. */
export const registrarMovimentoRoupa = (corpo: { chave: string }): Promise<ResultadoRoupariaResposta> =>
  enviar(`${B}/movimentos`, corpo, esquemaResultadoRouparia, corpo.chave);

export const cancelarMovimentoRoupa = (
  id: number,
  corpo: { versaoVista: number; motivo: string },
): Promise<ResultadoRoupariaResposta> =>
  enviar(
    `${B}/movimentos/${id}/cancelamento`,
    corpo,
    esquemaResultadoRouparia,
    novaChaveRouparia('cancelar'),
  );

export const incluirPecaRoupa = (corpo: unknown): Promise<ResultadoRoupariaResposta> =>
  enviar(`${B}/pecas`, corpo, esquemaResultadoRouparia, novaChaveRouparia('peca'));

export const alterarPecaRoupa = (id: number, corpo: unknown): Promise<ResultadoRoupariaResposta> =>
  colocar(`${B}/pecas/${id}`, corpo, esquemaResultadoRouparia, novaChaveRouparia('peca'));

export const lerCotaSetorRoupa = (centroCusto: number): Promise<SituacaoCotaSetor> =>
  ler(`${B}/cotas/${centroCusto}`, esquemaSituacaoCotaSetor);

export const gravarCotasRoupa = (corpo: {
  centroCusto: number;
  cotas: { peca: number; quantidade: number }[];
}): Promise<{ ok: true; mensagem: string }> =>
  colocar(`${B}/cotas`, corpo, esquemaResultadoCotasRoupa, novaChaveRouparia('cotas'));

export const lerEstatisticaRouparia = (de: string, ate: string): Promise<EstatisticaRouparia> =>
  ler(`${B}/estatistica${qs({ de, ate })}`, esquemaEstatisticaRouparia);

export const lerIndicadoresRouparia = (de: string, ate: string): Promise<IndicadoresRouparia> =>
  ler(`${B}/indicadores${qs({ de, ate })}`, esquemaIndicadoresRouparia);

export const buscarFornecedoresRouparia = (
  termo: string,
): Promise<{ itens: { codigo: number; nome: string }[] }> =>
  ler(`${B}/fornecedores${qs({ termo })}`, esquemaFornecedoresRouparia);
