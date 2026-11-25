// Cliente do cadastro editável do catálogo da prescrição (03-PEP L106, C1-115): frequências, condições "se
// necessário", item não padronizado e complementos do item. Gravações com o CSRF e a Idempotency-Key; recusas em
// Problem Details viram ErroApi (o código da recusa em `problema.codigo`).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const C = '/api/pep/prescricao/catalogo';
const ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch) =>
  lerJson(await buscar(url, { headers: ACEITO }), esquema);
const gravado = z.object({ id: z.number(), versao: z.number() });
export type Gravado = z.infer<typeof gravado>;
async function enviar(url: string, corpo: unknown, buscar: typeof fetch = fetch): Promise<Gravado> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.catalogo'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, gravado);
}

const opcao = z.object({ id: z.number(), nome: z.string() });
export type OpcaoCatalogo = z.infer<typeof opcao>;
const esquemaApoio = z.object({
  setores: z.array(opcao),
  vias: z.array(opcao),
  unidades: z.array(opcao),
  tipos: z.array(opcao),
  parametros: z.array(opcao),
  frequencias: z.array(opcao),
});
export type ApoioCatalogo = z.infer<typeof esquemaApoio>;
const esquemaFrequencia = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  descricaoResumida: z.string().nullable(),
  tipo: z.string(),
  intervaloMinutos: z.number().nullable(),
  dosesPorDia: z.number().nullable(),
  limiteHoras: z.number().nullable(),
  horarioFixo: z.boolean(),
  uso: z.string(),
  escopoSetor: z.string(),
  ativo: z.boolean(),
  dias: z.array(z.string()),
  setores: z.array(z.number()),
});
export type FrequenciaCadastrada = z.infer<typeof esquemaFrequencia>;
const esquemaCondicao = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  ativo: z.boolean(),
  parametroVital: z.number().nullable(),
  parametro: z.string().nullable(),
  limiar: z.number().nullable(),
});
export type CondicaoCadastrada = z.infer<typeof esquemaCondicao>;
const comVersao = { id: z.number(), versao: z.number() };
const esquemaComplementos = z.object({
  item: z.object({ ...comVersao, descricao: z.string(), padronizado: z.boolean(), ativo: z.boolean() }),
  frequencias: z.array(
    z.object({ ...comVersao, frequencia: z.number(), nome: z.string(), usoFrequente: z.boolean() }),
  ),
  setores: z.array(
    z.object({
      ...comVersao,
      setor: z.number().nullable(),
      nome: z.string().nullable(),
      usoRestrito: z.boolean(),
      bloqueado: z.boolean(),
      motivoBloqueio: z.string().nullable(),
    }),
  ),
  sinonimos: z.array(
    z.object({ ...comVersao, sequencia: z.number(), termo: z.string(), origemTermo: z.string() }),
  ),
  conflitos: z.array(
    z.object({
      ...comVersao,
      conflitante: z.number(),
      nome: z.string(),
      gravidade: z.string(),
      motivo: z.string().nullable(),
    }),
  ),
});
export type ComplementosItem = z.infer<typeof esquemaComplementos>;
export type TipoComplemento = 'frequencia' | 'setor' | 'sinonimo' | 'conflito';

export const lerApoioCatalogo = (b?: typeof fetch) => ler(`${C}/apoio`, esquemaApoio, b);
export const listarFrequencias = (b?: typeof fetch) =>
  ler(`${C}/frequencias`, z.object({ frequencias: z.array(esquemaFrequencia) }), b).then(
    (x) => x.frequencias,
  );
export const gravarFrequencia = (f: Record<string, unknown>, b?: typeof fetch) =>
  enviar(`${C}/frequencias`, f, b);
export const listarCondicoes = (b?: typeof fetch) =>
  ler(`${C}/condicoes`, z.object({ condicoes: z.array(esquemaCondicao) }), b).then((x) => x.condicoes);
export const gravarCondicao = (c: Record<string, unknown>, b?: typeof fetch) =>
  enviar(`${C}/condicoes`, c, b);
export const incluirNaoPadronizado = (n: Record<string, unknown>, b?: typeof fetch) =>
  enviar(`${C}/nao-padronizados`, n, b);
export const situacaoNaoPadronizado = (id: number, versao: number, ativo: boolean, b?: typeof fetch) =>
  enviar(`${C}/nao-padronizados/${id}/situacao`, { versao, ativo }, b);
export const lerComplementos = (item: number, b?: typeof fetch) =>
  ler(`${C}/itens/${item}/complementos`, esquemaComplementos, b);
export const incluirComplemento = (item: number, c: Record<string, unknown>, b?: typeof fetch) =>
  enviar(`${C}/itens/${item}/complementos`, c, b);
export const retirarComplemento = (
  item: number,
  tipo: TipoComplemento,
  id: number,
  versao: number,
  b?: typeof fetch,
) => enviar(`${C}/itens/${item}/complementos/retirar`, { tipo, id, versao }, b);
