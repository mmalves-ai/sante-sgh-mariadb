// ADR 0009: agenda estruturada. O texto livre da agenda vira regra (cobertura por convênio e por plano/subplano que
// aceita ou exclui, restrições, preparo e preço particular), que vale logo como melhor estimativa (decisão 27). O
// texto original vem inteiro ao lado, com os trechos não interpretados marcados (continuam valendo pelo texto).
import { z } from 'zod';
import { SITUACOES_REVISAO_REGRA, esquemaRegraPrecoParticular } from '../faturamento/preco-particular.js';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const situacao = z.enum(SITUACOES_REVISAO_REGRA);

export const SEXOS_ATENDIDOS = ['todos', 'feminino', 'masculino'] as const;
export type SexoAtendido = (typeof SEXOS_ATENDIDOS)[number];
export const CAMPOS_TEXTO_AGENDA = ['observacao', 'orientacao_marcacao', 'observacao_convenio'] as const;
export type CampoTextoAgenda = (typeof CAMPOS_TEXTO_AGENDA)[number];
export const TIPOS_REGRA_TEXTO = ['preco', 'cobertura', 'restricao', 'preparo'] as const;
export const TIPOS_PREPARO = ['preparo', 'documento', 'orientacao'] as const;
export const SITUACOES_ESTRUTURACAO = ['pendente', 'extraida', 'revisada', 'sem_regra'] as const;

export const esquemaTrechoTexto = z.object({
  inicio: z.number().int().nonnegative(),
  fim: z.number().int().positive(),
  interpretado: z.boolean(),
  tipoRegra: z.enum(TIPOS_REGRA_TEXTO).nullable(),
  motivo: z.string().nullable(),
});
export type TrechoTexto = z.infer<typeof esquemaTrechoTexto>;

/** Texto original da agenda, íntegro (sem corte), com os trechos marcados. */
export const esquemaTextoOrigemAgenda = z.object({
  id,
  agendaId: id,
  fontePagadoraId: id.nullable(),
  campo: z.enum(CAMPOS_TEXTO_AGENDA),
  texto: z.string(),
  /** Primeiros 16 bytes do SHA-256 do texto em UTF-8, em hexadecimal (32 caracteres). */
  hash: z.string().regex(/^[0-9a-f]{32}$/),
  situacao: z.enum(SITUACOES_ESTRUTURACAO),
  versaoExtrator: z.string().nullable(),
  trechos: z.array(esquemaTrechoTexto),
});
export type TextoOrigemAgenda = z.infer<typeof esquemaTextoOrigemAgenda>;

export const esquemaEntradaTextoOrigemAgenda = z
  .object({
    agendaId: id,
    fontePagadoraId: id.nullable().default(null),
    campo: z.enum(CAMPOS_TEXTO_AGENDA),
    texto: z.string().min(1),
  })
  .refine((t) => (t.campo === 'observacao_convenio') === (t.fontePagadoraId !== null), {
    message: 'Só a observação do convênio tem convênio.',
    path: ['fontePagadoraId'],
  });
export type EntradaTextoOrigemAgenda = z.infer<typeof esquemaEntradaTextoOrigemAgenda>;

const comVigencia = {
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
  situacaoRevisao: situacao.default('confirmada'),
  textoOrigemId: id.nullable().default(null),
};
const vigenciaCoerente = (r: { vigenciaInicio: string; vigenciaFim: string | null }) =>
  r.vigenciaFim === null || r.vigenciaFim >= r.vigenciaInicio;
const msgVigencia = { message: 'O fim da vigência não pode ser antes do início.', path: ['vigenciaFim'] };

/** Cobertura: sem linha, vale o convênio da agenda; com aceita, só esses planos; aceita=false exclui. */
export const esquemaEntradaCoberturaAgenda = z
  .object({
    agendaId: id,
    fontePagadoraId: id,
    /** Plano ou subplano; nulo: o convênio inteiro. */
    planoId: id.nullable().default(null),
    aceita: z.boolean(),
    observacao: z.string().max(500).nullable().default(null),
    ...comVigencia,
  })
  .refine(vigenciaCoerente, msgVigencia);
export type EntradaCoberturaAgenda = z.infer<typeof esquemaEntradaCoberturaAgenda>;

