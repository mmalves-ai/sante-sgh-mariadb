// Tipos de negócio do centro cirúrgico (M18), da anestesia (M46.1) e da cirurgia segura e do rastreio (M46.2): o que as
// portas devolvem e recebem, independente de onde (banco do cliente pelo @sgh/nucleo ou memória sintética de dev/ci).
// Melhoria: sem o estabelecimento em texto (vem do ContextoNucleo da porta), sem tabelas espelho nem tipos de driver.
// Dívida registrada (pedido do lote 03-01): os campos `reg`, `pares`, `hora`/`hhmm` e os códigos numéricos de sala,
// procedimento e convênio seguem o vocabulário dos contratos das telas (packages/contratos/src/cirurgia); a troca por
// ids do modelo e instantes ISO depende da revisão desses contratos.
import type { EstadoAgendamento } from '@sgh/dominio-cirurgia';
import type {
  DestinoAltaSrpa,
  DestinoSaidaBloco,
  MarcoFicha,
  MomentoChecklist,
  MomentoSrpa,
  ParteFicha,
  RespostaChecklist,
  SituacaoFicha,
  TipoMovimentoBloco,
  EstadoOperacao,
} from '@sgh/contratos';

/** Estado de cada operação no catálogo do estabelecimento (verde, amarela, bloqueada); null = desconhecida. */
export interface CatalogoOperacoes {
  estado(operacao: string, estabelecimento: string): EstadoOperacao | null;
}

export interface ContextoAnestesia {
  readonly agendamento: number;
  readonly reg: number;
  /** O atendimento pelo REG (id do atendimento); null sem atendimento (o balanço hídrico não recebe os fluidos). */
  readonly atendimento: number | null;
  readonly paciente: number | null;
  readonly sala: number;
  /** "AAAA-MM-DD HH:MM". */
  readonly inicio: string;
  readonly procedimento: number;
  readonly tipoAnestesiaAgendado: number | null;
  readonly anestesistaAgendado: number | null;
  readonly alergias: readonly { alergia: number; nome: string }[];
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly creatinina: number | null;
  readonly exames: readonly ExameRecente[];
  readonly examesTruncado: boolean;
  readonly medicacoes: readonly string[];
  readonly medicacoesTruncado: boolean;
}

export interface AgendamentoDaSala {
  readonly id: number;
  readonly sala: number;
  /** "AAAA-MM-DD HH:MM". */
  readonly inicio: string;
  readonly duracaoMin: number;
  readonly intervaloMin: number;
  readonly paciente: string;
  readonly prontuario: number;
  readonly reg: number;
  readonly atendimento: string;
  readonly convenio: number;
  readonly procedimento: number;
  readonly especialidade: number;
  readonly anestesia: number;
  /** Colunas dos pares (código e ID) e do pediatra, como lidas. */
  readonly pares: Readonly<Record<string, number | null>>;
  /** Recursos da sala pedidos (códigos de RECURSOS_SALA). */
  readonly recursos: readonly string[];
  readonly observacao: string;
  readonly usuario: string;
}

export interface AvaliacaoRecuperacao {
  readonly id: number;
  readonly agendamento: number;
  readonly sala: number;
  readonly momento: MomentoSrpa;
  readonly em: string;
  readonly aldrete: {
    readonly atividade: number;
    readonly respiracao: number;
    readonly circulacao: number;
    readonly consciencia: number;
    readonly saturacao: number;
  };
  readonly total: number;
  readonly dor: number;
  readonly nvpo: number;
  readonly destino: DestinoAltaSrpa | null;
  readonly regraVersao: number | null;
  readonly profissional: number | null;
  readonly usuario: string;
}

export interface ChecklistDaCirurgia {
  readonly id: number;
  readonly agendamento: number;
  readonly sala: number;
  readonly dataHora: string;
  readonly reg: number;
  readonly paciente: number | null;
  readonly cirurgia: number | null;
  readonly registroProntuario: number | null;
  readonly lista: number;
  readonly versao: number;
  readonly situacao: 'aberto' | 'concluido' | 'dispensado' | 'interrompido';
  readonly inducaoEm: string | null;
  readonly inducaoPor: string | null;
  readonly timeoutEm: string | null;
  readonly timeoutPor: string | null;
  readonly saidaEm: string | null;
  readonly saidaPor: string | null;
  readonly excecaoEm: string | null;
  readonly excecaoPor: string | null;
  readonly excecaoMotivo: string | null;
  readonly confirmacoes: readonly ConfirmacaoDoItem[];
}

