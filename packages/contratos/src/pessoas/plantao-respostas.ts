// Respostas da fatia F3 da gestão de pessoas (M52.3; ficha do M52, seções 4, 6 e 7): as trocas de plantão, "quem está
// de plantão agora" com o sobreaviso e o acionamento, e o dimensionamento de enfermagem com as parcelas da conta. Sem
// CPF e sem dado de saúde; o acionamento leva só o número do atendimento. Os rótulos dos códigos ficam no vocabulário.
import type { TipoEscala, TipoPlantao, TurnoEscala } from './escala-vocabulario.js';
import type {
  CategoriaScp,
  EstadoTroca,
  FonteDimensionamento,
  SituacaoAcionamento,
  TipoTroca,
} from './plantao-vocabulario.js';
import type { OpcaoPessoas } from './respostas.js';

/** Um lado da troca: o plantão e quem o tinha quando a troca foi pedida. */
export interface LadoTroca {
  readonly plantao: number;
  readonly escala: number;
  readonly vinculo: number;
  readonly nome: string;
  readonly tipo: TipoPlantao;
  readonly inicio: string;
  readonly fim: string;
}

export interface TrocaLida {
  readonly id: number;
  readonly tipo: TipoTroca;
  readonly estado: EstadoTroca;
  /** O plantão de quem pede. */
  readonly pedido: LadoTroca;
  /** O colega e, na troca, o plantão dele. */
  readonly colega: { readonly vinculo: number; readonly nome: string };
  readonly plantaoColega: LadoTroca | null;
  readonly motivo: string;
  readonly pedidoPor: string;
  readonly pedidoEm: string;
  readonly respostaPor: string | null;
  readonly respostaEm: string | null;
  /** Quando a coordenação registrou a resposta do colega sem acesso: como ele confirmou. */
  readonly confirmacao: string | null;
  readonly decisaoPor: string | null;
  readonly decisaoEm: string | null;
  readonly motivoDecisao: string | null;
  readonly versao: number;
  /** O que a pessoa da sessão pode fazer agora nesta troca (o servidor confere de novo). */
  readonly acoes: {
    readonly responder: boolean;
    readonly registrarResposta: boolean;
    readonly decidir: boolean;
    readonly cancelar: boolean;
  };
}

export interface ListaTrocas {
  readonly itens: readonly TrocaLida[];
}

/** Apoio da tela de trocas: as escalas publicadas (do mês atual em diante) e o que a pessoa da sessão pode fazer. */
export interface ApoioTrocas {
  readonly agora: string;
  readonly escalas: readonly {
    readonly id: number;
    readonly rotulo: string;
    readonly tipo: TipoEscala;
  }[];
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly pedir: boolean;
    /** Registrar em nome do colaborador sem acesso (a coordenação: `pessoas.escala.montar`). */
    readonly emNomeDe: boolean;
    readonly aprovar: boolean;
    readonly motivo: string | null;
  };
}

/**
 * Os plantões da escala publicada que ainda não começaram, para o pedido: quais são da pessoa da sessão e quais já
 * estão em troca aberta. Os colegas são os da mesma escala (D-COLEGA-52.3).
 */
export interface PlantoesParaTroca {
  readonly escala: number;
  readonly plantoes: readonly {
    readonly plantao: number;
    readonly vinculo: number;
    readonly nome: string;
    readonly tipo: TipoPlantao;
    readonly inicio: string;
    readonly fim: string;
    readonly versao: number;
    readonly meu: boolean;
    readonly emTroca: boolean;
  }[];
  readonly colegas: readonly { readonly vinculo: number; readonly nome: string }[];
}

/** O acionamento do sobreaviso (SGH_PES_ACIONAMENTO). */
export interface AcionamentoLido {
  readonly id: number;
  readonly plantao: number;
  readonly situacao: SituacaoAcionamento;
  readonly acionadoEm: string;
  readonly acionadoPor: string;
  readonly motivo: string;
  readonly atendimento: number | null;
  /** O instante limite da chegada (acionado + tempo de chegada do sobreaviso). */
  readonly prazoChegada: string;
  readonly chegouEm: string | null;
  /** Chegou depois do prazo (ou o prazo passou sem a chegada registrada). */
  readonly atrasado: boolean;
  readonly versao: number;
}

