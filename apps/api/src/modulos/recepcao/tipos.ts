// Tipos de negócio da recepção e da classificação de risco (F2.2): o que as portas (própria e memória) devolvem aos
// serviços. Vocabulário neutro (ids numéricos, datas ISO, booleanos); nada de coluna antiga, S/N ou sentinela. Onde a
// tela já tem contrato (@sgh/contratos), o tipo segue o contrato (situação e prioridade da senha são as do contrato,
// traduzidas na porta a partir das colunas do banco).
//
// Datas: "AAAA-MM-DDTHH:mm:ss" na hora civil do estabelecimento (o banco grava em UTC; a porta converte pelo fuso do
// estabelecimento), como o contrato da tela espera.
//
// Identificadores do atendimento na classificação: `cabecalho` (texto) e `reg` (número) são o MESMO id do atendimento
// (atendimento.id). Os dois nomes ficam porque o contrato da tela (ClassificacaoResumo, quadro do PA) os usa.
import type { ResultadoOperacao } from '@sgh/nucleo';

/** Contexto da porta: o cliente (rede da sessão) e o estabelecimento (código) ativos. */
export interface ContextoRecepcao {
  readonly rede: string;
  readonly hospital: string;
}

/** Contexto de uma gravação (montado pelo apoio a partir da sessão; o totem usa o usuário técnico). */
export interface ContextoGravacao {
  /** Login de quem grava (a porta resolve o id do usuário no banco do cliente). */
  readonly login: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly estacao?: string;
  readonly enderecoIp?: string;
  readonly reautenticadoEm?: number;
}

/** O contexto de gravação de um pedido da tela, com o evento do catálogo e o recurso (vão à trilha da operação). */
export interface GravacaoDaSessao extends ContextoGravacao {
  readonly evento: string;
  readonly recurso: string;
}

/** Contexto da porta com o contexto de gravação do pedido (as gravações da classificação o exigem). */
export type ContextoComGravacao = ContextoRecepcao & { readonly gravacao?: GravacaoDaSessao };

/** Linha de auditoria de uma gravação de configuração (vai à trilha na mesma transação). */
export interface TrilhaGravacao {
  /** Evento do catálogo (EVENTOS_AUDITAVEIS). */
  readonly evento: string;
  readonly recurso: string;
  /** Tabela e id do registro gravado (a tabela real do banco do cliente). */
  readonly tabela: string;
  readonly id: number | null;
  readonly login: string;
  readonly correlacao: string;
  readonly estacao?: string;
  readonly paciente?: number | null;
  readonly motivo?: string | null;
}

export interface GravacaoFeita {
  readonly resultado: ResultadoOperacao;
  readonly repetida: boolean;
  /** Id da linha da trilha (ou null na memória). */
  readonly trilha: number | null;
}