export interface DominiosFicha {
  readonly tiposAnestesia: readonly ItemDominioAnestesia[];
  readonly posicoes: readonly ItemDominioAnestesia[];
  readonly modosRespiratorios: readonly ItemDominioAnestesia[];
  readonly funcoesEquipe: readonly ItemDominioAnestesia[];
  readonly tiposSinal: readonly ItemDominioAnestesia[];
  readonly utilizacoes: readonly ItemDominioAnestesia[];
}

export interface PedidoCirurgia {
  readonly id: number;
  /** Versão lida do agendamento (trava otimista da mudança de estado); null na memória. */
  readonly versao?: number | null;
  readonly agendamento: number | null;
  readonly sala: number;
  readonly inicio: string;
  readonly duracaoMin: number;
  readonly intervaloMin: number;
  readonly reg: number;
  readonly prontuario: number;
  readonly idPaciente: number | null;
  readonly procedimento: number;
  readonly convenio: number;
  readonly cirurgiao: number | null;
  readonly carater: number | null;
  readonly anestesia: number | null;
  readonly estado: string;
  readonly motivo: string | null;
  readonly complemento: string | null;
  readonly solicitante: string | null;
  readonly observacao: string | null;
  readonly criadoPor: string;
  readonly atualizadoEm: string | null;
  readonly pendenciasAbertas: number;
  readonly excecao: boolean;
  /** M50 (etapa 3): o pedido feito pelo médico externo no portal (a conta e o paciente como ele informou). */
  readonly portal: { acesso: number; paciente: string; nascimento: string | null } | null;
}

export interface FichaAnestesica {
  readonly id: number;
  readonly agendamento: number;
  readonly sala: number;
  readonly dataHora: string;
  readonly reg: number;
  readonly paciente: number | null;
  readonly situacao: SituacaoFicha;
  readonly versao: number;
  readonly abertura: number;
  readonly abertaEm: string;
  readonly marcos: Partial<Record<MarcoFicha, string>>;
  readonly assinadaPor: number | null;
  readonly assinadaUsuario: string | null;
  readonly assinadaEm: string | null;
  readonly hash: string | null;
  readonly registroProntuario: number | null;
  readonly lancamentos: readonly LancamentoDaFicha[];
  readonly passagens: readonly PassagemDeResponsabilidade[];
  readonly lacunas: readonly LacunaJustificada[];
  readonly adendos: readonly AdendoDaFicha[];
  readonly truncado: boolean;
}

/** Filtro das cirurgias realizadas: período pela data do ato, atendimento (REG) e sala; tudo opcional. */
export interface FiltroRealizadas {
  readonly de: string | null;
  readonly ate: string | null;
  readonly reg?: number | null;
  readonly sala?: number | null;
}

