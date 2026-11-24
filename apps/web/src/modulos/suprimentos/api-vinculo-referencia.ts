// Cliente do vínculo do item com a referência de preço de material e medicamento (F3.6, 05-SUP linha 28), na ficha
// do item: o vigente e o histórico, a busca da referência (com o fator sugerido pela unidade), vincular e encerrar.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const referencia = z.object({
  id: z.number(),
  fonte: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  apresentacao: z.string().nullable(),
  tipoProduto: z.string(),
  situacao: z.string(),
  unidade: z.string().nullable(),
  ean: z.string().nullable(),
});
const edicao = z.object({ id: z.number(), numero: z.string() }).nullable();
const vinculo = z.object({
  id: z.number(),
  versao: z.number(),
  referencia,
  edicao,
  fator: z.number(),
  inicio: z.string(),
  fim: z.string().nullable(),
  vigente: z.boolean(),
});
export const esquemaFichaVinculoReferencia = z.object({
  hoje: z.string(),
  item: z.object({ id: z.number(), codigo: z.string(), nome: z.string(), unidade: z.string().nullable() }),
  vigente: vinculo.nullable(),
  historico: z.array(vinculo),
});
export const esquemaOpcaoReferencia = referencia.extend({
  fatorSugerido: z.number().nullable(),
  edicaoVigente: edicao,
});
export type FichaVinculoReferencia = z.infer<typeof esquemaFichaVinculoReferencia>;
export type OpcaoReferencia = z.infer<typeof esquemaOpcaoReferencia>;

const P = (item: number) => `/api/suprimentos/cadastro/itens/${item}/referencias-preco`;
const comId = z.object({ id: z.number() });

export const lerVinculoReferencia = (item: number): Promise<FichaVinculoReferencia> =>
  ler(P(item), esquemaFichaVinculoReferencia);
export const buscarReferenciaPreco = (item: number, termo: string): Promise<OpcaoReferencia[]> =>
  ler(`${P(item)}/buscar?termo=${encodeURIComponent(termo)}`, z.array(esquemaOpcaoReferencia));
export const vincularReferenciaPreco = (
  item: number,
  e: { referencia: number; edicao: number | null; fator: number; inicio: string },
) => enviar(P(item), e, comId, novaChave('vinculo-referencia'));
export const encerrarVinculoReferencia = (item: number, vinculo: number, fim: string) =>
  enviar(`${P(item)}/${vinculo}/encerrar`, { fim }, comId, novaChave('vinculo-referencia-fim'));
