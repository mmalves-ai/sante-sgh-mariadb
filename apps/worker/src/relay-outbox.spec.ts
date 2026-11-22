// Peças do relay no worker (ficha do M04; lote F2.2 05-16): nome da fila por cliente, conexão só em loopback e falha
// rápida, os dados do job e o ciclo sobre a fila comum de saída (núcleo falso: marca enviada, soma a tentativa com
// espera crescente e, esgotadas, erro).
import { describe, expect, it } from 'vitest';
import {
  cicloRelayOutbox,
  esperaDaTentativa,
  MAX_TENTATIVAS_RELAY,
  type NucleoRelay,
} from './relay-outbox-proprio.js';
import { conexaoValkey, dadosDoJobOutbox, filaDeEventos, type PendenteOutbox } from './relay-outbox.js';

describe('relay da outbox no worker', () => {
  it('fila de eventos por cliente (sem ":" no nome, que o BullMQ recusa)', () => {
    expect(filaDeEventos('rede-santa')).toBe('eventos-rede-santa');
    expect(filaDeEventos('f22_o5')).toBe('eventos-f22_o5');
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

  it('dados do job: a carga (booleano 1/0, nulo fora) e o código do estabelecimento', () => {
    const ev: PendenteOutbox = {
      id: '1',
      cliente: 'f22_teste',
      hospital: 'pc',
      tipo: 'imagem.mwl',
      chave: 'abc',
      carga: { exame: 5, ok: true, nada: null, texto: 'x' },
      tentativas: 0,
    };
    expect(dadosDoJobOutbox(ev)).toEqual({ exame: 5, ok: 1, texto: 'x', hospital: 'pc' });
    expect(dadosDoJobOutbox({ ...ev, hospital: null, carga: {} })).toEqual({});
  });

  it('ciclo: publicada vira enviada; a falha soma a tentativa com espera; esgotada vira erro', async () => {
    const linhas = [
      {
        id: 1,
        ponto: 'a.b',
        referencia_externa: 'k1',
        conteudo: '{"exame":1}',
        tentativas: 0,
        estabelecimento: 'pc',
      },
      {
        id: 2,
        ponto: 'a.b',
        referencia_externa: 'k2',
        conteudo: 'não é json',
        tentativas: 0,
        estabelecimento: null,
      },
      {
        id: 3,
        ponto: 'a.b',
        referencia_externa: null,
        conteudo: null,
        tentativas: MAX_TENTATIVAS_RELAY - 1,
        estabelecimento: 'pc',
      },
    ];
    const comandos: unknown[][] = [];
    const nucleo: NucleoRelay = {
      lerSomente: async (_c, fn) =>
        fn({ cliente: 'f22_teste', consultar: async () => linhas, uma: async () => null } as never),
      escrever: async (_c, fn) =>
        fn({
          executar: async (_sql: string, p: unknown[] = []) => {
            comandos.push(p);
            return 1;
          },
        } as never),
    };
    const publicados: PendenteOutbox[] = [];
    const agora = new Date('2026-11-21T10:00:00Z');
    const r = await cicloRelayOutbox(
      nucleo,
      'f22_teste',
      async (ev) => {
        if (ev.id !== '1') throw new Error('fora');
        publicados.push(ev);
      },
      { agora: () => agora },
    );
    expect(r).toEqual({ lidos: 3, publicados: 1, falhas: 2, esgotados: 1 });
    expect(publicados[0]).toMatchObject({ chave: 'k1', hospital: 'pc', carga: { exame: 1 } });
    expect(comandos[0]).toEqual([agora, agora, 1]);
    expect(comandos[1]).toEqual([
      1,
      new Date(agora.getTime() + esperaDaTentativa(1)),
      'pendente',
      'publicacao-falhou:Error',
      agora,
      2,
    ]);
    expect(comandos[2]![2]).toBe('erro');
    expect(esperaDaTentativa(20)).toBe(600_000);
  });
});
