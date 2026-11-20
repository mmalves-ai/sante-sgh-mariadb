// Respostas das telas da escala de plantão e dos regimes, fatia F2 (M52.2; ficha do M52, seções 4, 6 e 7). Sem CPF e
// sem dado de saúde; o plantão de outro estabelecimento da Rede nunca aparece (regra 7: só a recusa, sem a escala
// alheia). Os rótulos dos códigos ficam no vocabulário.
import type { OpcaoPessoas } from './respostas.js';
import type {
  AcaoEventoEscala,
  EstadoEscala,
  SituacaoPlantao,
  TipoEscala,
  TipoPlantao,
  TurnoEscala,
} from './escala-vocabulario.js';
import type { TipoVinculo } from './vocabulario.js';

/** Contrato em tempo parcial do domínio do ramo, com o limite semanal (regra 6). */
export interface OpcaoTempoParcial {
  readonly codigo: number;
  readonly rotulo: string;
  readonly limiteSemanalHoras: number | null;
}

/** Modelo de regime e jornada (SGH_PES_REGIME). */
export interface RegimeLido {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly jornada: number;
  readonly jornadaNome: string | null;
  readonly contratoParcial: number;
  readonly contratoParcialNome: string | null;
  readonly folgaPadrao: number | null;
  readonly folgaPadraoNome: string | null;
  readonly minutosPlantao: number;
  readonly descansoMinimoMin: number;
  readonly limiteSemanalHoras: number;
  /** O limite que a escala aplica: o do tempo parcial, se houver; senão, o do regime (regra 6). */
  readonly limiteEfetivoHoras: number;
  readonly acordo: string | null;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface ListaRegimes {
  readonly itens: readonly RegimeLido[];
}

/** Colaborador ativo para a escala e os regimes (sem CPF), com o regime em vigor hoje. */
export interface ColaboradorEscala {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly tipo: TipoVinculo;
  readonly cargo: string;
  readonly cargaSemanalHoras: number;
  readonly regime: { readonly id: number; readonly codigo: string; readonly desde: string } | null;
}

export interface ListaColaboradoresEscala {
  readonly itens: readonly ColaboradorEscala[];
}

/** Uma vigência de regime do vínculo (só inclusão). */
export interface VigenciaRegime {
  /** W0-06: o ID da vigência (para a anulação). */
  readonly id?: number;
  readonly regime: number;
  readonly codigo: string;
  readonly desde: string;
  readonly por: string;
  /** W0-06: a vigência anulada (fora do cálculo; continua no histórico com quem, quando e o motivo). */
  readonly anulada?: { readonly por: string; readonly em: string; readonly motivo: string } | null;
}

export interface CoberturaLida {
  readonly manha: number;
  readonly tarde: number;
  readonly noite: number;
}

/** Linha da lista das escalas. */
export interface EscalaResumo {
  readonly id: number;
  readonly unidade: number;
  readonly unidadeNome: string | null;
  readonly setor: string;
  readonly competencia: string;
  readonly tipo: TipoEscala;
  /** Conselho exigido de quem entra (null: escala de apoio; `qualquer`: qualquer registro ativo). */
  readonly conselhoExigido: string | null;
  readonly estado: EstadoEscala;
  readonly cobertura: CoberturaLida;
  readonly plantoes: number;
  readonly publicadaEm: string | null;
  readonly publicadaPor: string | null;
  /** W0-06: o cancelamento da escala publicada (quem, quando e o motivo). */
  readonly cancelamento?: { readonly por: string; readonly em: string; readonly motivo: string } | null;
  readonly versao: number;
}

export interface ListaEscalas {
  readonly itens: readonly EscalaResumo[];
}

/** Plantão lido na grade. */
export interface PlantaoLido {
  readonly id: number;
  readonly vinculo: number;
  readonly tipo: TipoPlantao;
  readonly inicio: string;
  readonly fim: string;
  readonly chegadaMin: number | null;
  readonly situacao: SituacaoPlantao;
  /** Alerta do conselho no dia do plantão (regra 3: a vencer ou sem validade conferida). */
  readonly alertaConselho: 'aVencer' | 'semValidade' | null;
  /** A Rede não pôde ser conferida na inclusão (outro estabelecimento indisponível; D-REDE-52). */
  readonly redeNaoConferida: boolean;
  readonly motivo: string | null;
  readonly versao: number;
}

/** Horas de jornada da semana (segunda a domingo) contra o limite (regra 6). */
export interface HorasDaSemana {
  readonly semana: string;
  readonly horas: number;
  readonly limite: number;
}

/** Uma linha da grade: o colaborador e os plantões dele na escala. */
export interface LinhaGrade {
  readonly vinculo: number;
  readonly nome: string;
  readonly cargo: string;
  readonly regime: string | null;
  readonly plantoes: readonly PlantaoLido[];
  readonly semanas: readonly HorasDaSemana[];
}

/** Furo de cobertura: turno do dia com menos escalados que o mínimo (regra 9). */
export interface FuroCobertura {
  readonly dia: string;
  readonly turno: TurnoEscala;
  readonly minimo: number;
  readonly escalados: number;
}

/** Evento da trilha da escala (só inclusão). */
export interface EventoEscalaLido {
  readonly id: number;
  readonly acao: AcaoEventoEscala;
  readonly plantao: number | null;
  readonly descricao: string;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

/** A grade mês × profissional da escala (ficha, seção 7). */
export interface GradeEscala {
  readonly escala: EscalaResumo & { readonly justificativaFuro: string | null };
  readonly dias: readonly string[];
  readonly linhas: readonly LinhaGrade[];
  readonly furos: readonly FuroCobertura[];
  readonly eventos: readonly EventoEscalaLido[];
}

export interface ApoioEscala {
  readonly hoje: string;
  readonly unidades: readonly OpcaoPessoas[];
  readonly jornadas: readonly OpcaoPessoas[];
  readonly temposParciais: readonly OpcaoTempoParcial[];
  readonly folgas: readonly OpcaoPessoas[];
  readonly regimes: readonly RegimeLido[];
  readonly interjornadaMinimaMin: number;
  /** Liberação da chave `pessoas.escala` no estabelecimento e o motivo, se desligada. */
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  /** O que esta sessão pode fazer (permissão e liberação; o servidor confere de novo em cada gravação). */
  readonly acoes: {
    readonly montar: boolean;
    readonly publicar: boolean;
    readonly editarRegime: boolean;
    readonly motivo: string | null;
  };
}

/** Resultado de uma gravação da escala: o ID e os alertas que não impediram a gravação. */
export interface ResultadoEscala {
  readonly id: number;
  readonly mensagem: string;
  readonly alertas: readonly string[];
}
