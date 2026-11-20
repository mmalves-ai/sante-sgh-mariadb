// Sessão no Valkey (ficha do M05 §10): o armazém real do Compose sgh (`./pnpm infra:subir`), com chaves
// prefixadas por uma rede de teste única (apagadas no fim). Prova TTL, INCR atômico com prazo, e que a
// sessão e o bloqueio por inatividade valem entre dois processos (duas instâncias do serviço sobre o
// mesmo Valkey). Usuários sintéticos; nenhum dado pessoal. VALKEY_URL: a do ambiente, ou a do Compose
// de dev (.env.example).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoSessao } from './servico-sessao.js';
import { SENHA, entrada, envTeste } from './teste.spec-util.js';
import { ArmazemValkey, ClienteValkey } from './valkey.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';

const URL_VALKEY = process.env['VALKEY_URL']?.trim() || 'redis://127.0.0.1:63718';
const REDE = `rede-int-${randomUUID().slice(0, 8)}`;
const env = { ...envTeste, REDE_PADRAO: REDE };

describe('sessão no Valkey', () => {
  let armazem: ArmazemValkey;
  const chaves: string[] = [];
  const chave = (s: string) => {
    const c = `${REDE}:teste:${s}`;
    chaves.push(c);
    return c;
  };

  beforeAll(() => {
    armazem = new ArmazemValkey(URL_VALKEY);
  });
  afterAll(async () => {
    for (const c of chaves) await armazem.apagar(c);
    await armazem.encerrar();
  });

  it('grava, lê, expira (PX) e apaga', async () => {
    const c = chave('a');
    await armazem.gravar(c, '{"x":1}', 60);
    expect(await armazem.obter(c)).toBe('{"x":1}');
    await armazem.apagar(c);
    expect(await armazem.obter(c)).toBeNull();
    const curta = chave('b');
    await armazem.gravar(curta, 'v', 1);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await armazem.obter(curta)).toBeNull();
  });

  it('consumir (GETDEL) em paralelo: de 20 pedidos simultâneos, só um recebe o valor', async () => {
    const c = chave('uso-unico');
    await armazem.gravar(c, 'desafio', 60);
    const lidos = await Promise.all(Array.from({ length: 20 }, () => armazem.consumir(c)));
    expect(lidos.filter((v) => v === 'desafio')).toHaveLength(1);
    expect(await armazem.obter(c)).toBeNull();
  });

  it('INCR atômico em paralelo: 50 incrementos dão 1..50 sem repetir, e a chave tem prazo', async () => {
    const c = chave('cont');
    const valores = await Promise.all(Array.from({ length: 50 }, () => armazem.incrementar(c, 30)));
    expect([...valores].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const u = new URL(URL_VALKEY);
    const cru = new ClienteValkey(u.hostname, Number(u.port || 6379));
    // Prazo posto (PEXPIRE NX): a chave não fica para sempre.
    expect(await cru.pttl(c)).toBeGreaterThan(0);
    await cru.encerrar();
  });

  it('a sessão e o bloqueio valem entre dois processos sobre o mesmo Valkey', async () => {
    let t = Date.now();
    const a = new ServicoSessao(new FonteAcessoSintetica(env), armazem, () => t);
    const outroArmazem = new ArmazemValkey(URL_VALKEY);
    const b = new ServicoSessao(new FonteAcessoSintetica(env), outroArmazem, () => t);
    try {
      const r = await a.entrar(entrada('SINT.USUARIO'), REDE);
      chaves.push(
        `${REDE}:sessao:${r.idSessao}`,
        `${REDE}:politica:aa`,
        `${REDE}:ultimo-acesso:aa:SINT.USUARIO`,
      );
      chaves.push(`${REDE}:login-tentativas:aa:SINT.USUARIO`);
      expect((await b.ler(r.idSessao, REDE))?.sessao.usuario.login).toBe('SINT.USUARIO');
      t += 1801 * 1000;
      expect((await a.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
      await b.tocar(r.idSessao, REDE);
      expect((await b.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
      expect((await b.reautenticar(r.idSessao, REDE, SENHA)).bloqueada).toBe(false);
      expect((await a.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(false);
      await a.sair(r.idSessao, REDE);
      expect(await b.ler(r.idSessao, REDE)).toBeNull();
    } finally {
      await outroArmazem.encerrar();
    }
  });
});
