// Regras da conta do médico externo no portal (W0-10), puras e testadas: o ato do hospital sobre a conta e a passagem
// de situação, e a tradução entre a situação do modelo (conta_portal_profissional_externo) e a da tela.
// Melhoria: a regra fica fora da porta (a de memória e a do banco usam a mesma) e recusa ato sem efeito.
import { recusa } from '@sgh/nucleo';
import type { AtoContaMedico, DecisaoPedidosConta, SituacaoContaMedico } from './porta.js';

/** Situação do modelo → situação da tela (a pendente e a suspensa não entram no portal: contam como bloqueadas). */
export function situacaoDaTela(modelo: string): SituacaoContaMedico | null {
  if (modelo === 'ativa') return 'ativo';
  if (modelo === 'encerrada') return 'encerrado';
  if (modelo === 'bloqueada' || modelo === 'suspensa') return 'bloqueado';
  return null;
}

/** Situação da tela → situação do modelo. */
export const SITUACAO_DO_MODELO: Readonly<Record<SituacaoContaMedico, string>> = {
  ativo: 'ativa',
  bloqueado: 'bloqueada',
  encerrado: 'encerrada',
};

/**
 * Confere o ato sobre a conta e devolve a situação nova: bloquear só a ativa, desbloquear só a bloqueada, encerrar a
 * que não está encerrada; o motivo é obrigatório (5 letras); com pedidos aguardando o bloco, a decisão é obrigatória.
 */
export function conferirAtoContaMedico(
  anterior: string,
  x: {
    ato: AtoContaMedico;
    motivo: string;
    pedidosPendentes: number;
    decisaoPedidos: DecisaoPedidosConta | null;
  },
): SituacaoContaMedico {
  if (x.motivo.trim().length < 5)
    throw recusa('motivo-obrigatorio', 'Escreva o motivo (5 letras ou mais).', { campos: ['motivo'] });
  if (anterior === 'encerrado')
    throw recusa('conta-encerrada', 'A conta já está encerrada: o encerramento não se desfaz.');
  if (x.ato === 'bloqueio') {
    if (anterior !== 'ativo') throw recusa('conta-nao-ativa', 'Só a conta ativa é bloqueada.');
    return 'bloqueado';
  }
  if (x.ato === 'desbloqueio') {
    if (anterior !== 'bloqueado') throw recusa('conta-nao-bloqueada', 'Só a conta bloqueada é desbloqueada.');
    return 'ativo';
  }
  if (x.pedidosPendentes > 0 && !x.decisaoPedidos)
    throw recusa(
      'pedidos-pendentes',
      'Decida se os pedidos aguardando o bloco serão retirados ou mantidos.',
      {
        campos: ['pedidos'],
      },
    );
  return 'encerrado';
}
