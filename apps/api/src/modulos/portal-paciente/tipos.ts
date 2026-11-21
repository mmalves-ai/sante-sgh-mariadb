// Tipos de negócio do portal do paciente (M50): o que a porta lê e grava, em vocabulário neutro (booleano, data ISO,
// id numérico, número de negócio). Substituem os tipos lidos do sistema de origem; nenhum código de origem nem sentinela.
// Melhoria: erros do portal e do pedido do titular com código fechado (união de literais), vindos do próprio módulo.
import { createHash } from 'node:crypto';

export type CodigoErroPortal =
  'email-em-uso' | 'convite-repetido' | 'versao-desatualizada' | 'situacao' | 'nao-encontrado';

/** Recusa da gravação do portal (a API traduz o código para o problema). */
export class ErroPortal extends Error {
  override readonly name = 'ErroPortal';
  readonly codigo: CodigoErroPortal;
  constructor(codigo: CodigoErroPortal, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export type CodigoErroPedido =
  'paciente-inexistente' | 'prontuario-repetido' | 'pedido-inexistente' | 'transicao' | 'conflito-versao';

/** Recusa do pedido do titular (LGPD art. 18). */
export class ErroPedido extends Error {
  override readonly name = 'ErroPedido';
  readonly codigo: CodigoErroPedido;
  constructor(codigo: CodigoErroPedido, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/**
 * O fato que o serviço do portal registra na trilha (evento de negócio). A porta própria o grava na trilha única
 * (trilha_auditoria) junto com a gravação: entidade e id do alvo, o evento no motivo e o resto nos dados.
 * Nunca leva nome, documento ou texto clínico: só códigos e identificadores.
 */
export interface RegistroTrilhaPortal {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly tabelaAlvo: string | null;
  readonly idAlvo: string | null;
  readonly chaveNaturalAlvo: string | null;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
  readonly origem?: string | null;
  readonly idPaciente?: number | null;
  readonly atendimento?: number | null;
  readonly diferenca?: string | null;
}

/** Item de domínio (id e descrição) exibido no portal. */
export interface ItemDominioPortal {
  readonly id: number;
  readonly descricao: string;
}

/** O paciente como o portal o vê (nunca o nome completo). */
export interface PacientePortal {
  readonly id: number;
  readonly prontuario: number;
  readonly nascimento: string | null;
  readonly ativo: boolean;
  readonly obito: boolean;
  /** O id do cadastro que ficou, quando este foi unificado em outro. */
  readonly unificadoEm: number | null;
  /** Primeiro nome, para a saudação e para o responsável reconhecer o representado. */
  readonly primeiroNome: string;
  /** capacidade_civil.id ou null. */
  readonly capacidadeCivil: number | null;
  /** Há responsável legal vigente no cadastro (sem trazer quem). */
  readonly temGuardiao: boolean;
}

export type TipoContaPortal = 'paciente' | 'responsavel';
export type SituacaoContaPortal = 'convidada' | 'ativa' | 'bloqueada' | 'encerrada';
export type SituacaoVinculoPortal = 'pendente' | 'ativo' | 'recusado' | 'encerrado';
export type AtoCopiaPortal = 'solicitacao' | 'legitimidade' | 'geracao' | 'entrega';
export type OrigemTrocaEmailPortal = 'portal' | 'balcao';
export type SituacaoTrocaEmailPortal = 'pendente' | 'confirmada' | 'cancelada';
export type EnvioTrocaEmailPortal = 'simulador' | 'halai';

/** Teto da página da fila de conferência dos vínculos. */
export const TETO_FILA_VINCULOS = 50;

/** O resumo do e-mail de uma conta ainda sem e-mail (único por conta; nunca casa com um e-mail real). */
export const resumoSemEmail = (conta: number): string =>
  createHash('sha256').update(`portal-sem-email:${conta}`).digest('hex');

export interface ContaPortal {
  readonly id: number;
  readonly hospital: string;
  readonly tipo: TipoContaPortal;
  readonly paciente: number | null;
  readonly prontuario: number | null;
  /** Só na conta de responsável sem cadastro (o nome e o nascimento conferidos no balcão). */
  readonly nome: string | null;
  readonly nascimento: string | null;
  readonly situacao: SituacaoContaPortal;
  readonly email: string | null;
  readonly emailResumo: string | null;
  readonly senhaResumo: string | null;
  /** O envelope cifrado do segredo do autenticador (decifrado só no serviço, com a chave mestra). */
  readonly segundoFator: string | null;
  readonly segundoFatorEm: Date | null;
  readonly termosEm: Date | null;
  readonly conviteResumo: string | null;
  readonly conviteValidoAte: Date | null;
  readonly conviteUsadoEm: Date | null;
  readonly conviteErradas: number;
  readonly conviteOrigem: string;
  readonly convidadoPor: string;
  readonly tentativas: number;
  readonly bloqueadoAte: Date | null;
  readonly motivoBloqueio: string | null;
  readonly motivoEncerramento: string | null;
  readonly ativadaEm: Date | null;
  readonly ultimoAcessoEm: Date | null;
  readonly encerradaEm: Date | null;
  readonly criadaEm: Date;
  readonly versao: number;
}

export interface NovaContaPortal {
  readonly rede: string;
  readonly hospital: string;
  readonly tipo: TipoContaPortal;
  readonly paciente: number | null;
  readonly prontuario: number | null;
  readonly nome: string | null;
  readonly nascimento: string | null;
  readonly conviteResumo: string;
  readonly conviteValidoAte: Date;
  readonly origem: string;
  readonly por: string;
}

export interface AtivacaoPortal {
  readonly email: string;
  readonly emailResumo: string;
  readonly senhaResumo: string;
  readonly segundoFator: string;
  readonly termoUso: string;
  readonly politica: string;
}

export interface VinculoPortal {
  readonly id: number;
  readonly hospital: string;
  readonly conta: number;
  readonly titular: number;
  readonly prontuarioTitular: number;
  readonly tipo: string;
  readonly prova: string;
  readonly arquivoChave: string | null;
  readonly arquivoHash: string | null;
  readonly validade: string | null;
  readonly escopos: string[];
  readonly situacao: SituacaoVinculoPortal;
  readonly canal: 'portal' | 'balcao';
  readonly pedidoEm: Date;
  readonly pedidoPor: string;
  readonly decididoPor: string | null;
  readonly decididoEm: Date | null;
  readonly motivoRecusa: string | null;
  readonly motivoFim: string | null;
  readonly encerradoEm: Date | null;
  readonly versao: number;
}

export interface NovoVinculoPortal {
  readonly hospital: string;
  readonly conta: number;
  readonly titular: number;
  readonly prontuarioTitular: number;
  readonly tipo: string;
  readonly prova: string;
  readonly arquivoChave: string | null;
  readonly arquivoHash: string | null;
  readonly validade: string | null;
  readonly escopos: readonly string[];
  readonly canal: 'portal' | 'balcao';
  readonly por: string;
  /** No balcão, quem conferiu o original decide junto (o vínculo nasce `ativo`). */
  readonly decididoPor: string | null;
}

export interface FiltroFilaVinculosPortal {
  /** Uma situação ou todas (null). */
  readonly situacao: SituacaoVinculoPortal | null;
  /** Só os vínculos destes titulares; ausente ou null: todos. */
  readonly titulares?: readonly number[] | null;
  /** O cursor da página seguinte: só os vínculos de id maior que este. */
  readonly depoisDe?: number | null;
}

export interface ConsentimentoPortal {
  readonly id: number;
  readonly finalidade: string;
  readonly versao: string;
  readonly situacao: number;
  readonly signatario: number;
  readonly registradoEm: string;
  readonly revogadoEm: string | null;
  readonly canal: string | null;
}

export interface DocumentoPortal {
  readonly id: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly criadoEm: string;
  readonly usuario: string;
  /** O nível do documento (o maior entre o da emissão e o dos eventos "assinado"). */
  readonly nivelAssinatura: string;
  readonly eventos: string[];
  /** A assinatura ICP-Brasil concluída e o código do verificador público, quando há. */
  readonly assinaturaIcp: number | null;
  readonly codigoVerificacao: string | null;
}

export interface LeituraTitular {
  readonly em: string;
  readonly usuario: string;
  readonly evento: string;
  readonly idAlvo: string | null;
}

export interface PedidoPortal {
  readonly id: string;
  readonly protocolo: string;
  readonly tipo: string;
  readonly situacao: string;
  readonly abertoEm: string;
  readonly prazo: string;
  readonly decididoEm: string | null;
  readonly fundamento: string | null;
  readonly resposta: string | null;
  /** O motivo do cancelamento pelo titular. */
  readonly motivoCancelamento: string | null;
}

export interface TrocaEmailPortal {
  readonly id: number;
  readonly conta: number;
  readonly emailNovo: string;
  readonly emailNovoResumo: string;
  readonly validoAte: Date;
  readonly origem: OrigemTrocaEmailPortal;
  readonly motivo: string;
  readonly pedidoPor: string;
  readonly envio: EnvioTrocaEmailPortal;
  readonly situacao: SituacaoTrocaEmailPortal;
  readonly criadoEm: string | null;
  readonly decididoEm: string | null;
}

export interface NovaTrocaEmailPortal {
  readonly rede: string;
  readonly conta: number;
  readonly emailNovo: string;
  readonly emailNovoResumo: string;
  readonly tokenResumo: string;
  readonly validoAte: Date;
  readonly origem: OrigemTrocaEmailPortal;
  readonly motivo: string;
  readonly pedidoPor: string;
  readonly envio: EnvioTrocaEmailPortal;
}

export interface AtoCopia {
  readonly id: string;
  readonly ato: AtoCopiaPortal;
  readonly solicitante: string | null;
  readonly vinculo: string | null;
  readonly prova: string | null;
  readonly hash: string | null;
  readonly paginas: number | null;
  readonly meio: string | null;
  readonly recebedor: string | null;
  readonly usuario: string;
  readonly em: Date;
}

export interface CopiaNaFila {
  readonly idPedido: string;
  readonly protocolo: string;
  readonly situacao: string;
  readonly canal: string;
  readonly idPaciente: number;
  readonly prontuario: number | null;
  readonly abertoEm: Date;
  readonly prazo: Date;
  readonly solicitante: string;
  readonly vinculo: string | null;
  /** Os atos já feitos (a etapa sai daqui: @sgh/dominio-acesso, etapaDaCopia). */
  readonly legitimidade: boolean;
  readonly geracoes: number;
  readonly entregue: boolean;
}
