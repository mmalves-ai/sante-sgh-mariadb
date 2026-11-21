// Tipos de negócio da manutenção e engenharia clínica (M55): o que a porta lê e grava, no vocabulário do contrato
// (booleano, data ISO "AAAA-MM-DD", instante civil "AAAA-MM-DDTHH:MM" no fuso do estabelecimento, id numérico e valores
// em centavos). Valem para as duas portas (a própria, sobre o banco do cliente, e a de memória de dev/ci).
// Melhoria: o "setor" da tela é o centro de custo do estabelecimento (id); a unidade vem do setor funcional ligado a ele,
// e os usuários são identificados pelo login só na borda (o banco guarda o id do usuário).
import type {
  AlertaEquipamento,
  AtividadePlano,
  CausaFalha,
  ClasseRisco,
  CoberturaContrato,
  CondutaProduto,
  CriticidadeEquipamento,
  DestinoDescarte,
  EventoCicloVida,
  Executor,
  NaturezaOs,
  PrioridadeOs,
  RecusaAlertaEquipamento,
  RecusaCicloVida,
  ResultadoExecucao,
  SituacaoEquipamento,
  SituacaoOs,
  TipoAlertaEquipamento,
  TipoEquipamento,
  TipoEventoCiclo,
  TipoRecursoAgenda,
  UnidadePeriodicidade,
} from '@sgh/contratos';
import { type ErroOperacao, recusa } from '@sgh/nucleo';

/** O setor da manutenção: o centro de custo do estabelecimento (`codigo` é o id), com a unidade do setor ligado. */
export interface SetorManutencao {
  readonly codigo: number;
  readonly nome: string;
  readonly sigla: string | null;
  readonly unidade: number | null;
  readonly ativo: boolean;
}

export interface UnidadeManutencao {
  readonly codigo: number;
  readonly nome: string;
}

export interface RecursoDeAgenda {
  readonly tipo: TipoRecursoAgenda;
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly centroCusto: number | null;
}

export interface UsuarioDaOs {
  readonly login: string;
  readonly nome: string;
}

export interface EquipamentoManutencao {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly classeRisco: ClasseRisco | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly registroAnvisa: string | null;
  readonly unidade: number | null;
  readonly centroCusto: number;
  readonly localizacao: string | null;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number } | null;
  readonly bemPatrimonial: number | null;
  readonly instalacao: string | null;
  readonly garantiaAte: string | null;
  readonly situacao: SituacaoEquipamento;
  readonly desativadoEm: string | null;
  readonly motivo: string | null;
  readonly parado: boolean;
  readonly osAbertas: number;
}

export interface FiltroEquipamentos {
  readonly termo?: string | null;
  readonly centroCusto?: number | null;
  readonly tipo?: TipoEquipamento | null;
  readonly criticidade?: CriticidadeEquipamento | null;
  readonly situacao?: SituacaoEquipamento | null;
  readonly ids?: readonly number[] | null;
  readonly antesDe?: number | null;
  readonly limite?: number;
}

export interface OrdemServico {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly natureza: NaturezaOs;
  readonly equipamento: number | null;
  readonly centroCusto: number;
  readonly local: string | null;
  readonly descricao: string;
  readonly contato: string | null;
  readonly prioridadeSugerida: PrioridadeOs;
  readonly prioridade: PrioridadeOs;
  readonly situacao: SituacaoOs;
  readonly solicitante: string;
  readonly tecnico: string | null;
  readonly executor: Executor;
  readonly cobertura: number | null;
  readonly plano: number | null;
  readonly registro: string;
  readonly assumidaEm: string | null;
  readonly concluidaEm: string | null;
  readonly encerradaEm: string | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly paradaInicio: string | null;
  readonly paradaFim: string | null;
  readonly causa: CausaFalha | null;
  readonly solucao: string | null;
  readonly inicioReparo: string | null;
  readonly fimReparo: string | null;
  readonly custoPecasCent: number;
  readonly custoMaoDeObraCent: number;
  readonly custoTerceirosCent: number;
  readonly laudo: number | null;
}

export interface FiltroOrdens {
  readonly centroCusto?: number | null;
  readonly equipamento?: number | null;
  readonly situacoes?: readonly SituacaoOs[];
  readonly natureza?: NaturezaOs | null;
  readonly prioridade?: PrioridadeOs | null;
  readonly solicitante?: string | null;
  readonly restricao?: { readonly login: string; readonly centros: readonly number[] } | null;
  readonly antesDe?: number | null;
  readonly limite?: number;
}

