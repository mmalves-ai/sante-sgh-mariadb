// Respostas da enfermagem beira-leito (M25; ficha, seções 4 e 7): a linha do tempo do turno, os horários do paciente
// no tablet, o horário com o histórico, os conflitos, os sinais vitais com o laboratório na mesma régua, a proposta de
// aprazamento e a passagem de plantão. Vocabulário de produto; nenhum nome de tabela nem de coluna.
import type {
  EstadoHorario,
  EventoInfusao,
  MotivoNaoAdministracao,
  ParteSbar,
  PendenciaPlantao,
  ResolucaoConflito,
  SituacaoChecagem,
  TipoHorario,
  TipoSinalVital,
  Turno,
} from './vocabulario.js';
import type { ChecagemContencaoNoTurno } from './contencao.js';

/** Um horário previsto da prescrição, como a enfermagem vê no turno. */
export interface HorarioEnfermagem {
  readonly id: number;
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  /** Número da internação (ou do atendimento) que a enfermagem vê. */
  readonly numero: number | null;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly leito: string | null;
  readonly unidade: string | null;
  /** Horário previsto (AAAA-MM-DDTHH:mm, hora local do estabelecimento). */
  readonly previsto: string;
  readonly situacao: SituacaoChecagem | string;
  readonly estado: EstadoHorario;
  readonly tipo: TipoHorario;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  /** Produto do item (para conferir a leitura da dose). */
  readonly produto: number | null;
  readonly seNecessario: boolean;
  readonly altaVigilancia: boolean;
  readonly duplaChecagem: boolean;
  readonly hemocomponente: boolean;
  /** Infusão contínua: a velocidade só muda se o item permite (regra 11). */
  readonly infusao: { readonly velocidadeMlH: number | null; readonly ajustavel: boolean } | null;
  /** Faixas da escala de glicemia (regra 12). */
  readonly faixasGlicemia: readonly FaixaGlicemiaLida[];
  readonly checadoEm: string | null;
  readonly atrasoMinutos: number | null;
  /** Observação da prescrição para a enfermagem. */
  readonly observacaoMedica: string | null;
}

export interface FaixaGlicemiaLida {
  /** A faixa da escala (o horário da faixa aponta para ela). */
  readonly id?: number;
  readonly de: number;
  readonly ate: number;
  readonly dose: number | null;
  readonly unidade: string | null;
  readonly produto: number | null;
}

/** A linha do tempo do turno da unidade (worklist da enfermagem). */
export interface LinhaDoTempoTurno {
  readonly unidade: string;
  readonly turno: { readonly inicio: string; readonly fim: string; readonly nome: Turno };
  readonly agora: string;
  readonly toleranciaMinutos: number;
  readonly horarios: readonly HorarioEnfermagem[];
  readonly cortada: boolean;
  readonly resumo: Readonly<Record<EstadoHorario, number>>;
  /** Pacientes da unidade com o leito (inclusive sem horário no turno). */
  readonly pacientes: readonly PacienteDaUnidade[];
  /** Sinais devidos (sem registro há mais que o intervalo da unidade). */
  readonly sinaisDevidos: readonly { readonly paciente: number; readonly ultimo: string | null }[];
  readonly conflitosAbertos: number;
  /** W1-08: as checagens da contenção mecânica aprazadas no turno (perfusão e pele), com o alerta da ordem vencida. */
  readonly contencoes?: readonly ChecagemContencaoNoTurno[];
}

export interface PacienteDaUnidade {
  readonly paciente: number;
  readonly atendimento: number;
  readonly numero: number | null;
  readonly nome: string;
  readonly leito: string | null;
  readonly alergia: boolean;
}

/** Um evento do histórico do horário (situação, aprazamento, ato no novo). */
export interface EventoHorario {
  readonly quando: string;
  readonly origem: 'historico' | 'extrato' | 'novo';
  readonly situacao: string | null;
  readonly rotulo: string;
  readonly profissional: string | null;
  readonly detalhe: string | null;
}

export interface HorarioDetalhe {
  readonly horario: HorarioEnfermagem;
  readonly historico: readonly EventoHorario[];
  readonly cortado: boolean;
  readonly atos: readonly AtoChecagemLido[];
  readonly infusao: readonly EventoInfusaoLido[];
}

/** O que o novo guardou do ato (hora real, leituras, dupla checagem, dispositivo). */
export interface AtoChecagemLido {
  readonly id: number;
  readonly tipo: 'checagem' | 'estorno';
  readonly situacao: string;
  readonly horaReal: string;
  readonly gravadoEm: string;
  readonly usuario: string;
  readonly pulseiraLida: boolean;
  readonly motivoSemPulseira: string | null;
  readonly gtin: string | null;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly conferente: string | null;
  readonly origemOffline: boolean;
  readonly motivo: MotivoNaoAdministracao | null;
  readonly observacao: string | null;
}

export interface EventoInfusaoLido {
  readonly id: number;
  readonly evento: EventoInfusao;
  readonly velocidadeMlH: number | null;
  readonly volumeInfundidoMl: number | null;
  readonly horaReal: string;
  readonly usuario: string;
}

