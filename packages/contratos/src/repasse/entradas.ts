// Entradas das telas e das operações do repasse médico (M33; ficha, seções 5 e 7): o que a tela manda e o executor
// valida (o mesmo Zod). A tela nunca manda número de RPA, ID, retenção calculada nem valor apurado: o motor e a
// numeração do outro sistema fazem. Competência no formato AAAA-MM.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { BASES_CALCULO_REPASSE } from './vocabulario.js';

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const percentual = z.number().min(0).max(100);
const dinheiro = z.number().min(0).max(99_999_999);
const justificativa = textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.'));

/** Proposta de regra nova ou de nova versão (nasce como rascunho em SGH_REP_REGRA_VERSAO; regra 3). */
export const esquemaProporRegraRepasse = z
  .object({
    /** Regra vigente que a proposta substitui (nova versão); null: regra nova. */
    substitui: id.nullable().default(null),
    vigencia: data,
    beneficiario: z.enum(['M', 'P']),
    /** Profissional ou prestador (id do profissional); null: qualquer um. */
    profissional: id.nullable().default(null),
    convenio: smallint.nullable().default(null),
    procedimentoInicial: z.number().int().min(0).nullable().default(null),
    procedimentoFinal: z.number().int().min(0).nullable().default(null),
    especialidade: smallint.nullable().default(null),
    ato: smallint.nullable().default(null),
    unidade: smallint.nullable().default(null),
    tipoConta: z.enum(['A', 'E', 'I']).default('A'),
    tipoLancamento: z.number().int().min(-1).max(32_767).nullable().default(null),
    /** Percentual sobre a base ou valor fixo: exatamente um dos dois maior que zero. */
    percentual: percentual.default(0),
    valorFixo: dinheiro.default(0),
    percentualFeriado: percentual.default(0),
    percentualFimDeSemana: percentual.default(0),
    base: z.enum(BASES_CALCULO_REPASSE),
    evento: smallint,
    justificativa,
  })
  .strict()
  .refine((r) => r.percentual > 0 !== r.valorFixo > 0, {
    message: 'Informe o percentual ou o valor fixo (um dos dois).',
    path: ['percentual'],
  })
  .refine(
    (r) =>
      r.procedimentoInicial === null ||
      r.procedimentoFinal === null ||
      r.procedimentoFinal >= r.procedimentoInicial,
    { message: 'O procedimento final vem depois do inicial.', path: ['procedimentoFinal'] },
  );
export type ProporRegraRepasseEntrada = z.infer<typeof esquemaProporRegraRepasse>;

/** Aprovar ou recusar a versão de regra (supervisor; quem propôs não aprova). */
export const esquemaDecidirRegraRepasse = z
  .object({ versao: id, decisao: z.enum(['aprovar', 'recusar']), justificativa })
  .strict();
export type DecidirRegraRepasseEntrada = z.infer<typeof esquemaDecidirRegraRepasse>;

/** Simulador: um item sintético contra a regra proposta ou as vigentes (nada é gravado). */
export const esquemaSimularRepasse = z
  .object({
    versao: id.nullable().default(null),
    data,
    convenio: smallint,
    procedimento: z.number().int().min(0),
    profissional: id.nullable().default(null),
    tipoConta: z.enum(['E', 'I']),
    valorCobrado: dinheiro,
    valorRecebido: dinheiro.nullable().default(null),
  })
  .strict();
export type SimularRepasseEntrada = z.infer<typeof esquemaSimularRepasse>;

/** Apurar o período (repasse.integrarItens, ou simulação quando a operação não estiver verde). */
export const esquemaApurarRepasse = z.object({ empresa: smallint, competencia }).strict();
export type ApurarRepasseEntrada = z.infer<typeof esquemaApurarRepasse>;

/** Conferir, aprovar ou devolver a apuração (quem apura não aprova; regra 9). */
export const esquemaDecidirApuracao = z
  .object({
    apuracao: id,
    acao: z.enum(['conferir', 'aprovar', 'devolver']),
    justificativa: justificativa.optional(),
  })
  .strict()
  .refine((d) => d.acao !== 'devolver' || d.justificativa !== undefined, {
    message: 'Justifique a devolução.',
    path: ['justificativa'],
  });
export type DecidirApuracaoEntrada = z.infer<typeof esquemaDecidirApuracao>;

/**
 * repasse.lancarEvento: o lançamento do repasse (com o vínculo do médico). Origem:
 * `apuracao` (o total do beneficiário na apuração aprovada do novo), `ajuste` (avulso, com justificativa) ou `estorno`
 * (glosa mantida depois do pagamento: lançamento negativo no período seguinte ligado ao original em SGH_REP_ESTORNO;
 * nunca altera o repasse pago).
 */
