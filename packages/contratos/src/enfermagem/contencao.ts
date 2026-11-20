// W0-03, mercado M5 (plano-final.json, item W0-03): contenção mecânica no paciente internado — a ordem (motivo, tipo,
// membros e prazo), a checagem periódica de perfusão e pele aprazada pela ordem (aprazamento próprio, só do novo), a
// renovação como ordem nova vinculada, a retirada que encerra e o alerta da ordem vencida. Base normativa brasileira:
// Resolução COFEN 427/2012 (contenção mecânica sob supervisão do enfermeiro, registro e monitoramento) e, no paciente
// psiquiátrico, a Resolução CFM 2.057/2013 (prescrição médica). Linha "Prescrição" da matriz: ajuste é ordem nova;
// inativação com justificativa; nunca exclusão física. Nenhum nome de tabela nem do sistema anterior em texto visto
// pelo usuário (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_CONTENCAO = ['leito', 'poltrona'] as const;
export type TipoContencao = (typeof TIPOS_CONTENCAO)[number];
export const ROTULOS_TIPO_CONTENCAO: Readonly<Record<TipoContencao, string>> = {
  leito: 'No leito',
  poltrona: 'Na poltrona',
};

export const MEMBROS_CONTENCAO = ['msd', 'mse', 'mid', 'mie', 'torax'] as const;
export type MembroContencao = (typeof MEMBROS_CONTENCAO)[number];
export const ROTULOS_MEMBRO_CONTENCAO: Readonly<Record<MembroContencao, string>> = {
  msd: 'Membro superior direito',
  mse: 'Membro superior esquerdo',
  mid: 'Membro inferior direito',
  mie: 'Membro inferior esquerdo',
  torax: 'Tórax (faixa torácica)',
};

export const MOTIVOS_CONTENCAO = [
  'agitacao',
  'riscoDispositivo',
  'riscoQueda',
  'autoagressao',
  'heteroagressao',
] as const;
export type MotivoContencao = (typeof MOTIVOS_CONTENCAO)[number];
export const ROTULOS_MOTIVO_CONTENCAO: Readonly<Record<MotivoContencao, string>> = {
  agitacao: 'Agitação psicomotora sem resposta a outras medidas',
  riscoDispositivo: 'Risco de retirada de dispositivo vital (tubo, cateter, sonda)',
  riscoQueda: 'Risco de queda grave',
  autoagressao: 'Risco de autoagressão',
  heteroagressao: 'Risco de agressão a outros',
};

/** O que a checagem periódica confere (COFEN 427/2012: monitoramento clínico do contido). */
export const ACHADOS_CHECAGEM_CONTENCAO = ['perfusao', 'pele', 'posicao', 'necessidades'] as const;
export type AchadoChecagemContencao = (typeof ACHADOS_CHECAGEM_CONTENCAO)[number];
export const ROTULOS_ACHADO_CONTENCAO: Readonly<Record<AchadoChecagemContencao, string>> = {
  perfusao: 'Perfusão, cor e temperatura dos membros contidos',
  pele: 'Integridade da pele sob a contenção',
  posicao: 'Posição e conforto (contenção não apertada)',
  necessidades: 'Hidratação, eliminações e mudança de decúbito',
};

export const SITUACOES_CONTENCAO = ['ativa', 'vencida', 'retirada', 'renovada'] as const;
export type SituacaoContencao = (typeof SITUACOES_CONTENCAO)[number];

const id = z.number().int().positive().max(2_147_483_647);
const motivoLivre = textoCp1252(300)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).'));

