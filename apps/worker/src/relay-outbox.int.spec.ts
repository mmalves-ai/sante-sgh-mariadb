// Relay → BullMQ no Valkey do Compose (ficha do M04, seção 10): com o Valkey "parado" (porta fechada) a
// publicação falha e o evento fica para a próxima tentativa; com o Valkey no ar o evento sai UMA vez (jobId =
// chave do evento: republicar não duplica) e o consumidor nulo idempotente o consome uma vez. Rede de teste
// própria (chaves isoladas), apagada no fim. Carga sintética (só IDs).
import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { conexaoValkey, consumidorNulo, filaBullmq, filaDeEventos, PREFIXO_FILAS } from './relay-outbox.js';

const URL_VALKEY = process.env['VALKEY_URL']?.trim() || 'redis://127.0.0.1:63718';
const REDE = `teste-m04-${randomBytes(3).toString('hex')}`;
const evento = {
  id: '1',
  cliente: REDE,
  hospital: 'pc',
  tipo: 'teste.sintetico',
  chave: `pc:teste.sintetico:${REDE}:0`,
  carga: { id: 1 },
  tentativas: 0,
};

async function noAr(): Promise<boolean> {
  const r = new Redis({ ...(conexaoValkey(URL_VALKEY) as object), lazyConnect: true });
  r.on('error', () => undefined);
  try {
    await r.connect();
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    r.disconnect();
  }
}
const disponivel = await noAr();

describe.skipIf(!disponivel)('relay da outbox no BullMQ (Valkey do Compose)', () => {
  const limpeza: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const f of limpeza.reverse()) await f().catch(() => undefined);
  });

  it('Valkey parado: falha; no ar: um job só, consumido uma vez', async () => {
    const parado = filaBullmq('redis://127.0.0.1:1', REDE, 1_000);
    await expect(parado.publicar(evento)).rejects.toThrow();
    void parado.fechar().catch(() => undefined);

    const fila = filaBullmq(URL_VALKEY, REDE);
    limpeza.push(() => fila.fechar());
    await fila.publicar(evento);
    await fila.publicar(evento); // nova tentativa depois de uma falha: mesma chave, nenhum job a mais
    const consumidos: string[] = [];
    const consumidor = consumidorNulo(URL_VALKEY, REDE, (id) => consumidos.push(id));
    limpeza.push(() => consumidor.fechar());
    const fim = Date.now() + 20_000;
    while (consumidos.length === 0 && Date.now() < fim) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 500));
    const admin = new Queue(filaDeEventos(REDE), {
      connection: conexaoValkey(URL_VALKEY, true),
      prefix: PREFIXO_FILAS,
    });
    limpeza.push(async () => {
      await admin.obliterate({ force: true });
      await admin.close();
    });
    const conjunto = new Redis({ ...(conexaoValkey(URL_VALKEY, true) as object) });
    limpeza.push(async () => {
      await conjunto.del(`${PREFIXO_FILAS}:${REDE}:eventos:consumidos`);
      conjunto.disconnect();
    });
    const contagens = await admin.getJobCounts('completed', 'waiting', 'active', 'failed');
    expect(consumidos).toHaveLength(1);
    expect(await conjunto.scard(`${PREFIXO_FILAS}:${REDE}:eventos:consumidos`)).toBe(1);
    expect((contagens['completed'] ?? 0) + (contagens['waiting'] ?? 0) + (contagens['active'] ?? 0)).toBe(1);
    console.log(
      `[valkey] relay: parado falha; no ar 1 job (${JSON.stringify(contagens)}), consumido ${consumidos.length} vez`,
    );
  });
});
