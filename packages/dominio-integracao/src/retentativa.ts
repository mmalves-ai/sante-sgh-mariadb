// Entrega das integrações novas (M34; ficha, regras 8 a 10; cap-12 §12.3): pelo menos uma vez, com retentativa
// crescente (1 min, 5 min, 30 min, 2 h e, daí em diante, a cada 2 h) até o limite do parceiro; esgotou, fila de
// mortos. Ordem por objeto: a mensagem de um paciente ou de uma conta só sai depois da anterior do mesmo objeto
// (a que está na fila de mortos segura as seguintes até ser tratada); objetos diferentes não esperam um pelo outro
// (parceiro lento não atrasa os outros). Regras puras: o relógio entra como parâmetro.

/** Esperas entre as tentativas, em minutos (a última se repete até o limite do parceiro). */
export const ESPERAS_RETENTATIVA_MIN = [1, 5, 30, 120] as const;

/** Espera antes da tentativa seguinte, dado quantas já falharam (1 = a primeira falhou). */
export function esperaMinutos(falhas: number): number {
  if (!Number.isInteger(falhas) || falhas < 1) throw new Error('Número de falhas inválido.');
  return ESPERAS_RETENTATIVA_MIN[Math.min(falhas, ESPERAS_RETENTATIVA_MIN.length) - 1]!;
}

export type DepoisDaFalha =
  | { readonly situacao: 'pendente'; readonly tentativas: number; readonly proximaEm: Date }
  | { readonly situacao: 'morto'; readonly tentativas: number; readonly mortoEm: Date };

/**
 * O que acontece com a mensagem depois de uma falha: nova tentativa com a espera crescente ou, esgotado o limite
 * do parceiro, a fila de mortos.
 */
export function depoisDaFalha(tentativasAntes: number, limite: number, agora: Date): DepoisDaFalha {
  if (!Number.isInteger(limite) || limite < 1) throw new Error('Limite de tentativas inválido.');
  const tentativas = tentativasAntes + 1;
  if (tentativas >= limite) return { situacao: 'morto', tentativas, mortoEm: agora };
  return {
    situacao: 'pendente',
    tentativas,
    proximaEm: new Date(agora.getTime() + esperaMinutos(tentativas) * 60_000),
  };
}

export interface EnvioNaFila {
  readonly id: string;
  readonly parceiro: string;
  readonly chaveOrdem: string;
  readonly situacao: 'pendente' | 'enviado' | 'morto' | 'descartado';
  /** Ordem de chegada (ID crescente da outbox). */
  readonly ordem: number;
  readonly proximaTentativaEm: Date | null;
}

/**
 * As mensagens que podem sair agora: por parceiro e objeto, só a primeira ainda não entregue, e só se chegou a hora
 * dela. Uma morta à frente segura o objeto (a ordem não se quebra); descartada não segura.
 */
export function prontasParaEnviar(fila: readonly EnvioNaFila[], agora: Date): EnvioNaFila[] {
  const porObjeto = new Map<string, EnvioNaFila[]>();
  for (const e of fila) {
    if (e.situacao === 'enviado' || e.situacao === 'descartado') continue;
    const k = `${e.parceiro}\u0000${e.chaveOrdem}`;
    const l = porObjeto.get(k) ?? [];
    l.push(e);
    porObjeto.set(k, l);
  }
  const prontas: EnvioNaFila[] = [];
  for (const l of porObjeto.values()) {
    const primeira = [...l].sort((a, b) => a.ordem - b.ordem)[0]!;
    if (primeira.situacao !== 'pendente') continue;
    if (primeira.proximaTentativaEm && primeira.proximaTentativaEm.getTime() > agora.getTime()) continue;
    prontas.push(primeira);
  }
  return prontas.sort((a, b) => a.ordem - b.ordem);
}

/** Minutos de uma mensagem na fila de mortos (inteiro, para baixo). */
export function minutosNaFilaDeMortos(mortoEm: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - mortoEm.getTime()) / 60_000));
}

export interface MortoSemTratamento {
  readonly id: string;
  readonly parceiro: string;
  readonly mortoEm: Date;
  readonly tratado: boolean;
}

/** Regra 10: mortos sem tratamento há mais que o limite (padrão 4 h) geram alerta. */
export function alertasDeMortos(
  mortos: readonly MortoSemTratamento[],
  limiteMinutos: number,
  agora: Date,
): { id: string; parceiro: string; minutos: number }[] {
  return mortos
    .filter((m) => !m.tratado)
    .map((m) => ({ id: m.id, parceiro: m.parceiro, minutos: minutosNaFilaDeMortos(m.mortoEm, agora) }))
    .filter((m) => m.minutos > limiteMinutos)
    .sort((a, b) => b.minutos - a.minutos);
}

export type Tratamento = 'reprocessar' | 'corrigir' | 'descartar';

/**
 * O tratamento de uma mensagem morta: reprocessar (o mesmo conteúdo, tentativas zeradas), corrigir (o conteúdo
 * refeito do fato atual, depois de corrigido o de-para ou o cadastro) ou descartar (sai da fila, com motivo). Só a
 * mensagem na fila de mortos pode ser tratada.
 */
export function aplicarTratamento(
  situacao: EnvioNaFila['situacao'],
  acao: Tratamento,
  motivo: string,
): { situacao: 'pendente' | 'descartado'; refazerConteudo: boolean } {
  if (situacao !== 'morto') throw new Error('Só a mensagem na fila de mortos pode ser tratada.');
  if (motivo.trim().length < 5) throw new Error('O tratamento exige o motivo.');
  if (acao === 'descartar') return { situacao: 'descartado', refazerConteudo: false };
  return { situacao: 'pendente', refazerConteudo: acao === 'corrigir' };
}
