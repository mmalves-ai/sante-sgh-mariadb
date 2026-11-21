// Balanço hídrico (M45, etapa 3; ficha, seções 4, 5, 7 e regra 6): ganhos e perdas por paciente internado, com o ganho
// endovenoso, enteral e oral vindo do horário checado "Administrado" (sem redigitar, uma vez só por horário), a diurese
// vinda dos sinais vitais, as perdas por tipo de eliminação (com a intensidade quando o tipo pede), as perdas
// insensíveis por fórmula versionada, o fechamento parcial e o de 24 horas na hora de corte da unidade (padrão 7 h) e o
// débito urinário em mL/kg/h com o alerta de oligúria. Toda conta sai com as parcelas impressas. O balanço é só do
// novo (as tabelas de movimento do balanço do sistema anterior têm 0 linhas). Vocabulário de produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaDataHoraLocal } from './entradas.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

// ── Vocabulário ────────────────────────────────────────────────────────────────────────────────────

export const SENTIDOS_BALANCO = ['ganho', 'perda'] as const;
export type SentidoBalanco = (typeof SENTIDOS_BALANCO)[number];

/** Origem do lançamento: digitado, do horário checado, da diurese dos sinais vitais ou o estorno de outro. */
export const ORIGENS_BALANCO = ['manual', 'checagem', 'sinal', 'estorno'] as const;
export type OrigemBalanco = (typeof ORIGENS_BALANCO)[number];

export const TIPOS_FECHAMENTO_BALANCO = ['parcial', 'total'] as const;
export type TipoFechamentoBalanco = (typeof TIPOS_FECHAMENTO_BALANCO)[number];
/** O código do tipo de fechamento no domínio do estabelecimento (1 = parcial, 2 = total; 2 linhas na cópia `pc`). */
export const CODIGO_TIPO_FECHAMENTO: Readonly<Record<TipoFechamentoBalanco, number>> = {
  parcial: 1,
  total: 2,
};

/**
 * Os grupos de ganho do domínio do estabelecimento (4 linhas na cópia `pc`: 1 VO, 2 Enteral, 3 Parenteral, 4 EV). O
 * novo usa os códigos do domínio; a tela mostra o nome lido.
 */
export const GRUPO_GANHO = { oral: 1, enteral: 2, parenteral: 3, endovenoso: 4 } as const;
/** O tipo de eliminação "Diurese" do domínio (1 na cópia `pc`): o débito urinário soma só ele. */
export const TIPO_ELIMINACAO_DIURESE = 1;

/** Chave de liberação (POL-3): o balanço nasce desligado por estabelecimento e unidade. */
export const CHAVE_LIBERACAO_BALANCO = 'enfermagem.balanco';

/** Os parâmetros do balanço (registro do novo: unidade, estabelecimento, rede). */
export const PARAMETRO_BALANCO_HORA_CORTE = 'enfermagem.balancoHoraCorte';
export const PARAMETRO_BALANCO_FORMULA = 'enfermagem.balancoFormulaInsensivel';
/**
 * As versões da fórmula das perdas insensíveis (a regra versionada fica no domínio da enfermagem; o fechamento grava a
 * versão usada). `nenhuma`: a unidade não estima as perdas insensíveis (o saldo sai só com as medidas).
 */
export const FORMULAS_PERDA_INSENSIVEL = ['PI-2026.1', 'nenhuma'] as const;
export type FormulaPerdaInsensivel = (typeof FORMULAS_PERDA_INSENSIVEL)[number];

// ── Domínios lidos ─────────────────────────────────────────────────────────────────────────────────

export interface GrupoGanhoBalanco {
  readonly codigo: number;
  readonly nome: string;
}
export interface TipoEliminacaoBalanco {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  /** O tipo pede a intensidade (1+ a 4+). */
  readonly pedeIntensidade: boolean;
  /** O tipo aceita o volume estimado (sem medir). */
  readonly aceitaEstimado: boolean;
  /** O tipo pede o aspecto. */
  readonly pedeAspecto: boolean;
}
export interface IntensidadeBalanco {
  readonly codigo: number;
  readonly nome: string;
}
export interface DominiosBalanco {
  readonly grupos: readonly GrupoGanhoBalanco[];
  readonly tiposEliminacao: readonly TipoEliminacaoBalanco[];
  readonly intensidades: readonly IntensidadeBalanco[];
  readonly tiposFechamento: readonly { readonly codigo: number; readonly nome: string }[];
  readonly vias: readonly { readonly codigo: string; readonly nome: string }[];
}

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

