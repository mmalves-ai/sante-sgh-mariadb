// Composição nutricional dos alimentos (F8, 04-HOT linha 142): a tabela de composição (TACO 4ª ed., catálogo público)
// por grupo e alimento, os nutrientes por 100 g e na porção, e a ligação ao gênero do estoque. A recusa do servidor vem
// em `problema` (ErroNutricao).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const C = '/api/nutricao/composicao';
const ni = z.number().int();

const esquemaGrupo = z.object({ id: ni, descricao: z.string() });
export type GrupoAlimento = z.infer<typeof esquemaGrupo>;

const esquemaResumo = z.object({
  id: ni,
  fonte: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  grupo: z.string().nullable(),
  energiaKcal: z.number().nullable(),
});
export type AlimentoResumo = z.infer<typeof esquemaResumo>;

const esquemaNutriente = z.object({
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.string(),
  unidade: z.string(),
  quantidade100g: z.number(),
  quantidadePorcao: z.number(),
});
export type NutrienteDaPorcao = z.infer<typeof esquemaNutriente>;

const esquemaAlimento = esquemaResumo.extend({
  fonteNome: z.string(),
  edicao: z.string(),
  versao: ni,
  genero: z.object({ id: ni, codigo: z.string().nullable(), nome: z.string().nullable() }).nullable(),
  porcao: z.number(),
  nutrientes: z.array(esquemaNutriente),
});
export type AlimentoComposicao = z.infer<typeof esquemaAlimento>;

export const lerGruposAlimento = (): Promise<GrupoAlimento[]> =>
  ler(`${C}/grupos`, z.object({ itens: z.array(esquemaGrupo) })).then((r) => r.itens);
export const buscarAlimentos = (termo: string, grupo: number | null): Promise<AlimentoResumo[]> =>
  ler(`${C}/alimentos${qs({ termo, grupo })}`, z.object({ itens: z.array(esquemaResumo) })).then(
    (r) => r.itens,
  );
export const lerAlimento = (id: number, porcao: number): Promise<AlimentoComposicao> =>
  ler(`${C}/alimentos/${id}${qs({ porcao })}`, esquemaAlimento);
export const ligarGenero = (id: number, genero: number | null, versao: number, chave: string) =>
  enviar(
    `${C}/alimentos/${id}/genero`,
    { genero, versao },
    z.object({ alimento: ni, genero: ni.nullable() }),
    chave,
  );
