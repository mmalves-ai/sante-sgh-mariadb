// Cifra das contas da plataforma (ADR 0021): Argon2id com sal no formato PHC, verificação em tempo constante,
// envelope AES-256-GCM do segredo TOTP e o convite (só o hash no banco). Senhas sintéticas.
import { describe, expect, it } from 'vitest';
import {
  chaveMestra,
  cifrarSegredo,
  cifrarSenha,
  conferirSenha,
  decifrarSegredo,
  hashConvite,
  novoConvite,
} from './cifra-plataforma.js';

const LEVE = { memoria: 8_192, passes: 1, paralelismo: 1 };

describe('Argon2id', () => {
  it('formato PHC com sal aleatório; confere a certa e recusa a errada', async () => {
    const a = await cifrarSenha('Sintetica#Plataforma1', LEVE);
    const b = await cifrarSenha('Sintetica#Plataforma1', LEVE);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=8192,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('Sintetica');
    expect(await conferirSenha('Sintetica#Plataforma1', a)).toBe(true);
    expect(await conferirSenha('sintetica#plataforma1', a)).toBe(false);
  });
  it('padrão acima do mínimo da OWASP', async () => {
    expect(await cifrarSenha('Sintetica#Plataforma1')).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });
  it('cifra ausente, fora do formato ou com parâmetros fora da faixa nunca confere', async () => {
    expect(await conferirSenha('x', null)).toBe(false);
    expect(await conferirSenha('x', 'texto-puro')).toBe(false);
    const fraca = (await cifrarSenha('x', LEVE)).replace('m=8192', 'm=1024');
    expect(await conferirSenha('x', fraca)).toBe(false);
  });
});

describe('envelope do segredo TOTP', () => {
  it('cifra e decifra com a chave mestra; outra chave ou envelope adulterado falham', () => {
    const k = chaveMestra(Buffer.alloc(32, 7).toString('base64'))!;
    const e = cifrarSegredo('JBSWY3DPEHPK3PXP', k);
    expect(e.startsWith('v1.')).toBe(true);
    expect(e).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decifrarSegredo(e, k)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decifrarSegredo(e, Buffer.alloc(32, 8))).toThrow();
    expect(() => decifrarSegredo('v2.a.b.c', k)).toThrow();
    expect(() => decifrarSegredo(`${e.slice(0, -2)}AA`, k)).toThrow();
  });
  it('chave mestra: 32 bytes em base64, senão null', () => {
    expect(chaveMestra(undefined)).toBeNull();
    expect(chaveMestra('  ')).toBeNull();
    expect(chaveMestra(Buffer.alloc(16).toString('base64'))).toBeNull();
  });
});

describe('convite', () => {
  it('token aleatório; no banco só o hash SHA-256', () => {
    const c = novoConvite();
    expect(c.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.hash).toBe(hashConvite(c.token));
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(novoConvite().token).not.toBe(c.token);
  });
});
