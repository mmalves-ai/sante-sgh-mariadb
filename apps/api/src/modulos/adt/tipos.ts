// Tipos de negócio da internação, dos leitos, da higienização, do SAME e do NIR (M21 e M44), lidos e gravados pelas
// portas do módulo (a própria sobre o banco do cliente e a de memória de dev/ci). Vocabulário neutro: internação pelo
// número que a recepção vê, leito pela chave natural do mapa (bloco + acomodação + leito), datas ISO, booleanos e ids;
// nenhum nome de tabela ou coluna aqui.
// Melhoria: os tipos deixam de vir do pacote de acesso ao sistema de origem e passam a ser do módulo, sem sufixo de
// origem; a situação equivalente vira `situacaoCodigo`.
import type {
  AcaoSolicitacaoNir,
  ChaveLeito,
  EtapaLimpeza,
  EstadoSolicitacaoNir,
  InternacaoResumo,
  OrigemSolicitacaoNir,
  PerfilLeito,
  Precaucao,
  PrioridadeNir,
  SituacaoReserva,
  TipoBarreiraAlta,
} from '@sgh/contratos';

/** Detalhe da internação: o resumo, os trechos de leito, as guias, as trocas, as contas e o histórico do paciente. */
export interface DetalheInternacao {
  readonly resumo: InternacaoResumo;
  readonly cabecalho: string;
  readonly procedimento: number;
  readonly cid: string | null;
  readonly medicoSolicitante: string;
  readonly acomodacaoPlano: string;
  readonly matricula: string;
  readonly validadeCarteira: string | null;
  readonly carater: string;
  readonly motivo: number | null;
  readonly motivoNome: string;
  readonly permanen: number;
  readonly vinculoAssistente: number;
  readonly trechos: {
    leito: { bloco: string; acomodacao: string; leito: string };
    tipo: { codigo: number; nome: string };
    entrada: string;
    horaEntrada: string;
    saida: string | null;
    horaSaida: string | null;
  }[];
  readonly guias: {
    conta: number;
    guia: string;
    inicio: string;
    fim: string | null;
    validadeDias: number;
    temSenha: boolean;
  }[];
  readonly trocas: {
    tipo: 'convenio' | 'clinica' | 'especialidade' | 'medico';
    data: string;
    hora: string;
    de: string;
    para: string;
    usuario: string;
  }[];
  readonly contas: { conta: number; inicio: string; fim: string | null; tipo: string; guias: number }[];
  readonly procedimentosExtras: {
    conta: number;
    procedimento: number;
    sequencia: number;
    convenio: number | null;
    apac: boolean;
    dataApac: string | null;
    especialidade: number | null;
  }[];
  readonly historicoPaciente: { reg: number; entrada: string; alta: string | null; motivo: number | null }[];
}

/** Os estados próprios dos leitos (bloqueio, precaução, extra, higienização), as limpezas, os atributos e as reservas. */
export interface EstadosDoMapa {
  readonly estados: {
    chave: string;
    estado: 'bloqueio' | 'precaucao' | 'extra' | 'higienizacao';
    motivo: string | null;
    precaucao: string | null;
    previsaoFim: string | null;
    desde: string;
    solicitacao: number | null;
    conflitoReg: number | null;
    conflitoEm: string | null;
    /** A observação do estado ("OS <número>" liga o bloqueio por manutenção à OS). */
    observacao?: string | null;
  }[];
  readonly limpezas: { chave: string; solicitacao: number; etapa: string; prazo: string | null }[];
  readonly atributos: {
    chave: string;
    sexo: string | null;
    idadeMinima: number | null;
    idadeMaxima: number | null;
    criticidade: number | null;
  }[];
  /** As reservas vigentes do NIR (uma por leito), com o conflito quando outra internação ocupou o leito. */
  readonly reservas?: {
    chave: string;
    id: number;
    solicitacao: number;
    validaAte: string;
    confirmada: boolean;
    conflitoEm: string | null;
  }[];
}

export interface ItemIncoerencia {
  readonly reg: number;
  readonly prontuario: number;
  readonly entrada: string;
  readonly horaEntrada: string;
  readonly alta: string | null;
  readonly horaSaida: string | null;
}

