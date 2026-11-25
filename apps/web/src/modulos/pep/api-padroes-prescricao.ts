// Cadastro editável dos padrões da prescrição (03-PEP L107): protocolos, kits de medicamentos e de soluções e receitas
// padrão, cada um com os itens; e os favoritos do prescritor (atalhos no editor da prescrição). Rotas em
// /api/pep/prescricao/padroes/* e /api/pep/prescricao/favoritos; gravação com a versão lida e chave de idempotência.
import { esquemaDetalheItem } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/prescricao';
const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);
async function enviar<T>(url: string, corpo: unknown, esquema: z.ZodType<T>, buscar: typeof fetch = fetch) {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('padroes'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquema);
}

const n = z.number().nullable();
const t = z.string().nullable();
const esquemaGravado = z.object({ id: z.number().int(), versao: z.number().int() });
export type Gravado = z.infer<typeof esquemaGravado>;

const esquemaItemProtocolo = z.object({
  sequencia: z.number().int(),
  tipoItem: z.string(),
  item: n,
  itemNome: t,
  descricao: t,
  dose: n,
  unidade: n,
  quantidade: n,
  frequencia: n,
  via: n,
  seNecessario: z.boolean(),
  preSelecionado: z.boolean(),
  observacao: t,
});
const esquemaProtocolo = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  codigo: z.string(),
  nome: z.string(),
  todosEstabelecimentos: z.boolean(),
  indicacao: t,
  sexo: z.string(),
  idadeMin: n,
  idadeMax: n,
  pesoMin: n,
  pesoMax: n,
  vigenciaInicio: t,
  vigenciaFim: t,
  ativo: z.boolean(),
  itens: z.array(esquemaItemProtocolo),
});
export type ProtocoloPadrao = z.infer<typeof esquemaProtocolo>;

const esquemaItemKit = z.object({
  sequencia: z.number().int(),
  item: n,
  itemNome: t,
  papel: z.string(),
  quantidade: z.number(),
  unidade: n,
  via: n,
  frequencia: n,
  faturavel: z.boolean(),
  observacao: t,
});
const esquemaKit = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  codigo: z.string(),
  nome: z.string(),
  tipoKit: z.string(),
  item: n,
  via: n,
  frequencia: n,
  doseInicial: n,
  doseFinal: n,
  velocidade: n,
  unidadeInfusao: n,
  ativo: z.boolean(),
  itens: z.array(esquemaItemKit),
});
export type KitPadrao = z.infer<typeof esquemaKit>;

const esquemaItemReceita = z.object({
  sequencia: z.number().int(),
  item: n,
  itemNome: t,
  descricaoLivre: t,
  dose: n,
  unidade: n,
  quantidade: n,
  frequencia: n,
  via: n,
  duracao: n,
  unidadeDuracao: n,
  usoContinuo: z.boolean(),
  posologia: t,
});
const esquemaReceita = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  nome: z.string(),
  abrangencia: z.string(),
  propria: z.boolean(),
  especialidade: n,
  formato: z.string(),
  texto: t,
  vigenciaInicio: z.string(),
  vigenciaFim: t,
  ativo: z.boolean(),
  itens: z.array(esquemaItemReceita),
});
export type ReceitaPadrao = z.infer<typeof esquemaReceita>;

export const listarProtocolosPadrao = (b: typeof fetch = fetch) =>
  ler(`${P}/padroes/protocolos`, z.object({ protocolos: z.array(esquemaProtocolo) }), b).then(
    (r) => r.protocolos,
  );
export const listarKitsPadrao = (b: typeof fetch = fetch) =>
  ler(`${P}/padroes/kits`, z.object({ kits: z.array(esquemaKit) }), b).then((r) => r.kits);
export const listarReceitasPadrao = (b: typeof fetch = fetch) =>
  ler(`${P}/padroes/receitas`, z.object({ receitas: z.array(esquemaReceita) }), b).then((r) => r.receitas);
export const gravarProtocoloPadrao = (corpo: unknown, b: typeof fetch = fetch) =>
  enviar(`${P}/padroes/protocolos`, corpo, esquemaGravado, b);
export const gravarKitPadrao = (corpo: unknown, b: typeof fetch = fetch) =>
  enviar(`${P}/padroes/kits`, corpo, esquemaGravado, b);
export const gravarReceitaPadrao = (corpo: unknown, b: typeof fetch = fetch) =>
  enviar(`${P}/padroes/receitas`, corpo, esquemaGravado, b);

// ── Favoritos do prescritor ─────────────────────────────────────────────────────────────────────
const esquemaFavorito = z.object({
  id: z.number().int(),
  tipo: z.enum(['item_prescritivel', 'protocolo_prescricao', 'kit_prescricao']),
  alvo: z.number().int(),
  rotulo: z.string(),
  ordem: z.number().int().nullable(),
});
export type FavoritoPrescritor = z.infer<typeof esquemaFavorito>;
export const listarFavoritos = (b: typeof fetch = fetch) =>
  ler(`${P}/favoritos`, z.object({ favoritos: z.array(esquemaFavorito) }), b).then((r) => r.favoritos);
export const marcarFavorito = (
  f: { tipo: FavoritoPrescritor['tipo']; alvo: number; rotulo?: string },
  b: typeof fetch = fetch,
) => enviar(`${P}/favoritos`, f, z.object({ id: z.number().int() }), b);
export const desmarcarFavorito = (id: number, b: typeof fetch = fetch) =>
  enviar(`${P}/favoritos/${id}/desmarcar`, {}, z.object({ id: z.number().int() }), b);

// ── Aplicação do kit no editor da prescrição ────────────────────────────────────────────────────
const esquemaAplicacaoKit = z.object({
  kit: z.number().int(),
  nome: z.string(),
  tipoKit: z.string(),
  forma: z.enum(['solucao', 'itens']),
  problema: z.string().nullable(),
  mensagem: z.string().nullable(),
  revisar: z.array(z.number().int()),
  linhas: z.array(
    z.object({
      sequencia: z.number().int(),
      papel: z.string(),
      produto: z.number().int(),
      produtoNome: z.string().nullable(),
      dose: z.number(),
      unidade: z.string().nullable(),
      principal: z.boolean(),
    }),
  ),
  sugestoes: z.array(esquemaDetalheItem.nullable()),
});
export type AplicacaoKit = z.infer<typeof esquemaAplicacaoKit>;
export const aplicacaoDoKit = (id: number, b: typeof fetch = fetch) =>
  ler(`${P}/padroes/kits/${id}/aplicacao`, esquemaAplicacaoKit, b);