/** A ordem de contenção (ou a renovação, que é ordem nova apontando a anterior). */
export const esquemaOrdemContencao = z
  .object({
    paciente: id,
    atendimento: id,
    motivo: z.enum(MOTIVOS_CONTENCAO),
    justificativa: motivoLivre,
    tipo: z.enum(TIPOS_CONTENCAO),
    membros: z.array(z.enum(MEMBROS_CONTENCAO)).min(1, 'Escolha ao menos um membro.').max(5),
    /** Prazo da ordem em horas (o máximo vem do parâmetro do estabelecimento). */
    prazoHoras: z.number().int().min(1).max(24),
    /** Intervalo da checagem periódica em minutos (o padrão vem do parâmetro). */
    intervaloMinutos: z.number().int().min(15).max(120),
  })
  .strict()
  .refine((o) => new Set(o.membros).size === o.membros.length, {
    message: 'Membro repetido.',
    path: ['membros'],
  });
export type OrdemContencaoEntrada = z.infer<typeof esquemaOrdemContencao>;

/** A checagem de um horário aprazado: cada achado conferido (normal ou alterado) e a observação do alterado. */
export const esquemaChecagemContencao = z
  .object({
    achados: z.record(z.enum(ACHADOS_CHECAGEM_CONTENCAO), z.enum(['normal', 'alterado'])),
    observacao: textoCp1252(300).optional(),
  })
  .strict()
  .refine((c) => ACHADOS_CHECAGEM_CONTENCAO.every((a) => c.achados[a] !== undefined), {
    message: 'Confira todos os itens da checagem.',
    path: ['achados'],
  })
  .refine((c) => !Object.values(c.achados).includes('alterado') || (c.observacao ?? '').trim().length >= 10, {
    message: 'Achado alterado exige a observação (10 caracteres ou mais).',
    path: ['observacao'],
  });
export type ChecagemContencaoEntrada = z.infer<typeof esquemaChecagemContencao>;

/** A retirada (encerra a ordem e cancela as checagens futuras) ou a inativação de ordem lançada errada. */
export const esquemaEncerrarContencao = z
  .object({ tipo: z.enum(['retirada', 'inativacao']), motivo: motivoLivre })
  .strict();
export type EncerrarContencaoEntrada = z.infer<typeof esquemaEncerrarContencao>;

/**
 * Revisão W0-03: o adendo da checagem (registro clínico: correção por fato novo do próprio autor). Os achados
 * corrigidos, a observação do alterado e o motivo; a checagem original continua legível.
 */
export const esquemaAdendoChecagemContencao = z
  .object({
    previsto: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Escolha o horário checado.'),
    achados: z.record(z.enum(ACHADOS_CHECAGEM_CONTENCAO), z.enum(['normal', 'alterado'])),
    observacao: textoCp1252(300).optional(),
    motivo: motivoLivre,
  })
  .strict()
  .refine((c) => ACHADOS_CHECAGEM_CONTENCAO.every((a) => c.achados[a] !== undefined), {
    message: 'Confira todos os itens da checagem.',
    path: ['achados'],
  })
  .refine((c) => !Object.values(c.achados).includes('alterado') || (c.observacao ?? '').trim().length >= 10, {
    message: 'Achado alterado exige a observação (10 caracteres ou mais).',
    path: ['observacao'],
  });
export type AdendoChecagemContencaoEntrada = z.infer<typeof esquemaAdendoChecagemContencao>;

/** A senha na inativação (operação crítica: a ordem lançada errada sai da contagem; reautenticação em diálogo). */
export const esquemaInativarContencao = z
  .object({ motivo: motivoLivre, senha: z.string().min(1).max(128) })
  .strict();

