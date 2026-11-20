// W0-08, parte 8 (mercado M2: tecnovigilância e recall ligados ao parque instalado; RDC 67/2009, RDC 551/2021 e RDC
// 509/2021): o alerta do fabricante ou da Anvisa (fabricante, modelo e faixa de série), os equipamentos afetados no
// parque, a OS de ação de campo para cada um e a queixa técnica aberta a partir da OS (vai à vigilância de produto da
// qualidade). Entrada manual: a importação dos alertas da Anvisa é parâmetro desligado (não há credencial). Tudo em
// SGH_MAN_ALERTA, SGH_MAN_ALERTA_EQUIP e SGH_MAN_OS_QUEIXA (script 1106).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_CONDUTA_PRODUTO, type CondutaProduto } from '../qualidade/analise.js';
import { CODIGOS_PRIORIDADE_OS, type PrioridadeOs } from './vocabulario.js';

export const TIPOS_ALERTA_EQUIPAMENTO = {
  alerta: 'Alerta de tecnovigilância',
  recall: 'Recolhimento ou ação de campo do fabricante (recall)',
} as const;
export type TipoAlertaEquipamento = keyof typeof TIPOS_ALERTA_EQUIPAMENTO;
export const CODIGOS_TIPO_ALERTA_EQUIPAMENTO = Object.keys(TIPOS_ALERTA_EQUIPAMENTO) as [
  TipoAlertaEquipamento,
  ...TipoAlertaEquipamento[],
];

export const SITUACOES_ALERTA_EQUIPAMENTO = { aberto: 'Aberto', encerrado: 'Encerrado' } as const;
export type SituacaoAlertaEquipamento = keyof typeof SITUACOES_ALERTA_EQUIPAMENTO;

/** As recusas próprias do alerta (a tela traduz pelo código). */
export type RecusaAlertaEquipamento =
  | 'desatualizado'
  | 'alerta-encerrado'
  | 'alerta-com-acao'
  | 'numero-com-vinculo'
  | 'faixa-invertida'
  | 'sem-afetados'
  | 'numero-repetido'
  | 'queixa-ja-aberta'
  | 'os-sem-equipamento';

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const texto = (n: number, min: number, msg: string) =>
  textoCp1252(n)
    .transform((v) => v.trim())
    .pipe(z.string().min(min, msg));
const opcional = (n: number) =>
  textoCp1252(n)
    .transform((v) => v.trim())
    .nullable()
    .default(null)
    .transform((v) => (v === null || v === '' ? null : v));
const serie = textoCp1252(40)
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().min(1, 'Informe o número de série.'));

const camposAlerta = {
  numero: texto(40, 3, 'Informe o número do alerta (da Anvisa ou do fabricante).'),
  tipo: z.enum(CODIGOS_TIPO_ALERTA_EQUIPAMENTO),
  titulo: texto(120, 5, 'Dê um título com pelo menos 5 caracteres.'),
  fabricante: texto(60, 2, 'Informe o fabricante.'),
  /** Vazio: todos os modelos do fabricante. */
  modelo: opcional(60),
  /** A faixa de série afetada (as duas pontas, inclusive; uma série só: início = fim). Vazia: todas as séries. */
  serieInicio: serie.nullable().default(null),
  serieFim: serie.nullable().default(null),
  registroAnvisa: z
    .string()
    .regex(/^\d{11}$/, 'O registro na Anvisa tem 11 dígitos.')
    .nullable()
    .default(null),
  publicadoEm: data.nullable().default(null),
  descricao: texto(2000, 10, 'Descreva o problema com pelo menos 10 caracteres.'),
  /** A ação de campo pedida (o que a OS de cada equipamento deve fazer). */
  acao: texto(2000, 10, 'Descreva a ação de campo com pelo menos 10 caracteres.'),
};

const faixaCompleta = (v: { serieInicio: string | null; serieFim: string | null }, ctx: z.RefinementCtx) => {
  if ((v.serieInicio === null) !== (v.serieFim === null))
    ctx.addIssue({
      code: 'custom',
      path: [v.serieInicio === null ? 'serieInicio' : 'serieFim'],
      message: 'Informe as duas pontas da faixa de série (ou nenhuma, para todas as séries).',
    });
};

/** Registrar o alerta (entrada manual). */
export const esquemaRegistrarAlertaEquipamento = z.object(camposAlerta).strict().superRefine(faixaCompleta);
export type RegistrarAlertaEquipamentoEntrada = z.infer<typeof esquemaRegistrarAlertaEquipamento>;

