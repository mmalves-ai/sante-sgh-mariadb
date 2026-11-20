// Mensagem assinada para o QZ Tray (regra 10 da ficha do M09; cap-09 §9.8): o QZ Tray só imprime em
// silêncio quando cada pedido vem assinado pelo servidor (SHA512withRSA, PKCS#1 v1.5, base64) com a chave
// cujo certificado a estação confia. O servidor assina só o texto que o QZ Tray pede (`toSign`); a chave
// privada nunca sai do servidor. Em dev a chave é de teste (gerada no processo); a da Rede vem no deploy.

import type { webcrypto } from 'node:crypto';

// Só tipos (apagados na compilação): a mesma API WebCrypto existe no Node e no navegador.
type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' } as const;

function base64(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const bin = atob(texto);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function gerarParDeChavesQz(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    false,
    ['sign', 'verify'],
  );
}

/** Importa a chave privada PKCS#8 (PEM) da Rede para assinar. */
export async function importarChavePrivadaQz(pem: string): Promise<CryptoKey> {
  const corpo = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  if (!corpo) throw new Error('Chave privada do QZ Tray vazia.');
  return globalThis.crypto.subtle.importKey('pkcs8', deBase64(corpo), ALGORITMO, false, ['sign']);
}

/** Assina o texto pedido pelo QZ Tray (`toSign`). */
export async function assinarMensagemQz(paraAssinar: string, chavePrivada: CryptoKey): Promise<string> {
  if (!paraAssinar) throw new Error('Nada para assinar.');
  const assinatura = await globalThis.crypto.subtle.sign(
    ALGORITMO,
    chavePrivada,
    new TextEncoder().encode(paraAssinar),
  );
  return base64(assinatura);
}

/** Conferência da assinatura (o mesmo que o QZ Tray faz com o certificado). */
export async function conferirAssinaturaQz(
  paraAssinar: string,
  assinatura: string,
  chavePublica: CryptoKey,
): Promise<boolean> {
  try {
    return await globalThis.crypto.subtle.verify(
      ALGORITMO,
      chavePublica,
      deBase64(assinatura),
      new TextEncoder().encode(paraAssinar),
    );
  } catch {
    return false;
  }
}