/** A ordem lida pela tela (as horas são locais, AAAA-MM-DDTHH:mm). */
export interface ContencaoLida {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly motivo: MotivoContencao;
  readonly justificativa: string;
  readonly tipo: TipoContencao;
  readonly membros: readonly MembroContencao[];
  readonly prazoHoras: number;
  readonly intervaloMinutos: number;
  readonly inicio: string;
  readonly fim: string;
  readonly anterior: number | null;
  readonly renovadaPor: number | null;
  /** Revisão W0-03: o início da renovação vigente (os horários desta ordem depois dele ficam cancelados). */
  readonly renovadaEm: string | null;
  readonly prescritor: string;
  readonly situacao: SituacaoContencao;
  /** A ordem inativada (lançada errada): continua visível, tachada, fora dos indicadores. */
  readonly inativa: boolean;
  /** W1-08: os horários da ordem agrupados por turno (perfusão e pele em todo turno coberto). */
  readonly turnos?: readonly TurnoChecagemContencaoResposta[];
  readonly encerramento: {
    readonly tipo: 'retirada' | 'inativacao';
    readonly motivo: string;
    readonly usuario: string;
    readonly em: string;
  } | null;
  readonly horarios: readonly {
    readonly previsto: string;
    readonly estado: 'pendente' | 'atrasada' | 'feita' | 'cancelada';
    readonly checagem: {
      readonly achados: Readonly<Record<string, string>>;
      readonly alterado: boolean;
      readonly observacao: string | null;
      readonly usuario: string;
      readonly feitaEm: string;
      readonly noPrazo: boolean;
      /** Revisão W0-03: os adendos do autor (o mais antigo primeiro; o último vale), com o motivo. */
      readonly adendos: readonly {
        readonly achados: Readonly<Record<string, string>>;
        readonly alterado: boolean;
        readonly observacao: string | null;
        readonly motivo: string;
        readonly usuario: string;
        readonly em: string;
      }[];
    } | null;
  }[];
}

/** W1-08: as checagens da ordem num turno de 12 horas da enfermagem (perfusão e pele em todo turno coberto). */
export interface TurnoChecagemContencaoResposta {
  readonly turno: 'diurno' | 'noturno';
  readonly inicio: string;
  readonly fim: string;
  readonly previstas: number;
  readonly feitas: number;
  readonly atrasadas: number;
  readonly pendentes: number;
  readonly canceladas: number;
  readonly achados: readonly string[];
  readonly horarios: readonly string[];
}

/** W1-08: uma checagem da contenção aprazada no turno da worklist da enfermagem (o aprazamento da unidade). */
export interface ChecagemContencaoNoTurno {
  readonly ordem: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly leito: string | null;
  readonly previsto: string;
  readonly estado: 'pendente' | 'atrasada' | 'feita' | 'cancelada';
  readonly achados: readonly string[];
  /** A ordem está vencida sem renovação nem retirada: o alerta acompanha o horário. */
  readonly ordemVencida: boolean;
}

export interface PacienteContencao {
  readonly paciente: number;
  readonly atendimento: number;
  readonly nome: string;
  readonly leito: string;
  readonly ordem: ContencaoLida | null;
}

export interface ContencoesDaUnidade {
  readonly unidade: string;
  readonly agora: string;
  readonly parametros: {
    readonly prazoMaximoHoras: number;
    readonly intervaloPadraoMinutos: number;
    readonly toleranciaMinutos: number;
  };
  readonly pacientes: readonly PacienteContencao[];
  /** As ordens vencidas (sem retirada nem renovação depois do prazo): o alerta da tela. */
  readonly vencidas: number;
  readonly atrasadas: number;
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly prescrever: boolean;
    readonly checar: boolean;
  };
}

export interface IndicadorContencaoResposta {
  readonly unidade: string;
  readonly de: string;
  readonly ate: string;
  /** W1-08: ordens com o prazo vencido sem renovação nem retirada no prazo (emAberto: ainda sem retirada). */
  readonly vencidasSemRenovacao: {
    readonly numerador: number;
    readonly denominador: number;
    readonly percentual: number | null;
    readonly emAberto: number;
  };
  readonly contencoes: {
    readonly numerador: number;
    readonly denominador: number;
    readonly por1000: number | null;
  };
  readonly horasContidas: number;
  readonly checagensNoPrazo: {
    readonly numerador: number;
    readonly denominador: number;
    readonly percentual: number | null;
  };
  readonly diasFechados: number;
  readonly impressao: string;
}
