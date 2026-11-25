// Cliente do cartão de preferência do cirurgião (F8, 04-CC linha 105): /api/cirurgia/cartoes-preferencia.
// Lista, apoio (posições e salas), cartão aplicável (sugestão do mapa e produtos do gasto de sala), inclusão,
// alteração com versão, tirar de uso e voltar (nada se apaga).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cartoes-preferencia';
const naturezas = ['material', 'medicamento', 'fio', 'instrumental', 'equipamento', 'outro'] as const;

const esquemaItem = z.object({
  id: z.number(),
  sequencia: z.number(),
  natureza: z.enum(naturezas),
  insumo: z.number().nullable(),
  caixaInstrumental: z.number().nullable(),
  equipamento: z.number().nullable(),
  descricao: z.string().nullable(),
  quantidade: z.number(),
  observacao: z.string().nullable(),
  nome: z.string().nullable(),
});
export const esquemaCartao = z.object({
  id: z.number(),
  cirurgiao: z.number(),
  procedimento: z.number().nullable(),
  posicao: z.number().nullable(),
  sala: z.number().nullable(),
  tempoMinutos: z.number().nullable(),
  tamanhoLuva: z.string().nullable(),
  preparoPele: z.string().nullable(),
  fiosSutura: z.string().nullable(),
  observacao: z.string().nullable(),
  ativo: z.boolean(),
  versao: z.number(),
  cirurgiaoNome: z.string().nullable(),
  procedimentoDescricao: z.string().nullable(),
  posicaoDescricao: z.string().nullable(),
  salaDescricao: z.string().nullable(),
  itens: z.array(esquemaItem),
});
export type CartaoPreferencia = z.infer<typeof esquemaCartao>;
export type NaturezaItem = (typeof naturezas)[number];
export const NATUREZAS_ITEM = naturezas;

export interface EntradaItemCartao {
  natureza: NaturezaItem;
  insumo: number | null;
  caixaInstrumental: number | null;
  equipamento: number | null;
  descricao: string | null;
  quantidade: number;
  observacao: string | null;
}
export interface EntradaCartao {
  cirurgiao: number;
  procedimento: number | null;
  posicao: number | null;
  sala: number | null;
  tempoMinutos: number | null;
  tamanhoLuva: string | null;
  preparoPele: string | null;
  fiosSutura: string | null;
  observacao: string | null;
  itens: EntradaItemCartao[];
}

const comId = z.object({ id: z.number().nullable() }).passthrough();
const opcao = z.object({ id: z.number(), descricao: z.string() });
export const esquemaAplicavel = z.object({
  cartao: esquemaCartao.nullable(),
  mapa: z
    .object({
      sala: z.number().nullable(),
      tempoMinutos: z.number().nullable(),
      posicao: z.number().nullable(),
    })
    .nullable(),
  gasto: z.array(z.object({ insumo: z.number(), quantidade: z.number(), insumoNome: z.string() })),
});
export type CartaoAplicavel = z.infer<typeof esquemaAplicavel>;

export const lerCartoesPreferencia = (cirurgiao: number | null) =>
  ler(cirurgiao ? `${C}?cirurgiao=${cirurgiao}` : C, z.object({ itens: z.array(esquemaCartao) }));
export const lerApoioCartao = () =>
  ler(`${C}/apoio`, z.object({ posicoes: z.array(opcao), salas: z.array(opcao) }));
export const lerCartaoAplicavel = (cirurgiao: number, procedimento: number | null) => {
  const q = new URLSearchParams({ cirurgiao: String(cirurgiao) });
  if (procedimento) q.set('procedimento', String(procedimento));
  return ler(`${C}/aplicavel?${q.toString()}`, esquemaAplicavel);
};
export const incluirCartao = (corpo: EntradaCartao) => enviar(C, corpo, comId, novaChave('cartao-pref'));
export async function alterarCartao(id: number, corpo: EntradaCartao & { versao: number }) {
  const r = await fetch(`${C}/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('cartao-pref-alt'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return comId.parse(await r.json());
}
export const usoCartao = (id: number, ativo: boolean, versao: number) =>
  enviar(`${C}/${id}/uso`, { ativo, versao }, comId, novaChave('cartao-pref-uso'));
