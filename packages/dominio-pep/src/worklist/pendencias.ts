// Pendências da fila do médico (ficha do M27, regras 1 e 4; cap-05b §5.10, resultados no PEP; cap-03 §3.2):
//   - resultado novo e "crítico não visto": marcados até a visualização ou a ciência, inclusive os liberados no outro
//     sistema (a liberação está no banco do estabelecimento; a visualização registrada pelo outro sistema, a leitura no
//     prontuário do novo pelo próprio médico e a ciência do crítico tiram a marca);
//   - as demais vêm prontas dos módulos de origem (a evolução de 24 h, a prescrição a vencer, os pareceres e as
//     assinaturas pendentes) e só entram na ordem;
//   - ordem da fila (regra 1): prioridade (a soma dos pesos das pendências presentes) e depois o prazo mais próximo.
import type { LinhaWorklistMedico, PendenciaMedico, TipoPendenciaMedico } from '@sgh/contratos';

export interface ResultadoDoPaciente {
  readonly exame: number;
  /** ISO da liberação (do novo ou do outro sistema). */
  readonly liberadoEm: string | null;
  readonly critico: boolean;
  /** O outro sistema registrou a visualização (SILIBERACAOEXAME.DATA_HORA_VISUALIZACAO). */
  readonly visualizadoNoOutroSistema: boolean;
  /** O médico da fila abriu o resultado no prontuário do novo. */
  readonly vistoPeloMedico: boolean;
  /** Ciência do crítico registrada (por qualquer responsável). */
  readonly ciencia: boolean;
}

/** Visto: a visualização (no outro sistema ou pelo médico no novo) ou a ciência. */
export function resultadoVisto(r: ResultadoDoPaciente): boolean {
  return r.visualizadoNoOutroSistema || r.vistoPeloMedico || r.ciencia;
}

/** Quantos resultados novos e quantos críticos não vistos (o crítico conta só no crítico, não duas vezes). */
export function contarResultados(rs: readonly ResultadoDoPaciente[]): { novos: number; criticos: number } {
  let novos = 0;
  let criticos = 0;
  for (const r of rs) {
    if (!r.liberadoEm || resultadoVisto(r)) continue;
    if (r.critico) criticos++;
    else novos++;
  }
  return { novos, criticos };
}

/** Peso de cada pendência na ordem da fila (maior = mais urgente). */
export const PESOS_PENDENCIA: Readonly<Record<TipoPendenciaMedico, number>> = {
  'critico-nao-visto': 100,
  'sem-evolucao-24h': 60,
  'prescricao-a-renovar': 50,
  'parecer-atrasado': 40,
  'resultado-novo': 20,
  'parecer-pendente': 15,
  'assinatura-pendente': 10,
};

/** Prioridade da linha: a soma dos pesos das pendências presentes (a quantidade não multiplica). */
export function prioridadeDasPendencias(ps: readonly PendenciaMedico[]): number {
  return [...new Set(ps.filter((p) => p.quantidade > 0).map((p) => p.tipo))].reduce(
    (s, t) => s + PESOS_PENDENCIA[t],
    0,
  );
}

/** O prazo mais próximo das pendências (ISO), ou null. */
export function prazoMaisProximo(ps: readonly PendenciaMedico[]): string | null {
  const prazos = ps
    .map((p) => p.prazo)
    .filter((p): p is string => !!p)
    .sort();
  return prazos[0] ?? null;
}

/** Ordem da fila: prioridade (desc), prazo (o mais próximo primeiro; sem prazo por último), leito e nome. */
export function ordenarWorklistMedico<
  T extends Pick<LinhaWorklistMedico, 'prioridade' | 'prazo' | 'leito' | 'nome' | 'paciente'>,
>(linhas: readonly T[]): T[] {
  return [...linhas].sort(
    (a, b) =>
      b.prioridade - a.prioridade ||
      (a.prazo === null ? 1 : 0) - (b.prazo === null ? 1 : 0) ||
      (a.prazo ?? '').localeCompare(b.prazo ?? '') ||
      (a.leito === null ? 1 : 0) - (b.leito === null ? 1 : 0) ||
      (a.leito ?? '').localeCompare(b.leito ?? '', 'pt-BR', { numeric: true }) ||
      a.nome.localeCompare(b.nome, 'pt-BR') ||
      a.paciente - b.paciente,
  );
}
