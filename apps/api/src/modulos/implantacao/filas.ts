// M60, etapa 3: o que a fumaça do servidor lê do Valkey: se responde (uma leitura curta, com a latência) e, por fila do BullMQ que
// a API conhece (email-<rede>, relatorio-<rede>), os consumidores conectados (os workers) e as contagens de trabalhos.
// Só contagens; nenhum conteúdo de trabalho sai daqui. Sem VALKEY_URL, a porta "sem Valkey" (configurado: falso).
import {
  FILAS_CONFERIDAS,
  type FilaConferida,
  type FilaConferidaCodigo,
  filaEnvioRelatorio,
  type ValkeyConferido,
} from '@sgh/contratos';
import { Queue } from 'bullmq';
import { filaDeEmail, PREFIXO_FILAS } from '../acesso/alerta.js';

export const FILAS_IMPLANTACAO = Symbol('FILAS_IMPLANTACAO');

/** Tempo máximo de cada leitura no Valkey (a fumaça nunca fica pendurada). */
export const TEMPO_LEITURA_VALKEY_MS = 3_000;

export interface PortaFilasImplantacao {
  valkey(rede: string): Promise<ValkeyConferido>;
  filas(rede: string): Promise<FilaConferida[]>;
  encerrar?(): Promise<void>;
}

const nomeDaFila = (codigo: FilaConferidaCodigo, rede: string): string =>
  codigo === 'email' ? filaDeEmail(rede) : filaEnvioRelatorio(rede);

const semLeitura = (codigo: FilaConferidaCodigo): FilaConferida => ({
  codigo,
  consumidores: null,
  aguardando: null,
  ativos: null,
  atrasados: null,
  falhas: null,
});

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error('tempo esgotado')), ms);
      t.unref();
    }),
  ]).finally(() => clearTimeout(t));
}

/** Sem VALKEY_URL: nada a ler (o item sai em alerta fora de produção e em falha nela). */
export class FilasSemValkey implements PortaFilasImplantacao {
  valkey(): Promise<ValkeyConferido> {
    return Promise.resolve({ configurado: false, responde: false, latenciaMs: null });
  }
  filas(): Promise<FilaConferida[]> {
    return Promise.resolve(FILAS_CONFERIDAS.map(semLeitura));
  }
}

/** As filas do BullMQ no Valkey de VALKEY_URL (só redis:// em loopback, como as demais filas da API). */
export class FilasBullmq implements PortaFilasImplantacao {
  private readonly filasAbertas = new Map<string, Queue>();
  private readonly conexao: { host: string; port: number };

  constructor(
    url: string,
    private readonly prefixo: string = PREFIXO_FILAS,
    private readonly prazoMs: number = TEMPO_LEITURA_VALKEY_MS,
  ) {
    const u = new URL(url);
    if (u.protocol !== 'redis:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
      throw new Error('VALKEY_URL: só redis:// em loopback.');
    this.conexao = { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port || 6379) };
  }

  private fila(nome: string): Queue {
    let f = this.filasAbertas.get(nome);
    if (!f) {
      f = new Queue(nome, {
        connection: {
          ...this.conexao,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2_000,
          lazyConnect: true,
        },
        prefix: this.prefixo,
      });
      f.on('error', () => undefined);
      this.filasAbertas.set(nome, f);
    }
    return f;
  }

  async valkey(rede: string): Promise<ValkeyConferido> {
    const inicio = Date.now();
    try {
      // Uma leitura curta na fila (o BullMQ 6 não expõe o cliente): respondeu, o Valkey está no ar.
      await comPrazo(this.fila(nomeDaFila('email', rede)).getJobCounts('waiting'), this.prazoMs);
      return { configurado: true, responde: true, latenciaMs: Date.now() - inicio };
    } catch {
      return { configurado: true, responde: false, latenciaMs: null };
    }
  }

  async filas(rede: string): Promise<FilaConferida[]> {
    const lidas: FilaConferida[] = [];
    for (const codigo of FILAS_CONFERIDAS) {
      try {
        const f = this.fila(nomeDaFila(codigo, rede));
        const [consumidores, c] = await comPrazo(
          Promise.all([f.getWorkersCount(), f.getJobCounts('waiting', 'active', 'delayed', 'failed')]),
          this.prazoMs,
        );
        lidas.push({
          codigo,
          consumidores,
          aguardando: c['waiting'] ?? 0,
          ativos: c['active'] ?? 0,
          atrasados: c['delayed'] ?? 0,
          falhas: c['failed'] ?? 0,
        });
      } catch {
        lidas.push(semLeitura(codigo));
      }
    }
    return lidas;
  }

  async encerrar(): Promise<void> {
    await Promise.allSettled([...this.filasAbertas.values()].map((f) => f.close()));
    this.filasAbertas.clear();
  }
}

/** A porta pelo ambiente: com VALKEY_URL, o BullMQ; sem ela, a porta sem Valkey. */
export function filasDoAmbiente(env: NodeJS.ProcessEnv): PortaFilasImplantacao {
  const url = env['VALKEY_URL']?.trim();
  return url ? new FilasBullmq(url) : new FilasSemValkey();
}
