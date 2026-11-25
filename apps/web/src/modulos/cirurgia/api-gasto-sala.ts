// Cliente do gasto de sala do ato cirúrgico (F3.4-5, 04-CC linha 100): /api/cirurgia/gasto-sala. Leitura do gasto com
// a sugestão da lista padrão, a diferença e as pendências; gravação, conferência, reabertura, cancelamento e débito
// (com versão); a lista padrão do procedimento; o apoio da tela (locais, produtos e lotes).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const G = '/api/cirurgia/gasto-sala';

const esquemaItem = z.object({
  id: z.number(),
  insumo: z.number(),
  insumoNome: z.string(),
  quantidade: z.number(),
  lote: z.number().nullable(),
  implantePermanente: z.boolean(),
  faturar: z.boolean(),
  movimento: z.number().nullable(),
  itemConta: z.number().nullable(),
});
export const esquemaGastoSala = z.object({
  ato: z.object({
    id: z.number(),
    numero: z.string(),
    atendimento: z.number(),
    situacao: z.string(),
    procedimentos: z.array(z.object({ id: z.number(), descricao: z.string() })),
  }),
  gasto: z
    .object({
      id: z.number(),
      situacao: z.enum(['aberta', 'conferida', 'debitada', 'cancelada']),
      local: z.number().nullable(),
      conta: z.number().nullable(),
      cirurgiao: z.number().nullable(),
      observacao: z.string().nullable(),
      versao: z.number(),
    })
    .nullable(),
  itens: z.array(esquemaItem),
  motivos: z.array(z.object({ tipo: z.string(), insumo: z.number().nullable(), motivo: z.string() })),
  cirurgiaoLista: z.number().nullable(),
  sugestao: z.array(
    z.object({
      insumo: z.number(),
      insumoNome: z.string(),
      quantidade: z.number(),
      obrigatorio: z.boolean(),
    }),
  ),
  diferencas: z.array(
    z.object({
      insumo: z.number(),
      sugerido: z.number(),
      lancado: z.number(),
      tipo: z.enum(['a_mais', 'a_menos', 'fora_da_lista', 'nao_usado']),
    }),
  ),
  pendencias: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
});
export type GastoSala = z.infer<typeof esquemaGastoSala>;

export const esquemaLinhaLista = z.object({
  id: z.number(),
  procedimento: z.number(),
  cirurgiao: z.number().nullable(),
  insumo: z.number().nullable(),
  kit: z.number().nullable(),
  quantidade: z.number(),
  obrigatorio: z.boolean(),
  ativo: z.boolean(),
  versao: z.number(),
  nome: z.string().nullable(),
});
export type LinhaLista = z.infer<typeof esquemaLinhaLista>;

const esquemaApoio = z.object({
  locais: z.array(z.object({ id: z.number(), nome: z.string(), comCentro: z.boolean() })),
  produtos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      nome: z.string(),
      controlaLote: z.boolean(),
      opme: z.boolean(),
    }),
  ),
});
export type ApoioGastoSala = z.infer<typeof esquemaApoio>;
const esquemaLotes = z.object({
  itens: z.array(z.object({ id: z.number(), numero: z.string(), validade: z.string(), saldo: z.number() })),
});
export type LoteGasto = z.infer<typeof esquemaLotes>['itens'][number];

export interface ItemEntrada {
  insumo: number;
  quantidade: number;
  lote: number | null;
  implantePermanente: boolean;
  faturar: boolean;
}
export interface EntradaGasto {
  local: number;
  cirurgiao: number | null;
  versao?: number;
  itens: ItemEntrada[];
  justificativas: { insumo: number; motivo: string }[];
}

const comId = z.object({ id: z.number() }).passthrough();
const q = (o: Record<string, string | number | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const lerGastoDoAto = (ato: number, cirurgiao: number | null = null) =>
  ler(`${G}/atos/${ato}${q({ cirurgiao })}`, esquemaGastoSala);
export const lerApoioGasto = (busca: string) => ler(`${G}/apoio${q({ busca })}`, esquemaApoio);
export const lerLotesGasto = async (insumo: number, local: number | null) =>
  (await ler(`${G}/lotes${q({ insumo, local })}`, esquemaLotes)).itens;
export const gravarGasto = (ato: number, e: EntradaGasto) =>
  enviar(`${G}/atos/${ato}`, e, comId, novaChave('gasto-sala'));
export const conferirGasto = (ato: number, versao: number) =>
  enviar(`${G}/atos/${ato}/conferir`, { versao }, comId, novaChave('gasto-sala-conferir'));
export const reabrirGasto = (ato: number, versao: number, motivo: string) =>
  enviar(`${G}/atos/${ato}/reabrir`, { versao, motivo }, comId, novaChave('gasto-sala-reabrir'));
export const cancelarGasto = (ato: number, versao: number, motivo: string) =>
  enviar(`${G}/atos/${ato}/cancelar`, { versao, motivo }, comId, novaChave('gasto-sala-cancelar'));
export const debitarGasto = (ato: number, versao: number) =>
  enviar(`${G}/atos/${ato}/debitar`, { versao }, comId, novaChave('gasto-sala-debitar'));

export const lerListaPadrao = async (procedimento: number) =>
  (await ler(`${G}/lista${q({ procedimento })}`, z.object({ itens: z.array(esquemaLinhaLista) }))).itens;
export const incluirLinhaPadrao = (e: {
  procedimento: number;
  cirurgiao: number | null;
  tipoAnestesia: null;
  insumo: number;
  kit: null;
  quantidade: number;
  obrigatorio: boolean;
}) => enviar(`${G}/lista`, e, comId, novaChave('gasto-sala-lista'));
export const alterarLinhaPadrao = (
  id: number,
  e: { versao: number; ativo?: boolean; quantidade?: number; obrigatorio?: boolean },
) => enviar(`${G}/lista/${id}`, e, comId, novaChave('gasto-sala-lista-alt'));
