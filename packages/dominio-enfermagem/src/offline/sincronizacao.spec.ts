// Regra 8 do M25: sem rede só checagem, sinal e anotação; ordem da hora real; o servidor relê e abre o conflito, nunca
// sobrescreve; a hora real aceita; o cache cifrado vence no prazo.
import { describe, expect, it } from 'vitest';
import {
  cacheVencido,
  decidirSincronizacao,
  horaRealAceita,
  ordemDeEnvio,
  permitidoSemRede,
  semRepetidos,
} from './sincronizacao.js';

describe('regra 8: sincronização depois da queda de rede', () => {
  it('só checagem, sinal vital e anotação simples sem rede', () => {
    expect(permitidoSemRede('checagem')).toBe(true);
    expect(permitidoSemRede('sinal')).toBe(true);
    expect(permitidoSemRede('anotacao')).toBe(true);
    expect(permitidoSemRede('aprazamento')).toBe(false);
    expect(permitidoSemRede('plantao')).toBe(false);
  });
  it('envia na ordem em que os atos foram feitos (hora real e sequência do aparelho), uma vez cada chave', () => {
    const atos = [
      { chave: 'c3', tipo: 'checagem', horaReal: '2026-10-22T10:05', sequencia: 3 },
      { chave: 'c1', tipo: 'sinal', horaReal: '2026-10-22T10:00', sequencia: 2 },
      { chave: 'c0', tipo: 'checagem', horaReal: '2026-10-22T10:00', sequencia: 1 },
      { chave: 'c1', tipo: 'sinal', horaReal: '2026-10-22T10:00', sequencia: 2 },
    ];
    expect(semRepetidos(ordemDeEnvio(atos)).map((a) => a.chave)).toEqual(['c0', 'c1', 'c3']);
  });
  it('o servidor relê: suspensão ou checagem em qualquer sistema vira conflito; nada sobrescrito', () => {
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'P' })).toEqual({ gravar: true });
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'S' })).toEqual({
      gravar: false,
      conflito: 'suspenso',
    });
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'C' })).toMatchObject({
      conflito: 'suspenso',
    });
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'A' })).toEqual({
      gravar: false,
      conflito: 'jaChecado',
    });
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'N' })).toMatchObject({
      conflito: 'jaChecado',
    });
    expect(decidirSincronizacao({ situacaoLida: 'P', situacaoAtual: 'p' })).toEqual({
      gravar: false,
      conflito: 'mudou',
    });
    // A tela leu outra situação (já checado): mesmo igual agora, não grava.
    expect(decidirSincronizacao({ situacaoLida: 'A', situacaoAtual: 'A' })).toMatchObject({ gravar: false });
  });
  it('a hora real do ato: nem do futuro nem além do prazo do cache', () => {
    const agora = '2026-10-22T12:00';
    expect(horaRealAceita({ horaReal: '2026-10-22T11:00', agora, prazoHoras: 12 })).toBe(true);
    expect(horaRealAceita({ horaReal: '2026-10-22T12:04', agora, prazoHoras: 12 })).toBe(true);
    expect(horaRealAceita({ horaReal: '2026-10-22T12:10', agora, prazoHoras: 12 })).toBe(false);
    expect(horaRealAceita({ horaReal: '2026-10-21T23:59', agora, prazoHoras: 12 })).toBe(false);
  });
  it('o cache do tablet vence no prazo', () => {
    expect(cacheVencido('2026-10-22T00:00', '2026-10-22T12:00', 12)).toBe(false);
    expect(cacheVencido('2026-10-22T00:00', '2026-10-22T12:01', 12)).toBe(true);
  });
});
