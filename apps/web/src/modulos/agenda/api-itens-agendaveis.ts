// Itens agendáveis (02-AGE linha 45): cadastro do item com as regras (pacote, pré-requisito, conflito, recurso e
// orientação por convênio) e, na marcação, a crítica, o lançamento dos itens e o preparo entregue ao paciente.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/itens-agendaveis';

export const TIPOS_ITEM = ['consulta', 'exame', 'procedimento', 'sessao', 'composto'] as const;
export const TIPOS_REQUISITO = [
  'item_realizado',
  'item_marcado',
  'autorizacao',
  'documento',
  'condicao',
] as const;
export const DIRECOES = ['ambos', 'antes', 'depois'] as const;
export const PAPEIS = ['exigido', 'realiza'] as const;

const esquemaResumo = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipoItem: z.string(),
  duracaoMinutos: z.number(),
  ativo: z.boolean(),
  versao: z.number(),
  regras: z.object({
    composicao: z.number(),
    conflitos: z.number(),
    requisitos: z.number(),
    recursos: z.number(),
    orientacoes: z.number(),
  }),
});
export type ItemResumo = z.infer<typeof esquemaResumo>;

const esquemaRegras = {
  composicao: z.array(z.object({ componente: z.number(), quantidade: z.number() })),
  conflitos: z.array(
    z.object({
      item: z.number(),
      intervaloMinimoHoras: z.number(),
      direcao: z.enum(['antes', 'depois', 'ambos']),
    }),
  ),
  requisitos: z.array(
    z.object({
      tipo: z.enum(TIPOS_REQUISITO),
      item: z.number().nullable(),
      descricao: z.string().nullable(),
      prazoMaximoDias: z.number().nullable(),
      bloqueia: z.boolean(),
    }),
  ),
  recursos: z.array(
    z.object({ recurso: z.number(), papel: z.enum(['realiza', 'exigido']), quantidade: z.number() }),
  ),
  orientacoes: z.array(z.object({ fontePagadora: z.number(), orientacao: z.string() })),
};
const esquemaItem = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipoItem: z.string(),
  duracaoMinutos: z.number(),
  diasPreparo: z.number().nullable(),
  orientacaoPreparo: z.string().nullable(),
  intervaloRepeticaoMinutos: z.number().nullable(),
  exigeAutorizacao: z.boolean(),
  exigeIndicacaoClinica: z.boolean(),
  teleatendimento: z.boolean(),
  ativo: z.boolean(),
  ...esquemaRegras,
  nomes: z.record(z.string(), z.string()),
});
export type ItemLido = z.infer<typeof esquemaItem>;
export type EntradaItem = Omit<ItemLido, 'id' | 'versao' | 'nomes'> & { versao?: number };

const opcao = z.array(z.object({ id: z.number(), nome: z.string() }));
const esquemaOpcoes = z.object({
  itens: z.array(z.object({ id: z.number(), nome: z.string(), tipo: z.string() })),
  recursos: opcao,
  fontes: opcao,
});
export type OpcoesItem = z.infer<typeof esquemaOpcoes>;

const achado = z.object({ codigo: z.string(), item: z.number(), mensagem: z.string() });
const esquemaCritica = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      preparo: z.string().nullable(),
      inicioPreparo: z.string().nullable(),
    }),
  ),
  bloqueios: z.array(achado),
  alertas: z.array(achado),
});
export type CriticaMarcacao = z.infer<typeof esquemaCritica>;

const esquemaDaMarcacao = z.object({
  marcacao: z.number(),
  itens: z.array(
    z.object({
      sequencia: z.number(),
      item: z.number().nullable(),
      descricao: z.string(),
      situacao: z.string(),
      preparo: z.string().nullable(),
    }),
  ),
  equipamentos: z.array(z.object({ equipamento: z.number(), nome: z.string(), quantidade: z.number() })),
});
export type ItensDaMarcacao = z.infer<typeof esquemaDaMarcacao>;

const esquemaGravacao = z
  .object({
    ok: z.boolean(),
    mensagem: z.string().optional(),
    resultado: z.record(z.string(), z.union([z.number(), z.string()])),
  })
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

export const lerItensAgendaveis = (busca: string) =>
  ler(`${P}${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`, z.array(esquemaResumo));
export const lerOpcoesItem = () => ler(`${P}/opcoes`, esquemaOpcoes);
export const lerItemAgendavel = (id: number) => ler(`${P}/${id}`, esquemaItem);
export const salvarItemAgendavel = (id: number | null, e: EntradaItem, chave: string) =>
  enviar(id ? `${P}/${id}` : P, e, chave);
export const criticarItensMarcacao = (marcacao: number, itens: number[]) =>
  ler(`${P}/marcacao/${marcacao}/critica?itens=${itens.join(',')}`, esquemaCritica);
export const lerItensDaMarcacao = (marcacao: number) => ler(`${P}/marcacao/${marcacao}`, esquemaDaMarcacao);
export const lancarItensMarcacao = (marcacao: number, itens: number[], chave: string) =>
  enviar(`${P}/marcacao/${marcacao}/itens`, { itens }, chave);
