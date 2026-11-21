// Relay da outbox no worker (ficha do M04, seção 1): a cada OUTBOX_INTERVALO_MS (padrão 1 s), um ciclo por
// cliente (relay-outbox-proprio.ts: pendentes de integracao_mensagem em ordem de id, publica, marca enviada; falha
// com espera crescente e, esgotada, erro). Publica no BullMQ, fila `eventos-<cliente>` com o prefixo `sgh`
// (chaves do cliente, ARQ-2), job com o TIPO do evento e jobId = chave do evento: a republicação depois de uma
// falha não duplica. Consumidor nulo idempotente (prova do ciclo neste marco; os consumidores reais nascem
// nos marcos donos): anota a chave num conjunto do Valkey e não faz mais nada. Só Valkey em loopback (trava de
// saídas do M01). Carga só com IDs e códigos (conferida na gravação). M06: o evento `alerta-emergencia`
// (quebra de vidro, gravado na fila comum de saída na mesma transação da abertura) vai à fila `email-<rede>`, que o
// EmailService entrega ao Auditor; a fila fora não perde o alerta (fica pendente na outbox).
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

/** Mensagem pendente da fila comum de saída (integracao_mensagem), como o relay a publica. */
export interface PendenteOutbox {
  readonly id: string;
  /** Código do cliente (o banco). */
  readonly cliente: string;
  /** Código do estabelecimento da mensagem (null: mensagem do cliente inteiro). */
  readonly hospital: string | null;
  /** O ponto de integração (o tipo do evento). */
  readonly tipo: string;
  /** A chave única do evento (o jobId). */
  readonly chave: string;
  /** Só ids e códigos. */
  readonly carga: Readonly<Record<string, string | number | boolean | null>>;
  readonly tentativas: number;
}

export type Publicador = (ev: PendenteOutbox) => Promise<void>;

/** Os dados do job: a carga (booleano vira 1/0; nulo sai) e o código do estabelecimento, quando houver. */
export function dadosDoJobOutbox(ev: PendenteOutbox): Record<string, string | number> {
  const d: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(ev.carga))
    if (typeof v === 'string' || typeof v === 'number') d[k] = v;
    else if (typeof v === 'boolean') d[k] = v ? 1 : 0;
  if (ev.hospital !== null && d['hospital'] === undefined) d['hospital'] = ev.hospital;
  return d;
}

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

/** Nome da fila de eventos do cliente (BullMQ não aceita ':' no nome; o prefixo e o cliente separam os clientes). */
export function filaDeEventos(rede: string): string {
  if (!/^[a-z0-9_-]{1,63}$/.test(rede)) throw new Error('Código de rede inválido para a fila.');
  return `eventos-${rede}`;
}

/**
 * Conexão do BullMQ pelo VALKEY_URL (redis:// em loopback). Publicação: falha rápido (sem fila offline nem
 * nova tentativa: a outbox é que tenta de novo). Consumo (bloqueante): o BullMQ exige maxRetriesPerRequest nulo.
 */
export function conexaoValkey(url: string, bloqueante = false): ConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:') throw new Error('VALKEY_URL: use redis://.');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    throw new Error('VALKEY_URL fora do loopback.');
  const base = {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: Number(u.port || 6379),
    connectTimeout: 2_000,
  };
  return bloqueante
    ? { ...base, maxRetriesPerRequest: null }
    : {
        ...base,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (n: number) => Math.min(n * 200, 2_000),
      };
}

export interface Fila {
  readonly publicar: Publicador;
  fechar(): Promise<void>;
}