/** Uma linha de "quem está de plantão agora". */
export interface PlantaoAgoraLinha {
  readonly plantao: number;
  readonly escala: number;
  readonly unidade: number;
  readonly unidadeNome: string | null;
  readonly setor: string;
  readonly tipoEscala: TipoEscala;
  readonly tipo: TipoPlantao;
  readonly inicio: string;
  readonly fim: string;
  /** O plantão começou no dia anterior (atravessa a meia-noite). */
  readonly desdeOntem: boolean;
  readonly chegadaMin: number | null;
  readonly vinculo: number;
  readonly nome: string;
  /** Sigla, número e UF do registro conferido no plantão (ex.: "COREN 52003/RS"), se houver. */
  readonly conselho: string | null;
  readonly especialidade: string | null;
  readonly especialidadeCodigo: string | null;
  /** O acionamento em aberto ou o último deste plantão (só no sobreaviso). */
  readonly acionamento: AcionamentoLido | null;
}

export interface PlantaoAgora {
  readonly instante: string;
  readonly linhas: readonly PlantaoAgoraLinha[];
  /** Mais de TETO_PLANTAO_AGORA linhas: refine pelo setor ou pela especialidade. */
  readonly truncado: boolean;
  readonly especialidades: readonly OpcaoPessoas[];
  readonly unidades: readonly OpcaoPessoas[];
  readonly acoes: { readonly acionar: boolean; readonly motivo: string | null };
}

/** O cálculo do dimensionamento, com as parcelas impressas (regra 9). */
export interface CalculoDimensionamento {
  readonly pacientes: Readonly<Record<CategoriaScp, number>>;
  /** Horas de enfermagem por categoria em 24 h (pacientes × horas da categoria). */
  readonly horasPorCategoria: Readonly<Record<CategoriaScp, number>>;
  /** Soma do NAS (% do tempo de um profissional), quando a classificação trouxer pacientes de terapia intensiva. */
  readonly nasSoma: number;
  readonly nasHoras: number;
  /** Total de horas de enfermagem (THE) em 24 h. */
  readonly totalHoras: number;
  /** Constante de Marinho: KM = (DS ÷ jornada semanal) × (1 + IST). */
  readonly km: number;
  readonly quantitativo: number;
  readonly totalProfissionais: number;
  readonly categoriaPrevalente: CategoriaScp | null;
  readonly percentualEnfermeiros: number;
  readonly enfermeiros: number;
  readonly tecnicos: number;
  /** Profissionais ao mesmo tempo no turno: THE ÷ 24 h, para cima (a cobertura mínima sugerida). */
  readonly coberturaSugerida: number;
  /** As contas por extenso, na ordem, para a coordenação conferir. */
  readonly parcelas: readonly string[];
}

export interface DimensionamentoLido {
  readonly id: number | null;
  readonly unidade: number;
  readonly unidadeNome: string | null;
  readonly setor: string;
  readonly data: string;
  readonly turno: TurnoEscala;
  readonly fonte: FonteDimensionamento;
  readonly unidadeInternacao: string | null;
  readonly jornadaSemanalHoras: number;
  readonly ist: number;
  readonly calculo: CalculoDimensionamento;
  /** Pacientes da unidade de internação sem classificação no turno (fonte: classificação). */
  readonly naoClassificados: number | null;
  readonly calculadoPor: string | null;
  readonly calculadoEm: string | null;
}

export interface ApoioDimensionamento {
  readonly hoje: string;
  readonly unidades: readonly OpcaoPessoas[];
  /** As unidades de internação da classificação de pacientes, com quantos estão internados (só a contagem). */
  readonly unidadesInternacao: readonly {
    readonly codigo: string;
    readonly rotulo: string;
    readonly internados: number;
  }[];
  readonly minimoEnfermeiros: number;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly calcular: boolean;
    readonly aplicarNaEscala: boolean;
    readonly motivo: string | null;
  };
}

export interface ListaDimensionamentos {
  readonly itens: readonly DimensionamentoLido[];
}
