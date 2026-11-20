// Cópia local da digitação (M22): só o dono (rede, estabelecimento, login) recebe de volta; vencida, sai; sair da
// sessão apaga tudo. Sem IndexedDB no ambiente de teste: a memória da aba faz o papel do banco do navegador.
import { describe, expect, it } from 'vitest';
import {
  apagarTudoLocal,
  chaveLocal,
  type DonoLocal,
  guardarLocal,
  lerLocal,
  PRAZO_LOCAL_MS,
  type RascunhoLocal,
} from './rascunho-local.js';

const ana: DonoLocal = { rede: 'r1', estabelecimento: 'pc', login: 'SINT.ANA' };
const beto: DonoLocal = { rede: 'r1', estabelecimento: 'pc', login: 'SINT.BETO' };
const anaOutro: DonoLocal = { rede: 'r1', estabelecimento: 'hs', login: 'SINT.ANA' };
const valor = (em = new Date().toISOString()): RascunhoLocal => ({
  paciente: 123,
  modelo: 61,
  atendimento: 9,
  dataHoraClinica: '2026-10-21T10:00',
  justificativa: '',
  respostas: [],
  rascunho: null,
  guardadoEm: em,
});

describe('cópia local da digitação (M22)', () => {
  it('a chave separa usuário e estabelecimento (o paciente 123 de um não é o de outro)', () => {
    const k = (d: DonoLocal) => chaveLocal(d, 123, 61, null);
    expect(new Set([k(ana), k(beto), k(anaOutro)]).size).toBe(3);
    expect(chaveLocal(ana, 123, 61, 7)).not.toBe(k(ana));
  });

  it('só o dono recebe de volta; outro usuário na mesma chave não lê e a cópia sai', async () => {
    const k = chaveLocal(ana, 123, 61, null);
    await guardarLocal(ana, k, valor());
    expect(await lerLocal(beto, k)).toBeNull();
    expect(await lerLocal(ana, k)).toBeNull();
    await guardarLocal(ana, k, valor());
    expect((await lerLocal(ana, k))?.paciente).toBe(123);
    expect(await lerLocal(anaOutro, k)).toBeNull();
  });

  it('vencida (mais de 24 h) não volta', async () => {
    const k = chaveLocal(ana, 123, 61, 5);
    const antiga = new Date(Date.now() - PRAZO_LOCAL_MS - 60_000).toISOString();
    await guardarLocal(ana, k, valor(antiga));
    expect(await lerLocal(ana, k)).toBeNull();
  });

  it('sair da sessão apaga tudo', async () => {
    const k = chaveLocal(ana, 124, 61, null);
    await guardarLocal(ana, k, valor());
    await apagarTudoLocal();
    expect(await lerLocal(ana, k)).toBeNull();
  });
});