/** Solicitação de limpeza na fila da higienização. */
export interface SolicitacaoLimpezaFila {
  readonly solicitacao: number;
  readonly leito: { bloco: string; acomodacao: string; leito: string };
  /** Situação da execução (1 pedida pela alta, 2 em fila, 3 em higienização, 4 liberada). */
  readonly situacaoCodigo: number;
  readonly solicitadaEm: string;
  readonly atendimento: string | null;
  /** Pedida por outro canal (a alta registrada fora da tela), ainda sem etapa: entra pela janela de horas. */
  readonly doOutroSistema?: boolean;
}

export interface LimpezaGiro {
  readonly solicitacao: number;
  readonly solicitadaEm: string;
  readonly area: string;
  readonly etapas: readonly {
    etapa: EtapaLimpeza;
    em: string;
    prazo: string | null;
    tipoLimpeza: number | null;
    profissional: number | null;
  }[];
}

// ── NIR ───────────────────────────────────────────────────────────────────────────────────────────

export interface RegistroRegulacaoNir {
  readonly id: number;
  readonly solicitacao: number;
  readonly central: string;
  readonly sentido: 'entrada' | 'saida';
  readonly numero: string;
  readonly situacao: string;
  readonly origem: 'manual' | 'conector';
  readonly observacao: string | null;
  readonly anterior: number | null;
  readonly mensagemHash: string | null;
  readonly por: string;
  readonly em: string;
}

export interface NovaRegulacao {
  readonly solicitacao: number;
  readonly central: string;
  readonly sentido: 'entrada' | 'saida';
  readonly numero: string;
  readonly situacao: string;
  readonly origem: 'manual' | 'conector';
  readonly observacao: string | null;
  /** A vigente vista (null: a primeira da solicitação). */
  readonly anterior: number | null;
  /** SHA-256 da mensagem trocada com a central (só no conector). */
  readonly mensagemHash: string | null;
  readonly por: string;
  /** Com o conector ligado: o evento da outbox na mesma transação (o pedido à central). */
  readonly outbox: { rede: string; tipo: string } | null;
}

export interface ReservaLeitoNir {
  readonly id: number;
  readonly solicitacao: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  readonly situacao: SituacaoReserva;
  readonly validaAte: string;
  readonly excecao: string | null;
  readonly criadaPor: string;
  readonly criadaEm: string;
  readonly confirmadaEm: string | null;
  readonly encerradaEm: string | null;
  readonly motivoEncerramento: string | null;
  readonly conflitoEm: string | null;
  readonly conflitoReg: number | null;
}

export interface SolicitacaoLeitoNir {
  readonly id: number;
  readonly origem: OrigemSolicitacaoNir;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly nome: string;
  readonly sexo: string | null;
  readonly nascimento: string | null;
  readonly atendimento: number | null;
  readonly cabecalho: string | null;
  readonly internacao: number | null;
  readonly cirurgia: number | null;
  readonly prioridade: PrioridadeNir;
  readonly prazoEm: string;
  readonly intensiva: boolean;
  readonly precaucao: Precaucao | null;
  readonly tiposAcomodacao: number[];
  readonly clinica: string;
  readonly especialidade: number | null;
  readonly cid: number | null;
  readonly justificativa: string;
  readonly estado: EstadoSolicitacaoNir;
  readonly versao: number;
  readonly vinculo: number;
  readonly solicitadoPor: string;
  readonly solicitadoEm: string;
  readonly regGerado: number | null;
  readonly concluidoEm: string | null;
  /** Os recursos pedidos e a observação do NIR (corrigíveis com motivo). */
  readonly recursos?: readonly string[];
  readonly observacao?: string | null;
}

export interface BarreiraDaAlta {
  readonly id: number;
  readonly reg: number;
  readonly tipo: TipoBarreiraAlta;
  readonly descricao: string;
  readonly responsavel: string;
  readonly prazo: string;
  readonly situacao: 'aberta' | 'resolvida' | 'cancelada';
  readonly criadaPor: string;
  readonly criadaEm: string;
  readonly resolvidaEm: string | null;
}

export interface AltaPrevistaRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly data: string;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
  /** A versão que retirou a alta prevista (a internação fica sem data prevista). */
  readonly retirada?: boolean;
}