export interface EventoOrdem {
  readonly id: number;
  readonly em: string;
  readonly ator: string;
  readonly de: SituacaoOs | null;
  readonly para: SituacaoOs;
  readonly nota: string | null;
}

export interface PlanoManutencao {
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
  readonly modelo: { readonly codigo: string; readonly versao: number } | null;
  readonly ultimaExecucao: string | null;
  readonly ultimoResultado: ResultadoExecucao | null;
}

export interface VersaoDoPlano {
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

export interface ExecucaoDoPlano {
  readonly id: number;
  readonly plano: number;
  readonly data: string;
  readonly resultado: ResultadoExecucao;
  readonly laudo: number | null;
  readonly certificadoPadrao: string | null;
  readonly observacao: string | null;
  readonly osCorretiva: number | null;
  readonly por: string;
  readonly em: string;
}

export interface CoberturaManutencao {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number;
  readonly numero: string;
  readonly cobertura: CoberturaContrato;
  readonly inicio: string;
  readonly fim: string;
  readonly slaHoras: number | null;
  readonly valorMensalCent: number | null;
  readonly contrato: number | null;
  readonly ativa: boolean;
  readonly equipamentos: readonly number[];
  readonly encerradaEm: string | null;
  readonly motivoEncerramento: string | null;
}

export interface VersaoDaCobertura {
  readonly versao: number;
  readonly operacao: 'alteracao' | 'encerramento';
  readonly inicio: string;
  readonly fim: string;
  readonly slaHoras: number | null;
  readonly valorMensalCent: number | null;
  readonly equipamentos: readonly number[];
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface EquipamentoDoPeriodo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly instalacao: string | null;
  readonly desativacao: string | null;
}

export interface OcorrenciasDoPeriodo {
  readonly equipamentos: EquipamentoDoPeriodo[];
  readonly paradas: { readonly equipamento: number; readonly inicio: string; readonly fim: string | null }[];
  readonly corretivas: {
    readonly equipamento: number;
    readonly registro: string;
    readonly causa: CausaFalha | null;
    readonly inicioReparo: string | null;
    readonly fimReparo: string | null;
  }[];
}

export interface AcaoDeCampo {
  readonly equipamento: number;
  readonly os: { readonly id: number; readonly numero: string; readonly situacao: string };
  readonly queixa: number | null;
  readonly por: string;
  readonly em: string;
}

export interface EquipamentoDoParque {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly centroCusto: number;
  readonly situacao: string;
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface EquipamentoParaGravar {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly classeRisco: ClasseRisco | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly registroAnvisa: string | null;
  readonly unidade: number | null;
  readonly centroCusto: number;
  readonly localizacao: string | null;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number } | null;
  readonly bemPatrimonial: number | null;
  readonly instalacao: string | null;
  readonly garantiaAte: string | null;
  readonly situacao: SituacaoEquipamento;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface AberturaOsParaGravar {
  readonly natureza: NaturezaOs;
  readonly equipamento: number | null;
  readonly centroCusto: number;
  readonly local: string | null;
  readonly descricao: string;
  readonly contato: string | null;
  readonly prioridadeSugerida: PrioridadeOs;
  readonly prioridade: PrioridadeOs;
  readonly solicitante: string;
  readonly registro: string;
  readonly parado: boolean;
  readonly plano: number | null;
  readonly nota: string | null;
}

/** Os campos que cada ação da OS muda (só os informados mudam; `null` limpa). */
export interface CamposOs {
  readonly prioridade?: PrioridadeOs;
  readonly tecnico?: string | null;
  readonly executor?: Executor;
  readonly cobertura?: number | null;
  readonly assumidaEm?: string | null;
  readonly concluidaEm?: string | null;
  readonly encerradaEm?: string | null;
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
  readonly paradaFim?: string | null;
  readonly causa?: CausaFalha | null;
  readonly solucao?: string | null;
  readonly inicioReparo?: string | null;
  readonly fimReparo?: string | null;
  readonly custoPecasCent?: number;
  readonly custoMaoDeObraCent?: number;
  readonly custoTerceirosCent?: number;
  readonly laudo?: number | null;
}

export interface MudancaOsParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  /** A situação lida (a mudança só passa se ela ainda vale). */
  readonly de: SituacaoOs;
  readonly para: SituacaoOs;
  readonly campos: CamposOs;
  readonly usuario: string;
  readonly nota: string | null;
}

/** A correção da abertura (antes de assumida): descrição, prioridade sugerida, setor, equipamento e local. */
export interface CorrecaoOsParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  readonly equipamento: number | null;
  readonly centroCusto: number;
  readonly local: string | null;
  readonly descricao: string;
  readonly prioridadeSugerida: PrioridadeOs;
  readonly usuario: string;
  /** O motivo e os valores anteriores (vai ao histórico da OS). */
  readonly nota: string;
}

