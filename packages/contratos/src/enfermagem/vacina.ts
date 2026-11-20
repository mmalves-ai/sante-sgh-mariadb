// Registro da vacina aplicada (M45, etapa 4; ficha, seções 5, 6, 7 e regra 18; Portaria GM/MS 5.663/2024 e RDC
// 197/2017): o registro clínico (imunobiológico, lote com a validade, dose, via, local de aplicação e o vacinador), com o
// prazo do envio RIA à RNDS (24 horas) e o evento na outbox que o conector do M34 lê (regra 14 do M34; fora de produção
// nada sai). Recurso novo, só do novo, desligado por estabelecimento pela chave `enfermagem.vacina` (DP-47.5 b), com o
// pré-requisito do credenciamento. Vocabulário de produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaDataHoraLocal } from './entradas.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

/** Chave de liberação (POL-3; DP-47.5 b): desligada por padrão. */
export const CHAVE_LIBERACAO_VACINA = 'enfermagem.vacina';
/** A chave do conector RIA do M34 (o envio à RNDS). */
export const CHAVE_CONECTOR_VACINA = 'integracao.rndsVacina';
/** O tipo do evento na outbox (o conector do M34 assina). */
export const EVENTO_VACINA_APLICADA = 'fato.vacina.aplicada';
/**
 * Os imunobiológicos que o estabelecimento aplica (`código:nome;...`, código do catálogo do modelo de informação da
 * RNDS): parâmetro da área, conferido no credenciamento (pré-requisito da chave).
 */
export const PARAMETRO_IMUNOBIOLOGICOS = 'enfermagem.vacina.imunobiologicos';

/** As doses do esquema (D1 a D4, dose única, reforço). O reforço pode repetir; as demais, uma vez por paciente. */
export const DOSES_VACINA = ['D1', 'D2', 'D3', 'D4', 'DU', 'REF', 'R1', 'R2'] as const;
export type DoseVacina = (typeof DOSES_VACINA)[number];
export const DOSES_QUE_REPETEM: readonly DoseVacina[] = ['REF', 'R1', 'R2'];

/** As vias de aplicação (códigos do modelo de informação). */
export const VIAS_VACINA = [
  { codigo: 'IM', nome: 'Intramuscular' },
  { codigo: 'SC', nome: 'Subcutânea' },
  { codigo: 'ID', nome: 'Intradérmica' },
  { codigo: 'VO', nome: 'Oral' },
] as const;
/** Os locais de aplicação (códigos do modelo de informação). */
export const LOCAIS_VACINA = [
  { codigo: 'DD', nome: 'Deltoide direito' },
  { codigo: 'DE', nome: 'Deltoide esquerdo' },
  { codigo: 'VLD', nome: 'Vasto lateral da coxa direita' },
  { codigo: 'VLE', nome: 'Vasto lateral da coxa esquerda' },
  { codigo: 'GD', nome: 'Glúteo direito' },
  { codigo: 'GE', nome: 'Glúteo esquerdo' },
  { codigo: 'ABD', nome: 'Antebraço direito' },
  { codigo: 'ABE', nome: 'Antebraço esquerdo' },
  { codigo: 'O', nome: 'Oral' },
] as const;

export interface ImunobiologicoVacina {
  readonly codigo: string;
  readonly nome: string;
}

export const esquemaRegistrarVacina = z
  .object({
    imunobiologico: z.string().regex(/^[A-Za-z0-9]{1,10}$/, 'Imunobiológico inválido.'),
    lote: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9./-]{2,30}$/, 'Lote inválido.'),
    fabricante: livre(80).nullable().default(null),
    validadeLote: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Validade no formato AAAA-MM-DD.'),
    dose: z.enum(DOSES_VACINA),
    via: z.enum(VIAS_VACINA.map((v) => v.codigo) as [string, ...string[]]),
    local: z.enum(LOCAIS_VACINA.map((v) => v.codigo) as [string, ...string[]]),
    /** A hora da aplicação (sem ela, a do banco). */
    aplicadaEm: esquemaDataHoraLocal.nullable().default(null),
  })
  .strict();
export type RegistrarVacinaEntrada = z.infer<typeof esquemaRegistrarVacina>;

