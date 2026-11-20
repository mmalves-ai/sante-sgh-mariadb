// Respostas da API da manutenção e engenharia clínica, fatia F1 (M55). Só rótulos de produto e códigos do vocabulário;
// o solicitante e o técnico saem pelo login e pelo nome do usuário do sistema (nunca CPF, telefone ou e-mail). Os
// indicadores levam as parcelas (regra 3): a tela imprime a conta, não só o resultado.
import type { OsNoLeito } from '../internacao/os-leito.js';
import type { CodigoModeloPlano } from './infraestrutura.js';
import type {
  AtividadePlano,
  CausaFalha,
  ClasseRisco,
  CoberturaContrato,
  CriticidadeEquipamento,
  Executor,
  NaturezaOs,
  PrioridadeOs,
  ResultadoExecucao,
  SituacaoEquipamento,
  SituacaoOs,
  SituacaoPlano,
  SituacaoPrazoOs,
  SlaPrioridade,
  TipoEquipamento,
  TipoRecursoAgenda,
  UnidadePeriodicidade,
} from './vocabulario.js';

export interface Rotulado<T extends string = string> {
  readonly codigo: T;
  readonly nome: string;
}

export interface EquipamentoResumo {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly classeRisco: ClasseRisco | null;
  readonly situacao: SituacaoEquipamento;
  /** Há OS com parada aberta. */
  readonly parado: boolean;
  readonly setor: Rotulado<string> | null;
  readonly unidade: Rotulado<string> | null;
  readonly localizacao: string | null;
  /** Itens do plano vencidos (regra 2). */
  readonly planosVencidos: number;
  readonly osAbertas: number;
}

export interface EquipamentoDetalhe extends EquipamentoResumo {
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly registroAnvisa: string | null;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number; readonly nome: string } | null;
  readonly bemPatrimonial: number | null;
  /** O bem patrimonial ligado, relido do patrimônio (a ficha mostra a plaqueta; nulo: sem bem ou não achado). */
  readonly bem?: BemDoEquipamento | null;
  readonly instalacao: string | null;
  readonly garantiaAte: string | null;
  readonly coberturas: readonly CoberturaResumo[];
}

/** Bem do patrimônio para ligar ao equipamento (busca da ficha; sem valor nem dado contábil). */
export interface BemDoEquipamento {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
}

export interface CoberturaResumo {
  readonly id: number;
  readonly numero: string;
  readonly fornecedor: Rotulado<string>;
  readonly cobertura: CoberturaContrato;
  readonly inicio: string;
  readonly fim: string;
  readonly vigente: boolean;
  readonly slaHoras: number | null;
}

export interface PrazoOs {
  readonly limite: string;
  readonly situacao: SituacaoPrazoOs;
  /** Minutos que faltam (negativo: vencido). Nulo quando a etapa já foi cumprida. */
  readonly restanteMinutos: number | null;
}

export interface OsResumo {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly natureza: NaturezaOs;
  readonly prioridade: PrioridadeOs;
  readonly situacao: SituacaoOs;
  readonly equipamento: { readonly id: number; readonly codigo: string; readonly nome: string } | null;
  readonly critico: boolean;
  readonly parado: boolean;
  readonly setor: Rotulado<string>;
  readonly local: string | null;
  readonly abertaEm: string;
  readonly solicitante: string;
  readonly tecnico: string | null;
  readonly atendimento: PrazoOs;
  readonly solucao: PrazoOs;
}

export interface EventoOs {
  readonly em: string;
  readonly ator: string;
  readonly de: SituacaoOs | null;
  readonly para: SituacaoOs;
  readonly nota: string | null;
}

