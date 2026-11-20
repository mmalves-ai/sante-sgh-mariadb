// W0-06, parte 7 (programa CRUD completo, M4 de mercado; itens 193 e 215 juntos): painel de indicadores de pessoas
// por unidade e setor, cada um com a ficha técnica (definição, fórmula, fontes, norma) e as parcelas impressas. O
// consolidado é sempre a soma dos numeradores sobre a soma dos denominadores (nunca a média dos setores). A conta fica
// em @sgh/dominio-pessoas (indicadores/indicadores-pessoas.ts); aqui ficam o vocabulário e o mesmo Zod da tela e do
// servidor.
import { z } from 'zod';

/** Os seis indicadores do painel, na ordem em que aparecem. */
export const INDICADORES_PESSOAS = [
  'turnover',
  'absenteismo',
  'horasExtras',
  'horasEnfermagemPacienteDia',
  'treinamentoPerCapita',
  'acidentesTrabalho',
] as const;
export type IndicadorPessoas = (typeof INDICADORES_PESSOAS)[number];

/** De onde vem cada número (a ficha técnica cita as fontes). */
export const FONTES_INDICADOR_PESSOAS = {
  cadastro: 'Cadastro de colaboradores (admissões, desligamentos e lotação)',
  ponto: 'Ponto (horas previstas, trabalhadas, ausências e horas extras apuradas)',
  folha: 'Folha (valor pago de horas extras na competência)',
  treinamento: 'Treinamentos (presença nas turmas realizadas)',
  sesmt: 'SESMT (acidentes de trabalho registrados)',
  censo: 'Censo hospitalar (pacientes-dia do setor)',
  dimensionamento: 'Dimensionamento de enfermagem (classificação de pacientes, COFEN 543/2017)',
} as const;
export type FonteIndicadorPessoas = keyof typeof FONTES_INDICADOR_PESSOAS;

const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');

/** Filtro do painel: o período (no máximo um ano) e, se quiser, a unidade e o setor. */
export const esquemaFiltroIndicadoresPessoas = z
  .object({
    inicio: data,
    fim: data,
    hospital: z.string().trim().min(1).max(10).nullable().default(null),
    setor: z.number().int().positive().nullable().default(null),
  })
  .refine((f) => f.inicio <= f.fim, { message: 'O início vem antes do fim.', path: ['fim'] })
  .refine((f) => Date.parse(f.fim) - Date.parse(f.inicio) <= 366 * 86_400_000, {
    message: 'O período tem no máximo um ano.',
    path: ['fim'],
  });
export type FiltroIndicadoresPessoas = z.infer<typeof esquemaFiltroIndicadoresPessoas>;

export const esquemaFichaIndicadorPessoas = z.object({
  codigo: z.enum(INDICADORES_PESSOAS),
  rotulo: z.string(),
  definicao: z.string(),
  formula: z.string(),
  unidade: z.string(),
  numerador: z.string(),
  denominador: z.string(),
  fontes: z.array(z.enum(Object.keys(FONTES_INDICADOR_PESSOAS) as [FonteIndicadorPessoas])),
  norma: z.string(),
  interpretacao: z.string(),
});
export type FichaIndicadorPessoas = z.infer<typeof esquemaFichaIndicadorPessoas>;

/** A parcela de um setor (unidade + setor): o numerador, o denominador e o valor do setor. */
export const esquemaParcelaIndicadorPessoas = z.object({
  hospital: z.string(),
  setor: z.number().int().nullable(),
  nomeSetor: z.string(),
  numerador: z.number(),
  denominador: z.number(),
  valor: z.number().nullable(),
  /** A conta do setor por extenso (ex.: "((3 + 1) ÷ 2) ÷ 20 × 100 = 10%"). */
  conta: z.string(),
  /** Só nas horas de enfermagem: a referência da COFEN do setor (h por paciente-dia) e a conta dela. */
  referencia: z.number().nullable().default(null),
  contaReferencia: z.string().nullable().default(null),
});
export type ParcelaIndicadorPessoas = z.infer<typeof esquemaParcelaIndicadorPessoas>;

export const esquemaIndicadorPessoasCalculado = z.object({
  ficha: esquemaFichaIndicadorPessoas,
  numerador: z.number(),
  denominador: z.number(),
  valor: z.number().nullable(),
  /** O consolidado por extenso: Σ numeradores ÷ Σ denominadores. */
  conta: z.string(),
  /** Só nas horas de enfermagem: a referência consolidada (Σ horas COFEN ÷ Σ pacientes-dia) e a razão realizado/referência. */
  referencia: z.number().nullable().default(null),
  razaoReferencia: z.number().nullable().default(null),
  parcelas: z.array(esquemaParcelaIndicadorPessoas),
  /** Complementos impressos (ex.: número de acidentes, valor pago de horas extras). */
  complementos: z.array(z.object({ rotulo: z.string(), valor: z.string() })),
});
export type IndicadorPessoasCalculado = z.infer<typeof esquemaIndicadorPessoasCalculado>;

export const esquemaPainelIndicadoresPessoas = z.object({
  inicio: data,
  fim: data,
  hospital: z.string().nullable(),
  setor: z.number().int().nullable(),
  indicadores: z.array(esquemaIndicadorPessoasCalculado),
  /** Fontes que não puderam ser lidas (ex.: censo sem a chave ligada): o indicador sai sem valor e diz por quê. */
  avisos: z.array(z.string()),
});
export type PainelIndicadoresPessoas = z.infer<typeof esquemaPainelIndicadoresPessoas>;

/** Apoio da tela do painel: a data de hoje, os setores do filtro e as horas da COFEN que valem (parâmetro ou padrão). */
export const esquemaApoioIndicadoresPessoas = z.object({
  hoje: data,
  hospital: z.string(),
  setores: z.array(z.object({ codigo: z.number().int(), rotulo: z.string() })),
  horasCofen: z.array(
    z.object({ categoria: z.string(), rotulo: z.string(), horas: z.number(), ajustada: z.boolean() }),
  ),
});
export type ApoioIndicadoresPessoas = z.infer<typeof esquemaApoioIndicadoresPessoas>;
