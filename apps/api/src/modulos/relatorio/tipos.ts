// Tipos de negócio do catálogo e da gestão dos relatórios (M34), comuns à porta própria (MariaDB) e à memória de
// dev/ci. Vocabulário neutro: booleano, data, id e número de negócio; o relatório é o código do catálogo do produto.
// Melhoria: o histórico de cada pedido e envio é a própria trilha de auditoria da operação (um lugar só, só inclusão).

/** Valor de uma célula do relatório. */
export type ValorRelatorio = string | number | null;
/** Uma linha do relatório: coluna do catálogo → valor. */
export type LinhaRelatorio = Record<string, ValorRelatorio>;
/** Os valores dos parâmetros já validados pelo esquema do relatório. */
export type ValoresDoRelatorio = Readonly<Record<string, string | number>>;

export type MotivoErroRelatorio = 'tempo' | 'teto' | 'consulta' | 'desconhecido';

/** Relatório não emitido: passou do tempo, do teto de linhas ou não tem consulta. */
export class ErroRelatorio extends Error {
  override readonly name = 'ErroRelatorio';
  readonly motivo: MotivoErroRelatorio;
  constructor(motivo: MotivoErroRelatorio, mensagem: string) {
    super(mensagem);
    this.motivo = motivo;
  }
}

/** O acesso herdado dos relatórios que este substitui (a triagem liga cada um ao do catálogo). */
export interface AcessoDeOrigem {
  /** Quantos relatórios de origem a triagem liga a este relatório do catálogo. */
  readonly relatorios: number;
  /** Todos os de origem eram restritos. */
  readonly restrito: boolean;
  /** A sessão tem a permissão do relatório (usuário ou perfil). */
  readonly permitido: boolean;
}

/** Um relatório do sistema de origem a triar (metadado: nome, módulo, parâmetros, acesso restrito). */
export interface RelatorioDeOrigem {
  readonly id: number;
  readonly nome: string;
  readonly modulo: number;
  readonly tipo: number;
  readonly opcao: number | null;
  readonly parametros: number;
  readonly acessoRestrito: boolean;
}

/** A proposta de destino de um relatório de origem (regra da triagem do domínio). */
export interface PropostaTriagem {
  readonly id: number;
  readonly nome: string;
  readonly modulo: number;
  readonly destino: string;
  readonly marco: string | null;
  readonly artefato: string;
  readonly papelDono: string;
  readonly onda: number | null;
  readonly regra: string;
  readonly motivo: string;
}

export interface FiltroTriagem {
  readonly destino?: string;
  readonly situacao?: string;
  readonly marco?: string;
  readonly termo?: string;
  readonly pagina: number;
  readonly tamanho: number;
}

/** Um item da triagem (destino nulo: ainda não decidido). */
export interface ItemTriagem {
  readonly id: number;
  readonly nome: string;
  readonly modulo: number | null;
  readonly destino: string | null;
  readonly marco: string | null;
  readonly artefato: string;
  readonly papelDono: string;
  readonly onda: number | null;
  readonly situacao: string;
  readonly regra: string | null;
  readonly motivo: string | null;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  /** Quem da área aceitou o destino e quando (nulo enquanto proposta). */
  readonly aceitoPor?: string | null;
  readonly aceitoEm?: string | null;
  readonly parametros: number;
  readonly acessoRestrito: boolean;
}

export interface ResumoTriagem {
  readonly total: number;
  readonly semDestino: number;
  readonly semDono: number;
  readonly confirmadas: number;
  readonly porDestino: Record<string, number>;
  readonly porMarco: Record<string, number>;
}

/** A decisão da área sobre um item da triagem. */
export interface DecisaoTriagem {
  readonly destino: string;
  readonly marco: string | null;
  readonly artefato: string;
  readonly papelDono: string;
  readonly onda: number | null;
  readonly motivo: string;
}

