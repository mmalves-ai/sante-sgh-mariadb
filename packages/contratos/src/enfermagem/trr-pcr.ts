// W0-03, mercado M2 (plano-final.json, item W0-03): o acionamento do Time de Resposta Rápida (TRR) a partir do alerta do
// escore (NEWS2 ou PEWS com gatilho de TRR), com a hora do alerta e a do acionamento; a chegada e o desfecho; a ficha da
// parada cardiorrespiratória (código azul) no modelo Utstein, com o rascunho do autor e a versão finalizada; e os
// indicadores (PCR por 1.000 pacientes-dia fora da UTI e o tempo de resposta do time), com o numerador e o denominador.
// Base brasileira: RDC 36/2013 (segurança do paciente) e RDC 7/2010 (atendimento à parada). Nenhum nome de tabela nem do
// sistema anterior em texto visto pelo usuário (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const DESFECHOS_TRR = ['permanece', 'transferidoUti', 'pcr', 'obito', 'paliativo'] as const;
export type DesfechoTrr = (typeof DESFECHOS_TRR)[number];
export const ROTULOS_DESFECHO_TRR: Readonly<Record<DesfechoTrr, string>> = {
  permanece: 'Permanece na unidade com conduta',
  transferidoUti: 'Transferido para a UTI',
  pcr: 'Evoluiu para parada (ficha de PCR)',
  obito: 'Óbito',
  paliativo: 'Cuidados paliativos (sem escalonamento)',
};

/** Ritmo inicial (Utstein): chocável ou não. */
export const RITMOS_PCR = ['fv', 'tvsp', 'aesp', 'assistolia', 'desconhecido'] as const;
export type RitmoPcr = (typeof RITMOS_PCR)[number];
export const ROTULOS_RITMO_PCR: Readonly<Record<RitmoPcr, string>> = {
  fv: 'Fibrilação ventricular',
  tvsp: 'Taquicardia ventricular sem pulso',
  aesp: 'Atividade elétrica sem pulso',
  assistolia: 'Assistolia',
  desconhecido: 'Desconhecido',
};
export const DESFECHOS_PCR = ['rceSustentado', 'obito'] as const;
export type DesfechoPcr = (typeof DESFECHOS_PCR)[number];
export const ROTULOS_DESFECHO_PCR: Readonly<Record<DesfechoPcr, string>> = {
  rceSustentado: 'Retorno da circulação espontânea sustentado (20 minutos ou mais)',
  obito: 'Óbito na sala (reanimação encerrada)',
};

const id = z.number().int().positive().max(2_147_483_647);
const hora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Hora no formato AAAA-MM-DDTHH:mm.');
const motivoLivre = textoCp1252(300)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).'));

/** O acionamento: do alerta (o escore com gatilho de TRR) ou à mão (com o motivo). */
export const esquemaAcionarTrr = z
  .object({
    paciente: id,
    atendimento: id,
    escore: id.optional(),
    motivo: motivoLivre.optional(),
  })
  .strict()
  .refine((x) => x.escore !== undefined || x.motivo !== undefined, {
    message: 'Sem o alerta do escore, informe o motivo do acionamento.',
    path: ['motivo'],
  });
export type AcionarTrrEntrada = z.infer<typeof esquemaAcionarTrr>;

export const esquemaEventoTrr = z
  .object({ tipo: z.enum(['chegada', 'desfecho']), desfecho: z.enum(DESFECHOS_TRR).optional() })
  .strict()
  .refine((x) => x.tipo === 'chegada' || x.desfecho !== undefined, {
    message: 'Escolha o desfecho.',
    path: ['desfecho'],
  });
export type EventoTrrEntrada = z.infer<typeof esquemaEventoTrr>;

/** Os campos mínimos da ficha Utstein (horas locais). */
export const esquemaDadosPcr = z
  .object({
    presenciada: z.boolean(),
    monitorizada: z.boolean(),
    ritmoInicial: z.enum(RITMOS_PCR),
    colapsoEm: hora,
    rcpEm: hora,
    desfibrilacaoEm: hora.nullable(),
    adrenalinaEm: hora.nullable(),
    viaAereaAvancada: z.boolean(),
    rceEm: hora.nullable(),
    fimEm: hora.nullable(),
    desfecho: z.enum(DESFECHOS_PCR).nullable(),
    causaProvavel: textoCp1252(200).optional(),
  })
  .strict();
export type DadosPcr = z.infer<typeof esquemaDadosPcr>;

/**
 * A ficha (primeira versão) ou a versão seguinte; `finalizar` fecha a ficha. Revisão W0-03: sem o acionamento, o autor
 * pode informar a unidade onde a parada aconteceu (o padrão é o leito atual); com ele, vale o local do acionamento.
 */