export interface OsDetalhe extends OsResumo {
  readonly descricao: string;
  readonly contato: string | null;
  readonly executor: Executor;
  readonly cobertura: CoberturaResumo | null;
  readonly paradaInicio: string | null;
  readonly paradaFim: string | null;
  readonly causa: CausaFalha | null;
  readonly solucaoTexto: string | null;
  readonly inicioReparo: string | null;
  readonly fimReparo: string | null;
  readonly custos: {
    readonly pecas: number;
    readonly maoDeObra: number;
    readonly terceiros: number;
    readonly total: number;
  };
  readonly laudo: number | null;
  readonly eventos: readonly EventoOs[];
  /** Quem está vendo é quem abriu a OS (a tela mostra o aceite e a recusa só a ele). */
  readonly souSolicitante: boolean;
  /** W0-08: a urgência informada por quem abriu (a corrigível enquanto ninguém assumiu). */
  readonly prioridadeSugerida: PrioridadeOs;
  /** W0-08: a abertura ainda se corrige (ninguém assumiu; quem abriu ou a manutenção). */
  readonly podeCorrigir: boolean;
  /** Ações que o ator pode fazer agora (o servidor decide; a tela só mostra). */
  readonly acoes: readonly ('assumir' | 'andamento' | 'concluir' | 'encerrar' | 'cancelar')[];
  /** Alerta do equipamento crítico parado (regra 1). */
  readonly alerta: AlertaParada | null;
  /**
   * W0-08 (M2): a queixa técnica aberta desta OS na vigilância de produto da qualidade e o alerta de tecnovigilância de
   * que ela é ação de campo; `podeAbrirQueixa`: OS de equipamento ainda sem queixa e a pessoa pode registrá-la.
   */
  readonly tecnovigilancia?: {
    readonly queixa: number | null;
    readonly alerta: { readonly id: number; readonly numero: string } | null;
    readonly podeAbrirQueixa: boolean;
  };
}

export interface AlertaParada {
  readonly setor: Rotulado<string>;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number; readonly nome: string } | null;
  /** Operação que bloqueia o recurso, quando existe; nulo: só o alerta. */
  readonly operacaoBloqueio: string | null;
}

export interface ItemPlanoPainel {
  readonly plano: number;
  readonly versao: number;
  readonly equipamento: { readonly id: number; readonly codigo: string; readonly nome: string };
  readonly criticidade: CriticidadeEquipamento;
  readonly atividade: AtividadePlano;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly ultimaExecucao: string | null;
  readonly ultimoResultado: ResultadoExecucao | null;
  readonly proxima: string;
  readonly situacao: SituacaoPlano;
  readonly diasParaVencer: number;
  readonly exigeLaudo: boolean;
  /** W0-08 (M4): o modelo pronto de onde o plano veio (PMOC, reservatório, gerador, gases); null: montado à mão. */
  readonly modelo?: CodigoModeloPlano | null;
}

/** Indicadores com as parcelas impressas (regra 3). Horas com 2 casas. */
export interface IndicadoresManutencao {
  readonly inicio: string;
  readonly fim: string;
  readonly equipamentos: number;
  readonly parcelas: {
    readonly horasPeriodo: number;
    readonly horasParadas: number;
    readonly horasOperacao: number;
    readonly falhas: number;
    readonly reparos: number;
    readonly horasReparo: number;
  };
  /** Percentual (0 a 100) ou nulo sem horas no período. */
  readonly disponibilidade: number | null;
  /** Horas entre falhas, nulo sem falha no período. */
  readonly mtbf: number | null;
  /** Horas por reparo, nulo sem reparo concluído. */
  readonly mttr: number | null;
  readonly porEquipamento: readonly {
    readonly equipamento: { readonly id: number; readonly codigo: string; readonly nome: string };
    readonly disponibilidade: number | null;
    readonly mtbf: number | null;
    readonly mttr: number | null;
    readonly horasParadas: number;
    readonly falhas: number;
    readonly reparos: number;
    readonly horasReparo: number;
  }[];
}

export interface PaginaManutencao<T> {
  readonly itens: readonly T[];
  /** Chave para a próxima página (`antesDe`), nula na última. */
  readonly proxima: number | null;
}