export interface MovimentoDoBloco {
  readonly id: number;
  readonly agendamento: number;
  readonly sala: number;
  readonly dataHora: string;
  readonly reg: number;
  readonly paciente: number | null;
  readonly sequencia: number;
  readonly tipo: TipoMovimentoBloco;
  readonly local: number | null;
  readonly localAnterior: number | null;
  readonly salaCirurgica: number | null;
  readonly em: string;
  readonly destino: DestinoSaidaBloco | null;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface AberturaChecklist extends CirurgiaDoBloco {
  readonly lista: number;
  readonly usuario: string;
}

export interface AberturaFicha extends CirurgiaDaAnestesia {
  /** O anestesista que abre a ficha (o primeiro responsável; id do profissional). */
  readonly abertura: number;
  readonly abertaEm: string;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface AvaliacaoPreAnestesica {
  readonly id: number;
  readonly agendamento: number;
  readonly versao: number;
  readonly avaliadoEm: string;
  readonly profissional: number;
  readonly asa: number;
  readonly emergencia: boolean;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly viaAerea: Record<string, unknown>;
  readonly jejum: Record<string, string | null>;
  readonly criteriosLee: string[];
  readonly leePontos: number;
  readonly alergiasConferidas: boolean;
  readonly comorbidades: string | null;
  readonly medicacoes: string | null;
  readonly exames: string | null;
  readonly anestesiasAnteriores: string | null;
  readonly plano: Record<string, unknown>;
  readonly tipoAnestesia: number;
  readonly conclusao: string;
  readonly ressalvas: string | null;
  readonly registroProntuario: number | null;
  readonly usuario: string;
  readonly criadoEm: string;
}

export interface RegistroApa extends CirurgiaDaAnestesia {
  /** A versão que a tela viu (0: nenhuma); outra versão gravada no meio recusa (`apa-mudou`). */
  readonly versaoVista: number;
  readonly avaliadoEm: string;
  readonly profissional: number;
  readonly asa: number;
  readonly emergencia: boolean;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly viaAerea: unknown;
  readonly jejum: unknown;
  readonly criteriosLee: readonly string[];
  readonly leePontos: number;
  readonly alergiasConferidas: boolean;
  readonly comorbidades: string | null;
  readonly medicacoes: string | null;
  readonly exames: string | null;
  readonly anestesiasAnteriores: string | null;
  readonly plano: unknown;
  readonly tipoAnestesia: number;
  readonly conclusao: string;
  readonly ressalvas: string | null;
  /** As pendências do agendamento (M18) que esta APA resolve (o domínio calculou). */
  readonly pendencias: readonly string[];
  /** Revisão do M46.1: as que esta versão reabre (gravadas como pendente; a versão vigente manda). */
  readonly pendenciasAbertas?: readonly string[];
  readonly usuario: string;
  readonly chave: string | null;
}

export interface RegistroSrpa extends CirurgiaDaAnestesia {
  readonly cirurgia: number | null;
  readonly momento: MomentoSrpa;
  readonly em: string;
  readonly aldrete: {
    readonly atividade: number;
    readonly respiracao: number;
    readonly circulacao: number;
    readonly consciencia: number;
    readonly saturacao: number;
  };
  readonly dor: number;
  readonly nvpo: number;
  readonly pas: number | null;
  readonly pad: number | null;
  readonly fc: number | null;
  readonly spo2: number | null;
  readonly temperatura: number | null;
  readonly observacao: string | null;
  readonly destino: DestinoAltaSrpa | null;
  readonly motivoDestino: string | null;
  readonly regraVersao: number | null;
  /** A última avaliação que a tela viu (0: nenhuma): outra gravada no meio recusa (`srpa-mudou`). */
  readonly ultimaVista: number;
  readonly profissional: number | null;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface CancelamentoDaAgenda {
  readonly id: number;
  readonly sala: number;
  readonly inicio: string;
  readonly paciente: string;
  readonly procedimento: number;
  readonly atualizadoEm: string;
  readonly usuario: string;
}

export interface CodigoDoPainel {
  readonly agendamento: number;
  readonly dia: string;
  readonly codigo: string;
  readonly validoAte: string;
}

export interface ConfirmacaoChecklist {
  readonly checklist: number;
  readonly versaoVista: number;
  readonly momento: MomentoChecklist;
  readonly em: string;
  readonly itens: readonly {
    readonly item: string;
    readonly resposta: RespostaChecklist;
    readonly observacao: string | null;
  }[];
  readonly profissional: number | null;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface DominiosRastreio {
  readonly locais: readonly ItemDominioBloco[];
  readonly tipos: readonly ItemDominioBloco[];
}

export interface HistoricoDaAgenda {
  readonly quando: string;
  readonly usuario: string;
  readonly operacao: string;
  readonly salaAnterior: number | null;
  readonly inicioAnterior: string | null;
  readonly sala: number | null;
  readonly inicio: string | null;
  readonly justificativa: string | null;
}

export interface LigacaoDoAto {
  readonly realizada: number;
  readonly agendamento: number | null;
  readonly origem: 'registro' | 'revisao';
}

export interface LoteFicha {
  readonly ficha: number;
  readonly lancamentos: readonly LancamentoFicha[];
  /** Quem lançou (id do profissional; null = sem vínculo de profissional, ex.: o circulante sem CBO). */
  readonly profissional: number | null;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface PendenciaDoPedido {
  readonly id: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly atualizadoPor: string | null;
  readonly atualizadoEm: string | null;
}

export interface AtoRealizado {
  readonly id: number;
  readonly reg: number;
  readonly data: string;
  readonly sala: number;
  readonly porte: string;
  readonly potencialContaminacao: string;
  readonly tipoAnestesia: number;
  readonly inicio: string;
  readonly fim: string;
  readonly duracao: string;
  readonly paciente: string;
  readonly procedimentos: ProcedimentoRealizado[];
}

export interface RegistroComplementarAto {
  readonly realizada: number;
  readonly entradaSala: string | null;
  readonly incisao: string | null;
  readonly saidaSala: string | null;
  readonly asa: number | null;
  readonly observacao: string | null;
}

export interface RelogioDoEstabelecimento {
  readonly hoje: string;
  readonly hhmm: string;
}

export interface SalaDoBloco {
  readonly codigo: number;
  readonly nome: string;
  readonly centroCusto: number;
  readonly usuarios: number;
  /** O login é usuário permitido da sala. */
  readonly permitida: boolean;
}

/** Uma versão anterior do pedido, como estava antes da alteração que a substituiu. */
export interface VersaoDoPedido {
  readonly idEstado: number;
  readonly versao: number;
  readonly sala: number;
  readonly inicio: string;
  readonly duracaoMin: number;
  readonly procedimento: number;
  readonly convenio: number;
  readonly observacao: string | null;
  readonly paciente: string | null;
  readonly motivo: string;
  readonly substituidaEm: string;
}

/** O pedido como fica depois da alteração (os mesmos campos do pedido pelo portal). */
export interface AlteracaoPedidoDoPortal {
  readonly id: number;
  readonly acesso: number;
  /** A versão que o médico viu (a vigente é 1 + as versões guardadas). */
  readonly versao: number;
  readonly sala: number;
  readonly data: string;
  readonly hora: string;
  readonly duracaoMin: number;
  readonly procedimento: number;
  readonly convenio: number;
  readonly cirurgiao: number | null;
  readonly carater: number;
  readonly anestesia: number;
  readonly observacao: string | null;
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly motivo: string;
  readonly usuario: string;
}

/** Linha do histórico da agenda num período: a mesma do agendamento, com o paciente e o atendimento. */
export interface HistoricoDaAgendaNoPeriodo extends HistoricoDaAgenda {
  readonly paciente: string;
  readonly reg: number | null;
}

export interface LancamentoDaFicha {
  readonly id: number;
  readonly parte: ParteFicha;
  readonly momento: string;
  readonly fim: string | null;
  /** Os campos da parte, no vocabulário do novo (tipo/valor do sinal, item/dose do fármaco…). */
  readonly dados: Readonly<Record<string, string | number | null>>;
  readonly profissional: number | null;
  readonly usuario: string;
  readonly registradoEm: string;
  /** Fluido e perda: o lançamento do balanço hídrico (null = fora do balanço). */
  readonly balanco: { readonly id: number; readonly em: string } | null;
}

export interface OpcoesDaCirurgia {
  readonly anestesias: { codigo: number; nome: string }[];
  readonly caracteres: { codigo: number; nome: string }[];
  readonly convenios: { codigo: number; nome: string; ativo: boolean }[];
  readonly especialidades: { codigo: number; nome: string }[];
}

export interface ProfissionalDoBloco {
  readonly id: number;
  readonly cod: number;
  readonly nome: string;
  /**
   * Revisão do M46.1 (regra 3 da ficha anestésica): o registro é de médico (conselho CRM ou CBO da família 225). Só a
   * leitura por registro (`profissionaisPorRegistro`) o preenche; as listas do mapa não o trazem.
   */
  readonly medico?: boolean;
}

export interface UsuarioDaSala {
  readonly login: string;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface ExameRecente {
  readonly id: number;
  readonly exame: string;
  readonly data: string | null;
  readonly liberado: boolean;
}

export interface ConfirmacaoDoItem {
  readonly id: number;
  readonly momento: MomentoChecklist;
  readonly item: string;
  readonly resposta: RespostaChecklist;
  readonly observacao: string | null;
  readonly em: string;
  readonly usuario: string;
  readonly profissional: number | null;
}

export interface ItemDominioAnestesia {
  readonly id: number;
  readonly rotulo: string;
  readonly sigla: string | null;
  readonly ativo: boolean;
}

export interface AdendoDaFicha {
  readonly id: number;
  readonly texto: string;
  readonly profissional: number;
  readonly usuario: string;
  readonly em: string;
}

export interface LacunaJustificada {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly motivo: string;
  readonly usuario: string;
}

export interface PassagemDeResponsabilidade {
  readonly id: number;
  readonly momento: string;
  readonly de: number;
  readonly para: number;
  readonly resumo: string;
  readonly usuario: string;
}

/** A chave natural da cirurgia (o agendamento pode sumir pelo cancelamento no outro sistema). */
export interface CirurgiaDoBloco {
  readonly agendamento: number;
  readonly sala: number;
  /** "AAAA-MM-DDTHH:mm" (o início previsto do agendamento). */
  readonly dataHora: string;
  readonly reg: number;
  readonly paciente: number | null;
}

/** A chave natural da cirurgia (o agendamento pode sumir pelo cancelamento no outro sistema). */
export interface CirurgiaDaAnestesia {
  readonly agendamento: number;
  readonly sala: number;
  /** "AAAA-MM-DDTHH:mm" (o início previsto do agendamento). */
  readonly dataHora: string;
  readonly reg: number;
  readonly paciente: number | null;
}

export interface ItemDominioBloco {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface ProcedimentoRealizado {
  readonly procedimento: number;
  readonly especialidade: number;
  readonly tecnica: number;
  readonly pares: Readonly<Record<string, number | null>>;
}

export type LancamentoFicha =
  | { readonly parte: 'sinal'; readonly momento: string; readonly tipo: string; readonly valor: number }
  | {
      readonly parte: 'medicamento';
      readonly momento: string;
      readonly fim: string | null;
      readonly item: number;
      readonly descricao: string | null;
      readonly dose: number;
      readonly unidade: string;
      readonly via: string;
      readonly continua: boolean;
      readonly observacao: string | null;
    }
  | {
      readonly parte: 'gas';
      readonly momento: string;
      readonly fim: string | null;
      readonly gas: string;
      readonly valor: number;
    }
  | {
      readonly parte: 'fluido';
      readonly momento: string;
      readonly fim: string | null;
      readonly fluido: string;
      readonly item: number | null;
      readonly volumeMl: number;
      readonly observacao: string | null;
      /** O de-para para o balanço do M45 (o grupo do ganho); null = não vai ao balanço. */
      readonly balanco: BalancoDoLancamento | null;
    }
  | {
      readonly parte: 'perda';
      readonly momento: string;
      readonly perda: string;
      readonly volumeMl: number;
      readonly observacao: string | null;
      /** O de-para para o balanço do M45 (o tipo de eliminação); null = não vai ao balanço. */
      readonly balanco: BalancoDoLancamento | null;
    }
  | {
      readonly parte: 'evento';
      readonly momento: string;
      readonly fim: string | null;
      readonly evento: string;
      readonly descricao: string | null;
    }
  | {
      readonly parte: 'modoRespiratorio';
      readonly momento: string;
      readonly modo: number;
      readonly observacao: string | null;
    }
  | {
      readonly parte: 'posicao';
      readonly momento: string;
      readonly posicao: number;
      readonly observacao: string | null;
    }
  | {
      readonly parte: 'equipe';
      readonly momento: string;
      readonly profissional: number;
      readonly cod: number;
      readonly funcao: number;
    }
  | {
      readonly parte: 'procedimento';
      readonly momento: string;
      readonly fim: string | null;
      readonly codigo: number | null;
      readonly descricao: string;
      readonly observacao: string | null;
    }
  | {
      readonly parte: 'exame';
      readonly momento: string;
      readonly exame: string;
      readonly resultado: string | null;
    }
  | {
      readonly parte: 'avulso';
      readonly momento: string;
      readonly descricao: string;
      readonly quantidade: number | null;
    }
  | {
      readonly parte: 'bi';
      readonly momento: string;
      readonly fim: string | null;
      readonly item: number;
      readonly descricao: string | null;
      readonly vazao: number;
      readonly unidade: string;
      readonly observacao: string | null;
    };

export interface MovimentoNoBloco extends CirurgiaDoBloco {
  /** A última sequência que a tela viu (0: nenhuma); outro movimento no meio recusa (`rastreio-mudou`). */
  readonly ultimoVisto: number;
  readonly tipo: TipoMovimentoBloco;
  readonly local: number | null;
  readonly localAnterior: number | null;
  readonly salaCirurgica: number | null;
  readonly em: string;
  readonly destino: DestinoSaidaBloco | null;
  readonly observacao: string | null;
  /** O estado do agendamento (M18) a marcar, quando a transição é permitida (o domínio decidiu). */
  readonly estadoAgendamento: { readonly id: number; readonly estado: EstadoAgendamento } | null;
  /** O código do painel a criar (na entrada ou no retorno; null: já existe no dia ou não cabe). */
  readonly codigo: {
    readonly dia: string;
    readonly sortear: () => string;
    readonly validoAte: string;
  } | null;
  readonly usuario: string;
  readonly chave: string | null;
}

/** Fluido e perda: o lançamento do balanço hídrico ligado ao lançamento da ficha. */
export interface BalancoDoLancamento {
  readonly paciente: number;
  readonly atendimento: number;
  /** Grupo do ganho ou tipo da perda no balanço hídrico. */
  readonly grupo: number | null;
  readonly tipoEliminacao: number | null;
  readonly descricao: string;
  /** O início da janela de 24 horas do balanço que contém o momento (hora de corte do estabelecimento). */
  readonly janelaInicio: string;
}
