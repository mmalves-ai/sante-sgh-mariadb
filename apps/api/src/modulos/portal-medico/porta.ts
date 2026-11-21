// Porta do portal do médico externo (M50, etapa 3): a conta do portal do médico externo (conta_portal_profissional_externo)
// ligada ao profissional do corpo clínico e as leituras do profissional (a API não escreve SQL; fronteira Nx). A agenda
// do bloco e o pedido de cirurgia vão pela porta da cirurgia (PORTA_CIRURGIA); o extrato, pela do repasse.
//   - `banco`: o banco do cliente (MariaDB) pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura e gravações
//     pelo Executor, com a trilha, o outbox e a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
// Melhoria: tipos de negócio próprios (ids numéricos, datas ISO, situação por palavra); o contexto é o do núcleo
// (cliente, estabelecimento e usuário por id), com o código da rede e do estabelecimento só para parâmetros e mensagens.
import type { ContextoNucleo } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';

export const PORTA_PORTAL_MEDICO = Symbol('PORTA_PORTAL_MEDICO');

/** Contexto da porta: o do núcleo, com o código da rede e do estabelecimento da sessão. */
export type ContextoPortalMedico = ContextoNucleo & {
  readonly rede: string;
  readonly hospital: string;
  /** A chave de idempotência da requisição (sem ela, cada gravação é nova). */
  readonly chaveIdempotencia?: string;
};

/** Situação da conta como as telas a mostram. */
export type SituacaoContaMedico = 'ativo' | 'bloqueado' | 'encerrado';
export type AtoContaMedico = 'bloqueio' | 'desbloqueio' | 'encerramento';
export type DecisaoPedidosConta = 'retirar' | 'manter';
/** Por onde foi o link da troca do e-mail. */
export type EnvioTrocaEmailMedico = 'simulador' | 'halai';
/** Por onde foi a notificação do crítico ('desligado': registrada sem envio, com o motivo). */
export type EnvioCriticoMedico = 'simulador' | 'halai' | 'desligado';

/** O vínculo da conta do portal com o profissional do corpo clínico (decidido por uma pessoa do hospital). */
export interface VinculoMedicoExterno {
  readonly acesso: number;
  readonly profissional: number | null;
  /** Login de quem ligou ou desligou (null: sem registro). */
  readonly vinculadoPor: string | null;
  readonly vinculadoEm: string | null;
}

/**
 * Uma inscrição do profissional no conselho, como as regras do pedido de cirurgia e do extrato a usam:
 *   - `id`: o cirurgião da agenda do bloco (no banco, o próprio profissional_id; na memória, o cirurgião sintético);
 *   - `codigo`: o prestador do repasse (no banco, o próprio profissional_id; na memória, o código sintético);
 *   - `uf` e `numero`: a inscrição no conselho (o número como está no cadastro). É `numero` que casa com o número que o
 *     médico informou na conta, nunca `codigo`.
 * O vínculo assistencial da fila de pacientes NÃO sai daqui: é `ProfissionalCorpoClinico.vinculoAssistencial`.
 */
export interface RegistroDoProfissional {
  readonly id: number;
  readonly codigo: number;
  readonly uf: string;
  readonly numero?: string;
}

export interface ProfissionalCorpoClinico {
  readonly id: number;
  readonly nome: string;
  readonly registros: readonly RegistroDoProfissional[];
  /**
   * Os ids pelos quais a fila assistencial (pep: "meus pacientes" e críticos) reconhece o profissional. No banco é o
   * profissional_id (o vínculo assistencial do modelo); na memória de dev/ci, as ocupações sintéticas do pep (cboDe).
   * A fila do pep ainda chama esse campo de `cbos`: a troca do nome e o filtro por profissional_id no banco são
   * pedido do lote 04-02 ao lote do pep.
   */
  readonly vinculoAssistencial: readonly number[];
}

