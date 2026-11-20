// Guarda do XML TISS (ficha do M31, regra 4; guarda-xml.int.spec.ts): sobre o S3 do projeto (loopback, Object Lock
// GOVERNANCE no dev), o XML guardado não é sobrescrito (a chave existente é recusada antes de gravar) nem apagado (o
// Object Lock recusa apagar a versão travada sem o desvio de governança). Conteúdo sintético.
import { describe, expect, it } from 'vitest';
import { ClienteS3 } from '../documento/infra/s3.js';
import { armazemXmlS3, retencaoXml } from './armazem-xml.js';

const S3 = process.env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318';
const disponivel = await fetch(S3)
  .then(() => true)
  .catch(() => false);

describe.skipIf(!disponivel)('guarda do XML TISS no S3 com Object Lock', () => {
  it('sobrescrita recusada e versão travada não apaga', async () => {
    const s3 = new ClienteS3({ endpoint: S3, regiao: 'us-east-1' });
    const bucket = 'sgh-teste-tiss-m31';
    const arm = armazemXmlS3(s3, bucket, 'dev');
    const chave = `pc/tiss/lotes/0/INT31-${Date.now()}.xml`;
    const g = await arm.guardar(chave, new TextEncoder().encode('<x>SINTETICO</x>'));
    expect(g.versao).toBeTruthy();
    await expect(arm.guardar(chave, new TextEncoder().encode('<x>OUTRO</x>'))).rejects.toThrow(/imutável/);
    await expect(s3.apagarVersao(bucket, chave, g.versao!)).rejects.toThrow();
    expect(new TextDecoder().decode((await arm.ler(chave))!)).toBe('<x>SINTETICO</x>');
    const r = await s3.retencao(bucket, chave, g.versao!);
    expect(r.modo).toBe('GOVERNANCE');
  }, 120_000);

  it('retenção: COMPLIANCE de 5 anos em homologação e produção; GOVERNANCE curta no dev', () => {
    const agora = new Date('2026-10-23T00:00:00Z');
    expect(retencaoXml('producao', agora)).toEqual({
      modo: 'COMPLIANCE',
      ate: new Date('2031-10-23T00:00:00Z'),
    });
    expect(retencaoXml('homologacao', agora).modo).toBe('COMPLIANCE');
    expect(retencaoXml('dev', agora)).toEqual({ modo: 'GOVERNANCE', ate: new Date('2026-10-24T00:00:00Z') });
  });
});