export interface PlanoParaGravar {
  readonly equipamento: number;
  readonly atividade: AtividadePlano;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly dataBase: string;
  readonly antecedenciaDias: number | null;
  readonly procedimento: string | null;
  readonly executor: Executor;
  readonly cobertura: number | null;
  /** O modelo pronto de onde o plano veio (código e versão); null ou ausente: plano montado à mão. */
  readonly modelo?: { readonly codigo: string; readonly versao: number } | null;
  readonly usuario: string;
}

export interface AlteracaoPlanoParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly dataBase: string;
  readonly antecedenciaDias: number | null;
  readonly procedimento: string | null;
  readonly executor: Executor;
  readonly cobertura: number | null;
  readonly motivo: string;
  readonly usuario: string;
}

export interface ExecucaoParaGravar {
  readonly plano: number;
  readonly versaoVista: number;
  readonly data: string;
  readonly resultado: ResultadoExecucao;
  readonly laudo: number | null;
  readonly certificadoPadrao: string | null;
  readonly observacao: string | null;
  readonly osCorretiva: number | null;
  readonly usuario: string;
}

export interface CoberturaParaGravar {
  readonly fornecedor: number;
  readonly numero: string;
  readonly cobertura: CoberturaContrato;
  readonly inicio: string;
  readonly fim: string;
  readonly slaHoras: number | null;
  readonly valorMensalCent: number | null;
  readonly contrato: number | null;
  readonly equipamentos: readonly number[];
  readonly usuario: string;
}

export interface AlteracaoCoberturaParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  readonly inicio: string;
  readonly fim: string;
  readonly slaHoras: number | null;
  readonly valorMensalCent: number | null;
  readonly equipamentos: readonly number[];
  readonly motivo: string;
  readonly usuario: string;
}

export interface EncerramentoCoberturaParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  /** A data em que o contrato deixa de valer (entre o início e o fim da vigência). */
  readonly data: string;
  readonly motivo: string;
  readonly usuario: string;
}

export interface ExclusaoCoberturaParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  readonly motivo: string;
  readonly usuario: string;
}

export interface CamposAlertaParaGravar {
  readonly numero: string;
  readonly tipo: TipoAlertaEquipamento;
  readonly titulo: string;
  readonly fabricante: string;
  readonly modelo: string | null;
  readonly serieInicio: string | null;
  readonly serieFim: string | null;
  readonly registroAnvisa: string | null;
  readonly publicadoEm: string | null;
  readonly descricao: string;
  readonly acao: string;
}

export type AlertaParaIncluir = CamposAlertaParaGravar & {
  readonly usuario: string;
  /** A regra pura da faixa (`faixaInvertida`). */
  readonly conferir: () => RecusaAlertaEquipamento | null;
};

export type AlertaParaAlterar = CamposAlertaParaGravar & {
  readonly id: number;
  readonly versaoVista: number;
  readonly motivo: string;
  readonly usuario: string;
  /** A regra pura (`conferirAlteracaoAlerta`) sobre o alerta relido com a trava. */
  readonly conferir: (atual: AlertaEquipamento) => RecusaAlertaEquipamento | null;
};

export interface AlertaAlterado {
  readonly id: number;
  readonly versao: number;
  readonly antes: AlertaEquipamento;
}

export interface AlertaParaEncerrar {
  readonly id: number;
  readonly versaoVista: number;
  readonly motivo: string;
  readonly usuario: string;
}

export interface AcaoDeCampoPlanejada {
  readonly equipamento: number;
  readonly centroCusto: number;
  readonly descricao: string;
}

export interface GeracaoAcaoDeCampoParaGravar {
  readonly id: number;
  readonly versaoVista: number;
  readonly prioridade: PrioridadeOs;
  readonly usuario: string;
  readonly registro: string;
  readonly planejar: (
    alerta: AlertaEquipamento,
    parque: readonly EquipamentoDoParque[],
    acoes: readonly AcaoDeCampo[],
  ) =>
    | { ok: true; equipamentos: readonly AcaoDeCampoPlanejada[] }
    | { ok: false; motivo: RecusaAlertaEquipamento };
}

export interface AcaoDeCampoGerada {
  readonly versao: number;
  readonly geradas: { equipamento: number; os: number; numero: string }[];
}