/** Alterar pela versão lida, com motivo (o critério só muda enquanto nenhuma OS de ação de campo foi gerada). */
export const esquemaAlterarAlertaEquipamento = z
  .object({ id, versao, ...camposAlerta, motivo })
  .strict()
  .superRefine(faixaCompleta);
export type AlterarAlertaEquipamentoEntrada = z.infer<typeof esquemaAlterarAlertaEquipamento>;

/** Encerrar com motivo (a ação de campo terminou ou o alerta não se aplica). */
export const esquemaEncerrarAlertaEquipamento = z.object({ id, versao, motivo }).strict();
export type EncerrarAlertaEquipamentoEntrada = z.infer<typeof esquemaEncerrarAlertaEquipamento>;

/** Excluir o registrado por engano (só sem nenhuma OS de ação de campo), com motivo. */
export const esquemaExcluirAlertaEquipamento = z.object({ id, versao, motivo }).strict();
export type ExcluirAlertaEquipamentoEntrada = z.infer<typeof esquemaExcluirAlertaEquipamento>;

/**
 * Gerar a OS de ação de campo para os afetados ainda sem OS. `equipamentos` vazio: todos os afetados pela faixa; com
 * IDs: só esses (inclusive os sem série que a pessoa conferiu na etiqueta).
 */
export const esquemaGerarAcaoDeCampo = z
  .object({
    id,
    versao,
    equipamentos: z.array(id).max(500).default([]),
    prioridade: z.enum(CODIGOS_PRIORIDADE_OS as [PrioridadeOs, ...PrioridadeOs[]]).default('alta'),
  })
  .strict();
export type GerarAcaoDeCampoEntrada = z.infer<typeof esquemaGerarAcaoDeCampo>;

/** Abrir a queixa técnica (vigilância de produto da qualidade) a partir da OS. */
export const esquemaQueixaDaOs = z
  .object({
    os: id,
    tipo: z.enum(['queixaTecnica', 'eventoAdverso', 'alertaSanitario']),
    descricao: texto(4000, 10, 'Descreva a queixa com pelo menos 10 caracteres.'),
    conduta: z.enum(CODIGOS_CONDUTA_PRODUTO as [CondutaProduto, ...CondutaProduto[]]).default('nenhuma'),
  })
  .strict();
export type QueixaDaOsEntrada = z.infer<typeof esquemaQueixaDaOs>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AlertaEquipamento {
  readonly id: number;
  readonly numero: string;
  readonly tipo: TipoAlertaEquipamento;
  readonly origem: 'manual' | 'anvisa';
  readonly titulo: string;
  readonly fabricante: string;
  readonly modelo: string | null;
  readonly serieInicio: string | null;
  readonly serieFim: string | null;
  readonly registroAnvisa: string | null;
  readonly publicadoEm: string | null;
  readonly descricao: string;
  readonly acao: string;
  readonly situacao: SituacaoAlertaEquipamento;
  readonly encerradoEm: string | null;
  readonly encerradoPor: string | null;
  readonly motivo: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  /** Quantas OS de ação de campo já foram geradas. */
  readonly acoes: number;
}

/** O alerta com os equipamentos do parque diante dele (afetados e a conferir) e as OS geradas. */
export interface AlertaEquipamentoDetalhe extends AlertaEquipamento {
  readonly afetados: readonly AfetadoAlerta[];
  /** A importação automática dos alertas da Anvisa (parâmetro; desligada: só entrada manual). */
  readonly importacaoAnvisa: boolean;
}

/** Resultado da ação de campo: as OS geradas, uma por equipamento. */
export interface ResultadoAcaoDeCampo {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly mensagem: string;
  readonly geradas: readonly { readonly equipamento: number; readonly os: number; readonly numero: string }[];
}

/** Um equipamento do parque diante do alerta. */
export interface AfetadoAlerta {
  readonly equipamento: number;
  readonly codigo: string;
  readonly nome: string;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly centroCusto: number;
  /** `afetado`: a série cai na faixa; `conferir`: sem série cadastrada (confira na etiqueta). */
  readonly enquadramento: 'afetado' | 'conferir';
  /** A OS de ação de campo já gerada para ele (com a queixa aberta dela, quando houver). */
  readonly os: { readonly id: number; readonly numero: string; readonly situacao: string } | null;
  readonly queixa: number | null;
}