/** Um ato do histórico da conta (bloqueio, desbloqueio, encerramento e as trocas). */
export interface AtoContaMedicoRegistrado {
  readonly id: number;
  readonly ato: AtoContaMedico | 'troca-senha' | 'troca-email';
  readonly situacaoAnterior: string;
  readonly motivo: string | null;
  readonly pedidosPendentes: number;
  readonly decisaoPedidos: DecisaoPedidosConta | null;
  readonly usuario: string;
  readonly em: string;
}

export interface TrocaEmailMedico {
  readonly id: number;
  readonly acesso: number;
  readonly emailNovo: string;
  readonly validoAte: Date;
  readonly envio: EnvioTrocaEmailMedico;
  readonly situacao: 'pendente' | 'confirmada' | 'cancelada';
}

export interface NotificacaoCriticoMedico {
  readonly aviso: number;
  readonly envio: EnvioCriticoMedico;
  readonly motivo: string | null;
  readonly em: string;
}

/**
 * A linha de auditoria do portal, em termos de negócio (evento, operação, alvo, paciente). A porta própria a grava na
 * trilha do núcleo (trilhaDoNucleo); a de memória a guarda para os testes. Nunca leva dado pessoal.
 */
export interface TrilhaPortalMedico {
  readonly rede?: string;
  readonly hospital?: string;
  /** Quem agiu: o login interno ou a conta do portal ("SGH.PORTAL.M<conta>"). */
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly tabelaAlvo: string;
  readonly idAlvo: string | null;
  readonly chaveNaturalAlvo: string | null;
  readonly resultado: 'sucesso' | 'falha';
  readonly estacao: string;
  readonly correlacao: string;
  readonly idPaciente: number | null;
}

const ACAO_DO_EVENTO = (operacao: string): TrilhaDaGravacao['acao'] =>
  /(lido|leitura|extrato|agenda|prontuario|pacientes|consulta|ciência|ciencia)/i.test(operacao)
    ? 'consulta'
    : 'operacao';

/** A linha da trilha do núcleo: o estabelecimento, o usuário e a correlação do contexto; o evento nos dados. */
export function trilhaDoNucleo(c: ContextoNucleo, t: TrilhaPortalMedico): TrilhaDaGravacao {
  const id = t.idAlvo !== null && /^\d{1,15}$/.test(t.idAlvo) ? Number(t.idAlvo) : null;
  return {
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    acao: ACAO_DO_EVENTO(t.operacao),
    entidade: t.tabelaAlvo,
    entidadeId: id,
    dadosDepois: {
      evento: t.evento,
      recurso: t.recurso,
      operacao: t.operacao,
      resultado: t.resultado,
      quem: t.usuario,
      estacao: t.estacao,
      chave: t.chaveNaturalAlvo,
      paciente: t.idPaciente,
    },
    correlacao: (t.correlacao || c.correlacao).slice(0, 64),
  };
}

export interface GravadorPortalMedico {
  vincular(r: { acesso: number; profissional: number; por: string }): Promise<void>;
  desvincular(r: { acesso: number; por: string }): Promise<void>;
  /** W0-10: bloqueio, desbloqueio ou encerramento com motivo (fato novo; a conta relida sob trava). */
  atoConta(r: {
    acesso: number;
    ato: AtoContaMedico;
    motivo: string;
    pedidosPendentes: number;
    decisaoPedidos: DecisaoPedidosConta | null;
    amostraPedidos: readonly string[];
    por: string;
  }): Promise<{ situacao: SituacaoContaMedico; anterior: string; id: number }>;
  /** W0-10: a senha nova da conta ativa (o resumo já calculado) e o ato 'troca-senha'. */
  trocarSenha(r: { acesso: number; senhaResumo: string; por: string }): Promise<{ id: number }>;
  /** W0-10: o pedido da troca do e-mail (cancela o pendente anterior). */
  pedirTrocaEmail(r: {
    acesso: number;
    emailNovo: string;
    tokenResumo: string;
    validoAte: Date;
    envio: EnvioTrocaEmailMedico;
  }): Promise<{ id: number }>;
  cancelarTrocaEmail(troca: number): Promise<void>;
  /** W0-10: o link do e-mail novo confirmado: a conta ativa passa ao e-mail novo e o ato 'troca-email'. */
  confirmarTrocaEmail(r: {
    tokenResumo: string;
    agora: Date;
    por: string;
  }): Promise<{ acesso: number; emailNovo: string; id: number }>;
  /** W0-10 (M5): a conta notificada do aviso de crítico (false: já notificada; uma por aviso e conta). */
  notificarCritico(r: {
    aviso: number;
    acesso: number;
    envio: EnvioCriticoMedico;
    motivo: string | null;
  }): Promise<boolean>;
}