/** Tipo do evento da outbox que vai à fila de e-mail (alerta da quebra de vidro ao Auditor). */
export const EVENTO_ALERTA_EMERGENCIA = 'alerta-emergencia';
/** ADR 0021: aviso ao Auditor da abertura de uma sessão "como" (suporte técnico ou plataforma). */
export const EVENTO_ALERTA_SUPORTE = 'alerta-suporte';
/** M14 (regra 14): tabela que estava vazia passou a ter dados (aviso à TI e ao responsável técnico). */
export const EVENTO_ALERTA_TABELA_VAZIA = 'alerta-tabela-vazia';
/** M37 (regra 7): chamado com dado pessoal (aviso ao encarregado) ou S1 (aviso ao plantão). */
export const EVENTO_ALERTA_CHAMADO = 'alerta-chamado';
/** M38 (cap-14 §14.6): divergência na vigilância diária de gravação em produção (alerta direto à TI). */
export const EVENTO_ALERTA_ASSINATURA = 'alerta-assinatura-divergente';
/** Eventos da outbox que vão à fila de e-mail. */
export const EVENTOS_DE_EMAIL: ReadonlySet<string> = new Set([
  EVENTO_ALERTA_EMERGENCIA,
  EVENTO_ALERTA_SUPORTE,
  EVENTO_ALERTA_TABELA_VAZIA,
  EVENTO_ALERTA_CHAMADO,
  EVENTO_ALERTA_ASSINATURA,
]);

export function filaDeEmail(rede: string): string {
  if (!/^[a-z0-9_-]{1,63}$/.test(rede)) throw new Error('Código de rede inválido para a fila.');
  return `email-${rede}`;
}

/** Publicador BullMQ da rede (um por processo). */
export function filaBullmq(url: string, rede: string, tempoMs = 3_000): Fila {
  const fila = new Queue(filaDeEventos(rede), { connection: conexaoValkey(url), prefix: PREFIXO_FILAS });
  fila.on('error', () => undefined); // a falha chega ao relay pela promessa (vira nova tentativa)
  const email = new Queue(filaDeEmail(rede), { connection: conexaoValkey(url), prefix: PREFIXO_FILAS });
  email.on('error', () => undefined);
  return {
    async publicar(ev: PendenteOutbox) {
      // Valkey fora: o BullMQ esperaria a conexão; o relay prefere falhar e tentar de novo depois.
      let relogio: NodeJS.Timeout | undefined;
      const limite = new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new Error('Valkey indisponível (tempo esgotado)')), tempoMs);
      });
      try {
        const dados = dadosDoJobOutbox(ev);
        const jobId = ev.chave.replace(/:/g, '_');
        await Promise.race([
          EVENTOS_DE_EMAIL.has(ev.tipo)
            ? email.add(ev.tipo, dados, {
                jobId,
                attempts: 5,
                backoff: { type: 'exponential', delay: 2_000 },
                removeOnComplete: 1_000,
                removeOnFail: 5_000,
              })
            : fila.add(ev.tipo, dados, { jobId, removeOnComplete: 1_000, removeOnFail: 5_000 }),
          limite,
        ]);
      } finally {
        clearTimeout(relogio);
      }
    },
    async fechar() {
      await fila.close();
      await email.close();
    },
  };
}

/**
 * Consumidor idempotente: anota a chave do job (SADD) e conta. M34: `processar` (as integrações novas) recebe o
 * evento ANTES da anotação; se falhar, o BullMQ tenta de novo e o processamento é idempotente pela chave do evento.
 */
export function consumidorNulo(
  url: string,
  rede: string,
  aoConsumir?: (jobId: string) => void,
  processar?: (ev: { chave: string; tipo: string; dados: Record<string, string | number> }) => Promise<void>,
): { worker: Worker; fechar(): Promise<void> } {
  const anotacoes = new Redis({ ...(conexaoValkey(url, true) as object), lazyConnect: false });
  anotacoes.on('error', () => undefined);
  const worker = new Worker(
    filaDeEventos(rede),
    async (job) => {
      await processar?.({
        chave: String(job.id),
        tipo: job.name,
        dados: (job.data ?? {}) as Record<string, string | number>,
      });
      await anotacoes.sadd(`${PREFIXO_FILAS}:${rede}:eventos:consumidos`, String(job.id));
      aoConsumir?.(String(job.id));
    },
    { connection: conexaoValkey(url, true), prefix: PREFIXO_FILAS, autorun: true },
  );
  worker.on('error', () => undefined);
  return {
    worker,
    async fechar() {
      await worker.close();
      anotacoes.disconnect();
    },
  };
}
