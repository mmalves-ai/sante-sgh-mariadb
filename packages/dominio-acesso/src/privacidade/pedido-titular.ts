// Pedidos do titular (ficha do M10, seção 6; cap-08 §8.13; LGPD, art. 18 e 19): protocolo, tipo, prazo de 15
// dias, verificação de identidade antes de qualquer resposta, decisão com fundamento legal. Eliminação de dado de
// prontuário é recusada com o fundamento da guarda legal (Lei 13.787/2018: 20 anos; CFM 1.821/2007); o pedido
// fica registrado e respondido no prazo. O pedido se liga ao paciente pelo ID e pelo prontuário (sobrevive a uma
// unificação de cadastros). Nenhum dado do titular vai para o texto do pedido além do que a pessoa escrever na
// descrição (que só a área de privacidade lê).

export const TIPOS_PEDIDO = [
  'confirmacao',
  'acesso',
  'correcao',
  'anonimizacao',
  'eliminacao',
  'portabilidade',
  'compartilhamento',
  'revogacao-consentimento',
] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];

export const SITUACOES_PEDIDO = [
  'aberto',
  'identidade-verificada',
  'atendido',
  'negado',
  'cancelado',
] as const;
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number];

export const PRAZO_DIAS = 15;

export const FUNDAMENTOS = [
  'guarda-legal-prontuario',
  'obrigacao-legal',
  'exercicio-de-direito',
  'identidade-nao-confirmada',
  'outro',
] as const;
export type Fundamento = (typeof FUNDAMENTOS)[number];

export interface PedidoTitular {
  readonly situacao: SituacaoPedido;
  readonly tipo: TipoPedido;
  readonly abertoEm: Date;
  readonly identidadeVerificada: boolean;
}

/** Prazo de resposta: 15 dias corridos a partir da abertura. */
export function prazoDoPedido(abertoEm: Date): Date {
  return new Date(abertoEm.getTime() + PRAZO_DIAS * 86_400_000);
}

export function pedidoAtrasado(p: Pick<PedidoTitular, 'situacao' | 'abertoEm'>, agora: Date): boolean {
  return (
    (p.situacao === 'aberto' || p.situacao === 'identidade-verificada') && agora > prazoDoPedido(p.abertoEm)
  );
}

export type TransicaoPedido =
  | { readonly para: 'identidade-verificada' }
  | { readonly para: 'atendido'; readonly fundamento?: Fundamento }
  | { readonly para: 'negado'; readonly fundamento: Fundamento };

export type RecusaTransicao =
  'ja-encerrado' | 'identidade-primeiro' | 'fundamento-obrigatorio' | 'eliminacao-de-prontuario' | 'repetido';

/** Confere a mudança de situação (a decisão exige a identidade verificada e, na negativa, o fundamento). */
export function conferirTransicao(p: PedidoTitular, t: TransicaoPedido): RecusaTransicao | null {
  if (pedidoEncerrado(p.situacao)) return 'ja-encerrado';
  if (t.para === 'identidade-verificada') return p.identidadeVerificada ? 'repetido' : null;
  // Negar por identidade não confirmada é a única decisão sem a verificação.
  if (!p.identidadeVerificada && !(t.para === 'negado' && t.fundamento === 'identidade-nao-confirmada'))
    return 'identidade-primeiro';
  if (t.para === 'negado' && !t.fundamento) return 'fundamento-obrigatorio';
  // A eliminação de dado de prontuário não é atendida: guarda legal (o pedido é negado com esse fundamento).
  if (t.para === 'atendido' && p.tipo === 'eliminacao') return 'eliminacao-de-prontuario';
  return null;
}

export function mensagemTransicao(r: RecusaTransicao): string {
  switch (r) {
    case 'ja-encerrado':
      return 'O pedido já foi respondido.';
    case 'identidade-primeiro':
      return 'Confirme a identidade do titular antes de responder.';
    case 'fundamento-obrigatorio':
      return 'Informe o fundamento legal da negativa.';
    case 'eliminacao-de-prontuario':
      return 'Dado de prontuário tem guarda legal de 20 anos: responda negando com o fundamento "guarda legal do prontuário".';
    case 'repetido':
      return 'A identidade já foi confirmada.';
  }
}

/** Respondido (atendido ou negado) ou cancelado pelo titular: não muda mais. */
export function pedidoEncerrado(situacao: SituacaoPedido): boolean {
  return situacao === 'atendido' || situacao === 'negado' || situacao === 'cancelado';
}

// W0-10 (linha 'Pedido do paciente' da matriz): o pedido protocolado não se edita; enquanto não for respondido, o
// titular o cancela com motivo (a desistência é um fato novo: a situação vai a 'cancelado' com o motivo, quem e quando;
// nada é apagado). O respondido (atendido ou negado) ou já cancelado não se cancela: a API devolve 409.
export const MOTIVOS_CANCELAMENTO_PEDIDO = [
  'desistencia',
  'aberto-por-engano',
  'em-duplicidade',
  'resolvido-de-outra-forma',
] as const;
export type MotivoCancelamentoPedido = (typeof MOTIVOS_CANCELAMENTO_PEDIDO)[number];

export type RecusaCancelamento = 'ja-respondido' | 'ja-cancelado';

export function conferirCancelamento(p: Pick<PedidoTitular, 'situacao'>): RecusaCancelamento | null {
  if (p.situacao === 'cancelado') return 'ja-cancelado';
  if (p.situacao === 'atendido' || p.situacao === 'negado') return 'ja-respondido';
  return null;
}

export function mensagemCancelamento(r: RecusaCancelamento): string {
  return r === 'ja-cancelado'
    ? 'O pedido já foi cancelado.'
    : 'O pedido já foi respondido: o pedido protocolado não se altera. Se precisar, abra um pedido novo.';
}

/** Protocolo legível: ano + sequência de 6 dígitos (ex.: 2026-000123). */
export function protocoloDoPedido(ano: number, sequencia: number): string {
  if (!Number.isInteger(sequencia) || sequencia <= 0 || sequencia > 999_999)
    throw new Error('Sequência inválida.');
  return `${ano}-${String(sequencia).padStart(6, '0')}`;
}