export const esquemaEntradaRestricaoAgenda = z
  .object({
    agendaId: id,
    fontePagadoraId: id.nullable().default(null),
    planoId: id.nullable().default(null),
    itemAgendavelId: id.nullable().default(null),
    sexoAtendido: z.enum(SEXOS_ATENDIDOS).nullable().default(null),
    idadeMinimaAnos: z.number().int().min(0).max(130).nullable().default(null),
    idadeMaximaAnos: z.number().int().min(0).max(130).nullable().default(null),
    aceitaRetorno: z.boolean().nullable().default(null),
    diasRetorno: z.number().int().min(0).max(3650).nullable().default(null),
    permiteEncaixe: z.boolean().nullable().default(null),
    observacao: z.string().max(500).nullable().default(null),
    ...comVigencia,
  })
  .refine(vigenciaCoerente, msgVigencia)
  .refine(
    (r) => r.idadeMinimaAnos === null || r.idadeMaximaAnos === null || r.idadeMinimaAnos <= r.idadeMaximaAnos,
    {
      message: 'A idade mínima não pode passar da máxima.',
      path: ['idadeMaximaAnos'],
    },
  )
  .refine((r) => r.planoId === null || r.fontePagadoraId !== null, {
    message: 'Plano só com o convênio.',
    path: ['planoId'],
  });
export type EntradaRestricaoAgenda = z.infer<typeof esquemaEntradaRestricaoAgenda>;

export const esquemaEntradaPreparoAgenda = z
  .object({
    agendaId: id,
    itemAgendavelId: id.nullable().default(null),
    tipo: z.enum(TIPOS_PREPARO).default('preparo'),
    descricao: z.string().min(1),
    jejumHoras: z.number().int().min(1).max(72).nullable().default(null),
    ...comVigencia,
  })
  .refine(vigenciaCoerente, msgVigencia);
export type EntradaPreparoAgenda = z.infer<typeof esquemaEntradaPreparoAgenda>;

const lido = { id, versao: z.number().int().positive() };
export const esquemaCoberturaAgenda = z.object({
  ...lido,
  fontePagadoraId: id,
  fontePagadoraNome: z.string(),
  planoId: id.nullable(),
  planoNome: z.string().nullable(),
  /** Plano superior do plano (subplano), para a tela agrupar. */
  planoSuperiorId: id.nullable(),
  planoSuperiorNome: z.string().nullable(),
  aceita: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  situacaoRevisao: situacao,
  textoOrigemId: id.nullable(),
});
export const esquemaRestricaoAgenda = z.object({
  ...lido,
  fontePagadoraId: id.nullable(),
  fontePagadoraNome: z.string().nullable(),
  planoId: id.nullable(),
  planoNome: z.string().nullable(),
  itemAgendavelId: id.nullable(),
  sexoAtendido: z.enum(SEXOS_ATENDIDOS).nullable(),
  idadeMinimaAnos: z.number().int().nullable(),
  idadeMaximaAnos: z.number().int().nullable(),
  aceitaRetorno: z.boolean().nullable(),
  diasRetorno: z.number().int().nullable(),
  permiteEncaixe: z.boolean().nullable(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  situacaoRevisao: situacao,
  textoOrigemId: id.nullable(),
});
export const esquemaPreparoAgenda = z.object({
  ...lido,
  itemAgendavelId: id.nullable(),
  tipo: z.enum(TIPOS_PREPARO),
  descricao: z.string(),
  jejumHoras: z.number().int().nullable(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  situacaoRevisao: situacao,
  textoOrigemId: id.nullable(),
});
export type CoberturaAgenda = z.infer<typeof esquemaCoberturaAgenda>;
export type RestricaoAgenda = z.infer<typeof esquemaRestricaoAgenda>;
export type PreparoAgenda = z.infer<typeof esquemaPreparoAgenda>;

/** A agenda estruturada inteira: os campos da agenda, as regras e o texto original ao lado. */
export const esquemaAgendaEstruturada = z.object({
  agendaId: id,
  nome: z.string(),
  codigoOrigem: z.string().nullable(),
  estabelecimentoId: id,
  estabelecimentoNome: z.string(),
  profissionalId: id.nullable(),
  profissionalNome: z.string().nullable(),
  vigenciaInicio: data.nullable(),
  vigenciaFim: data.nullable(),
  padrao: z.object({
    sexoAtendido: z.enum(SEXOS_ATENDIDOS),
    idadeMinimaAnos: z.number().int().nullable(),
    idadeMaximaAnos: z.number().int().nullable(),
    aceitaRetorno: z.boolean(),
    diasRetorno: z.number().int().nullable(),
    permiteEncaixe: z.boolean(),
    preparo: z.string().nullable(),
  }),
  /** Convênios aceitos pela agenda (vínculo agenda × convênio). */
  convenios: z.array(id),
  /** Os mesmos convênios com o nome (fonte pagadora), na mesma ordem. */
  conveniosAceitos: z.array(z.object({ fontePagadoraId: id, nome: z.string() })),
  coberturas: z.array(esquemaCoberturaAgenda),
  restricoes: z.array(esquemaRestricaoAgenda),
  preparos: z.array(esquemaPreparoAgenda),
  precosParticulares: z.array(esquemaRegraPrecoParticular),
  textos: z.array(esquemaTextoOrigemAgenda),
});
export type AgendaEstruturada = z.infer<typeof esquemaAgendaEstruturada>;
