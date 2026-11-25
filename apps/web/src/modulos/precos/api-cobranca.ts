// Cliente da tela "Cobrança por fonte pagadora" (F3.7, 06-FAT linhas 6, 8 e 9): de-para do item para o código da
// fonte, credenciamento de cobrança com exceção e equivalência do mat/med da referência de mercado com a operadora e a
// TUSS, e a conferência do que sai na guia. As gravações mandam o CSRF e a Idempotency-Key; erro vira ErroApi.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

export const esquemaListaCobranca = z.object({
  colunas: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
  itens: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  total: z.number(),
  pagina: z.number().default(0),
  porPagina: z.number().default(50),
  avisos: z.array(z.string()).default([]),
});
export type ListaCobranca = z.infer<typeof esquemaListaCobranca>;

export const esquemaConferencia = z.object({
  codigo: z.string(),
  descricao: z.string().nullable(),
  quantidade: z.number(),
  equivalenciaId: z.number().nullable(),
  unidade: z.string().nullable(),
  percentualCobranca: z.number().nullable(),
  credenciamento: z.object({ permitido: z.boolean(), origem: z.string() }).passthrough(),
  codigoPrestadorNaFonte: z.string().nullable(),
  avisos: z.array(z.string()),
});
export type Conferencia = z.infer<typeof esquemaConferencia>;

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

const qs = (p: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const ler = <T>(url: string, esquema: z.ZodType<T>) =>
  fetch(url, { headers: JSON_ACEITO }).then((r) => lerJson(r, esquema));

const postar = (url: string, corpo: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  }).then((r) => lerJson(r, esquemaGravado));

export const listarDePara = (convenio: number) =>
  ler(`/api/faturamento/de-para-exames${qs({ convenio, porPagina: 50 })}`, esquemaListaCobranca);
export const listarCredenciamentos = (convenio: number) =>
  ler(`/api/faturamento/credenciamento${qs({ convenio, porPagina: 50 })}`, esquemaListaCobranca);
export const listarExcecoes = (convenio: number) =>
  ler(`/api/faturamento/credenciamento/excecoes${qs({ convenio })}`, esquemaListaCobranca);
export const listarEquivalenciasMatmed = (item: number) =>
  ler(`/api/precos/matmed/referencia/${item}/equivalencias`, esquemaListaCobranca);

export const conferirCobranca = (p: Record<string, string | number | null>) =>
  ler(`/api/faturamento/conferencia-cobranca${qs(p)}`, esquemaConferencia);

export const gravarDePara = (corpo: unknown) => postar('/api/faturamento/de-para', corpo);
export const gravarCredenciamento = (corpo: unknown) =>
  postar('/api/faturamento/credenciamento-cobranca', corpo);
export const gravarExcecao = (corpo: unknown) => postar('/api/faturamento/credenciamento/excecoes', corpo);
export const gravarEquivalenciaMatmed = (item: number, corpo: unknown) =>
  postar(`/api/precos/matmed/referencia/${item}/equivalencias`, corpo);

export type AlvoEncerramento = 'de-para' | 'credenciamento' | 'excecao';
const URL_ENCERRAR: Record<AlvoEncerramento, string> = {
  'de-para': '/api/faturamento/de-para',
  credenciamento: '/api/faturamento/credenciamento-cobranca',
  excecao: '/api/faturamento/credenciamento/excecoes',
};
/** Encerra a vigência (nada se apaga; o fim não recua para antes de hoje), com o motivo na trilha. */
export const encerrarRegistro = (
  alvo: AlvoEncerramento,
  id: number,
  corpo: { versao: number; vigenciaFim: string; motivo: string | null },
) => postar(`${URL_ENCERRAR[alvo]}/${id}/encerramento`, corpo);
