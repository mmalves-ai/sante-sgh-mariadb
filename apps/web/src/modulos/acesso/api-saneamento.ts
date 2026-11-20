// Cliente da tela "Saneamento dos grupos" (M59-F4; ficha do M59, seção 7), validado pelos contratos. As gravações
// levam o CSRF da sessão e a Idempotency-Key (uma por pedido); aprovar pela área, aplicar e retirar as opções do grupo
// vazio levam a senha digitada na hora (reautenticação; nunca guardada).
import {
  type AprovarItemSaneamento,
  esquemaItemSaneamento,
  esquemaPainelSaneamento,
  esquemaResultadoAplicacaoSaneamento,
  esquemaSimulacaoSaneamento,
  esquemaUsuariosSaneamento,
  type ItemSaneamento,
  type NovoItemSaneamento,
  type PainelSaneamento,
  type ResultadoAplicacaoSaneamento,
  type SimulacaoSaneamento,
  type UsuariosSaneamento,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
export const BASE_SANEAMENTO = '/api/administracao/acesso/grupos/saneamento';

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  buscar: typeof fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const g = (grupo: string) => encodeURIComponent(grupo);
const esquemaPlano = z.object({ itens: z.array(esquemaItemSaneamento) });

export const buscarPainelSaneamento = (buscar: typeof fetch = fetch): Promise<PainelSaneamento> =>
  ler(BASE_SANEAMENTO, esquemaPainelSaneamento, buscar);

export const listarUsuariosSaneamento = (
  grupo: string,
  buscar: typeof fetch = fetch,
): Promise<UsuariosSaneamento> =>
  ler(`${BASE_SANEAMENTO}/grupos/${g(grupo)}/usuarios`, esquemaUsuariosSaneamento, buscar);

export const listarPlanoSaneamento = (
  grupo: string | null,
  buscar: typeof fetch = fetch,
): Promise<ItemSaneamento[]> =>
  ler(`${BASE_SANEAMENTO}/plano${grupo ? `?grupo=${g(grupo)}` : ''}`, esquemaPlano, buscar).then(
    (r) => r.itens,
  );

export const simularSaneamento = (
  login: string,
  destino: string,
  buscar: typeof fetch = fetch,
): Promise<SimulacaoSaneamento> =>
  ler(
    `${BASE_SANEAMENTO}/simulacao?${new URLSearchParams({ login, destino }).toString()}`,
    esquemaSimulacaoSaneamento,
    buscar,
  );

export const decidirSaneamento = (
  dados: NovoItemSaneamento,
  buscar: typeof fetch = fetch,
): Promise<ItemSaneamento> => enviar(`${BASE_SANEAMENTO}/plano`, dados, esquemaItemSaneamento, buscar);

export const aprovarSaneamento = (
  id: string,
  dados: AprovarItemSaneamento,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<ItemSaneamento> =>
  enviar(`${BASE_SANEAMENTO}/plano/${g(id)}/aprovar`, { dados, senha }, esquemaItemSaneamento, buscar);

export const descartarSaneamento = (id: string, buscar: typeof fetch = fetch): Promise<ItemSaneamento> =>
  enviar(`${BASE_SANEAMENTO}/plano/${g(id)}/descartar`, {}, esquemaItemSaneamento, buscar);

export const aplicarSaneamento = (
  id: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoAplicacaoSaneamento> =>
  enviar(`${BASE_SANEAMENTO}/plano/${g(id)}/aplicar`, { senha }, esquemaResultadoAplicacaoSaneamento, buscar);

export const dissolverGrupoSaneamento = (
  grupo: string,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoAplicacaoSaneamento> =>
  enviar(
    `${BASE_SANEAMENTO}/grupos/${g(grupo)}/dissolver`,
    { dados: { motivo }, senha },
    esquemaResultadoAplicacaoSaneamento,
    buscar,
  );
