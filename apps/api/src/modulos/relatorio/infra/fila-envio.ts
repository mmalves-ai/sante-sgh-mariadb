// Fila do envio de relatório (M34, regra 5): o job `relatorio-envio` na fila `relatorio-<rede>` do BullMQ (prefixo
// sgh), que o worker entrega por SMTP (fora de produção, só o coletor local; trava de saídas do M01). O job leva só o
// título, o link autenticado e os destinatários (conferido pelo Zod dos contratos). Sem VALKEY_URL, "sem-fila".
import { esquemaJobEnvioRelatorio, filaEnvioRelatorio, type JobEnvioRelatorio } from '@sgh/contratos';
import { Queue } from 'bullmq';
import type { FilaEnvioRelatorio } from '../aplicacao/gestao.js';

/**
 * Prefixo das filas no Valkey. M35: `FILAS_PREFIXO` separa as filas do E2E de um worktree (portas próprias) das do
 * `pnpm dev` do dono no mesmo Valkey: sem isso, o worker do dono consumia o job do E2E e o e-mail não chegava.
 */
export const PREFIXO_FILAS = prefixoDasFilas(process.env);

export function prefixoDasFilas(env: NodeJS.ProcessEnv): string {
  const p = env['FILAS_PREFIXO']?.trim();
  if (!p) return 'sgh';
  if (!/^sgh(?:-[a-z0-9]{1,20}){0,3}$/.test(p))
    throw new Error('FILAS_PREFIXO: sgh ou sgh-<parte> (minúsculas e dígitos).');
  return p;
}

export class FilaEnvioPorValkey implements FilaEnvioRelatorio {
  private readonly filas = new Map<string, Queue>();
  constructor(private readonly url: string) {
    const u = new URL(url);
    if (u.protocol !== 'redis:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
      throw new Error('VALKEY_URL: só redis:// em loopback.');
  }

  private fila(rede: string): Queue {
    let f = this.filas.get(rede);
    if (!f) {
      const u = new URL(this.url);
      f = new Queue(filaEnvioRelatorio(rede), {
        connection: {
          host: u.hostname.replace(/^\[|\]$/g, ''),
          port: Number(u.port || 6379),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2_000,
        },
        prefix: PREFIXO_FILAS,
      });
      f.on('error', () => undefined);
      this.filas.set(rede, f);
    }
    return f;
  }

  async enfileirar(job: JobEnvioRelatorio): Promise<'enfileirado' | 'sem-fila'> {
    const j = esquemaJobEnvioRelatorio.parse(job);
    try {
      await this.fila(j.rede).add('relatorio-envio', j, {
        jobId: `envio-${j.hospital}-${j.agendamento}-${Date.now()}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
      return 'enfileirado';
    } catch {
      return 'sem-fila';
    }
  }

  async encerrar(): Promise<void> {
    for (const f of this.filas.values()) await f.close().catch(() => undefined);
  }
}
