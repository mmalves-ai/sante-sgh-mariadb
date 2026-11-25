// Cotas e prazos de marcação (02-AGE linha 47): leitura (com o uso da cota na janela de hoje), opções dos combos e
// manutenção da cota e do prazo de aviso.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/cotas-prazos';

export const PERIODICIDADES = ['dia', 'semana', 'mes', 'vigencia'] as const;
export const ACOES = ['bloquear', 'alertar', 'lista_espera', 'exigir_autorizacao'] as const;
export const RECORTES = ['agenda', 'fontePagadora', 'especialidade', 'tipoMarcacao', 'item'] as const;
export type Recorte = (typeof RECORTES)[number];

const idOuNulo = z.number().nullable();
export const esquemaCota = z.object({
  id: z.number(),
  versao: z.number(),
  agenda: idOuNulo,
  fontePagadora: idOuNulo,
  especialidade: idOuNulo,
  tipoMarcacao: idOuNulo,
  item: idOuNulo,
  periodicidade: z.enum(PERIODICIDADES),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  quantidadeMaxima: z.number().nullable(),
  percentualMaximo: z.number().nullable(),
  acao: z.enum(ACOES),
  ativo: z.boolean(),
  uso: z.object({ usadas: z.number(), limite: z.number(), inicio: z.string(), fim: z.string() }).nullable(),
});
export type CotaLida = z.infer<typeof esquemaCota>;
export const esquemaPrazo = z.object({
  id: z.number(),
  versao: z.number(),
  agenda: idOuNulo,
  item: idOuNulo,
  antecedenciaMinimaHoras: z.number(),
  antecedenciaMaximaDias: z.number().nullable(),
  textoAviso: z.string().nullable(),
  vigenciaInicio: z.string().nullable(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
});
export type PrazoLido = z.infer<typeof esquemaPrazo>;
const esquemaLista = z.object({ cotas: z.array(esquemaCota), prazos: z.array(esquemaPrazo) });

const opcao = z.array(z.object({ id: z.number(), nome: z.string() }));
export const esquemaOpcoes = z.object(
  Object.fromEntries(RECORTES.map((d) => [d, opcao])) as Record<Recorte, typeof opcao>,
);
export type OpcoesCota = z.infer<typeof esquemaOpcoes>;

const esquemaGravacao = z
  .object({ ok: z.boolean(), mensagem: z.string().optional(), resultado: z.record(z.string(), z.number()) })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = <T>(url: string, e: z.ZodType<T>) =>
  fetch(url, { headers: { accept: 'application/json' } }).then((r) => json(r, e));
const enviar = (url: string, corpo: unknown, chave: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  }).then((r) => json(r, esquemaGravacao));

export const lerCotasPrazos = () => ler(P, esquemaLista);
export const lerOpcoesCota = () => ler(`${P}/opcoes`, esquemaOpcoes);

export type EntradaCota = Omit<CotaLida, 'id' | 'versao' | 'uso'> & { versao?: number };
export type EntradaPrazo = Omit<PrazoLido, 'id' | 'versao'> & { versao?: number };
export const salvarCota = (id: number | null, e: EntradaCota, chave: string) =>
  enviar(id ? `${P}/cotas/${id}` : `${P}/cotas`, e, chave);
export const salvarPrazo = (id: number | null, e: EntradaPrazo, chave: string) =>
  enviar(id ? `${P}/prazos/${id}` : `${P}/prazos`, e, chave);