const codigo = z.number().int().min(1).max(32_767);

/** Um lançamento digitado (ganho ou perda). O ganho da checagem e a diurese dos sinais nunca são digitados. */
export const esquemaLancamentoBalanco = z
  .object({
    sentido: z.enum(SENTIDOS_BALANCO),
    /** Ganho: o grupo do domínio (VO, enteral, parenteral, EV). */
    grupo: codigo.nullable().default(null),
    /** Ganho: a via do cadastro de vias (opcional). */
    via: z
      .string()
      .regex(/^[A-Z0-9]{1,2}$/, 'Via inválida.')
      .nullable()
      .default(null),
    /** Perda: o tipo de eliminação do domínio. */
    tipoEliminacao: codigo.nullable().default(null),
    /** Perda: a intensidade (1+ a 4+), quando o tipo pede. */
    intensidade: codigo.nullable().default(null),
    aspecto: livre(40).nullable().default(null),
    /** O volume estimado (sem medir), quando o tipo aceita. */
    estimado: z.boolean().default(false),
    volumeMl: z.number().nonnegative().max(20_000),
    descricao: livre(120).nullable().default(null),
    /** A hora real do ganho ou da perda; sem ela, a hora do banco. */
    horaReal: esquemaDataHoraLocal.nullable().default(null),
    origemOffline: z.boolean().default(false),
  })
  .strict();
export type LancamentoBalancoEntrada = z.infer<typeof esquemaLancamentoBalanco>;

export const esquemaLancarBalanco = z
  .object({ lancamentos: z.array(esquemaLancamentoBalanco).min(1).max(20) })
  .strict();

/** Estorno de um lançamento (nada se apaga: o estorno anula o lançamento, com o motivo). */
export const esquemaEstornarBalanco = z
  .object({
    motivo: livre(200).pipe(z.string().min(10, 'Justifique o estorno (10 caracteres ou mais).')),
  })
  .strict();

/**
 * O fechamento: parcial (até agora) ou de 24 horas (a janela inteira, só depois da hora de corte). A tela manda o que
 * viu (o saldo e a impressão das parcelas): se o balanço mudou entre a leitura e o fechar, o servidor recusa.
 */
export const esquemaFecharBalanco = z
  .object({
    tipo: z.enum(TIPOS_FECHAMENTO_BALANCO),
    /** Início da janela de 24 horas (AAAA-MM-DDTHH:mm), a da hora de corte da unidade. */
    inicio: esquemaDataHoraLocal,
    /** Até onde a tela calculou (o parcial; no de 24 horas, o fim da janela). */
    ate: esquemaDataHoraLocal,
    pesoKg: z.number().min(0.3).max(400).nullable().default(null),
    impressaoVista: z.string().regex(/^[0-9a-f]{64}$/, 'Impressão do balanço inválida.'),
  })
  .strict();
export type FecharBalancoEntrada = z.infer<typeof esquemaFecharBalanco>;

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

export interface LancamentoBalancoLido {
  readonly id: number;
  readonly sentido: SentidoBalanco;
  readonly origem: OrigemBalanco;
  readonly grupo: number | null;
  readonly via: string | null;
  readonly tipoEliminacao: number | null;
  readonly intensidade: number | null;
  readonly aspecto: string | null;
  readonly estimado: boolean;
  readonly volumeMl: number;
  readonly horaReal: string;
  readonly descricao: string | null;
  /** O horário da prescrição de onde veio o ganho (origem checagem). */
  readonly horario: number | null;
  /** O sinal vital de onde veio a diurese (origem sinal). */
  readonly sinal: number | null;
  /** O lançamento anulado por este (origem estorno). */
  readonly estornado: number | null;
  /** O estorno que anulou este lançamento. */
  readonly estornadoPor: number | null;
  readonly motivo: string | null;
  readonly origemOffline: boolean;
  readonly usuario: string;
  readonly gravadoEm: string;
}

