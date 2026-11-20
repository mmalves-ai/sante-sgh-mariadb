// Comuns da aba dos periódicos (M53.7): as ações que o painel do período libera, na ordem da obrigação (S-1200 e S-1210
// dos sem evento, depois o S-1299; o S-1298 só com o período fechado no eSocial). O S-1200 "de todos" (vínculos vazios)
// retifica os aceitos e só aparece quando há aceito; os em andamento ficam de fora no servidor (D-RETIF-PER-537).
import type { PainelPeriodicosEsocial } from '@sgh/contratos';

export type TipoPedidoPeriodico = 'remuneracao' | 'pagamentos' | 'fechamento' | 'reabertura';
export interface PedidoPeriodico {
  readonly tipo: TipoPedidoPeriodico;
  /** Chave do texto do botão em `folha.esocial.periodicos.*`. */
  readonly rotulo:
    'gerarRemuneracao' | 'retificarRemuneracao' | 'gerarPagamentos' | 'gerarFechamento' | 'gerarReabertura';
  /** Vínculos (vazio = todos os do período). */
  readonly vinculos: readonly number[];
  readonly principal: boolean;
}

/** As ações do painel; `gerar` é a permissão de gerar eventos do apoio do eSocial. */
export function pedidosDoPainel(p: PainelPeriodicosEsocial, gerar: boolean): PedidoPeriodico[] {
  const r: PedidoPeriodico[] = [];
  if (p.acoes.gerar) {
    if (p.remuneracao.semEvento.length)
      r.push({
        tipo: 'remuneracao',
        rotulo: 'gerarRemuneracao',
        vinculos: p.remuneracao.semEvento,
        principal: true,
      });
    if (p.remuneracao.aceitos > 0)
      r.push({ tipo: 'remuneracao', rotulo: 'retificarRemuneracao', vinculos: [], principal: false });
  }
  // O S-1210 é do mês do pagamento: os pagamentos podem vir de um período anterior já fechado na folha, então basta o
  // período aberto no eSocial (o servidor recusa sem pagamento de período fechado).
  if (gerar && p.situacao === 'aberto' && p.pagamentos?.semEvento.length)
    r.push({
      tipo: 'pagamentos',
      rotulo: 'gerarPagamentos',
      vinculos: p.pagamentos.semEvento,
      principal: true,
    });
  if (p.acoes.fecharEsocial)
    r.push({ tipo: 'fechamento', rotulo: 'gerarFechamento', vinculos: [], principal: true });
  if (p.acoes.reabrirEsocial)
    r.push({ tipo: 'reabertura', rotulo: 'gerarReabertura', vinculos: [], principal: false });
  return r;
}
