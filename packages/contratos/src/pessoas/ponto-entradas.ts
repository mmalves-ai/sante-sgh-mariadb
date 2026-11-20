// Entradas das telas do ponto, fatia F4 (M52.4; ficha do M52, seções 6 a 8; regras 11 a 15). O mesmo Zod vale na tela
// e no servidor; as regras que dependem do estado (período fechado, aprovador diferente de quem pediu, marcação do
// colaborador, inconsistências do período) ficam em @sgh/dominio-pessoas e o servidor relê o estado na transação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaCompetenciaEscala, esquemaInstanteEscala } from './escala-entradas.js';
import {
  CODIGOS_TIPO_AJUSTE,
  CODIGOS_TIPO_REP,
  TETO_ARQUIVO_AFD,
  type TipoAjuste,
  type TipoRep,
} from './ponto-vocabulario.js';

const id = z.number().int().positive();
const idTexto = z.coerce.number().int().positive();
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const codigoDominio = z.number().int().min(0).max(99_999);

export const esquemaImportarAfd = z
  .object({
    /** Nome do arquivo como veio do relógio (só para a lista; o servidor guarda o hash, não o arquivo). */
    nome: textoCp1252(120).pipe(z.string().min(1, 'Informe o nome do arquivo.')),
    tipoRep: z.enum(CODIGOS_TIPO_REP as [TipoRep, ...TipoRep[]]),
    /** Modelo do relógio homologado (domínio do ramo), se houver. */
    modelo: codigoDominio.nullable().default(null),
    conteudo: z
      .string()
      .min(1, 'O arquivo está vazio.')
      .max(
        TETO_ARQUIVO_AFD,
        'O arquivo passa de 1 milhão de caracteres: exporte do relógio por período menor.',
      ),
  })
  .strict();
export type ImportarAfdEntrada = z.infer<typeof esquemaImportarAfd>;

export const esquemaFiltroPonto = z
  .object({
    competencia: esquemaCompetenciaEscala,
    termo: z.string().trim().max(60).optional(),
    unidade: z.coerce.number().int().min(0).optional(),
    situacao: z.enum(['todos', 'abertos', 'fechados', 'pendentes', 'sem-ciencia']).default('todos'),
    pagina: z.coerce.number().int().min(0).default(0),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroPontoEntrada = z.infer<typeof esquemaFiltroPonto>;

/** A lista dos arquivos do relógio: a situação, o período coberto (o arquivo que cruza de–até) e a página. */
export const esquemaFiltroArquivosAfd = z
  .object({
    situacao: z.enum(['todos', 'importado', 'quarentena']).default('todos'),
    de: data.optional(),
    ate: data.optional(),
    pagina: z.coerce.number().int().min(0).max(10_000).default(0),
    limite: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((f) => !f.de || !f.ate || f.de <= f.ate, {
    message: 'O início do período vem antes do fim.',
    path: ['ate'],
  });
export type FiltroArquivosAfdEntrada = z.infer<typeof esquemaFiltroArquivosAfd>;

export const esquemaBuscaColaboradorPonto = z
  .object({
    termo: z.string().trim().min(2, 'Digite pelo menos 2 letras.').max(60),
    estado: z.enum(['ativo', 'desligado', 'todos']).default('ativo'),
  })
  .strict();

export const esquemaEspelhoPonto = z
  .object({ vinculo: idTexto, competencia: esquemaCompetenciaEscala })
  .strict();

export const esquemaLancarAjuste = z
  .object({
    vinculo: id,
    tipo: z.enum(CODIGOS_TIPO_AJUSTE as [TipoAjuste, ...TipoAjuste[]]),
    dia: data,
    /** Desconsiderar: a marcação original. */
    marcacao: id.nullable().default(null),
    /** Inclusão: o horário da marcação que faltou (hora local). */
    instante: esquemaInstanteEscala.nullable().default(null),
    /** Justificativa: o tipo de movimento do ramo (atestado, falta justificada, folga...). */
    movimento: codigoDominio.nullable().default(null),
    /** O motivo cadastrado do ramo, se houver. */
    justificativa: codigoDominio.nullable().default(null),
    /** Inclusão: a marcação da jornada (1ª entrada, 1ª saída...), do domínio do ramo. */
    periodo: codigoDominio.nullable().default(null),
    /** Justificativa: minutos abonados; vazio = o dia inteiro. */
    minutos: z.number().int().min(1).max(1440).nullable().default(null),
    motivo,
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.tipo === 'inclusao' && !a.instante)
      ctx.addIssue({
        code: 'custom',
        path: ['instante'],
        message: 'Informe o horário da marcação que faltou.',
      });
    if (a.tipo === 'desconsiderar' && a.marcacao === null)
      ctx.addIssue({ code: 'custom', path: ['marcacao'], message: 'Escolha a marcação a desconsiderar.' });
    if (a.tipo === 'justificativa' && a.movimento === null)
      ctx.addIssue({ code: 'custom', path: ['movimento'], message: 'Escolha o tipo da justificativa.' });
  });
export type LancarAjusteEntrada = z.infer<typeof esquemaLancarAjuste>;

export const esquemaDecidirAjuste = z
  .object({
    ajuste: id,
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: textoCp1252(400).nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.decisao === 'recusar' && (d.motivo ?? '').trim().length < 10)
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Explique a recusa com pelo menos 10 caracteres.',
      });
  });
