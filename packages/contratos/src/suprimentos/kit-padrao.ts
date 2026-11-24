// Kit padrão de insumos (F3.6, 05-SUP linha 13): a entrada da gravação (o kit inteiro, com a composição e os
// procedimentos que o usam) e a leitura para o cadastro. Vocabulário neutro: ids, booleanos e quantidades.
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';
import { TIPOS_KIT_PADRAO } from './regras/kit-padrao.js';

// As regras puras do kit padrão vão também pelo índice: a tela confere na hora com as mesmas mensagens da API.
export {
  chaveProcedimentoKit,
  conferirKitPadrao,
  diferencaItensKit,
  type ItemKitPadraoConferido,
  type KitPadraoConferido,
  type KitPadraoDoProcedimento,
  linhasDoKitPadrao,
  type ProcedimentoKitPadraoConferido,
  TIPOS_KIT_PADRAO,
  type TipoKitPadrao,
} from './regras/kit-padrao.js';

const id = idBanco;
const quantidade = z.number().positive().max(99_999_999_999);

export const esquemaGravarKitPadrao = z
  .object({
    /** Sem kit: inclui; com kit e versão: altera (a versão trava a edição concorrente). */
    kit: id.optional(),
    versao: z.number().int().positive().optional(),
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    tipo: z.enum(TIPOS_KIT_PADRAO),
    permiteQuantidadeAcima: z.boolean(),
    permiteSimilar: z.boolean(),
    observacao: z.string().trim().max(2000).nullable(),
    ativo: z.boolean(),
    itens: z
      .array(
        z
          .object({
            insumo: id,
            quantidade,
            obrigatorioRastreavel: z.boolean(),
            permiteSubstituto: z.boolean(),
          })
          .strict(),
      )
      .max(500),
    procedimentos: z
      .array(
        z
          .object({
            procedimentoCirurgico: id.nullable(),
            itemFaturavel: id.nullable(),
            quantidadeKits: quantidade,
            padrao: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine((e) => (e.kit === undefined) === (e.versao === undefined), {
    message: 'Alteração leva o kit e a versão.',
    path: ['versao'],
  });
export type GravarKitPadraoEntrada = z.infer<typeof esquemaGravarKitPadrao>;

export const esquemaKitPadraoCadastro = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  nome: z.string(),
  tipo: z.enum(TIPOS_KIT_PADRAO),
  permiteQuantidadeAcima: z.boolean(),
  permiteSimilar: z.boolean(),
  observacao: z.string().nullable(),
  ativo: z.boolean(),
  itens: z.array(
    z.object({
      insumo: z.number(),
      nome: z.string(),
      unidade: z.string(),
      quantidade: z.number(),
      obrigatorioRastreavel: z.boolean(),
      permiteSubstituto: z.boolean(),
    }),
  ),
  procedimentos: z.array(
    z.object({
      procedimentoCirurgico: z.number().nullable(),
      itemFaturavel: z.number().nullable(),
      codigo: z.string(),
      nome: z.string(),
      quantidadeKits: z.number(),
      padrao: z.boolean(),
    }),
  ),
});
export type KitPadraoCadastro = z.infer<typeof esquemaKitPadraoCadastro>;

export const esquemaProcedimentoKitBusca = z.object({
  procedimentoCirurgico: z.number().nullable(),
  itemFaturavel: z.number().nullable(),
  codigo: z.string(),
  nome: z.string(),
});
export type ProcedimentoKitBusca = z.infer<typeof esquemaProcedimentoKitBusca>;

// F3.6 (05-SUP linha 20): a gestão do pedido de compra emitido vai ao índice por aqui (o índice está em edição paralela).
export * from './pedido-gestao.js';