/** Um ganho do horário checado (ou a diurese dos sinais) que ainda não entrou no balanço: entra no fechamento. */
export interface PendenteBalanco {
  readonly origem: 'checagem' | 'sinal';
  readonly referencia: number;
  readonly sentido: SentidoBalanco;
  readonly grupo: number | null;
  readonly via: string | null;
  readonly tipoEliminacao: number | null;
  readonly volumeMl: number;
  readonly horaReal: string;
  readonly descricao: string;
}

/** Um horário checado no intervalo sem volume para o balanço (o motivo: unidade da dose, via fora do balanço). */
export interface SemVolumeBalanco {
  readonly horario: number;
  readonly horaReal: string;
  readonly descricao: string;
  readonly motivo: string;
}

export interface ParcelaBalanco {
  readonly rotulo: string;
  readonly ml: number;
}

export interface CalculoBalanco {
  readonly inicio: string;
  /** O fim do cálculo: o fim da janela ou agora (parcial). */
  readonly ate: string;
  readonly horas: number;
  readonly ganhosMl: number;
  readonly ganhos: readonly ParcelaBalanco[];
  readonly perdasMl: number;
  readonly perdas: readonly ParcelaBalanco[];
  readonly insensiveisMl: number;
  /** A conta das perdas insensíveis impressa (peso × taxa × horas × ajuste da febre). */
  readonly insensiveisConta: string;
  readonly saldoMl: number;
  /** A conta do saldo impressa (ganhos − perdas − insensíveis). */
  readonly saldoConta: string;
  readonly diureseMl: number;
  readonly pesoKg: number | null;
  readonly temperaturaMaxima: number | null;
  /** Débito urinário (mL/kg/h); null sem peso ou sem horas. */
  readonly debitoUrinario: number | null;
  readonly debitoConta: string | null;
  readonly oliguria: boolean;
  readonly formula: string;
  readonly lancamentos: number;
  /** Impressão SHA-256 das parcelas (a tela manda de volta no fechar). */
  readonly impressao: string;
}

export interface FechamentoBalancoLido {
  readonly id: number;
  readonly tipo: TipoFechamentoBalanco;
  readonly inicio: string;
  readonly fim: string;
  /** Hora de corte da unidade no fechamento (HH:MM). */
  readonly horaCorte: string;
  readonly ganhosMl: number;
  readonly perdasMl: number;
  readonly insensiveisMl: number;
  readonly saldoMl: number;
  readonly diureseMl: number;
  readonly pesoKg: number | null;
  readonly debitoUrinario: number | null;
  readonly oliguria: boolean;
  readonly formula: string;
  readonly lancamentos: number;
  readonly parcelas: string;
  readonly usuario: string;
  readonly gravadoEm: string;
}

export interface JanelaBalanco {
  readonly inicio: string;
  readonly fim: string;
  /** Já tem o fechamento de 24 horas. */
  readonly fechada: boolean;
  /** A janela em curso (contém agora). */
  readonly atual: boolean;
}

export interface BalancoDoPaciente {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
  readonly agora: string;
  /** Hora de corte da unidade (HH:MM; padrão 07:00). */
  readonly horaCorte: string;
  /** A entrada da internação (AAAA-MM-DDTHH:mm; nula sem a data): o lançamento de antes dela é recusado. */
  readonly internadoDesde: string | null;
  readonly janela: JanelaBalanco;
  /** As janelas recentes (a atual e as anteriores), para escolher. */
  readonly janelas: readonly JanelaBalanco[];
  readonly lancamentos: readonly LancamentoBalancoLido[];
  readonly pendentes: readonly PendenteBalanco[];
  readonly semVolume: readonly SemVolumeBalanco[];
  readonly calculo: CalculoBalanco;
  readonly fechamentos: readonly FechamentoBalancoLido[];
  readonly dominios: DominiosBalanco;
  /** O último peso dos sinais vitais (para o débito urinário e as perdas insensíveis). */
  readonly peso: { readonly valor: number; readonly quando: string } | null;
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
  };
  /** A leitura dos horários checados foi cortada no teto (2.000): a tela avisa. */
  readonly cortada: boolean;
}

export interface ResultadoBalanco {
  readonly ok: true;
  readonly ids: readonly number[];
  readonly mensagem: string;
}