export type DecidirAjusteEntrada = z.infer<typeof esquemaDecidirAjuste>;

export const esquemaFecharPeriodo = z.object({ vinculo: id, competencia: esquemaCompetenciaEscala }).strict();
export type FecharPeriodoEntrada = z.infer<typeof esquemaFecharPeriodo>;

export const esquemaReabrirPeriodo = z
  .object({ vinculo: id, competencia: esquemaCompetenciaEscala, motivo })
  .strict();
export type ReabrirPeriodoEntrada = z.infer<typeof esquemaReabrirPeriodo>;

export const esquemaCienciaEspelho = z
  .object({
    vinculo: id,
    competencia: esquemaCompetenciaEscala,
    /** O resumo (SHA-256) do espelho que o colaborador viu: o servidor recusa se mudou. */
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    concorda: z.boolean(),
    observacao: textoCp1252(400).nullable().default(null),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (!c.concorda && (c.observacao ?? '').trim().length < 10)
      ctx.addIssue({
        code: 'custom',
        path: ['observacao'],
        message: 'Diga com o que não concorda (pelo menos 10 caracteres).',
      });
  });
export type CienciaEspelhoEntrada = z.infer<typeof esquemaCienciaEspelho>;

export const esquemaAcertoBanco = z
  .object({
    vinculo: id,
    competencia: esquemaCompetenciaEscala,
    /** Minutos com sinal (positivo credita; negativo debita). */
    minutos: z.number().int().min(-12_000).max(12_000),
    motivo,
  })
  .strict();
export type AcertoBancoEntrada = z.infer<typeof esquemaAcertoBanco>;

export const esquemaRegraBanco = z
  .object({
    regime: id,
    /** Destino das horas (domínio do ramo): 1 não se aplica; 2 banco de horas; 3 folha de pagamento. */
    destino: z.number().int().min(1).max(3),
    /** Início de cada ciclo (domínio do ramo): 1 zerado; 2 residual positivo; 3 residual negativo; 4 os dois. */
    inicio: z.number().int().min(1).max(4),
    /** Primeira competência do primeiro ciclo. */
    desde: esquemaCompetenciaEscala,
    cicloMeses: z.number().int().min(1).max(12),
    faltaDebita: z.boolean().default(false),
    versao: z.number().int().min(0).nullable().default(null),
  })
  .strict();
export type RegraBancoEntrada = z.infer<typeof esquemaRegraBanco>;

/** W0-06: desativação ou reativação da regra do banco de horas do regime, com o motivo e a versão lida. */
export const esquemaSituacaoRegraBanco = z
  .object({ regime: id, versao: z.number().int().min(0), ativo: z.boolean(), motivo })
  .strict();
export type SituacaoRegraBancoEntrada = z.infer<typeof esquemaSituacaoRegraBanco>;

/** W0-06: desistência do ajuste pendente pelo PRÓPRIO solicitante (o servidor confere quem pediu). */
export const esquemaDesistirAjuste = z.object({ ajuste: id, motivo }).strict();
export type DesistirAjusteEntrada = z.infer<typeof esquemaDesistirAjuste>;

export const esquemaExportarPonto = z.object({ competencia: esquemaCompetenciaEscala }).strict();
