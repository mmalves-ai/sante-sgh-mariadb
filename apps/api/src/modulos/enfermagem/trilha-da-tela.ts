// A linha da trilha que a tela monta (evento auditável, recurso, paciente, estação e motivo) nas portas próprias da
// SAE, da vacina e da transfusão. A tela passa a linha pronta ou uma função do resultado; a função é resolvida
// DENTRO da operação do Executor, depois de gravar, com o resultado da gravação, e vai nos dados da trilha da mesma
// transação. Sem nenhuma escrita (a recusa de segurança, o registro só de auditoria), a porta roda uma operação sem
// escrita que grava só a trilha.
// Melhoria: o evento auditável e o paciente nunca se perdem (antes, a linha montada por função era descartada).
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, definirOperacao, type Executor, type ResultadoOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { TrilhaDaGravacao } from '../exames/public-api.js';

/** A trilha que a tela entrega à porta: pronta, função do resultado ou nenhuma. */
export type TrilhaDaTela<T = never> = TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null;

/** A linha da trilha resolvida com o resultado (a função que falha não derruba a gravação: fica a trilha do Executor). */
export function resolverTrilha(t: TrilhaDaTela<unknown> | undefined, r: unknown): TrilhaDaGravacao | null {
  if (!t) return null;
  if (typeof t !== 'function') return t;
  try {
    return t(r);
  } catch {
    return null;
  }
}

/** Os extras da trilha do Executor pela linha da tela (motivo e dados: evento, recurso, paciente e estação). */
export function extrasDaTrilha(l: TrilhaDaGravacao | null): { motivo: string | null; dados: unknown } {
  return { motivo: l?.motivo ?? null, dados: l?.dadosDepois ?? null };
}

/**
 * Operação sem escrita que grava só a linha da trilha da tela (ex.: o bloqueio da transfusão, regra 11). O alvo é a
 * tabela própria que a porta indica para a entidade da tela, com o id dela.
 */
export async function gravarSoTrilha(
  executor: Executor,
  c: ContextoNucleo & { readonly estabelecimento: number },
  nome: string,
  alvo: { readonly tabela: string; readonly id: number | null },
  linha: TrilhaDaGravacao | null,
): Promise<void> {
  const op = definirOperacao<{ chave: string }, ResultadoOperacao>({
    nome,
    tabelas: [alvo.tabela],
    entrada: z.object({ chave: z.string() }),
    async gravar() {
      return {};
    },
    alvo: () => ({ tabela: alvo.tabela, id: alvo.id }),
    trilha: () => ({ acao: 'operacao' as const, ...extrasDaTrilha(linha) }),
  });
  const chave = `trilha:${randomUUID()}`;
  await executor.executar(
    op,
    c.cliente,
    { chave },
    {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: chave,
    },
  );
}
