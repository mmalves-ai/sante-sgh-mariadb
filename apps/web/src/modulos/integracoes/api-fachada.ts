// Cliente do painel de estado da fachada da API de integração da Hal-AI (M58, etapa 4), validado pelo contrato. A
// configuração vai com o CSRF (token duplo), a Idempotency-Key e a senha de novo (crítica); Problem Details viram
// ErroApi (mensagem em português).
import {
  esquemaPainelFachada,
  esquemaResultadoConfigurarFachada,
  type PainelFachada,
  type PedidoConfigurarFachada,
  type ResultadoConfigurarFachada,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const F = '/api/administracao/integracoes/fachada';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chave(): string {
  try {
    return `web-fachada-${crypto.randomUUID()}`;
  } catch {
    return `web-fachada-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export const lerPainelFachada = (): Promise<PainelFachada> =>
  fetch(F, { headers: { accept: 'application/json' } }).then((r) => lerJson(r, esquemaPainelFachada));

export const configurarFachada = (pedido: PedidoConfigurarFachada): Promise<ResultadoConfigurarFachada> =>
  fetch(`${F}/configuracao`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(pedido),
  }).then((r) => lerJson(r, esquemaResultadoConfigurarFachada));
