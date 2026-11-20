// D-CPF-52 (M52.1): o CPF em SGH_PES_* nunca em claro. O HMAC é estável (a busca exata acha a mesma pessoa) e muda com
// a chave; a cifra é aleatória por gravação, decifra com a mesma chave e não decifra com outra nem adulterada. CPF
// sintético; chaves de teste.
import { describe, expect, it } from 'vitest';
import { CifraCpf, chaveCpfDoAmbiente } from './cifra-cpf.js';
import { cpfSintetico } from './porta-memoria.js';

const CPF = cpfSintetico('900520077');

describe('CifraCpf', () => {
  const a = new CifraCpf(Buffer.alloc(32, 1));
  const b = new CifraCpf(Buffer.alloc(32, 2));

  it('HMAC estável, sem o CPF, e diferente por chave; a máscara não muda o valor', () => {
    expect(a.hmac(CPF)).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hmac(CPF)).toBe(
      a.hmac(`${CPF.slice(0, 3)}.${CPF.slice(3, 6)}.${CPF.slice(6, 9)}-${CPF.slice(9)}`),
    );
    expect(a.hmac(CPF)).not.toBe(b.hmac(CPF));
    expect(a.hmac(CPF)).not.toContain(CPF);
  });

  it('cifra aleatória que só a mesma chave decifra; adulterado ou de outra chave: null', () => {
    const x = a.cifrar(CPF);
    expect(x).not.toContain(CPF);
    expect(a.cifrar(CPF)).not.toBe(x);
    expect(a.decifrar(x)).toBe(CPF);
    expect(b.decifrar(x)).toBeNull();
    expect(a.decifrar(`${x.slice(0, -2)}AA`)).toBeNull();
    expect(a.decifrar('v0.x.y.z')).toBeNull();
    expect(a.decifrar(null)).toBeNull();
  });

  it('a chave do ambiente: 32 bytes em hexadecimal ou base64; senão, nenhuma', () => {
    expect(() => new CifraCpf(Buffer.alloc(16))).toThrow();
    expect(chaveCpfDoAmbiente({ PESSOAS_CHAVE_CPF: 'ab'.repeat(32) })?.length).toBe(32);
    expect(
      chaveCpfDoAmbiente({ PLATAFORMA_CHAVE_MESTRA: Buffer.alloc(32, 3).toString('base64') })?.length,
    ).toBe(32);
    expect(chaveCpfDoAmbiente({ PESSOAS_CHAVE_CPF: 'curta' })).toBeNull();
    expect(chaveCpfDoAmbiente({})).toBeNull();
  });

  it('texto pessoal (M53.6): volta igual, com acento; outra chave ou texto adulterado não decifra', () => {
    const c = new CifraCpf(Buffer.alloc(32, 3));
    const t = c.cifrarTexto('{"endereço":"Rua São João, 100"}');
    expect(t).toMatch(/^t1\./);
    expect(c.decifrarTexto(t)).toBe('{"endereço":"Rua São João, 100"}');
    expect(new CifraCpf(Buffer.alloc(32, 4)).decifrarTexto(t)).toBeNull();
    expect(c.decifrarTexto(`${t.slice(0, -2)}xx`)).toBeNull();
    expect(c.decifrarTexto(null)).toBeNull();
    expect(c.decifrarTexto('v1.a.b.c')).toBeNull();
    expect(c.decifrarTexto(c.cifrarTexto(''))).toBe('');
  });
});
