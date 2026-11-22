// Regras da entrega dos fatos às integrações (M34; lote F2.2 05-14): qual estado da liberação do exame vale para o
// parceiro, quando o item da remessa ao laboratório de apoio vira pedido, a assinatura que um evento derivado usa e
// quando a reserva de uma mensagem em envio venceu. Puro: sem banco, sem relógio implícito.
// Melhoria: a liberação desfeita (operação de exclusão) ou revogada nunca chega ao parceiro como resultado liberado; a
// retirada vira o evento próprio "fato.resultado.revogado", entregue a quem assina o resultado liberado.

export const EVENTO_RESULTADO_LIBERADO = 'fato.resultado.liberado';
export const EVENTO_RESULTADO_REVOGADO = 'fato.resultado.revogado';

/** As etapas do histórico da liberação que mudam o que o parceiro pode ver. */
export const ETAPAS_LIBERACAO_VIGIADAS = ['liberacao_clinica', 'revogacao'] as const;

export interface EventoLiberacao {
  readonly id: number;
  readonly etapa: string;
  /** inclusao, alteracao ou exclusao (a exclusão desfaz o registro da etapa). */
  readonly operacao: string;
  readonly ocorridoEm: Date;
}

export type EstadoLiberacao = 'nao_liberado' | 'liberado' | 'revogado' | 'desfeito';

const vigiada = (e: EventoLiberacao) => (ETAPAS_LIBERACAO_VIGIADAS as readonly string[]).includes(e.etapa);

/** O histórico em ordem (o instante e, no empate, a linha). */
export function ordenarLiberacao(h: readonly EventoLiberacao[]): EventoLiberacao[] {
  return [...h].sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime() || a.id - b.id);
}

function aplicar(estado: EstadoLiberacao, e: EventoLiberacao): EstadoLiberacao {
  const desfaz = e.operacao === 'exclusao';
  if (e.etapa === 'liberacao_clinica')
    return desfaz ? (estado === 'liberado' ? 'desfeito' : estado) : 'liberado';
  if (e.etapa === 'revogacao') {
    // Desfazer a revogação devolve a liberação que ela tinha retirado.
    if (desfaz) return estado === 'revogado' ? 'liberado' : estado;
    return estado === 'liberado' ? 'revogado' : estado;
  }
  return estado;
}

/** O estado do resultado depois do histórico inteiro. */
export function estadoDaLiberacao(h: readonly EventoLiberacao[]): EstadoLiberacao {
  return ordenarLiberacao(h).reduce(aplicar, 'nao_liberado' as EstadoLiberacao);
}

/**
 * O fato que a linha `id` do histórico gera para o parceiro, olhando o histórico inteiro do exame:
 * - a liberação só quando é ela que vale AGORA (nenhuma linha vigiada posterior a desfez ou revogou);
 * - a retirada (revogação ou liberação desfeita) só quando tirou um resultado liberado e ele segue retirado; o evento
 *   sai apenas se o parceiro já recebeu a liberação (quem confere é o chamador, na fila comum);
 * - qualquer outra linha (etapa não vigiada, linha superada, sem mudança) não gera fato.
 */
export function fatoDaLiberacao(
  historico: readonly EventoLiberacao[],
  id: number,
): typeof EVENTO_RESULTADO_LIBERADO | typeof EVENTO_RESULTADO_REVOGADO | null {
  const h = ordenarLiberacao(historico);
  const i = h.findIndex((e) => e.id === id);
  if (i < 0 || !vigiada(h[i]!)) return null;
  if (h.slice(i + 1).some(vigiada)) return null; // superada: a linha posterior decide
  const antes = h.slice(0, i).reduce(aplicar, 'nao_liberado' as EstadoLiberacao);
  const depois = aplicar(antes, h[i]!);
  if (depois === 'liberado' && (antes !== 'liberado' || h[i]!.etapa === 'liberacao_clinica'))
    return EVENTO_RESULTADO_LIBERADO;
  if ((depois === 'revogado' || depois === 'desfeito') && antes === 'liberado')
    return EVENTO_RESULTADO_REVOGADO;
  return null;
}

/** A assinatura do parceiro que recebe o evento: quem assina o resultado liberado recebe também a retirada dele. */
export function assinaturaDoEvento(tipo: string): string {
  return tipo === EVENTO_RESULTADO_REVOGADO ? EVENTO_RESULTADO_LIBERADO : tipo;
}

/**
 * Decisão (lote 05-14): o pedido ao laboratório de apoio nasce quando a remessa é FECHADA (a remessa aberta ainda
 * muda); a remessa já enviada, recebida ou concluída também vale (o pedido pode ter vindo pelo conector). O carimbo do
 * fato é o fechamento (sem ele, o envio).
 */
export const SITUACOES_REMESSA_COM_PEDIDO = ['fechada', 'enviada', 'recebida', 'concluida'] as const;
/** O exame cancelado ou recusado nunca vai ao laboratório de apoio (que executaria e cobraria). */
export const SITUACOES_EXAME_SEM_PEDIDO = ['cancelado', 'recusado'] as const;

export function exameVaiAoApoio(
  situacaoRemessa: string,
  situacaoExame: string,
  situacaoItem: string,
): boolean {
  return (
    (SITUACOES_REMESSA_COM_PEDIDO as readonly string[]).includes(situacaoRemessa) &&
    !(SITUACOES_EXAME_SEM_PEDIDO as readonly string[]).includes(situacaoExame) &&
    situacaoItem !== 'cancelado' &&
    situacaoItem !== 'recusado'
  );
}

/** Tempo (min) depois do qual a reserva "enviando" de um processo que caiu pode ser retomada por outro. */
export const RESERVA_ENVIO_MIN = 15;

export function reservaVencida(reservadaEm: Date | null, agora: Date, minutos = RESERVA_ENVIO_MIN): boolean {
  return reservadaEm === null || agora.getTime() - reservadaEm.getTime() >= minutos * 60_000;
}
