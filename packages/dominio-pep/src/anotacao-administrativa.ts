// Anotação administrativa do caso (03-PEP L147): o registro NÃO clínico da equipe sobre o atendimento (serviço
// social, NIR, gestão de leito, faturamento, ouvidoria), organizado por categoria e com o alcance de leitura escolhido
// por quem escreve: a equipe do estabelecimento, só os destinatários nomeados ou toda a rede. Destinatários recebem a
// anotação como pendência de leitura (marcar como lida). Nada é apagado nem tem o texto reescrito: o cancelamento é
// só do autor, com motivo (LGPD: trilha de quem fez o quê; SBIS: integridade do registro).
import type { FalhaRegra } from './farmacovigilancia.js';

export const ACESSOS_ANOTACAO = ['equipe', 'destinatarios', 'todos'] as const;
export type AcessoAnotacao = (typeof ACESSOS_ANOTACAO)[number];
export const ACOES_ANOTACAO = ['marcar_lida', 'cancelar'] as const;
export type AcaoAnotacao = (typeof ACOES_ANOTACAO)[number];
export type SituacaoAnotacao = 'ativa' | 'cancelada';

export const TEXTO_ANOTACAO_MAXIMO = 2000;
export const DESTINATARIOS_ANOTACAO_MAXIMO = 20;
export const MOTIVO_CANCELAMENTO_ANOTACAO_MINIMO = 5;
export const MOTIVO_CANCELAMENTO_ANOTACAO_MAXIMO = 300;

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });

/** Os destinatários sem repetição e sem o próprio autor (quem escreve não precisa ser avisado). */
export function normalizarDestinatarios(lista: readonly number[], autor: number | null): number[] {
  return [...new Set(lista)].filter((u) => u !== autor);
}

export interface NovaAnotacao {
  readonly texto: string;
  /** null quando a categoria não existe. */
  readonly categoriaAtiva: boolean | null;
  readonly acesso: AcessoAnotacao;
  /** Os destinatários já normalizados. */
  readonly destinatarios: readonly number[];
  /** Quantos dos destinatários são contas ativas do cliente. */
  readonly destinatariosValidos: number;
  /** null quando o atendimento não existe. */
  readonly atendimento: { readonly doPaciente: boolean; readonly doEstabelecimento: boolean } | null;
  /**
   * A reserva de leito do NIR que deu origem à anotação (contexto opcional): ausente quando não informada, null quando
   * informada e inexistente.
   */
  readonly reserva?: { readonly doPaciente: boolean } | null;
}

export function validarNovaAnotacao(n: NovaAnotacao): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  const texto = n.texto.trim();
  if (!texto) f.push(falha('texto-obrigatorio', 'Escreva a anotação.'));
  else if (texto.length > TEXTO_ANOTACAO_MAXIMO)
    f.push(falha('texto-longo', `A anotação passa de ${TEXTO_ANOTACAO_MAXIMO} caracteres.`));
  if (n.categoriaAtiva === null) f.push(falha('categoria-inexistente', 'A categoria escolhida não existe.'));
  else if (!n.categoriaAtiva) f.push(falha('categoria-inativa', 'A categoria escolhida está inativa.'));
  if (!n.atendimento) f.push(falha('atendimento-inexistente', 'O atendimento não existe.'));
  else if (!n.atendimento.doPaciente)
    f.push(falha('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.'));
  else if (!n.atendimento.doEstabelecimento)
    f.push(
      falha('atendimento-de-outro-estabelecimento', 'O atendimento é de outro estabelecimento da rede.'),
    );
  if (n.reserva === null) f.push(falha('reserva-inexistente', 'A reserva de leito informada não existe.'));
  else if (n.reserva && !n.reserva.doPaciente)
    f.push(falha('reserva-de-outro-paciente', 'A reserva de leito informada não é deste paciente.'));
  if (n.acesso === 'destinatarios' && n.destinatarios.length === 0)
    f.push(falha('destinatario-obrigatorio', 'Escolha ao menos um destinatário para a anotação restrita.'));
  if (n.destinatarios.length > DESTINATARIOS_ANOTACAO_MAXIMO)
    f.push(falha('destinatarios-demais', `No máximo ${DESTINATARIOS_ANOTACAO_MAXIMO} destinatários.`));
  else if (n.destinatariosValidos < n.destinatarios.length)
    f.push(falha('destinatario-inexistente', 'Algum destinatário não é uma conta ativa do cliente.'));
  return f;
}

export interface AnotacaoParaLeitura {
  readonly acesso: string;
  readonly autorUsuarioId: number;
  readonly estabelecimentoId: number;
  readonly destinatarios: readonly number[];
}
export interface LeitorAnotacao {
  readonly usuario: number | null;
  readonly estabelecimento: number;
}

/** Quem lê: o autor e os destinatários sempre; a equipe do estabelecimento; toda a rede só no acesso "todos". */
export function anotacaoVisivel(a: AnotacaoParaLeitura, l: LeitorAnotacao): boolean {
  if (a.acesso === 'todos') return true;
  if (l.usuario !== null && (l.usuario === a.autorUsuarioId || a.destinatarios.includes(l.usuario)))
    return true;
  return a.acesso === 'equipe' && a.estabelecimentoId === l.estabelecimento;
}

export const situacaoAnotacao = (canceladaEm: Date | string | null): SituacaoAnotacao =>
  canceladaEm ? 'cancelada' : 'ativa';

export interface PassoAnotacao {
  readonly acao: AcaoAnotacao;
  readonly cancelada: boolean;
  readonly ehAutor: boolean;
  readonly ehDestinatario: boolean;
  readonly lida: boolean;
  readonly motivo: string | null;
}

export function passoAnotacao(p: PassoAnotacao): FalhaRegra[] {
  if (p.cancelada) return [falha('anotacao-cancelada', 'A anotação já foi cancelada.')];
  if (p.acao === 'marcar_lida') {
    if (!p.ehDestinatario) return [falha('nao-destinatario', 'A anotação não foi endereçada a você.')];
    if (p.lida) return [falha('ja-lida', 'Você já marcou a anotação como lida.')];
    return [];
  }
  const f: FalhaRegra[] = [];
  if (!p.ehAutor) f.push(falha('so-autor-cancela', 'Só quem escreveu a anotação pode cancelá-la.'));
  const motivo = (p.motivo ?? '').trim();
  if (motivo.length < MOTIVO_CANCELAMENTO_ANOTACAO_MINIMO)
    f.push(falha('motivo-obrigatorio', 'Informe o motivo do cancelamento.'));
  else if (motivo.length > MOTIVO_CANCELAMENTO_ANOTACAO_MAXIMO)
    f.push(falha('motivo-longo', `O motivo passa de ${MOTIVO_CANCELAMENTO_ANOTACAO_MAXIMO} caracteres.`));
  return f;
}
