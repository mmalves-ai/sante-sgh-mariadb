// Cliente da entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79): as doações recebidas, a busca do
// doador (pessoa ou empresa do cadastro), a referência do item (último preço de compra) e o registro da doação. Os
// contratos de resposta são os da porta própria (apps/api/src/modulos/suprimentos/entrada-doacao.ts), validados aqui
// antes de chegar à tela.
import type { CriterioCustoDoacao, TipoDoador } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const B = '/api/suprimentos/doacoes';
const id = z.number().int();
const tipoDoador = z.enum(['pessoa', 'empresa']);

export const esquemaDoadorOpcao = z.object({
  tipo: tipoDoador,
  id,
  nome: z.string(),
  documento: z.string().nullable(),
});
export type DoadorOpcaoTela = z.infer<typeof esquemaDoadorOpcao>;

export const esquemaReferenciaItemDoacao = z.object({
  item: id,
  nome: z.string(),
  controlaLote: z.boolean(),
  ultimoPreco: z.number().nullable(),
});
export type ReferenciaItemDoacaoTela = z.infer<typeof esquemaReferenciaItemDoacao>;

export const esquemaDoacaoRecebida = z.object({
  id,
  numero: id,
  termo: z.string(),
  recebidaEm: z.string(),
  doador: z.string(),
  tipoDoador,
  local: z.string(),
  itens: z.number(),
  valorTotal: z.number(),
});
export type DoacaoRecebidaTela = z.infer<typeof esquemaDoacaoRecebida>;

export const esquemaResultadoDoacao = z.object({
  id,
  numero: id,
  itens: z.number(),
  valorTotal: z.number(),
  avisos: z.array(id),
});
export type ResultadoDoacaoTela = z.infer<typeof esquemaResultadoDoacao>;

export interface EntradaDoacaoTela {
  readonly doador: { readonly tipo: TipoDoador; readonly id: number };
  readonly termo: string;
  readonly recebidaEm: string;
  readonly local: number;
  readonly observacao: string | null;
  readonly itens: readonly {
    readonly item: number;
    readonly quantidade: number;
    readonly criterio: CriterioCustoDoacao;
    readonly valorJusto: number | null;
    readonly lotes: readonly {
      readonly lote: string;
      readonly validade: string;
      readonly quantidade: number;
    }[];
  }[];
}

export const doacoesRecebidas = (): Promise<DoacaoRecebidaTela[]> => ler(B, z.array(esquemaDoacaoRecebida));
export const buscarDoadores = (termo: string): Promise<DoadorOpcaoTela[]> =>
  ler(`${B}/doadores${qs({ termo })}`, z.array(esquemaDoadorOpcao));
export const referenciaItemDoacao = (item: number): Promise<ReferenciaItemDoacaoTela> =>
  ler(`${B}/itens/${item}`, esquemaReferenciaItemDoacao);
export const registrarDoacao = (e: EntradaDoacaoTela, chave: string): Promise<ResultadoDoacaoTela> =>
  enviar(B, e, esquemaResultadoDoacao, chave);