export interface EventoSolicitacaoNir {
  readonly solicitacao: number;
  readonly acao: string;
  readonly de: string | null;
  readonly para: string;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

export interface HistogramasPermanencia {
  readonly portaria312: { chave: string; dias: number; n: number }[];
  readonly diariasFaturaveis: { chave: string; dias: number; n: number }[];
  readonly uti: { chave: string; dias: number; n: number }[];
  readonly nomes: Map<string, string>;
}

export interface InternadoDoQuadro {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number;
  readonly nome: string;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  readonly clinica: string;
  readonly entrada: string;
  readonly procedimento: string | null;
  readonly cid: string | null;
  readonly trechos: { tipo: number; entrada: string; saida: string | null }[];
}

export interface NovaBarreira {
  readonly reg: number;
  readonly pront: number;
  readonly tipo: TipoBarreiraAlta;
  readonly descricao: string;
  readonly responsavel: string;
  readonly prazo: string;
  readonly usuario: string;
}

export interface NovaAltaPrevista {
  readonly reg: number;
  readonly pront: number;
  readonly data: string;
  readonly anterior: number | null;
  readonly motivo: string | null;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface NovaReserva {
  readonly solicitacao: number;
  readonly leito: ChaveLeito;
  readonly validadeMin: number;
  readonly excecao: string | null;
  readonly usuario: string;
}

export interface NovaSolicitacaoLeito {
  readonly origem: OrigemSolicitacaoNir;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly cabecalho: string | null;
  readonly internacao: number | null;
  readonly cirurgia: number | null;
  readonly prioridade: PrioridadeNir;
  readonly prazoMin: number;
  readonly perfil: PerfilLeito;
  readonly clinica: string;
  readonly especialidade: number | null;
  readonly cid: number | null;
  readonly justificativa: string;
  readonly situacaoCodigo: number | null;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface TransicaoSolicitacao {
  readonly solicitacao: number;
  readonly acao: AcaoSolicitacaoNir;
  readonly de: EstadoSolicitacaoNir;
  readonly para: EstadoSolicitacaoNir;
  /** A nova prioridade (priorizar) e o novo prazo em minutos desde o pedido. */
  readonly prioridade?: PrioridadeNir | null;
  readonly prazoMinDesdeOPedido?: number | null;
  readonly motivo?: string | null;
  readonly situacaoCodigo?: number | null;
  readonly reserva?: number | null;
  readonly reg?: number | null;
  readonly usuario: string;
}

export interface ConfiguracaoRegulacaoNir {
  readonly sistemas: {
    id: number;
    sigla: string;
    ativo: boolean;
    servicos: number;
    servicosAtivos: number;
  }[];
  readonly endpoints: { id: number; servico: number | null; descricao: string; metodo: string | null }[];
  readonly tabelas: {
    id: number;
    descricao: string;
    ativo: boolean;
    referencia: string | null;
    valores: number;
  }[];
}

/** Eventos da solicitação que não criam vínculo (a exclusão por engano continua possível depois deles). */
export const EVENTOS_SEM_DESDOBRAMENTO: readonly string[] = [
  'solicitar',
  'analisar',
  'priorizar',
  'corrigir',
];

export interface DependenciasSolicitacaoNir {
  readonly reservas: number;
  readonly transicoes: number;
  readonly regulacoes: number;
  readonly internacaoGerada: number;
}

/** As dependências da solicitação em frase (a recusa da exclusão diz o que a prende). */
export function frasesDependenciasNir(d: DependenciasSolicitacaoNir): string {
  const partes: string[] = [];
  const p = (q: number, um: string, varios: string) => q > 0 && partes.push(`${q} ${q === 1 ? um : varios}`);
  p(d.reservas, 'reserva de leito vinculada', 'reservas de leito vinculadas');
  p(
    d.transicoes,
    'transição (trânsito, internação, cancelamento ou reserva)',
    'transições (trânsito, internação, cancelamento ou reserva)',
  );
  p(d.regulacoes, 'registro de regulação', 'registros de regulação');
  p(d.internacaoGerada, 'internação ou transferência gerada', 'internações ou transferências geradas');
  return partes.join(', ');
}