/** A situação do envio RIA (do evento na outbox e da chave do conector). */
export const SITUACOES_ENVIO_VACINA = ['aguardandoConector', 'naFila', 'enviado', 'falhou'] as const;
export type SituacaoEnvioVacina = (typeof SITUACOES_ENVIO_VACINA)[number];

export interface VacinaAplicadaLida {
  readonly id: number;
  readonly imunobiologico: string;
  readonly nome: string;
  readonly lote: string;
  readonly fabricante: string | null;
  readonly validadeLote: string;
  readonly dose: DoseVacina;
  readonly via: string;
  readonly local: string;
  readonly aplicadaEm: string;
  /** O prazo do envio RIA (24 horas depois da aplicação). */
  readonly prazoEnvio: string;
  readonly envio: { readonly situacao: SituacaoEnvioVacina; readonly vencido: boolean };
  readonly usuario: string;
  readonly em: string;
  /**
   * W0-03: `ativa`, `retificada` (os campos acima já são os da última versão) ou `estornada` (inativa e visível). O
   * registro original fica em `original` quando há retificação.
   */
  readonly situacao?: 'ativa' | 'retificada' | 'estornada';
  readonly original?: Pick<
    VacinaAplicadaLida,
    'lote' | 'fabricante' | 'validadeLote' | 'dose' | 'via' | 'local' | 'aplicadaEm'
  > | null;
  readonly correcoes?: readonly CorrecaoVacina[];
}

/** W0-03: o estorno ou a retificação da vacina, com a situação do evento RIA de cancelamento ou substituição. */
export interface CorrecaoVacina {
  readonly versao: number;
  readonly tipo: 'estorno' | 'retificacao';
  readonly motivo: string;
  readonly dados: Readonly<Record<string, string | null>> | null;
  readonly usuario: string;
  readonly em: string;
  readonly envio: { readonly situacao: SituacaoEnvioVacina };
}

/** W0-03: estornar (registrada por engano) ou retificar (dados digitados errado) a vacina, com o motivo. */
export const esquemaCorrigirVacina = z
  .object({
    tipo: z.enum(['estorno', 'retificacao']),
    motivo: z.string().trim().min(10, 'Descreva o motivo (pelo menos 10 caracteres).').max(300),
    dados: z
      .object({
        lote: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9./-]{2,30}$/, 'Lote inválido.')
          .optional(),
        fabricante: livre(80).nullable().optional(),
        validadeLote: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Validade no formato AAAA-MM-DD.')
          .optional(),
        dose: z.enum(DOSES_VACINA).optional(),
        via: z.enum(VIAS_VACINA.map((v) => v.codigo) as [string, ...string[]]).optional(),
        local: z.enum(LOCAIS_VACINA.map((v) => v.codigo) as [string, ...string[]]).optional(),
        aplicadaEm: esquemaDataHoraLocal.optional(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .refine((x) => x.tipo === 'estorno' || (x.dados !== null && Object.keys(x.dados).length > 0), {
    message: 'Informe o que a retificação corrige.',
    path: ['dados'],
  })
  .refine((x) => x.tipo === 'retificacao' || x.dados === null, {
    message: 'O estorno não leva dados.',
    path: ['dados'],
  });
export type CorrigirVacinaEntrada = z.infer<typeof esquemaCorrigirVacina>;

/** A escolha do atendimento externo do dia (a sala de vacina da consulta): os mais recentes primeiro, até o teto. */
export interface ExternosDoDiaVacina {
  readonly itens: readonly {
    readonly atendimento: number;
    readonly paciente: number;
    readonly numero: number;
    readonly nome: string;
    readonly entrada: string | null;
  }[];
  /** Havia mais atendimentos que o teto: a tela pede o número do atendimento. */
  readonly cortada: boolean;
}

export interface VacinasDoPaciente {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
  readonly agora: string;
  readonly imunobiologicos: readonly ImunobiologicoVacina[];
  readonly vacinas: readonly VacinaAplicadaLida[];
  /** O conector do envio RIA (M34): desligado, o registro fica com o envio aguardando. */
  readonly conector: { readonly ligado: boolean; readonly motivo: string | null };
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly registrar: boolean;
  };
}

export interface ResultadoVacina {
  readonly ok: true;
  readonly id: number;
  readonly prazoEnvio: string;
  readonly mensagem: string;
}
