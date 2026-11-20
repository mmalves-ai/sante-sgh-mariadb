import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Relogio } from './relogio.js';
import { SinalDeVidaService } from './sinal-de-vida.service.js';
import { WorkerModule } from './worker.module.js';

describe('worker', () => {
  it('sobe o contexto Nest sem HTTP e injeta o relógio no sinal de vida', async () => {
    const contexto = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    const sinal = contexto.get(SinalDeVidaService);
    expect(sinal.descrever().estado).toBe('vivo');
    expect(Reflect.getMetadata('design:paramtypes', SinalDeVidaService)).toEqual([Relogio]);
    await contexto.close();
  });
});

describe('serviços do worker (M34: WORKER_SERVICOS)', () => {
  it('sem a variável, todos; com a lista, só os pedidos (e o sinal de vida)', async () => {
    const { servicosDoWorker } = await import('./worker.module.js');
    expect(servicosDoWorker({}).length).toBeGreaterThanOrEqual(12);
    const so = servicosDoWorker({ WORKER_SERVICOS: 'relatorio-envio, desconhecido' });
    expect(so.map((p) => (p as { name: string }).name)).toEqual([
      'SinalDeVidaService',
      'EnvioRelatorioService',
    ]);
  });
});