export const esquemaLancarEventoRepasse = z
  .object({
    // M52.6: `plantao` = os plantões realizados e aprovados do prestador (SGH_PES_PLANTAO_REALIZADO), só pela gestão de
    // pessoas (o repasse recusa esta origem na própria tela).
    origem: z.enum(['apuracao', 'ajuste', 'estorno', 'plantao']).default('ajuste'),
    empresa: smallint,
    competencia,
    /** Data do lançamento (dentro da competência) e a previsão de pagamento. */
    data,
    previsao: data.nullable().default(null),
    evento: smallint,
    tipo: z.enum(['M', 'E']),
    /** Código do prestador (o do médico; o da empresa médica no tipo E). */
    prestador: id,
    /** Id do profissional (médico); obrigatório no tipo M, o vínculo do lançamento com o médico. */
    profissional: id.nullable().default(null),
    valor: z
      .number()
      .min(-99_999_999)
      .max(99_999_999)
      .refine((v) => v !== 0, 'Valor diferente de zero.'),
    referente: textoCp1252(60).default(''),
    justificativa,
    /** Apuração do novo (SGH_REP_APURACAO.ID) na origem `apuracao`. */
    apuracao: id.nullable().default(null),
    /** Lançamento original (id do lançamento de repasse) na origem `estorno`. */
    estornaDe: id.nullable().default(null),
    /** Realizados aprovados (SGH_PES_PLANTAO_REALIZADO.ID) na origem `plantao` (M52.6). */
    plantoes: z.array(id).max(200).default([]),
  })
  .strict()
  .refine((e) => e.tipo !== 'M' || e.profissional !== null, {
    message: 'Informe o registro do médico.',
    path: ['profissional'],
  })
  .refine((e) => e.origem !== 'estorno' || (e.estornaDe !== null && e.valor < 0), {
    message: 'O estorno é negativo e aponta o lançamento original.',
    path: ['estornaDe'],
  })
  .refine((e) => e.origem === 'estorno' || e.valor > 0, {
    message: 'Só o estorno é negativo.',
    path: ['valor'],
  })
  .refine((e) => (e.origem === 'plantao') === e.plantoes.length > 0, {
    message: 'A origem plantão leva os plantões realizados (e só ela).',
    path: ['plantoes'],
  })
  .refine((e) => e.origem !== 'apuracao' || e.apuracao !== null, {
    message: 'Informe a apuração aprovada.',
    path: ['apuracao'],
  });
export type LancarEventoRepasseEntrada = z.infer<typeof esquemaLancarEventoRepasse>;

/** repasse.incluirRegra: a versão aprovada incluída na regra de repasse (com o profissional, quando há), só pelo servidor. */
export const esquemaIncluirRegraRepasse = z
  .object({
    versao: id,
    vigencia: data,
    beneficiario: z.enum(['M', 'P']),
    prestador: z.number().int().min(0).default(0),
    profissional: id.nullable().default(null),
    convenio: smallint.default(0),
    procedimentoInicial: z.number().int().min(0).default(0),
    procedimentoFinal: z.number().int().min(0).default(0),
    especialidade: smallint.default(0),
    ato: smallint.default(0),
    unidade: smallint.default(0),
    tipoConta: z.enum(['A', 'E', 'I']),
    tipoLancamento: z.number().int().min(-1).max(32_767).default(0),
    percentual: percentual,
    valorFixo: dinheiro,
    percentualFeriado: percentual.default(0),
    percentualFimDeSemana: percentual.default(0),
    evento: smallint,
  })
  .strict();
export type IncluirRegraRepasseEntrada = z.infer<typeof esquemaIncluirRegraRepasse>;

/** repasse.integrarItens: os itens do período com o valor do motor (a integração da apuração), ligados ao lançamento da apuração. */
export const esquemaIntegrarItensRepasse = z
  .object({
    apuracao: id,
    empresa: smallint,
    competencia,
    lancamentos: z
      .array(
        z
          .object({
            lancamento: id,
            itens: z
              .array(
                z
                  .object({
                    item: id,
                    regra: id.nullable(),
                    percentual: z.number().min(0).max(100),
                    valor: dinheiro,
                  })
                  .strict(),
              )
              .min(1)
              .max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type IntegrarItensRepasseEntrada = z.infer<typeof esquemaIntegrarItensRepasse>;

/** repasse.emitirRpa: lançamentos do beneficiário ainda sem RPA (1 a 200 de uma vez). */
const objetoEmitirRpa = z.object({
  empresa: smallint,
  competencia,
  tipo: z.enum(['M', 'E']).default('M'),
  prestador: id,
  profissional: id.nullable().default(null),
  lancamentos: z.array(id).min(1).max(200),
  /** Emissão e vencimento do título; as retenções são do motor (regra 7), nunca da tela. */
  emissao: data,
  vencimento: data,
});
const medicoComRegistro = (e: { tipo: string; profissional: number | null }) =>
  e.tipo !== 'M' || e.profissional !== null;
export const esquemaEmitirRpa = objetoEmitirRpa
  .strict()
  .refine(medicoComRegistro, { message: 'Informe o registro do médico.', path: ['profissional'] });
/** A entrada do executor: a da tela mais as retenções calculadas pelo motor no servidor (regra 7). */
export const esquemaEmitirRpaCalculado = objetoEmitirRpa
  .extend({
    retencoes: z
      .object({
        bruto: dinheiro,
        baseInss: dinheiro,
        inss: dinheiro,
        baseIrrf: dinheiro,
        faixaIrrf: z.number().int().min(0).nullable(),
        irrf: dinheiro,
        iss: dinheiro,
        liquido: z.number().min(0).max(99_999_999),
      })
      .strict(),
  })
  .strict()
  .refine(medicoComRegistro, { message: 'Informe o registro do médico.', path: ['profissional'] })
  .refine(
    (e) =>
      Math.round(e.retencoes.bruto * 100) -
        Math.round(e.retencoes.inss * 100) -
        Math.round(e.retencoes.irrf * 100) -
        Math.round(e.retencoes.iss * 100) ===
      Math.round(e.retencoes.liquido * 100),
    { message: 'Líquido = bruto − INSS − IRRF − ISS.', path: ['retencoes'] },
  );
export type EmitirRpaCalculadoEntrada = z.infer<typeof esquemaEmitirRpaCalculado>;
export type EmitirRpaEntrada = z.infer<typeof esquemaEmitirRpa>;