export interface PortaPortalMedico {
  readonly destino: 'banco' | 'memoria';
  gravar<T>(
    c: ContextoPortalMedico,
    fn: (g: GravadorPortalMedico) => Promise<T>,
    trilha: TrilhaPortalMedico | null,
  ): Promise<T>;
  /** Só a linha da trilha (a leitura auditada do extrato e da agenda pelo portal). */
  registrarLeitura(c: ContextoPortalMedico, trilha: TrilhaPortalMedico): Promise<void>;
  vinculos(c: ContextoPortalMedico, acessos: readonly number[]): Promise<Map<number, VinculoMedicoExterno>>;
  profissional(c: ContextoPortalMedico, id: number): Promise<ProfissionalCorpoClinico | null>;
  /** Vários profissionais numa consulta (a lista interna das contas). */
  profissionais(
    c: ContextoPortalMedico,
    ids: readonly number[],
  ): Promise<Map<number, ProfissionalCorpoClinico>>;
  /** Quem tem cada código de prestador: o código de mais de um profissional fica retido no extrato. */
  donosDosCodigos(c: ContextoPortalMedico, codigos: readonly number[]): Promise<Map<number, Set<number>>>;
  sugestoes(c: ContextoPortalMedico, uf: string, numero: number): Promise<{ id: number; nome: string }[]>;
  /** A sugestão de várias contas numa consulta (chave "UF:número"). */
  sugestoesEmLote(
    c: ContextoPortalMedico,
    pares: readonly { uf: string; numero: number }[],
  ): Promise<Map<string, { id: number; nome: string }[]>>;
  buscarProfissionais(c: ContextoPortalMedico, texto: string): Promise<{ id: number; nome: string }[]>;
  /** W0-10: o histórico dos atos da conta (mais recente primeiro). */
  atosConta(c: ContextoPortalMedico, acesso: number): Promise<AtoContaMedicoRegistrado[]>;
  /** W0-10: o pedido pendente da troca do e-mail da conta e o pedido pelo resumo do token. */
  trocaEmailPendente(c: ContextoPortalMedico, acesso: number): Promise<TrocaEmailMedico | null>;
  trocaEmailPorToken(c: ContextoPortalMedico, tokenResumo: string): Promise<TrocaEmailMedico | null>;
  /** W0-10 (M5): as notificações de crítico da conta (mais recente primeiro). */
  notificacoesCritico(c: ContextoPortalMedico, acesso: number): Promise<NotificacaoCriticoMedico[]>;
  /** W0-10 (M6): o login do sistema do profissional ligado (autor dos documentos a assinar); null sem login. */
  loginDoProfissional(c: ContextoPortalMedico, profissional: number): Promise<string | null>;
}

export const METODOS_PORTA_PORTAL_MEDICO: ReadonlySet<string> = new Set([
  'gravar',
  'registrarLeitura',
  'vinculos',
  'profissional',
  'profissionais',
  'donosDosCodigos',
  'sugestoes',
  'sugestoesEmLote',
  'buscarProfissionais',
  'atosConta',
  'trocaEmailPendente',
  'trocaEmailPorToken',
  'notificacoesCritico',
  'loginDoProfissional',
]);
