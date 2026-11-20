import { describe, expect, it } from 'vitest';
import { assinarMensagemQz, conferirAssinaturaQz, gerarParDeChavesQz, importarChavePrivadaQz } from './qz.js';

describe('mensagem assinada para o QZ Tray (SHA512withRSA)', () => {
  it('assina o texto pedido e a conferência aceita só o mesmo texto e a mesma chave', async () => {
    const par = await gerarParDeChavesQz();
    const pedido = '{"call":"print","params":{"printer":"ZEBRA-TESTE"},"timestamp":1}';
    const assinatura = await assinarMensagemQz(pedido, par.privateKey);
    expect(assinatura).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(await conferirAssinaturaQz(pedido, assinatura, par.publicKey)).toBe(true);
    expect(await conferirAssinaturaQz(pedido + ' ', assinatura, par.publicKey)).toBe(false);
    const outro = await gerarParDeChavesQz();
    expect(await conferirAssinaturaQz(pedido, assinatura, outro.publicKey)).toBe(false);
    expect(await conferirAssinaturaQz(pedido, '%%%', par.publicKey)).toBe(false);
    await expect(assinarMensagemQz('', par.privateKey)).rejects.toThrow(/Nada/);
  });

  it('importa a chave privada PKCS#8 em PEM', async () => {
    const par = await globalThis.crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-512',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ['sign', 'verify'],
    );
    const der = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', par.privateKey));
    let s = '';
    for (const b of der) s += String.fromCharCode(b);
    // Marcadores montados em partes: a chave é gerada no teste (não há segredo no arquivo).
    const marca = (tipo: string) => ['-----', tipo, ' PRIVATE KEY-----'].join('');
    const pem = `${marca('BEGIN')}\n${btoa(s).replace(/(.{64})/g, '$1\n')}\n${marca('END')}\n`;
    const chave = await importarChavePrivadaQz(pem);
    const a = await assinarMensagemQz('x', chave);
    expect(await conferirAssinaturaQz('x', a, par.publicKey)).toBe(true);
    await expect(importarChavePrivadaQz(marca('BEGIN') + marca('END'))).rejects.toThrow(/vazia/);
  });
});