/** Os dados de um envio agendado (hora do dia em "HH:MM", de 00:00 a 23:59). */
export interface DadosAgendamento {
  readonly relatorio: string;
  readonly titulo: string;
  readonly parametros: Readonly<Record<string, string | number>>;
  /** Listas de distribuição de e-mail (código). */
  readonly grupos: readonly string[];
  readonly enderecos: readonly string[];
  readonly periodicidade: string;
  readonly hora: string;
  readonly diaSemana: number | null;
  readonly diaMes: number | null;
}

export interface AgendamentoRelatorio extends DadosAgendamento {
  readonly id: string;
  readonly ativo: boolean;
  readonly dono: string;
  readonly proximoEnvio: Date | null;
  readonly ultimoEnvio: Date | null;
  readonly ultimaSituacao: 'enviado' | 'falhou' | null;
  readonly ultimaFalha: string | null;
  readonly falhasSeguidas: number;
  /** A versão da linha (trava otimista): a tela devolve a que leu. */
  readonly versao?: number;
}

/** Uma execução, exportação ou envio a registrar (só o resumo SHA-256 dos parâmetros vai ao banco). */
export interface NovaExecucao {
  readonly relatorio: string;
  readonly tipo: 'execucao' | 'exportacao' | 'envio';
  readonly formato: 'grade' | 'pdf' | 'xlsx' | 'csv' | 'link';
  readonly usuario: string;
  /** Texto canônico dos parâmetros. */
  readonly parametros: string;
  readonly linhas: number;
  readonly duracaoMs: number;
  readonly dadoPessoal: boolean;
  readonly mascarado: boolean;
  readonly justificativa: string | null;
  readonly situacao: 'ok' | 'cancelada' | 'recusada' | 'falhou';
  readonly agendamento: string | null;
}

export interface ExecucaoRelatorio {
  readonly id: string;
  readonly relatorio: string;
  readonly tipo: 'execucao' | 'exportacao' | 'envio';
  readonly formato: string;
  readonly usuario: string;
  readonly linhas: number;
  readonly duracaoMs: number;
  readonly dadoPessoal: boolean;
  readonly mascarado: boolean;
  readonly temJustificativa: boolean;
  readonly situacao: 'ok' | 'cancelada' | 'recusada' | 'falhou';
  readonly criadoEm: Date;
}

/** Os dados de um pedido de relatório novo. */
export interface DadosPedido {
  readonly titulo: string;
  readonly descricao: string;
  readonly finalidade: string;
  readonly area: string;
  /** Data ISO (AAAA-MM-DD). */
  readonly prazo: string;
}

export interface PedidoRelatorio extends DadosPedido {
  readonly id: string;
  readonly solicitante: string;
  readonly situacao: string;
  readonly relatorio: string | null;
  readonly resposta: string | null;
  readonly respondidoPor: string | null;
  readonly respondidoEm: Date | null;
  readonly criadoEm: Date;
  readonly canceladoEm: Date | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
  /** A versão da linha (trava otimista): a tela devolve a que leu. */
  readonly versao?: number;
}

export type AlvoEventoRelatorio = 'pedido' | 'agendamento';
export type EventoRelatorio = 'alteracao' | 'cancelamento' | 'exclusao' | 'ativacao' | 'desativacao';

/** Um evento do ciclo do pedido ou do envio (quem, quando, o motivo e a linha anterior em JSON). */
export interface RegistroEventoRelatorio {
  readonly evento: EventoRelatorio;
  readonly motivo: string;
  readonly por: string;
  readonly em: Date;
  readonly antes: string | null;
}

export type AlvoDependenciaRelatorio = 'pedido' | 'agendamento';

/** O que impede a exclusão física (fk: linha de outra tabela; logica: desdobramento do próprio registro). */
export interface VinculoRelatorio {
  readonly grupo: string;
  readonly quantidade: number;
  readonly origem: 'fk' | 'logica';
}
