// Alerta ao Auditor da quebra de vidro (ficha do M06, regra 8): job na fila `email-<rede>` do BullMQ (prefixo
// sgh), que o worker entrega por SMTP (Mailpit fora de produção; a trava de saídas do M01 garante). A carga
// leva só identificadores e códigos (nunca nome de paciente nem a justificativa). Sem VALKEY_URL (dev sem
// Valkey), o alerta fica só no log e na trilha, e a resposta diz "sem-fila".
import { Queue } from 'bullmq';

export interface AlertaEmergencia {
  readonly rede: string;
  readonly hospital: string;
  readonly idEmergencia: string;
  readonly idUsuario: string;
  readonly motivo: string;
  readonly inicio: string;
  readonly fim: string;
}

/** ADR 0021: aviso ao Auditor da abertura da sessão "como" (só identificadores e códigos). */
export interface AlertaSuporte {
  readonly rede: string;
  readonly hospital: string;
  readonly idSessao: string;
  readonly atorTipo: string;
  readonly idUsuario: string;
  readonly motivo: string;
  readonly inicio: string;
  readonly fim: string;
}

/** M15 (regra 12): alerta de leitura do prontuário (muitos prontuários ou fora do horário); só códigos. */
export interface AlertaLeitura {
  readonly rede: string;
  readonly hospital: string;
  readonly idUsuario: string;
  readonly tipo: 'muitos-prontuarios' | 'fora-do-horario';
  readonly criticidade: number;
  readonly em: string;
}

export interface AlertaAuditor {
  emergenciaAberta(a: AlertaEmergencia): Promise<'enfileirado' | 'sem-fila'>;
  /** M15: alerta de leitura do prontuário ao Auditor (fila email; sem fila, só log e trilha). */
  leituraProntuario?(a: AlertaLeitura): Promise<'enfileirado' | 'sem-fila'>;
  /** Com o banco da plataforma, o aviso vai à SGH_OUTBOX; este caminho é o da memória (dev/ci sintético). */
  suporteSessaoAberta?(a: AlertaSuporte): Promise<'enfileirado' | 'sem-fila'>;
  encerrar?(): Promise<void>;
}

export const ALERTA_AUDITOR = Symbol('ALERTA_AUDITOR');
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

export function filaDeEmail(rede: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(rede)) throw new Error('Código de rede inválido para a fila.');
  return `email-${rede}`;
}

export class AlertaPorFila implements AlertaAuditor {
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
      f = new Queue(filaDeEmail(rede), {
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

  async emergenciaAberta(a: AlertaEmergencia): Promise<'enfileirado'> {
    await this.fila(a.rede).add('alerta-emergencia', a, {
      // Único por abertura (número + início): a fila não deduplica alertas de aberturas diferentes.
      jobId: `emergencia-${a.hospital}-${a.idEmergencia}-${Date.parse(a.inicio)}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
    });
    return 'enfileirado';
  }

  async suporteSessaoAberta(a: AlertaSuporte): Promise<'enfileirado'> {
    await this.fila(a.rede).add('alerta-suporte', a, {
      jobId: `suporte-${a.hospital}-${a.idSessao}-${Date.parse(a.inicio)}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
    });
    return 'enfileirado';
  }

  async leituraProntuario(a: AlertaLeitura): Promise<'enfileirado'> {
    await this.fila(a.rede).add('alerta-leitura', a, {
      jobId: `leitura-${a.hospital}-${a.idUsuario}-${a.tipo}-${Date.parse(a.em)}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
    });
    return 'enfileirado';
  }

  async encerrar(): Promise<void> {
    for (const f of this.filas.values()) await f.close().catch(() => undefined);
  }
}

export class AlertaSemFila implements AlertaAuditor {
  constructor(private readonly aviso: (m: string, c: Record<string, unknown>) => void) {}
  emergenciaAberta(a: AlertaEmergencia): Promise<'sem-fila'> {
    this.aviso('alerta de quebra de vidro sem fila (VALKEY_URL ausente)', {
      estabelecimento: a.hospital,
      emergencia: a.idEmergencia,
    });
    return Promise.resolve('sem-fila');
  }
  leituraProntuario(a: AlertaLeitura): Promise<'sem-fila'> {
    this.aviso('alerta de leitura do prontuário sem fila (VALKEY_URL ausente)', {
      estabelecimento: a.hospital,
      tipo: a.tipo,
    });
    return Promise.resolve('sem-fila');
  }
  suporteSessaoAberta(a: AlertaSuporte): Promise<'sem-fila'> {
    this.aviso('aviso de sessão do suporte técnico sem fila (VALKEY_URL ausente)', {
      estabelecimento: a.hospital,
      sessao: a.idSessao,
    });
    return Promise.resolve('sem-fila');
  }
}
