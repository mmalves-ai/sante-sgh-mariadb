// Contratos das telas "Coexistência com o legado" (M02): estabelecimentos da rede e verificação de schema.
import { z } from 'zod';

export const CATEGORIAS_SCHEMA = [
  'tabelas',
  'visoes',
  'triggers',
  'procedimentos',
  'generators',
  'indices',
  'restricoes',
  'dominios',
  'excecoes',
  'funcoes',
] as const;

const diferenca = z.object({
  ausentes: z.array(z.string()),
  novos: z.array(z.string()),
  alterados: z.array(z.string()),
});

export const esquemaMarcaSchema = z.object({
  estabelecimento: z.string(),
  estado: z.enum(['homologado', 'divergente', 'sem-homologacao', 'indisponivel']),
  verificadaEm: z.iso.datetime(),
  resumo: z.string().nullable(),
  resumoHomologado: z.string().nullable(),
  contagens: z.record(z.string(), z.number()).nullable(),
  diferencas: z.partialRecord(z.enum(CATEGORIAS_SCHEMA), diferenca),
  tabelasBloqueadas: z.array(z.string()),
  bloqueiaTudo: z.boolean(),
  motivo: z.string().nullable(),
  duracaoMs: z.number().nullable(),
});
export type MarcaSchemaApi = z.infer<typeof esquemaMarcaSchema>;

export const esquemaVerificacaoSchema = z.object({
  marcas: z.array(esquemaMarcaSchema),
  /** Comparação entre os bancos da rede (null com menos de dois bancos verificados). */
  entreBancos: z
    .array(z.object({ a: z.string(), b: z.string(), iguais: z.boolean(), resumo: z.string() }))
    .nullable(),
});
export type VerificacaoSchemaApi = z.infer<typeof esquemaVerificacaoSchema>;

export const esquemaEstabelecimento = z.object({
  codigo: z.string(),
  nomeConfigurado: z.string(),
  disponivel: z.boolean(),
  motivo: z.string().nullable(),
  conectado: z.boolean(),
  nomeConfere: z.boolean().nullable(),
  nomeNoBanco: z.string().nullable(),
  cnes: z.number().nullable(),
  unidades: z.number(),
  sysdbaDev: z.boolean(),
  estadoSchema: z.string().nullable(),
  pool: z.object({ abertas: z.number(), livres: z.number(), emUso: z.number() }).nullable(),
});
export const esquemaEstabelecimentos = z.object({
  rede: z.string(),
  estabelecimentos: z.array(esquemaEstabelecimento),
});
export type EstabelecimentosApi = z.infer<typeof esquemaEstabelecimentos>;
