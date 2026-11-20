// Trabalho sem rede à beira do leito (ficha do M25, regra 8; cap-05b §5.8; cap-09 §9.7 "PWA e offline restrito"):
// sem rede, o tablet só faz checagem, sinal vital e anotação simples; guarda a hora real do ato; sincroniza na ordem
// em que os atos foram feitos, cada um com a chave de idempotência; o servidor relê o horário e, se houve suspensão ou
// checagem em qualquer um dos dois sistemas depois da leitura, abre o conflito visível e avisa o enfermeiro e a
// farmácia: nunca sobrescreve. O que o tablet guarda é cifrado e apagado no logout ou no prazo.
import { diferencaMinutos } from '../tempo.js';

export const ATOS_SEM_REDE = ['checagem', 'sinal', 'anotacao'] as const;
export type AtoSemRede = (typeof ATOS_SEM_REDE)[number];

/** Só checagem, sinal vital e anotação simples podem ser feitos sem rede. */
export function permitidoSemRede(tipo: string): tipo is AtoSemRede {
  return (ATOS_SEM_REDE as readonly string[]).includes(tipo);
}

export interface AtoGuardado {
  readonly chave: string;
  readonly tipo: string;
  readonly horaReal: string;
  /** Ordem local (sequência do aparelho): desempata atos do mesmo minuto. */
  readonly sequencia: number;
}

/** A ordem do envio: a hora real do ato e, no mesmo minuto, a sequência do aparelho. */
export function ordemDeEnvio<T extends AtoGuardado>(atos: readonly T[]): T[] {
  return [...atos].sort((a, b) => a.horaReal.localeCompare(b.horaReal) || a.sequencia - b.sequencia);
}

/** Chaves repetidas na fila (a mesma chave é o mesmo ato: vai uma vez). */
export function semRepetidos<T extends AtoGuardado>(atos: readonly T[]): T[] {
  const vistas = new Set<string>();
  return atos.filter((a) => (vistas.has(a.chave) ? false : (vistas.add(a.chave), true)));
}

export type DecisaoSincronizacao =
  | { readonly gravar: true }
  | { readonly gravar: false; readonly conflito: 'suspenso' | 'jaChecado' | 'mudou' };

/**
 * Regra 8: o servidor relê o horário antes de gravar o ato que chegou do tablet. A situação lida pelo tablet tem de
 * ser a de agora; se mudou (suspensão, checagem neste ou no outro sistema), o ato vira conflito.
 */
export function decidirSincronizacao(s: {
  readonly situacaoLida: string;
  readonly situacaoAtual: string;
}): DecisaoSincronizacao {
  if (s.situacaoAtual === s.situacaoLida && s.situacaoAtual === 'P') return { gravar: true };
  if (s.situacaoAtual === 'S' || s.situacaoAtual === 'C' || s.situacaoAtual === 'X')
    return { gravar: false, conflito: 'suspenso' };
  if (s.situacaoAtual === 'A' || s.situacaoAtual === 'N') return { gravar: false, conflito: 'jaChecado' };
  return { gravar: false, conflito: 'mudou' };
}

/** A hora real do ato vale: não é do futuro (tolerância do relógio do aparelho) nem anterior ao prazo do cache. */
export function horaRealAceita(c: {
  readonly horaReal: string;
  readonly agora: string;
  readonly prazoHoras: number;
  readonly folgaRelogioMinutos?: number;
}): boolean {
  const d = diferencaMinutos(c.horaReal, c.agora);
  return d >= -(c.folgaRelogioMinutos ?? 5) && d <= c.prazoHoras * 60;
}

/** O que o tablet guardou venceu (passou do prazo do cache): é apagado sem enviar o que for leitura. */
export function cacheVencido(guardadoEm: string, agora: string, prazoHoras: number): boolean {
  return diferencaMinutos(guardadoEm, agora) > prazoHoras * 60;
}
