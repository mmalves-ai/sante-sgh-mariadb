// Cliente do cartão de preferência do cirurgião (F8, 04-CC linha 105): /api/cirurgia/cartoes-preferencia.
// Lista, apoio (as escolhas por nome), busca de produto, cartão aplicável na data do ato (sugestão do mapa e produtos do gasto de sala), inclusão,
// alteração com versão, tirar de uso e voltar (nada se apaga).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cartoes-preferencia';
const naturezas = ['material', 'medicamento', 'fio', 'instrumental', 'equipamento', 'kit', 'outro'] as const;

const esquemaItem = z.object({
  id: z.number(),
  sequencia: z.number(),
  natureza: z.enum(naturezas),
  insumo: z.number().nullable(),
  caixaInstrumental: z.number().nullable(),
  equipamento: z.number().nullable(),
  kit: z.number().nullable(),
  descricao: z.string().nullable(),
  quantidade: z.number(),
  observacao: z.string().nullable(),
  nome: z.string().nullable(),
});
export const esquemaCartao = z.object({
  id: z.number(),
  cirurgiao: z.number(),
  procedimento: z.number().nullable(),
  grupo: z.number().nullable(),
  vigenciaInicio: z.string().nullable(),
  vigenciaFim: z.string().nullable(),
  grupoDescricao: z.string().nullable(),
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
  kit: number | null;
  descricao: string | null;
  quantidade: number;
  observacao: string | null;
}
export interface EntradaCartao {
  cirurgiao: number;
  procedimento: number | null;
  grupo: number | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
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
export type OpcaoCartao = z.infer<typeof opcao>;
export const lerApoioCartao = () =>
  ler(
    `${C}/apoio`,
    z.object({
      cirurgioes: z.array(opcao),
      procedimentos: z.array(opcao),
      grupos: z.array(opcao),
      posicoes: z.array(opcao),
      salas: z.array(opcao),
      caixas: z.array(opcao),
      equipamentos: z.array(opcao),
      kits: z.array(opcao),
    }),
  );
/** Produtos do estoque por nome ou código (a partir de 3 letras). */
export const lerProdutosCartao = (busca: string) =>
  ler(`${C}/produtos?${new URLSearchParams({ busca }).toString()}`, z.object({ itens: z.array(opcao) }));
/** O cartão que vale para o cirurgião e o procedimento na data do ato (AAAA-MM-DD; sem data, hoje). */
export const lerCartaoAplicavel = (cirurgiao: number, procedimento: number | null, data?: string | null) => {
  const q = new URLSearchParams({ cirurgiao: String(cirurgiao) });
  if (procedimento) q.set('procedimento', String(procedimento));
  if (data) q.set('data', data);
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
