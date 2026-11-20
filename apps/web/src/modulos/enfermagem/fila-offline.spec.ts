// Regra 8 do M25 no aparelho: a fila sem rede é do dono, na ordem do ato, sem repetir a chave, vence no prazo do
// cache e sai inteira ao sair da sessão; o relógio do ato segue o do estabelecimento (o fuso do aparelho não importa).
import { describe, expect, it } from 'vitest';
import { apagarCofreLocal, guardar, lerGuardado } from './cofre-local.js';
import {
  type AtoNaFila,
  corpoDaSincronizacao,
  enfileirar,
  lerFila,
  resolvidos,
  retirar,
} from './fila-offline.js';
import { desvioDoRelogio, horaDoEstabelecimento } from './usar-checagem.js';

const DONO = { rede: 'sint', estabelecimento: 'aa', login: 'SINT.ENF.PLANTAO' };
const OUTRO = { ...DONO, login: 'SINT.TECNICO.ENF' };
const ato = (chave: string): AtoNaFila => ({
  tipo: 'checagem',
  chave,
  horario: 1,
  checagem: { desfecho: 'administrado', situacaoLida: 'P' },
  rotulo: 'Dose',
});

describe('fila da beira do leito (sem rede)', () => {
  it('guarda na ordem, sem repetir a chave, e só para o dono', async () => {
    await apagarCofreLocal();
    await enfileirar(DONO, ato('ato-00000001'), 12);
    await enfileirar(DONO, ato('ato-00000002'), 12);
    await enfileirar(DONO, ato('ato-00000001'), 12);
    expect((await lerFila(DONO, 12)).map((a) => a.chave)).toEqual(['ato-00000001', 'ato-00000002']);
    expect(await lerFila(OUTRO, 12)).toEqual([]);
  });

  it('vence no prazo do cache e some ao sair da sessão', async () => {
    await apagarCofreLocal();
    const t0 = Date.parse('2026-10-22T10:00:00Z');
    await guardar(DONO, 'horarios:1', { x: 1 }, t0);
    expect(await lerGuardado(DONO, 'horarios:1', 12, t0 + 11 * 3_600_000)).toEqual({ x: 1 });
    expect(await lerGuardado(DONO, 'horarios:1', 12, t0 + 13 * 3_600_000)).toBeNull();
    await enfileirar(DONO, ato('ato-00000003'), 12);
    await apagarCofreLocal();
    expect(await lerFila(DONO, 12)).toEqual([]);
  });

  it('retira os resolvidos (aceitos, repetidos e conflitos) e mantém a falha de rede', async () => {
    await apagarCofreLocal();
    for (const k of ['a-00000001', 'a-00000002', 'a-00000003']) await enfileirar(DONO, ato(k), 12);
    const r = resolvidos([
      { chave: 'a-00000001', ok: true, codigo: null },
      { chave: 'a-00000002', ok: false, codigo: 'horario-suspenso', conflito: 9 },
      { chave: 'a-00000003', ok: false, codigo: 'erro' },
    ]);
    expect(r).toEqual(['a-00000001', 'a-00000002']);
    expect((await retirar(DONO, r, 12)).map((a) => a.chave)).toEqual(['a-00000003']);
    expect(corpoDaSincronizacao(await lerFila(DONO, 12))[0]).not.toHaveProperty('rotulo');
  });

  it('a hora real do ato segue o relógio do estabelecimento', () => {
    const agora = Date.parse('2026-10-22T19:00:00Z');
    const desvio = desvioDoRelogio('2026-10-22T16:00', agora);
    expect(horaDoEstabelecimento(desvio, agora + 5 * 60_000)).toBe('2026-10-22T16:05');
    expect(desvioDoRelogio('invalido', agora)).toBe(0);
  });
});
