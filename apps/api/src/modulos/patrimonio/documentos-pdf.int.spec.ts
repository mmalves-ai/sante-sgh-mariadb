// O termo de baixa em PDF/A (M54, etapa 6; ficha, seção 10, "Documento"): o HTML convertido pelo Gotenberg em PDF/A-2b
// e conferido pelo veraPDF (os mesmos contêineres dos documentos do M09/M15). Dados sintéticos. Pula sem o Gotenberg.
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { converterHtmlEmPdfA, gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { pastaTemporaria, verapdf } from '../documento/integracao.spec-util.js';
import { htmlTermoBaixa } from './documentos.js';
import { BEM_BAIXADO, MOVIMENTO_BAIXA } from './documentos.spec-util.js';

const GOTENBERG = 'http://127.0.0.1:3318';
const no = await gotenbergDisponivel(GOTENBERG);
const pasta = pastaTemporaria('m546-pdf-');
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe.skipIf(!no)('termo de baixa em PDF/A (Gotenberg + veraPDF)', () => {
  it('passa no veraPDF (PDF/A-2b)', async () => {
    const html = htmlTermoBaixa({
      bem: BEM_BAIXADO,
      baixa: MOVIMENTO_BAIXA,
      estabelecimento: 'pc',
      titular: 'HOSPITAL SINTETICO',
      emitidoEm: '2026-10-29T12:00:00Z',
      emitidoPor: 'SINT.PATRIMONIO',
    });
    const a = await converterHtmlEmPdfA(GOTENBERG, html);
    const r = verapdf(pasta, { 'termo-baixa.pdf': a.pdf });
    expect(r.map((x) => [x.arquivo, x.conforme])).toEqual([['termo-baixa.pdf', true]]);
  }, 300_000);
});
