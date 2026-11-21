// Regras do centro cirúrgico que as portas (própria e memória) e as telas aplicam igual, sem banco.
// Pedido do lote 03-01: levar estas regras ao @sgh/dominio-cirurgia (o lote não edita pacotes de outra unidade).
import { recusa } from '@sgh/nucleo';
import type { DominiosFicha } from './tipos.js';

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** A função "Anestesista" da equipe cirúrgica (pelo rótulo do cadastro), ou null se não cadastrada. */
export function funcaoAnestesista(d: Pick<DominiosFicha, 'funcoesEquipe'>): number | null {
  return d.funcoesEquipe.find((f) => f.ativo && normalizar(f.rotulo) === 'ANESTESISTA')?.id ?? null;
}

/** O pedido do portal pode ser alterado? Só o da própria conta, ainda solicitado, na versão vista e com motivo. */
export function conferirAlteracaoPedido(
  atual: { acesso: number | null; estado: string; agendamento: number | null; versao: number } | null,
  r: { acesso: number; versao: number; motivo: string },
): void {
  if (!atual || atual.acesso !== r.acesso)
    throw recusa('registro-inexistente', 'O pedido não existe ou não é desta conta.');
  if (atual.estado !== 'solicitado' || atual.agendamento !== null)
    throw recusa(
      'solicitacao-encerrada',
      'O pedido já foi confirmado pelo bloco, cancelado ou suspenso: não se altera mais pelo portal.',
    );
  if (atual.versao !== r.versao)
    throw recusa(
      'versao-desatualizada',
      `O pedido mudou desde que foi aberto (versão ${atual.versao}): atualize a tela e confira antes de alterar.`,
    );
  if (r.motivo.trim().length < 5)
    throw recusa('motivo-obrigatorio', 'Informe o motivo da alteração (ao menos 5 letras).', {
      campos: ['motivo'],
    });
}
