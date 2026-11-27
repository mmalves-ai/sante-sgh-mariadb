// Cliente da central de integrações externas (decisão 53), validado pelo contrato. As gravações vão com o CSRF (token
// duplo) e a Idempotency-Key; a credencial e o modo levam a senha de novo (crítica). A credencial só vai, nunca volta:
// o painel diz só se está definida. Problem Details viram ErroApi (mensagem em português).
import {
  esquemaPainelIntegracoesExternas,
  esquemaResultadoIntegracaoExterna,
  type PainelIntegracoesExternas,
  type PedidoConfigurarIntegracaoExterna,
  type PedidoDefinirModoIntegracao,
  type PedidoGuardarCredencialIntegracao,
  type ResultadoIntegracaoExterna,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export const BASE_INTEGRACOES_EXTERNAS = '/api/administracao/integracoes-externas';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chave(): string {
  try {
    return `web-integracao-externa-${crypto.randomUUID()}`;
  } catch {
    return `web-integracao-externa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function gravar(caminho: string, corpo: unknown): Promise<ResultadoIntegracaoExterna> {
  return fetch(`${BASE_INTEGRACOES_EXTERNAS}/${caminho}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  }).then((r) => lerJson(r, esquemaResultadoIntegracaoExterna));
}

export const lerIntegracoesExternas = (): Promise<PainelIntegracoesExternas> =>
  fetch(BASE_INTEGRACOES_EXTERNAS, { headers: { accept: 'application/json' } }).then((r) =>
    lerJson(r, esquemaPainelIntegracoesExternas),
  );

export const gravarParametrosIntegracao = (
  p: PedidoConfigurarIntegracaoExterna,
): Promise<ResultadoIntegracaoExterna> => gravar('parametros', p);

export const guardarCredencialIntegracao = (
  p: PedidoGuardarCredencialIntegracao,
): Promise<ResultadoIntegracaoExterna> => gravar('credencial', p);

export const definirModoIntegracao = (p: PedidoDefinirModoIntegracao): Promise<ResultadoIntegracaoExterna> =>
  gravar('modo', p);
