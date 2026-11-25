// Configuração do faturamento SUS (06-SUS linha 53, C1-051): a permissão por usuário e setor (permissao_setor_sus),
// que filtra além do cargo, e os parâmetros próprios de cada instrumento (parametro_instrumento_sus), no lugar do texto
// solto nos parâmetros gerais (faturamento.sus.*). Os campos dos parâmetros seguem os leiautes do Ministério: BPA-Mag
// (órgão de origem e destino, sigla, CNPJ do prestador, indicador do destino), APAC (UF do gestor), SISAIH01 (CNS do
// diretor clínico, UTI por acomodação) e CIHA01 (fonte de remuneração padrão).
import { z } from 'zod';
import { FONTES_REMUNERACAO_CIHA } from './sus.js';

/** Os instrumentos com parâmetros próprios. */
export const INSTRUMENTOS_PARAMETRO_SUS = ['ciha', 'bpa', 'apac', 'aih'] as const;
export type InstrumentoParametroSus = (typeof INSTRUMENTOS_PARAMETRO_SUS)[number];

/** O que a permissão do setor libera: digitar a produção, faturá-la ou os dois. */
export const TIPOS_PERMISSAO_SETOR_SUS = ['digitacao', 'faturamento', 'digitacao_faturamento'] as const;
export type TipoPermissaoSetorSus = (typeof TIPOS_PERMISSAO_SETOR_SUS)[number];

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opcional = (max: number) => z.string().trim().max(max).nullable();

export const esquemaPermissaoSetorSusLida = z.object({
  id,
  usuario: z.object({ id, login: z.string(), nome: z.string() }),
  setor: z.object({ id, nome: z.string() }),
  tipo: z.enum(TIPOS_PERMISSAO_SETOR_SUS),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  vigente: z.boolean(),
  criadoPor: z.string().nullable(),
  criadoEm: z.string(),
  versao: z.string(),
});
export type PermissaoSetorSusLida = z.infer<typeof esquemaPermissaoSetorSusLida>;

export const esquemaIncluirPermissaoSetorSus = z
  .object({
    usuario: id,
    setor: id,
    tipo: z.enum(TIPOS_PERMISSAO_SETOR_SUS),
    vigenciaInicio: data,
    vigenciaFim: data.nullable(),
  })
  .strict();
export type IncluirPermissaoSetorSusEntrada = z.infer<typeof esquemaIncluirPermissaoSetorSus>;

/** Encerrar a permissão (nunca apagar: o histórico de quem podia o quê fica). */
export const esquemaEncerrarPermissaoSetorSus = z
  .object({ vigenciaFim: data, versao: z.string().regex(/^\d{1,10}$/) })
  .strict();
export type EncerrarPermissaoSetorSusEntrada = z.infer<typeof esquemaEncerrarPermissaoSetorSus>;

/** Os campos dos parâmetros de um instrumento (null: vale o parâmetro geral, enquanto não cadastrado). */
export const esquemaCamposParametroSus = z
  .object({
    fontePadrao: z.enum(FONTES_REMUNERACAO_CIHA).nullable(),
    orgaoOrigem: opcional(30),
    siglaOrigem: opcional(6),
    cnpjPrestador: opcional(18),
    orgaoDestino: opcional(40),
    indicadorDestino: z.enum(['E', 'M']).nullable(),
    uf: opcional(2),
    utiPorAcomodacao: opcional(200),
    diretorClinicoCns: opcional(15),
  })
  .strict();
export type CamposParametroSus = z.infer<typeof esquemaCamposParametroSus>;

export const esquemaParametrosInstrumentoSus = z.object({
  instrumento: z.enum(INSTRUMENTOS_PARAMETRO_SUS),
  campos: esquemaCamposParametroSus,
  /** null: ainda sem cadastro (vale o parâmetro geral). */
  versao: z.string().nullable(),
  alteradoPor: z.string().nullable(),
  alteradoEm: z.string().nullable(),
});
export type ParametrosInstrumentoSus = z.infer<typeof esquemaParametrosInstrumentoSus>;

export const esquemaGravarParametrosInstrumentoSus = z
  .object({
    campos: esquemaCamposParametroSus,
    versao: z
      .string()
      .regex(/^\d{1,10}$/)
      .nullable(),
  })
  .strict();
export type GravarParametrosInstrumentoSusEntrada = z.infer<typeof esquemaGravarParametrosInstrumentoSus>;

export const esquemaConfiguracaoSusTela = z.object({
  permissoes: z.array(esquemaPermissaoSetorSusLida),
  parametros: z.array(esquemaParametrosInstrumentoSus),
  setores: z.array(z.object({ id, nome: z.string() })),
  usuarios: z.array(z.object({ id, login: z.string(), nome: z.string() })),
  hoje: data,
  podeEditar: z.boolean(),
});
export type ConfiguracaoSusTela = z.infer<typeof esquemaConfiguracaoSusTela>;
