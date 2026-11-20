// A guia TISS em PDF/A (ficha do M31, seção 10, "Documento": PDF/A das guias no leiaute oficial conferido no veraPDF):
// a guia da conta sintética pela rota da impressão (sessão real sobre a fonte sintética e a porta em memória), convertida
// pelo Gotenberg do projeto e conferida no veraPDF (PDF/A-2b, 0 regra com falha), por imagem Docker sem rede.
import { rmSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { converterHtmlEmPdfA, gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { pastaTemporaria, verapdf } from '../documento/integracao.spec-util.js';
import { PortaTissMemoria } from './porta-memoria.js';

const GOTENBERG = process.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
const disponivel = await gotenbergDisponivel(GOTENBERG);
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };

describe.skipIf(!disponivel)('guia TISS em PDF/A (veraPDF)', () => {
  let app: NestFastifyApplication;
  const pasta = pastaTemporaria('guia-tiss-');
  beforeAll(async () => {
    const tiss = new PortaTissMemoria({ estado: () => 'verde' });
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha: new RegistradorTrilhaMemoria(),
      tiss,
      armazemXmlTiss: tiss.armazem,
      vigia: null,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('a guia da conta emitida sai em PDF/A-2b sem falha no veraPDF', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.TISS', senha: SENHA },
    });
    const cookie = (r.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const g = await app.inject({ method: 'GET', url: '/api/tiss/guias/9101/impressao', headers: { cookie } });
    expect(g.statusCode).toBe(200);
    // A API converte o leiaute pelo Gotenberg do projeto (sem ele, devolve o HTML: aqui converte como a API faria).
    const pdf = String(g.headers['content-type']).startsWith('application/pdf')
      ? new Uint8Array(g.rawPayload)
      : (await converterHtmlEmPdfA(GOTENBERG, g.body, { metadados: { Title: 'Guia SP/SADT' } })).pdf;
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const v = verapdf(pasta, { 'guia.pdf': pdf });
    console.log(
      `[veraPDF] ${v.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(v[0]).toMatchObject({ conforme: true, regrasFalhas: 0 });
  }, 180_000);
});
