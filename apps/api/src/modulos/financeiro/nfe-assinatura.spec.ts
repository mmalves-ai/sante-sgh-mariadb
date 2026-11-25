// F7, 07-FIN linha 114: assinatura XMLDSig da NF-e de saída (certificado SINTÉTICO) e a escolha do certificado.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarRaizSintetica, emitirSintetico } from '@sgh/dominio-documento';
import { describe, expect, it } from 'vitest';
import { assinarNfe, certificadoNfe, conferirAssinaturaNfe } from './nfe-assinatura.js';

const agora = new Date('2026-11-25T12:00:00Z');
const CNPJ = '11222333000181';
const CHAVE = '3'.repeat(44);
const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${CHAVE}"><ide><nNF>5</nNF></ide><det nItem="1"><prod><xProd>LUVA &amp; MASCARA</xProd></prod></det></infNFe></NFe>`;

describe('assinatura da NF-e', () => {
  const c = certificadoNfe({}, CNPJ, 'simulador', agora);
  if (!c.ok) throw new Error(c.motivo);
  it('assina infNFe pelo Id e a conferência refaz o resumo e a assinatura', () => {
    const assinado = assinarNfe(xml, c.cert);
    expect(assinado).toContain(`<Reference URI="#NFe${CHAVE}">`);
    expect(assinado).toContain('xmldsig#rsa-sha1');
    expect(assinado.indexOf('<Signature')).toBeGreaterThan(assinado.indexOf('</infNFe>'));
    expect(conferirAssinaturaNfe(assinado)).toEqual({ ok: true, cnpj: CNPJ });
    expect(c.sintetico).toBe(true);
  });
  it('a alteração depois da assinatura é apanhada', () => {
    const assinado = assinarNfe(xml, c.cert);
    const r = conferirAssinaturaNfe(assinado.replace('<nNF>5</nNF>', '<nNF>6</nNF>'));
    expect(r).toEqual({ ok: false, motivo: 'O resumo da NF-e não confere.' });
    expect(() => assinarNfe(assinado, c.cert)).toThrow(/assinada/);
  });
  it('fora do simulador, sem A1 no cofre, não assina; com A1 de outra empresa, recusa', () => {
    expect(certificadoNfe({}, CNPJ, 'sefaz', agora)).toMatchObject({
      ok: false,
      codigo: 'certificado-ausente',
    });
    const raiz = criarRaizSintetica(agora);
    const outro = emitirSintetico(raiz, { cpf: null, nome: 'OUTRA EMPRESA SINTETICA:99888777000161' }, agora);
    const dir = mkdtempSync(join(tmpdir(), 'nfe-a1-'));
    const cert = `-----BEGIN CERTIFICATE-----\n${Buffer.from(outro.certificado)
      .toString('base64')
      .replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;
    writeFileSync(join(dir, 'c.pem'), cert);
    writeFileSync(join(dir, 'k.pem'), outro.chave.export({ type: 'pkcs8', format: 'pem' }).toString());
    const env = { NFE_CERTIFICADO_ARQUIVO: join(dir, 'c.pem'), NFE_CHAVE_ARQUIVO: join(dir, 'k.pem') };
    expect(certificadoNfe(env, CNPJ, 'sefaz', agora)).toMatchObject({
      ok: false,
      codigo: 'certificado-outro-cnpj',
    });
    expect(certificadoNfe(env, '99888777000161', 'sefaz', agora)).toMatchObject({
      ok: true,
      sintetico: false,
    });
  });
});
