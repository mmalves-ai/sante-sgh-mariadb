// Faixas do vigia (M09, revisão): limite NaN desligaria o alerta em silêncio e intervalo 0 bateria no MON$
// do legado a cada ~1 ms; os dois são recusados na leitura da configuração.
import { describe, expect, it } from 'vitest';
import type { Leitor } from '../transacao.js';
import {
  INTERVALO_COLETA_MS,
  LIMITE_TRANSACAO_PADRAO_MS,
  coletar,
  lerConfiguracaoVigia,
  lerMon,
} from './coletor.js';

describe('configuração do vigia', () => {
  it('padrões sem chave', () => {
    expect(lerConfiguracaoVigia({})).toEqual({
      limiteTransacaoMs: LIMITE_TRANSACAO_PADRAO_MS,
      intervaloMs: INTERVALO_COLETA_MS,
    });
  });

  it('valores na faixa', () => {
    expect(lerConfiguracaoVigia({ VIGIA_TRANSACAO_LIMITE_MS: '1000', VIGIA_INTERVALO_MS: '5000' })).toEqual({
      limiteTransacaoMs: 1_000,
      intervaloMs: 5_000,
    });
  });

  it.each([
    ['VIGIA_TRANSACAO_LIMITE_MS', 'abc'],
    ['VIGIA_TRANSACAO_LIMITE_MS', '0'],
    ['VIGIA_TRANSACAO_LIMITE_MS', '1.5'],
    ['VIGIA_INTERVALO_MS', '0'],
    ['VIGIA_INTERVALO_MS', 'NaN'],
    ['VIGIA_INTERVALO_MS', '999999999'],
  ])('%s=%s é recusado', (chave, valor) => {
    expect(() => lerConfiguracaoVigia({ [chave]: valor })).toThrow(chave);
  });
});

// Integração na fase0 (M11 + M12): a leitura do MON$ com um leitor falso (sem banco), para os ramos de
// valor nulo ou ausente; os números são sintéticos.
describe('leitura do MON$ (leitor falso)', () => {
  const leitor = (respostas: Record<string, Record<string, unknown>[]>): Leitor => ({
    hospital: 'pc',
    consultar: <T>(sql: string) => {
      const chave = Object.keys(respostas).find((k) => sql.includes(k)) ?? '';
      return Promise.resolve((respostas[chave] ?? []) as T[]);
    },
    lerBlob: () => Promise.resolve(Buffer.alloc(0)),
  });

  it('banco ausente vira zero; processo e marca nulos ou ausentes viram null', async () => {
    const l = await lerMon(
      leitor({
        'MON$ATTACHMENTS a WHERE': [
          { ID: 1, PROC: null, MARCA: undefined, PROPRIA: 1 },
          { ID: 2, PROC: 'api', MARCA: 'SGH', PROPRIA: 0 },
          { ID: 3 },
        ],
        'MON$TRANSACTIONS t': [
          { ID: 2, RO: 1, MS: -5, PROPRIA: 0 },
          { ID: 3, RO: 0, MS: 10, PROPRIA: 1 },
        ],
        'MON$STATEMENTS s': [{ ID: 2, ST: 1, MS: -1 }, { ID: 3 }],
        MON$RECORD_STATS: [{ ID: 2, L: 1, W: 2, C: 3 }, { ID: 3 }],
      }),
    );
    expect(l.banco).toEqual({ oit: 0, oat: 0, ost: 0, proxima: 0 });
    expect(l.anexos).toEqual([
      { id: 1, processo: null, marca: null, propria: true },
      { id: 2, processo: 'api', marca: 'SGH', propria: false },
      { id: 3, processo: null, marca: null, propria: false },
    ]);
    expect(l.transacoes).toEqual([
      { anexo: 2, somenteLeitura: true, idadeMs: 0, propria: false },
      { anexo: 3, somenteLeitura: false, idadeMs: 10, propria: true },
    ]);
    expect(l.comandos).toEqual([
      { anexo: 2, estado: 1, idadeMs: 0 },
      { anexo: 3, estado: 0, idadeMs: 0 },
    ]);
    expect(l.travas).toEqual([
      { anexo: 2, travas: 1, esperas: 2, conflitos: 3 },
      { anexo: 3, travas: 0, esperas: 0, conflitos: 0 },
    ]);
  });

  it('coleta com o limite padrão e com limite e alertas externos', async () => {
    const vazio = leitor({ 'MON$DATABASE d': [{ OIT: 1, OAT: 2, OST: 2, NXT: 3 }] });
    const a = await coletar(vazio, { estabelecimento: 'pc' });
    expect(a.estabelecimento).toBe('pc');
    const b = await coletar(vazio, { estabelecimento: 'pc', limiteTransacaoMs: 100, alertasExternos: [] });
    expect(b.estabelecimento).toBe('pc');
  });
});