export const esquemaFichaPcr = z
  .object({
    paciente: id,
    atendimento: id,
    trr: id.optional(),
    unidade: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ._-]{1,5}$/, 'Unidade inválida.')
      .optional(),
    dados: esquemaDadosPcr,
    finalizar: z.boolean(),
  })
  .strict();
export type FichaPcrEntrada = z.infer<typeof esquemaFichaPcr>;
/**
 * A versão seguinte. Revisão W0-03: a da ficha já finalizada é a correção do autor, finalizada, com a justificativa
 * (`motivo`); a anterior fica inativa e legível.
 */
export const esquemaVersaoPcr = z
  .object({ dados: esquemaDadosPcr, finalizar: z.boolean(), motivo: motivoLivre.optional() })
  .strict();

/** Revisão W0-03: a inativação do lançado errado (acionamento, chegada/desfecho ou ficha), com a senha. */
export const esquemaInativarTrr = z
  .object({ motivo: motivoLivre, senha: z.string().min(1).max(128) })
  .strict();

/** Revisão W0-03: a retificação da chegada (a hora) ou do desfecho, só do autor, com o motivo. */
export const esquemaRetificarEventoTrr = z
  .object({ em: hora.optional(), desfecho: z.enum(DESFECHOS_TRR).optional(), motivo: motivoLivre })
  .strict()
  .refine((x) => x.em !== undefined || x.desfecho !== undefined, {
    message: 'Informe a hora ou o desfecho corrigidos.',
    path: ['em'],
  });

export interface InativacaoTrrLida {
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

export interface EventoTrrLido {
  readonly id: number;
  readonly tipo: 'chegada' | 'desfecho';
  readonly seq: number;
  readonly em: string;
  readonly desfecho: DesfechoTrr | null;
  readonly usuario: string;
  readonly motivo: string | null;
  readonly inativacao: InativacaoTrrLida | null;
  readonly vigente: boolean;
}

export interface AcionamentoTrrLido {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly origem: 'escore' | 'manual';
  readonly escore: number | null;
  readonly alertaEm: string | null;
  readonly acionadoEm: string;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly chegadaEm: string | null;
  readonly desfecho: DesfechoTrr | null;
  /** Minutos do alerta ao acionamento e do acionamento à chegada (null sem a hora). */
  readonly minutosAteAcionar: number | null;
  readonly minutosResposta: number | null;
  /** Revisão W0-03: o acionamento inativado (lançado errado): tachado, fora dos indicadores. */
  readonly inativacao: InativacaoTrrLida | null;
  /** Revisão W0-03: o escore do alerta foi estornado (o tempo "do alerta ao acionamento" não conta). */
  readonly escoreEstornado: boolean;
  /** Revisão W0-03: a chegada e o desfecho com o histórico das correções. */
  readonly eventos: readonly EventoTrrLido[];
  /** Revisão W0-03: a ficha vigente da parada ligada a este acionamento (null sem ficha). */
  readonly ficha: number | null;
}

export interface FichaPcrLida {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly trr: number | null;
  readonly versao: number;
  readonly anterior: number | null;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly dados: DadosPcr;
  readonly autor: string;
  readonly criadoEm: string;
  /** Revisão W0-03: a justificativa da correção (versão depois da finalizada). */
  readonly motivo: string | null;
  /** Revisão W0-03: a ficha inativada (lançada errada): visível, tachada, fora do indicador. */
  readonly inativacao: InativacaoTrrLida | null;
  /** Revisão W0-03: o paciente não está mais internado na unidade (a ficha segue legível e o rascunho, finalizável). */
  readonly foraDaUnidade?: boolean;
  /** Versões anteriores (inativas, legíveis com os dados), da mais nova para a mais antiga. */
  readonly versoes: readonly {
    readonly id: number;
    readonly versao: number;
    readonly criadoEm: string;
    readonly situacao: 'rascunho' | 'finalizada';
    readonly autor: string;
    readonly motivo: string | null;
    readonly dados: DadosPcr | null;
  }[];
}

export interface AlertaTrrAberto {
  readonly escore: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly leito: string;
  readonly nome: string;
  readonly escala: string;
  readonly total: number;
  readonly alertaEm: string;
}

export interface IndicadoresTrrPcr {
  readonly de: string;
  readonly ate: string;
  readonly pcrForaUti: {
    readonly numerador: number;
    readonly denominador: number;
    readonly por1000: number | null;
  };
  readonly tempoResposta: {
    readonly medianaMinutos: number | null;
    readonly noPrazo: {
      readonly numerador: number;
      readonly denominador: number;
      readonly percentual: number | null;
    };
    readonly metaMinutos: number;
  };
  readonly alertaAteAcionar: { readonly medianaMinutos: number | null; readonly n: number };
  readonly impressao: string;
}
