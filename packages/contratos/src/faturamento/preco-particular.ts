// ADR 0009: preço PARTICULAR definido pelo médico ou pela agenda (regra estruturada), credenciamento profissional ×
// convênio com alerta ou bloqueio, e a resposta do cálculo com a origem do preço. Não existe preço por médico em
// convênio (decisão 24): o convênio segue tabela da conta > plano > convênio. Vocabulário neutro: ids, datas ISO,
// booleanos e valores em reais com 2 casas.
import { z } from 'zod';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const valor = z.number().nonnegative().multipleOf(0.01);

/** Quem é dono da regra: o profissional ou a agenda (um só). */
export const DONOS_REGRA_PRECO = ['profissional', 'agenda'] as const;
export type DonoRegraPreco = (typeof DONOS_REGRA_PRECO)[number];
/**
 * O que a regra precifica: um procedimento, um grupo, qualquer consulta do dono ou o exame padrão da agenda (exame sem
 * item, só com dono agenda: o "valor do exame particular" do texto da agenda).
 */
export const ALVOS_REGRA_PRECO = ['item', 'grupo', 'consulta', 'exame'] as const;
export type AlvoRegraPreco = (typeof ALVOS_REGRA_PRECO)[number];
/** estimada: extraída do texto da agenda, já vale (decisão 27); recusada: não vale. */
export const SITUACOES_REVISAO_REGRA = ['estimada', 'confirmada', 'recusada'] as const;
export type SituacaoRevisaoRegra = (typeof SITUACOES_REVISAO_REGRA)[number];
export const ORIGENS_REGRA_AGENDA_PRECO = ['sistema', 'migracao', 'integracao'] as const;

const baseRegra = z.object({
  estabelecimentoId: id.nullable().default(null),
  fontePagadoraId: id,
  dono: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('profissional'), profissionalId: id }),
    z.object({ tipo: z.literal('agenda'), agendaId: id }),
  ]),
  alvo: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('item'), itemFaturavelId: id }),
    z.object({ tipo: z.literal('grupo'), grupoFaturamentoId: id }),
    z.object({ tipo: z.literal('consulta') }),
    z.object({ tipo: z.literal('exame') }),
  ]),
  valor,
  prioridade: z.number().int().min(0).max(65_535).default(100),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
  situacaoRevisao: z.enum(SITUACOES_REVISAO_REGRA).default('confirmada'),
  textoOrigemId: id.nullable().default(null),
  observacao: z.string().max(500).nullable().default(null),
});

const vigenciaCoerente = (r: { vigenciaInicio: string; vigenciaFim: string | null }) =>
  r.vigenciaFim === null || r.vigenciaFim >= r.vigenciaInicio;

/** O alvo "exame" (exame padrão, sem item) só existe na agenda. */
const exameSoDaAgenda = (r: { dono: { tipo: DonoRegraPreco }; alvo: { tipo: AlvoRegraPreco } }) =>
  r.alvo.tipo !== 'exame' || r.dono.tipo === 'agenda';

export const esquemaEntradaRegraPrecoParticular = baseRegra
  .refine(vigenciaCoerente, {
    message: 'O fim da vigência não pode ser antes do início.',
    path: ['vigenciaFim'],
  })
  .refine(exameSoDaAgenda, {
    message: 'O exame padrão (sem procedimento) só pode ter a agenda como dona.',
    path: ['alvo'],
  });
export type EntradaRegraPrecoParticular = z.infer<typeof esquemaEntradaRegraPrecoParticular>;

export const esquemaRegraPrecoParticular = baseRegra.extend({
  id,
  ativo: z.boolean(),
  origem: z.enum(ORIGENS_REGRA_AGENDA_PRECO),
  versao: z.number().int().positive(),
});
export type RegraPrecoParticular = z.infer<typeof esquemaRegraPrecoParticular>;

