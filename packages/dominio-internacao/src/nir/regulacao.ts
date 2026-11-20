// Regulação estadual no NIR (M44, etapa 3; ficha, regra 14; cap-05a §5.4, Nota; cap-12 §12.4), regras puras: o número
// sempre registrável à mão; cada mudança de situação é uma linha nova sobre a vigente; a regulação encerrada (negada ou
// cancelada) aceita um pedido novo com outro número; a concluída não muda mais. O conector só existe com a DP-29: o
// simulador abaixo é a outra ponta fora de produção (determinístico, sem rede) e a carga que vai à outbox leva só IDs e
// códigos.
import { type CentralRegulacao, type SituacaoRegulacao, SITUACOES_REGULACAO } from '@sgh/contratos';

export interface RegulacaoVigente {
  readonly id: number;
  readonly numero: string;
  readonly central: CentralRegulacao;
  readonly situacao: SituacaoRegulacao;
}

export type DecisaoRegulacao =
  | { readonly ok: true; readonly novoPedido: boolean }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

export function situacaoFinal(s: SituacaoRegulacao): boolean {
  return SITUACOES_REGULACAO.find((x) => x.codigo === s)?.final ?? false;
}

/**
 * O registro pedido sobre a vigente vista: o primeiro da solicitação (qualquer situação não final de abertura); a
 * mudança de situação com o mesmo número e a mesma central; depois de negada ou cancelada, um pedido novo (outro
 * número, situação de abertura); a concluída não muda; a mesma situação com o mesmo número não é mudança.
 * `jaUsados` (revisão do M44.3): os números (com a central) de todos os registros anteriores da solicitação; o pedido
 * novo depois de encerrada não reaproveita nenhum deles (A negada → B cancelada → A de novo é recusado).
 */
export function decidirRegulacao(
  vigente: RegulacaoVigente | null,
  pedido: { numero: string; central: CentralRegulacao; situacao: SituacaoRegulacao },
  jaUsados: readonly { numero: string; central: string }[] = [],
): DecisaoRegulacao {
  const abertura: readonly SituacaoRegulacao[] = ['solicitada', 'em_analise', 'autorizada'];
  if (vigente === null)
    return abertura.includes(pedido.situacao)
      ? { ok: true, novoPedido: true }
      : {
          ok: false,
          codigo: 'situacao-de-abertura',
          motivo: 'O primeiro registro da regulação é solicitada, em análise ou autorizada.',
        };
  if (vigente.situacao === 'concluida')
    return { ok: false, codigo: 'regulacao-concluida', motivo: 'A regulação já foi concluída.' };
  if (situacaoFinal(vigente.situacao)) {
    if (
      pedido.numero === vigente.numero ||
      jaUsados.some((u) => u.numero === pedido.numero && u.central === pedido.central)
    )
      return {
        ok: false,
        codigo: 'regulacao-encerrada',
        motivo: 'Esta regulação foi encerrada: um pedido novo à central vem com outro número.',
      };
    return abertura.includes(pedido.situacao)
      ? { ok: true, novoPedido: true }
      : {
          ok: false,
          codigo: 'situacao-de-abertura',
          motivo: 'O pedido novo começa como solicitada, em análise ou autorizada.',
        };
  }
  if (pedido.numero !== vigente.numero || pedido.central !== vigente.central)
    return {
      ok: false,
      codigo: 'numero-diferente',
      motivo:
        'A regulação em andamento tem outro número ou outra central: encerre-a (negada ou cancelada) antes de registrar outra.',
    };
  if (pedido.situacao === vigente.situacao)
    return { ok: false, codigo: 'sem-mudanca', motivo: 'A situação informada é a que já está registrada.' };
  return { ok: true, novoPedido: false };
}

/** A carga da outbox para a central (só IDs e códigos; o conteúdo clínico nunca vai na carga). */
export function cargaDaRegulacao(r: {
  regulacao: number;
  solicitacao: number;
  central: CentralRegulacao;
  sentido: 'entrada' | 'saida';
}): Record<string, string> {
  return {
    regulacao: String(r.regulacao),
    solicitacao: String(r.solicitacao),
    central: r.central,
    sentido: r.sentido,
  };
}

/**
 * O simulador da central (fora de produção; DP-29): responde ao pedido com a situação seguinte, sem rede. O pedido de
 * prioridade emergência ou urgente é autorizado; os demais ficam em análise. O número devolvido é o mesmo do pedido.
 */
export function respostaSimuladaDaCentral(p: {
  numero: string;
  situacao: SituacaoRegulacao;
  prioridade: string;
}): { numero: string; situacao: SituacaoRegulacao; mensagem: string } {
  const situacao: SituacaoRegulacao =
    p.situacao === 'autorizada'
      ? 'concluida'
      : p.prioridade === 'emergencia' || p.prioridade === 'urgente'
        ? 'autorizada'
        : 'em_analise';
  return { numero: p.numero, situacao, mensagem: `SIMULADOR:${p.numero}:${situacao}` };
}

/** Contagem por situação vigente (as solicitações sem registro em `sem-numero`). */
export function contagemRegulacao(vigentes: readonly (SituacaoRegulacao | null)[]): Record<string, number> {
  const r: Record<string, number> = { 'sem-numero': 0 };
  for (const s of SITUACOES_REGULACAO) r[s.codigo] = 0;
  for (const v of vigentes) r[v ?? 'sem-numero'] = (r[v ?? 'sem-numero'] ?? 0) + 1;
  return r;
}