/** Setor (centro de custo) para os combos da manutenção. */
export interface SetorManutencao {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

/** O apoio das telas: setores, unidades, os setores da pessoa, os parâmetros, o que ela pode e a liberação. */
export interface ApoioManutencao {
  readonly hoje: string;
  readonly agora: string;
  readonly setores: readonly SetorManutencao[];
  readonly unidades: readonly { readonly codigo: number; readonly nome: string }[];
  /** Os setores do cadastro da pessoa; vazio: sem restrição (abre para qualquer setor ativo). */
  readonly meusSetores: readonly number[];
  readonly sla: Readonly<Record<PrioridadeOs, SlaPrioridade>>;
  readonly antecedenciaDias: number;
  readonly aceiteHoras: number;
  readonly pode: {
    readonly abrir: boolean;
    readonly atender: boolean;
    readonly encerrar: boolean;
    readonly ler: boolean;
    readonly editar: boolean;
    readonly planejar: boolean;
  };
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
}

/** O equipamento lido pelo QR (só o necessário para abrir a OS). */
export interface EquipamentoPeloCodigo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly criticidade: CriticidadeEquipamento;
  readonly situacao: SituacaoEquipamento;
  readonly setor: Rotulado<string> | null;
  readonly centroCusto: number;
  readonly parado: boolean;
  readonly osAbertas: number;
}

export interface PainelPlano {
  readonly hoje: string;
  readonly itens: readonly ItemPlanoPainel[];
  readonly resumo: Readonly<Record<SituacaoPlano, number>>;
}

export interface ExecucaoPlano {
  readonly id: number;
  readonly data: string;
  readonly resultado: ResultadoExecucao;
  readonly laudo: number | null;
  readonly certificadoPadrao: string | null;
  readonly observacao: string | null;
  readonly osCorretiva: number | null;
  readonly por: string;
}

/** W0-08: versão anterior do plano (os campos como estavam antes da alteração, o motivo, quem e quando). */
export interface VersaoPlano {
  readonly versao: number;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly dataBase: string;
  readonly antecedenciaDias: number | null;
  readonly procedimento: string | null;
  readonly executor: Executor;
  readonly cobertura: number | null;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

/** W0-08: o plano como está (para o formulário de alteração), com as versões anteriores. */
export interface PlanoDetalhe {
  readonly id: number;
  readonly versao: number;
  readonly equipamento: number;
  readonly atividade: AtividadePlano;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly dataBase: string;
  readonly antecedenciaDias: number | null;
  readonly procedimento: string | null;
  readonly executor: Executor;
  readonly cobertura: number | null;
  readonly ativo: boolean;
  /** W0-08 (M4): o modelo pronto de onde o plano veio, com a versão do roteiro; null: montado à mão. */
  readonly modelo?: { readonly codigo: CodigoModeloPlano; readonly versao: number } | null;
  readonly versoes: readonly VersaoPlano[];
}

/** W0-08: o contrato de manutenção na lista (com a versão para alterar, encerrar ou excluir). */
export interface ContratoManutencao extends CoberturaResumo {
  readonly versao: number;
  readonly equipamentos: readonly number[];
  readonly valorMensal: number | null;
  readonly ativa: boolean;
  readonly encerradaEm: string | null;
  readonly motivoEncerramento: string | null;
}

/** W0-08: versão anterior do contrato (os campos e os equipamentos como estavam, o motivo, quem e quando). */
export interface VersaoContratoManutencao {
  readonly versao: number;
  readonly operacao: 'alteracao' | 'encerramento';
  readonly inicio: string;
  readonly fim: string;
  readonly slaHoras: number | null;
  readonly valorMensal: number | null;
  readonly equipamentos: readonly number[];
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

/** W0-08: o contrato como está, com as versões anteriores. */
export interface ContratoManutencaoDetalhe extends ContratoManutencao {
  readonly versoes: readonly VersaoContratoManutencao[];
}

/** Resultado de toda gravação da manutenção. */
export interface ResultadoManutencao {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly mensagem: string;
  /** Abertura: o número da OS; execução reprovada: o da corretiva aberta. */
  readonly numero?: string | null;
  /** Abertura com equipamento crítico parado: o alerta e quantas pessoas foram avisadas. */
  readonly alerta?: (AlertaParada & { readonly avisados: number }) | null;
  /** Abertura: OS ainda abertas do mesmo equipamento (aviso de duplicidade). */
  readonly possiveisDuplicadas?: readonly number[];
  /** W0-07 (M4, parâmetro adt.osBloqueiaLeito): o leito do local da OS, o bloqueio proposto ou encerrado. */
  readonly leito?: OsNoLeito | null;
}