/** Passo 0 do executor sem gravar (a tela esconde a ação com o motivo). */
export interface LiberacaoConsultada {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

// ── Recepção ─────────────────────────────────────────────────────────────────────────────────────

/** Serviço (gerador de senha) da recepção. */
/** Situação da senha (nominal: a do banco e a do contrato da tela, SITUACOES_SENHA). */
export type SituacaoSenha =
  | 'aguardando'
  | 'chamada'
  | 'em_atendimento'
  | 'encaminhada'
  | 'atendida'
  | 'suspensa'
  | 'nao_compareceu'
  | 'cancelada';

/** Tipo do serviço: o que abre atendimento ou o de serviços diversos (sem atendimento). */
export type TipoServico = 'atendimento' | 'diverso';

export interface GeradorRecepcao {
  readonly id: number;
  readonly recepcao: number;
  /** Prefixo da senha (letras antes do número). */
  readonly letra: string;
  readonly nome: string;
  readonly tipo: TipoServico;
  readonly ativo: boolean;
  /** O serviço emite senha prioritária. */
  readonly prioritaria: boolean;
  /** Limite de senhas por dia; null: sem limite. */
  readonly limiteDia: number | null;
  /** Ordem da fila (ORDENS_FILA: prioridade, intercalada, chegada). */
  readonly ordem: string;
  readonly intercalar: number;
  /** Meta de espera da emissão à chamada; null: sem meta (vale a padrão do estabelecimento). */
  readonly tempoAlvoMinutos: number | null;
  readonly rotuloTotem: string | null;
  readonly noTotem: boolean;
}

/** Local de atendimento da recepção (consultório, sala, guichê de serviço). */
export interface LocalRecepcao {
  readonly id: number;
  readonly recepcao: number;
  /** Número de exibição do local (o id). */
  readonly cod: number;
  readonly descricao: string;
  readonly ativo: boolean;
  /** Locais para onde este encaminha. */
  readonly encaminha: number[];
}

export interface Recepcao {
  readonly id: number;
  readonly descricao: string;
  readonly locais: LocalRecepcao[];
  readonly geradores: GeradorRecepcao[];
  /** Números dos guichês cadastrados e ativos. */
  readonly guiches: number[];
}

/** Guichê aberto (ocupação vigente). */
export interface GuicheEmUso {
  readonly recepcao: number;
  readonly local: number;
  readonly guiche: number;
  /** Login de quem ocupa. */
  readonly usuario: string;
}

/** Senha emitida, em vocabulário neutro (os códigos do contrato que não são a situação ficam em codigos-senha.ts). */
export interface SenhaRecepcao {
  readonly id: number;
  readonly numero: number;
  readonly texto: string;
  readonly gerador: number;
  readonly recepcao: number;
  readonly servico: string;
  readonly tipoServico: TipoServico;
  readonly prioritaria: boolean;
  /** Código do grupo de prioridade legal (grupo_prioridade_legal.codigo), ou null. */
  readonly grupo: string | null;
  /** Peso do grupo de prioridade legal (menor chama antes), ou null. */
  readonly pesoGrupo: number | null;
  /** Início do horário da marcação ligada à senha (hora civil do estabelecimento), ou null. */
  readonly horarioMarcacao: string | null;
  readonly situacao: SituacaoSenha;
  /** Número do guichê em que a senha está; null: nenhum. */
  readonly guiche: number | null;
  /** Local de atendimento em que a senha está; null: nenhum. */
  readonly local: number | null;
  /** Login de quem chamou ou emitiu (vazio no totem). */
  readonly usuario: string;
  readonly emitidaEm: string;
  readonly origem: string | null;
  readonly chamadas: number;
  readonly chamadaEm: string | null;
  readonly primeiraChamadaEm: string | null;
  readonly concluidaEm: string | null;
  readonly localChamada: number | null;
  readonly atendida: boolean;
  readonly agendamento: boolean;
  readonly chamadasNoFluxo: number;
  readonly ultimoLocalChamada: number | null;
  readonly ultimoLocal: number | null;
}

/** Agendado do dia (check-in). */
export interface AgendadoRecepcao {
  readonly tipo: 'consulta' | 'exame';
  readonly marcacao: number;
  readonly hora: string;
  readonly agenda: string;
  readonly paciente: string;
  readonly nomeSocial: string | null;
  readonly prontuario: number;
  /** Senha ligada à marcação (chegada registrada), ou null. */
  readonly senha: number | null;
}

export interface PacienteDaSenha {
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly prontuario: number;
}

/** Painel de TV configurado no estabelecimento. */
export interface PainelTv {
  readonly config: number;
  readonly ordem: number;
  readonly nome: string;
}

export interface IndicadoresRecepcao {
  readonly porHora: { hora: number; emitidas: number }[];
  readonly porDia: {
    data: string;
    emitidas: number;
    liberadas: number;
    suspensas: number;
    atendidas: number;
  }[];
  readonly porSituacao: { situacao: string; senhas: number }[];
  readonly prioridade: { prioridade: string; senhas: number }[];
  readonly porServico: { gerador: number; servico: string; senhas: number }[];
  readonly tempos: {
    prioridade: string;
    emitidaEm: string;
    chamadaEm: string | null;
    concluidaEm: string | null;
    recepcao: number;
    guiche: number | null;
  }[];
  readonly naoLocalizado: number;
  readonly total: number;
}

/** Dispositivo do perfil Painel/Totem (o token nunca sai daqui: só o prefixo). */
export interface DispositivoRecepcao {
  readonly id: number;
  /** Código do estabelecimento do dispositivo. */
  readonly hospital: string;
  readonly tipo: string;
  readonly nome: string;
  readonly recepcao: number | null;
  readonly locais: number[];
  readonly geradores: number[];
  readonly conteudo: string | null;
  readonly portalOrdem: number | null;
  /** Login do usuário técnico com que o totem grava (null: painel). */
  readonly usuarioTecnico: string | null;
  readonly voz: boolean;
  readonly criadoEm: string;
  readonly criadoPor: string;
  readonly validoAte: string;
  readonly revogadoEm: string | null;
  readonly ultimoUso: string | null;
  readonly prefixo: string;
  readonly valido: boolean;
  readonly loginSubstituido: string | null;
  readonly conferidoEm: string | null;
  readonly conferidoPor: string | null;
}

export interface NovoDispositivo {
  readonly tipo: 'totem' | 'painel' | 'paineltv';
  readonly nome: string;
  readonly recepcao: number | null;
  readonly locais: readonly number[];
  readonly geradores: readonly number[];
  readonly conteudo: string | null;
  readonly portalOrdem: number | null;
  readonly usuarioTecnico: string | null;
  readonly voz: boolean;
  readonly validadeDias: number;
  readonly usuario: string;
}

/** Configuração da fila de um serviço (gerador). */
export interface ConfiguracaoFila {
  readonly gerador: number;
  readonly recepcao: number;
  readonly ordem: string;
  readonly intercalar: number;
  readonly tempoAlvoMinutos: number;
  readonly rotuloTotem: string | null;
  readonly noTotem: boolean;
  readonly usuario: string;
}

/** Guia do dia aguardando autorização da fonte pagadora (fila da recepção na página inicial). */
export interface GuiaPendente {
  /** Id do atendimento. */
  readonly reg: number;
  readonly paciente: string;
  readonly convenio: string;
  readonly abertoEm: string;
}

// ── Classificação de risco ───────────────────────────────────────────────────────────────────────

export interface SinaisVitais {
  readonly pas: number | null;
  readonly pad: number | null;
  readonly fc: number | null;
  readonly fr: number | null;
  readonly temperatura: number | null;
  readonly saturacao: number | null;
  readonly glicemia: number | null;
  readonly dor: number | null;
  readonly glasgow: number | null;
}

export type MotivoClassificacao = 'inicial' | 'estouro' | 'mudanca_quadro';

/** Situação do formulário clínico da classificação no prontuário. */
export type SituacaoFormularioClassificacao = 'gravado' | 'semPrioridade' | 'desligado';

export interface ClassificacaoRegistrada {
  readonly id: number;
  readonly cabecalho: string;
  readonly reg: number;
  readonly paciente: number;
  readonly versaoProtocolo: number;
  readonly fluxograma: string;
  readonly discriminadores: string[];
  readonly automaticos: string[];
  readonly sinais: SinaisVitais;
  readonly corProposta: string;
  readonly corFinal: string;
  readonly justificativa: string | null;
  readonly motivo: MotivoClassificacao;
  readonly descricaoMudanca: string | null;
  readonly anterior: number | null;
  readonly tempoAlvoMin: number;
  readonly registroE08: number | null;
  readonly e08: SituacaoFormularioClassificacao;
  readonly autor: string;
  /** Hora civil do estabelecimento. */
  readonly em: string;
}

export interface NovaClassificacao {
  readonly cabecalho: string;
  /** Queixa principal informada na classificação. */
  readonly queixa: string;
  readonly reg: number;
  readonly paciente: number;
  readonly versaoProtocolo: number;
  readonly fluxograma: string;
  readonly discriminadores: readonly string[];
  readonly automaticos: readonly string[];
  readonly sinais: SinaisVitais;
  readonly corProposta: string;
  readonly corFinal: string;
  readonly justificativa: string | null;
  readonly motivo: MotivoClassificacao;
  readonly descricaoMudanca: string | null;
  readonly anterior: number | null;
  readonly tempoAlvoMin: number;
  readonly horaSinais: string;
  readonly e08: { situacao: 'gravado' | 'semPrioridade'; registro: number } | { situacao: 'desligado' };
  readonly autor: string;
}

export interface VersaoProtocolo {
  readonly id: number;
  /** Id do protocolo (o mesmo em todas as versões). */
  readonly protocolo: number;
  readonly versao: number;
  readonly tipo: string;
  readonly nome: string;
  readonly notas: string;
  readonly autor: string;
  readonly aprovador: string;
  readonly publicadoEm: string;
  readonly licencaValidaAte: string | null;
  /** SHA-256 do JSON canônico do conteúdo. */
  readonly impressao: string;
}

export interface CorDoProtocolo {
  readonly cor: string;
  readonly nome: string;
  readonly prioridade: number;
  readonly tempoAlvoMin: number;
  readonly opcaoE08: number | null;
}

export interface DiscriminadorDoProtocolo {
  readonly fluxograma: string;
  readonly codigo: string;
  readonly titulo: string;
  readonly cor: string;
  readonly regra: unknown;
  readonly sugereProtocolo: string | null;
}

export interface PublicacaoProtocolo {
  /** Protocolo de que esta é a versão seguinte; null: protocolo novo. */
  readonly protocolo: number | null;
  readonly tipo: string;
  readonly nome: string;
  readonly conteudo: unknown;
  readonly impressao: string;
  readonly notas: string;
  readonly autor: string;
  readonly aprovador: string;
  readonly licenca: { registro: string; titular: string; validaAte: string } | null;
  readonly cores: readonly CorDoProtocolo[];
  readonly discriminadores: readonly DiscriminadorDoProtocolo[];
}

/** Cor de classificação vista nos registros anteriores (só contagem e a cor). */
export interface CorAnterior {
  readonly id: number;
  readonly codigoProtocolo: number;
  readonly classificacao: string;
  readonly corOriginal: string;
  readonly corHex: string | null;
}

/** Opção de prioridade clínica já vista nos formulários (só contagens). */
export interface OpcaoPrioridadeVista {
  readonly indice: number | null;
  readonly idResposta: number;
  readonly texto: string;
  readonly registros: number;
}

export interface VersaoGerenciado {
  readonly id: number;
  readonly tipo: string;
  readonly versao: number;
  readonly nome: string;
  readonly notas: string;
  readonly autor: string;
  readonly aprovador: string;
  readonly publicadoEm: string;
  readonly impressao: string;
  readonly conteudo: unknown;
}

export interface PublicacaoGerenciado {
  readonly tipo: string;
  readonly nome: string;
  readonly conteudo: unknown;
  readonly impressao: string;
  readonly notas: string;
  readonly autor: string;
  readonly aprovador: string;
}

export type OrigemInclusao = 'enfermeiro' | 'medico' | 'sugerido';

export interface EventoProtocoloPaciente {
  readonly id: number;
  readonly tipo: 'meta' | 'checklist' | 'encerramento';
  readonly codigo: string;
  readonly situacao: string;
  readonly quando: string | null;
  readonly prazoEm: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

export interface ProtocoloPaciente {
  readonly id: number;
  readonly cabecalho: string;
  readonly reg: number;
  readonly paciente: number;
  readonly tipo: string;
  readonly gerenciado: number;
  readonly origem: OrigemInclusao;
  readonly sugeridoPor: string | null;
  readonly criterios: string[];
  readonly chegadaEm: string;
  readonly incluidoEm: string;
  readonly incluidoPor: string;
  readonly eventos: EventoProtocoloPaciente[];
}

export interface NovaInclusaoProtocolo {
  readonly cabecalho: string;
  readonly reg: number;
  readonly paciente: number;
  readonly tipo: string;
  readonly gerenciado: number;
  readonly origem: OrigemInclusao;
  readonly sugeridoPor: string | null;
  readonly criterios: readonly string[];
  readonly chegadaEm: string;
  readonly autor: string;
  readonly vinculo: number;
}

export interface NovoEventoProtocolo {
  readonly protocoloPaciente: number;
  readonly tipoEvento: 'meta' | 'checklist' | 'encerramento';
  readonly codigo: string;
  readonly situacao: string;
  readonly ocorridoEm: string | null;
  readonly prazoEm: string | null;
  readonly motivo: string | null;
  readonly por: string;
}

/** Atendimento aberto do pronto atendimento, como a fila da classificação o lê (pela porta do atendimento). */
export interface AtendimentoPa {
  readonly reg: number;
  readonly cabecalho: string;
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly senha: string | null;
  readonly prioridade: '0' | '1' | '2';
  readonly chegada: string;
  readonly profissional: string;
  readonly marcas: { etapa: string; em: string }[];
  readonly leito: string | null;
  readonly observacaoDesde: string | null;
  readonly comMarcas: boolean;
  readonly saida: 'liberado' | 'alta' | null;
  readonly prontuario?: number;
  readonly nomeSocial?: string | null;
}