/** Resultado da checagem (com os avisos dos nove certos que o profissional conferiu). */
export interface ResultadoChecagem {
  readonly ok: true;
  readonly horario: number;
  readonly situacao: SituacaoChecagem;
  readonly repetida: boolean;
  readonly avisos: readonly string[];
  readonly mensagem: string;
}

/** Recusa dos nove certos ou do conflito (o corpo do problema leva o código). */
export interface AvaliacaoNoveCertos {
  readonly bloqueios: readonly string[];
  readonly avisos: readonly string[];
}

export interface ConflitoSincronizacao {
  readonly id: number;
  readonly horario: number;
  readonly paciente: number;
  readonly pacienteNome: string | null;
  readonly chave: string;
  readonly tipo: 'suspenso' | 'jaChecado' | 'mudou';
  readonly situacaoEncontrada: string;
  readonly desfechoTentado: string;
  readonly horaReal: string;
  readonly usuario: string;
  readonly registradoEm: string;
  readonly resolucao: ResolucaoConflito | null;
  readonly resolvidoPor: string | null;
  readonly resolvidoEm: string | null;
  readonly observacao: string | null;
}

export interface SinalVitalLido {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly tipo: TipoSinalVital;
  readonly valor: number;
  readonly unidade: string;
  readonly metodo: string | null;
  readonly horaReal: string;
  readonly usuario: string;
  readonly foraDaFaixa: boolean;
  readonly versao: number;
  /** Retificado: a versão anterior (a nova é a que vale). */
  readonly substituidoPor: number | null;
  readonly justificativa: string | null;
  readonly horario: number | null;
}

export interface SinaisVitaisDoPaciente {
  readonly paciente: number;
  readonly de: string;
  readonly ate: string;
  readonly sinais: readonly SinalVitalLido[];
  /** Glicemia e outros resultados de laboratório na mesma régua do tempo. */
  readonly laboratorio: readonly {
    readonly exame: string;
    readonly nome: string;
    readonly valor: number;
    readonly quando: string;
  }[];
  readonly cortada: boolean;
}

export interface PropostaAprazamento {
  readonly horario: number;
  readonly item: number;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly leito: string | null;
  readonly descricao: string;
  readonly previsto: string;
  readonly proposto: string;
  readonly motivoProposta: string;
  /** Já confirmado aqui (o último registro). */
  readonly registrado: {
    readonly acao: string;
    readonly confirmado: string | null;
    readonly por: string;
  } | null;
}

export interface NotaSbarLida {
  readonly atendimento: number;
  readonly paciente: number;
  readonly pacienteNome: string | null;
  readonly partes: Readonly<Record<ParteSbar, string | null>>;
  readonly pendencias: readonly {
    readonly tipo: PendenciaPlantao;
    readonly descricao: string;
    readonly horario: number | null;
  }[];
}

export interface PassagemPlantaoLida {
  readonly id: number;
  readonly unidade: string;
  readonly turno: Turno;
  readonly data: string;
  readonly passadoPor: string;
  readonly recebedor: string;
  readonly passadoEm: string;
  readonly situacao: 'aguardandoAceite' | 'aceita' | 'recusada' | 'cancelada';
  readonly aceitoEm: string | null;
  readonly observacao: string | null;
  /** W0-03: o cancelamento por quem passou, antes do aceite (a passagem continua legível, com o motivo). */
  readonly cancelamento?: { readonly motivo: string; readonly por: string; readonly em: string } | null;
  readonly notas: readonly NotaSbarLida[];
}

/** Pendências herdadas que a passagem sugere (doses atrasadas e omitidas, conflitos). */
export interface PendenciasSugeridas {
  readonly unidade: string;
  readonly pacientes: readonly {
    readonly paciente: number;
    readonly atendimento: number;
    readonly nome: string;
    readonly leito: string | null;
    readonly pendencias: readonly {
      readonly tipo: PendenciaPlantao;
      readonly descricao: string;
      readonly horario: number | null;
    }[];
  }[];
}

export interface DispositivoBeiraLeito {
  readonly id: number;
  readonly nome: string;
  readonly unidade: string;
  readonly tipo: 'tablet' | 'coletor' | 'celular';
  readonly ativo: boolean;
  readonly ultimoSincronismo: string | null;
  readonly cadastradoPor: string;
  /** Revisão W0-03: os valores anteriores do cadastro (a mais antiga primeiro), com o motivo, quem e quando. */
  readonly versoes?: readonly {
    readonly versao: number;
    readonly nome: string;
    readonly unidade: string;
    readonly ativo: boolean;
    readonly motivo: string;
    readonly usuario: string;
    readonly em: string;
  }[];
}

/** Estado das funcionalidades e das ações para as telas (liberação e permissão). */
export interface GravacaoEnfermagem {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
  readonly funcionalidades: Readonly<
    Record<string, { readonly ligada: boolean; readonly motivo: string | null }>
  >;
  readonly parametros: {
    readonly toleranciaMinutos: number;
    readonly pulseiraObrigatoria: boolean;
    readonly doseObrigatoria: boolean;
    readonly loteValidadeObrigatorio: boolean;
    readonly duplaChecagem: boolean;
    readonly cacheHoras: number;
    readonly intervaloSinaisHoras: number;
  };
  /** O profissional da sessão é enfermeiro (apraza) ou técnico (executa e checa). */
  readonly categoria: 'enfermeiro' | 'tecnico' | 'outro';
}