export const esquemaFiltroRegrasPrecoParticular = z.object({
  profissionalId: id.optional(),
  agendaId: id.optional(),
  fontePagadoraId: id.optional(),
  /** Só as vigentes nesta data (as recusadas e inativas nunca vêm). */
  vigentesEm: data.optional(),
});
export type FiltroRegrasPrecoParticular = z.infer<typeof esquemaFiltroRegrasPrecoParticular>;

/** Credenciamento profissional × convênio (profissional_fonte_pagadora), com vigência e plano, e os nomes para a tela. */
export const esquemaCredenciamento = z.object({
  id,
  profissionalId: id,
  profissionalNome: z.string(),
  fontePagadoraId: id,
  fontePagadoraNome: z.string(),
  estabelecimentoId: id.nullable(),
  /** Nulo quando o credenciamento vale na rede inteira. */
  estabelecimentoNome: z.string().nullable(),
  planoId: id.nullable(),
  /** Nulo quando vale para todos os planos do convênio. */
  planoNome: z.string().nullable(),
  credenciado: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  versao: z.number().int().positive(),
});
export type Credenciamento = z.infer<typeof esquemaCredenciamento>;

export const esquemaEntradaCredenciamento = z
  .object({
    profissionalId: id,
    fontePagadoraId: id,
    estabelecimentoId: id.nullable().default(null),
    planoId: id.nullable().default(null),
    credenciado: z.boolean().default(true),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
  })
  .refine(vigenciaCoerente, {
    message: 'O fim da vigência não pode ser antes do início.',
    path: ['vigenciaFim'],
  });
export type EntradaCredenciamento = z.infer<typeof esquemaEntradaCredenciamento>;

/** Opções do convênio que o ADR 0009 acrescenta (decisões 25 e 26). */
export const esquemaOpcoesCredenciamentoConvenio = z.object({
  fontePagadoraId: id,
  /** Falso (padrão): atender sem credenciamento só alerta; verdadeiro: recusa. */
  bloqueiaSemCredenciamento: z.boolean(),
  /** Convênio novo credencia todos os profissionais ativos ao ser criado. */
  credenciaTodosAoCriar: z.boolean(),
});
export type OpcoesCredenciamentoConvenio = z.infer<typeof esquemaOpcoesCredenciamentoConvenio>;

/** Resultado da verificação do credenciamento no atendimento ou na marcação. */
export const esquemaVerificacaoCredenciamento = z.object({
  credenciado: z.boolean(),
  /** nenhum: credenciado; alerta: atende com aviso; bloqueio: recusa (opção do convênio). */
  efeito: z.enum(['nenhum', 'alerta', 'bloqueio']),
  credenciamentoId: id.nullable(),
  motivo: z.string().nullable(),
});
export type VerificacaoCredenciamento = z.infer<typeof esquemaVerificacaoCredenciamento>;

/** De onde veio o preço que o cálculo usou (memória de cálculo e tela de preços). */
export const ORIGENS_PRECO = [
  'regra_particular_profissional',
  'regra_particular_agenda',
  'tabela_conta',
  'tabela_plano',
  'tabela_convenio',
  'manual',
] as const;
export type OrigemPreco = (typeof ORIGENS_PRECO)[number];

export const esquemaResultadoCalculoPreco = z.object({
  /** Valor unitário cobrado; nulo quando não há preço (item-sem-preco: pede preço manual justificado). */
  valor: valor.nullable(),
  origem: z.enum(ORIGENS_PRECO).nullable(),
  regraPrecoParticularId: id.nullable(),
  tabelaPrecoId: id.nullable(),
  /** Texto da agenda de onde a regra foi extraída (mostrado ao lado), quando houver. */
  textoOrigemId: id.nullable(),
  /** A regra que decidiu é estimada (extraída do texto, ainda não confirmada). */
  estimada: z.boolean(),
  credenciamento: esquemaVerificacaoCredenciamento.nullable(),
  /** Explicação curta para a tela ("regra do médico X, vigente desde ..."). */
  explicacao: z.string(),
  recusa: z.enum(['item-sem-preco', 'profissional-nao-credenciado']).nullable(),
});
export type ResultadoCalculoPreco = z.infer<typeof esquemaResultadoCalculoPreco>;
