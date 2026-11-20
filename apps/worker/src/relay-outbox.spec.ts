// Peças do relay no worker (ficha do M04): nome da fila por rede, conexão só em loopback e falha rápida.
import { describe, expect, it } from 'vitest';
import { conexaoValkey, filaDeEventos } from './relay-outbox.js';

describe('relay da outbox no worker', () => {
  it('fila de eventos por rede (sem ":" no nome, que o BullMQ recusa)', () => {
    expect(filaDeEventos('rede-santa')).toBe('eventos-rede-santa');
    expect(() => filaDeEventos('Rede:X')).toThrow();
  });

  it('Valkey só em loopback por redis://; publicação falha rápido, consumo bloqueante sem limite de tentativas', () => {
    expect(conexaoValkey('redis://127.0.0.1:63718')).toMatchObject({
      host: '127.0.0.1',
      port: 63718,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(conexaoValkey('redis://localhost', true)).toMatchObject({
      port: 6379,
      maxRetriesPerRequest: null,
    });
    const r = conexaoValkey('redis://127.0.0.1:1') as { retryStrategy: (n: number) => number };
    expect(r.retryStrategy(1)).toBe(200);
    expect(r.retryStrategy(100)).toBe(2000);
    expect(() => conexaoValkey('redis://10.0.0.1:6379')).toThrow(/loopback/);
    expect(() => conexaoValkey('rediss://127.0.0.1:6379')).toThrow(/redis:\/\//);
  });
});