export interface QueixaDaOsParaGravar {
  readonly os: number;
  readonly tipo: 'queixaTecnica' | 'eventoAdverso' | 'alertaSanitario';
  readonly descricao: string;
  readonly conduta: CondutaProduto;
  readonly usuario: string;
  readonly agora: string;
}

export interface QueixaDaOsAberta {
  readonly id: number;
  readonly versao: number;
  readonly os: number;
}

export interface VinculoCursoParaGravar {
  readonly fabricante: string;
  readonly modelo: string;
  readonly curso: number;
  readonly usuario: string;
}

export interface DesvinculoCursoParaGravar {
  readonly id: number;
  readonly motivo: string;
  readonly usuario: string;
}

export interface EventoCicloParaGravar {
  readonly equipamento: number;
  readonly tipo: TipoEventoCiclo;
  readonly data: string;
  readonly motivo: string;
  readonly documento: string | null;
  readonly destino: DestinoDescarte | null;
  readonly valorObtidoCent: number | null;
  readonly autorizadoPor: string;
  readonly usuario: string;
  readonly conferir: (existentes: readonly EventoCicloVida[], hoje: string) => RecusaCicloVida | null;
}

export interface EventoCicloRegistrado {
  readonly id: number;
  readonly valorContabilCent: number | null;
}

/** O aviso da central do usuário (o mesmo destinatário, evento e objeto não é avisado duas vezes). */
export interface AvisoDaCentral {
  readonly login: string;
  readonly tipo: string;
  readonly gravidade: 'grave' | 'atencao' | 'informacao';
  readonly modulo: string;
  readonly evento: string;
  readonly titulo: string;
  readonly link: string | null;
  readonly objetoTabela: string | null;
  readonly objetoChave: string;
}

/** O número da OS: o ano do registro e o número sequencial do estabelecimento ("2026-000123"). */
export const numeroDaOs = (registro: string, sequencial: number): string =>
  `${registro.slice(0, 4)}-${String(sequencial).padStart(6, '0')}`;

const MENSAGENS_ALERTA: Readonly<Record<RecusaAlertaEquipamento, string>> = {
  desatualizado:
    'O alerta mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  'alerta-encerrado': 'O alerta está encerrado e não muda mais.',
  'alerta-com-acao':
    'Já há OS de ação de campo geradas por este alerta: o fabricante, o modelo e a faixa de série não mudam mais. Registre outro alerta para a faixa nova.',
  'numero-com-vinculo':
    'O número do alerta já é citado pelas OS de ação de campo ou pela queixa técnica da vigilância de produto: ele não muda mais. Registre outro alerta se o número estiver errado.',
  'faixa-invertida': 'O início da faixa de série vem depois do fim. Confira as duas pontas.',
  'sem-afetados': 'Nenhum equipamento afetado ficou sem OS de ação de campo.',
  'numero-repetido': 'Já há um alerta com este número no estabelecimento.',
  'queixa-ja-aberta': 'Esta OS já tem a queixa técnica aberta na vigilância de produto.',
  'os-sem-equipamento': 'A queixa técnica precisa de um equipamento: esta OS é de serviço predial.',
};

const MENSAGENS_CICLO: Readonly<Record<RecusaCicloVida, string>> = {
  desatualizado:
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  'vinculo-repetido': 'Este curso já é exigido para este modelo.',
  'curso-inativo': 'O curso não existe ou está inativo no catálogo do treinamento.',
  'evento-repetido': 'Este evento já foi registrado para o equipamento (um de cada tipo).',
  'fora-de-ordem': 'A data não segue a ordem do ciclo de vida: incorporação, desativação e descarte.',
  'sem-desativacao': 'Registre a desativação do equipamento antes do descarte.',
  'data-futura': 'A data do evento não pode estar no futuro.',
  'descarte-incompleto': 'O descarte precisa do laudo ou do certificado de destinação e do destino.',
  'equipamento-descartado': 'O equipamento já foi descartado: o ciclo de vida está encerrado.',
};

/** Recusa de negócio do alerta de tecnovigilância (409, com a mensagem da tela). */
export const recusaAlerta = (c: RecusaAlertaEquipamento): ErroOperacao => recusa(c, MENSAGENS_ALERTA[c]);

/** Recusa de negócio do ciclo de vida do equipamento (409, com a mensagem da tela). */
export const recusaCicloVida = (c: RecusaCicloVida): ErroOperacao => recusa(c, MENSAGENS_CICLO[c]);
