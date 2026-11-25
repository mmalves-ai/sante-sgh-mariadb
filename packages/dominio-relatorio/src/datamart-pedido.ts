// Controle da carga do data mart na administração (01-REL L113; F3): a regra pura do pedido manual de carga e da
// situação que o administrador vê. O pedido grava a carga manual em execução, aguardando o worker (marcação
// `pedido = aguardando` no resumo técnico); o worker assume o pedido (`iniciado`), roda o carregador e fecha a carga
// com as etapas, como a agendada. Nada de dado de pessoa: o registro só tem contagens, tempos e a mensagem limpa.
// Melhoria: um clique pede a carga, com a recusa na hora se outra carga do estabelecimento está aberta; a carga aberta
// há mais do que o teto aparece como interrompida (não bloqueia o pedido seguinte), sem apagar o registro.

/** Marcação do pedido manual no resumo técnico da carga (dados.pedido). */
export type MarcaPedido = 'aguardando' | 'iniciado';
export const PEDIDO_AGUARDANDO: MarcaPedido = 'aguardando';
export const PEDIDO_INICIADO: MarcaPedido = 'iniciado';

/** Tempo depois do qual uma carga ainda aberta é tida como interrompida: 6 horas. */
export const TETO_CARGA_ABERTA_MS = 6 * 3_600_000;

/** O que o administrador vê de cada carga. */
export type SituacaoVisivelCarga =
  | 'aguardando'
  | 'em_execucao'
  | 'interrompida'
  | 'concluida'
  | 'concluida_com_rejeicao'
  | 'falhou'
  | 'cancelada';

export interface CargaAberta {
  readonly id: number;
  readonly ocorridoEm: Date;
}

export type DecisaoPedido =
  | { readonly aceito: true }
  | { readonly aceito: false; readonly motivo: 'carga-em-andamento'; readonly carga: number };

/** O pedido manual é aceito se nenhuma carga do estabelecimento está aberta há menos do que o teto. */
export function decidirPedidoManual(abertas: readonly CargaAberta[], agora: Date): DecisaoPedido {
  const viva = abertas.find((c) => agora.getTime() - c.ocorridoEm.getTime() < TETO_CARGA_ABERTA_MS);
  return viva ? { aceito: false, motivo: 'carga-em-andamento', carga: viva.id } : { aceito: true };
}

/** A situação que a tela mostra: a aberta separa o pedido que aguarda, a execução e a interrompida. */
export function situacaoVisivel(
  c: { readonly situacao: string; readonly pedido: string | null; readonly ocorridoEm: Date },
  agora: Date,
): SituacaoVisivelCarga {
  if (c.situacao !== 'em_execucao') {
    const fechadas: readonly string[] = ['concluida', 'concluida_com_rejeicao', 'falhou', 'cancelada'];
    if (!fechadas.includes(c.situacao)) throw new Error('situação da carga desconhecida');
    return c.situacao as SituacaoVisivelCarga;
  }
  if (agora.getTime() - c.ocorridoEm.getTime() >= TETO_CARGA_ABERTA_MS) return 'interrompida';
  return c.pedido === PEDIDO_AGUARDANDO ? 'aguardando' : 'em_execucao';
}

/** Duração da carga fechada, em milissegundos (null se ainda aberta ou com relógio invertido). */
export function duracaoDaCarga(ocorridoEm: Date, concluidoEm: Date | null): number | null {
  if (!concluidoEm) return null;
  const d = concluidoEm.getTime() - ocorridoEm.getTime();
  return d >= 0 ? d : null;
}
