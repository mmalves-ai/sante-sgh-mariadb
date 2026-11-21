// Regra 4 do M32 (cap-06b §6.8, Perfis; cap-08 §8.1): segregação de funções no título. Quem lança não aprova, quem
// aprova não paga, quem paga não concilia. A pessoa é o login do usuário, comparado sem caixa.
import { mesmaPessoa, recusaFin, type RecusaFinanceiro } from './recusa.js';

export type AcaoTitulo = 'aprovar' | 'pagar' | 'conciliar';

export interface HistoricoTitulo {
  /** Quem lançou (login). */
  readonly lancou: string | null;
  /** Quem aprovou (SGH_FIN_APROVACAO). */
  readonly aprovaram: readonly string[];
  /** Quem pagou (a baixa). */
  readonly pagou: string | null;
}

export function conferirSegregacao(
  acao: AcaoTitulo,
  quem: string,
  h: HistoricoTitulo,
): RecusaFinanceiro | null {
  if (acao === 'aprovar' && mesmaPessoa(quem, h.lancou))
    return recusaFin('segregacao-lancou-aprova', 'Quem lançou o título não pode aprová-lo.');
  if (acao === 'pagar') {
    if (mesmaPessoa(quem, h.lancou))
      return recusaFin('segregacao-lancou-paga', 'Quem lançou o título não pode pagá-lo.');
    if (h.aprovaram.some((a) => mesmaPessoa(a, quem)))
      return recusaFin('segregacao-aprovou-paga', 'Quem aprovou o título não pode pagá-lo.');
  }
  if (acao === 'conciliar' && mesmaPessoa(quem, h.pagou))
    return recusaFin('segregacao-pagou-concilia', 'Quem pagou não pode conciliar o mesmo movimento.');
  return null;
}
